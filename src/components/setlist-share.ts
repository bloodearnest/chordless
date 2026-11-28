import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import qrcode from 'qrcode-generator'
import type { Setlist } from '../js/data-types.ts'
import type { ChordlessDB } from '../js/db.ts'
import { rich } from '../js/rich-text.ts'
import {
  createServerShare,
  findServerShare,
  type ServerShare,
  serverShareUrl,
  stopServerShare,
} from '../js/server-share.ts'
import { type ListedSong, songListHtml, songListText } from '../js/setlist/song-list-text.ts'
import { shareUrl } from '../js/share-crypto.ts'
import { stopShare } from '../js/share-manager.ts'
import { getCurrentSpace, getSpaceById, onChordless } from '../js/space.ts'
import { workerConnection } from '../js/storage/space-storage.ts'
import { t } from '../js/text.ts'
import { formatSetlistDate, setlistTitle } from '../js/utils/date-utils.ts'
import { errorMessage, failedWith } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './icon.ts'
import { buttonStyles } from './shared-styles.ts'

/** Where the app lives, whatever host this copy runs on (localhost in development) */
const APP_URL = 'https://chordless.app'

/** The setlist was shared, updated or stopped: its `share` has changed */
export class SetlistShareChangeEvent extends Event {
  static readonly type = 'setlist-share:change'
  constructor() {
    super(SetlistShareChangeEvent.type, { bubbles: true, composed: true })
  }
}

/** A QR code for some text, as an image the page can show (black on white, whatever the theme) */
export function qrDataUrl(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createDataURL(8, 4)
}

/**
 * Sharing a setlist by link (docs/SHARING.md): make the link, show it with a QR code
 * for the room, copy or send it, and stop sharing. The setlist's `share` is saved on the
 * setlist itself; sync keeps the shared copy up to date and ends it when the setlist is past.
 *
 * It is a modal: the explanation and Create, or once shared the link, QR code, Update and Stop.
 * The page opens it from the header's share button (show()), and listens for the change event.
 *
 * Needs the setlist and the space's database. Anyone signed in to Google can share,
 * if their account can write to the space's Drive folder.
 */
export class SetlistShare extends LitElement {
  /** How long "Copied" is shown (a property for tests to shorten) */
  static copiedMs = 2000

  static override properties = {
    setlist: { attribute: false },
    db: { attribute: false },
    songs: { attribute: false },
    leader: { type: String },
    linkable: { type: Boolean },
    _mode: { state: true },
    _moved: { state: true },
    _knowsSpace: { state: true },
    _server: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _copied: { state: true },
  }

  static override styles = [
    buttonStyles,
    css`
      :host {
        display: block;
      }

      section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1rem;
      }

      p {
        margin: 0;
        font-size: var(--font-ui-small);
        line-height: 1.4;
      }

      .note {
        opacity: 0.7;
      }

      .error {
        color: var(--color-danger, #e74c3c);
      }

      input {
        width: 100%;
        box-sizing: border-box;
        padding: 0.6rem;
        border-radius: 4px;
        border: 1px solid var(--tint-strong);
        background: var(--tint);
        color: inherit;
        font: inherit;
        font-size: var(--font-ui-small);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      a.btn {
        text-decoration: none;
      }

      .actions.center {
        justify-content: center;
      }

      .link {
        display: flex;
        gap: 0.5rem;
      }

      .link input {
        flex: 1;
        min-width: 0;
      }

      /* Both panels share one cell, so the modal is as tall as the taller and does not jump */
      .panels {
        display: grid;
      }

      .panel {
        grid-area: 1 / 1;
      }

      .panel[inert] {
        visibility: hidden;
      }

      .modes {
        display: flex;
        gap: 0.5rem;
        justify-content: center;
      }

      .modes .btn[aria-pressed='true'] {
        background: var(--button-bg);
        color: #fff;
      }

      textarea {
        width: 100%;
        box-sizing: border-box;
        min-height: 18rem;
        padding: 0.6rem;
        border-radius: 4px;
        border: 1px solid var(--tint-strong);
        background: var(--tint);
        color: inherit;
        font: inherit;
        font-size: var(--font-ui-small);
        resize: vertical;
      }

      ul {
        margin: 0;
        padding-left: 1.25rem;
        font-size: var(--font-ui-small);
        line-height: 1.5;
      }

      img {
        align-self: center;
        width: min(16rem, 100%);
        height: auto;
        image-rendering: pixelated;
        border-radius: 4px;
      }
    `,
  ]

  declare setlist: Setlist | null
  declare db: ChordlessDB | null
  /** The setlist's songs (RuntimeSongs), for the song list */
  declare songs: ListedSong[]
  /** The leader's name, for the song list */
  declare leader: string
  /** The setlist can be shared by link (not for a read-only space) */
  declare linkable: boolean
  declare _mode: 'link' | 'list'
  /** The setlist's space is on Chordless (moved, or a church's team): its links are the Worker's, not Drive's */
  declare _moved: boolean
  /** Whether it is known yet if the space is stored on Chordless (until then the dialog does not say which way to share) */
  declare _knowsSpace: boolean
  declare _busy: boolean
  declare _server: ServerShare | null | undefined
  declare _error: string
  declare _copied: boolean

  _stopModal: Ref<AppModal> = createRef()
  _dialog: Ref<AppModal> = createRef()

  constructor() {
    super()
    this.setlist = null
    this.db = null
    this.songs = []
    this.leader = ''
    this.linkable = true
    this._mode = 'link'
    this._moved = false
    this._knowsSpace = false
    this._server = undefined
    this._busy = false
    this._error = ''
    this._copied = false
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('db')) void this._askSpace()
    if (changed.has('_moved') || changed.has('setlist')) void this._loadServer()
  }

  /** Whether the setlist's space is stored on Chordless: the dialog says nothing of how to share until it is known */
  async _askSpace() {
    const space = await getSpaceById(this.db?.spaceId ?? getCurrentSpace().id)
    this._moved = onChordless(space)
    this._knowsSpace = true
  }

  /** The Worker, for a space stored on Chordless (a test gives its own: the real one needs a session) */
  /* v8 ignore next 2 -- the real connection is the signed-in person's: the calls it makes are tested in server-share.test.ts */
  connection = workerConnection

  /** Make sure the Worker has the setlist before it is shared (a test gives its own) */
  /* v8 ignore next 3 -- needs the account and the database of the device: space-data-runtime is tested above it */
  syncFirst: (spaceId: string) => Promise<void> = async spaceId =>
    (await import('../js/space-data-runtime.ts')).syncSpaceDataFor(spaceId)

  /** Whether the setlist is shared, by either kind of link (the share button is lit by it) */
  get shared(): boolean {
    return Boolean(this.setlist?.share || this._server)
  }

  /** Ask the Worker whether a setlist of a space stored on Chordless is shared (offline, it is not known) */
  async _loadServer() {
    const setlist = this.setlist
    if (!this._moved || !setlist || !navigator.onLine) return
    try {
      this._server = await findServerShare(this.connection(), setlist.id)
    } catch (error) {
      // (a setlist the Worker does not have yet is not shared; anything else is not known)
      console.warn('[Share] Could not ask whether it is shared:', errorMessage(error))
      return
    }
    this.dispatchEvent(new SetlistShareChangeEvent())
  }

  override async connectedCallback() {
    super.connectedCallback()
    // (a page gives the database after this; a dialog that is not given one is of the current space)
    if (!this.db) void this._askSpace()
  }

  /** Make the link, or bring an existing share up to date, and save it on the setlist */
  async _run(work: (setlist: Setlist, db: ChordlessDB) => Promise<void>) {
    const { setlist, db } = this
    if (!setlist || !db || this._busy) return
    this._busy = true
    this._error = ''
    try {
      await work(setlist, db)
    } catch (error) {
      console.error('[Share] Failed:', error)
      this._error = navigator.onLine
        ? failedWith(
            error,
            t('share-failed', { reason: errorMessage(error) }),
            t('share-failed-plain')
          )
        : t('share-offline-note')
    } finally {
      this._busy = false
    }
  }

  _create() {
    return this._run(async (setlist, db) => {
      // (the Worker reads the setlist itself, so it must have the setlist as it is)
      await this.syncFirst(db.spaceId)
      this._server = await createServerShare(this.connection(), setlist.id)
      this.dispatchEvent(new SetlistShareChangeEvent())
    })
  }

  async _stop() {
    if (!(await this._stopModal.value?.ask())) return
    return this._run(async (setlist, db) => {
      if (this._moved && this._server) {
        await stopServerShare(this.connection(), this._server.shareId)
        this._server = null
        this.dispatchEvent(new SetlistShareChangeEvent())
        return
      }
      if (!setlist.share) return
      await stopShare(setlist.share)
      setlist.share = null
      await db.updateSetlist(setlist.id, stored => {
        stored.share = null
      })
      this.requestUpdate()
      this.dispatchEvent(new SetlistShareChangeEvent())
    })
  }

  get _url() {
    if (this._server) return serverShareUrl(location.origin, this._server.shareId)
    const share = this.setlist?.share
    return share ? shareUrl(location.origin, share.fileId, share.key, this.setlist?.id) : ''
  }

  async _copy() {
    try {
      await navigator.clipboard.writeText(this._url)
      this._copied = true
      setTimeout(() => {
        this._copied = false
      }, SetlistShare.copiedMs)
    } catch {
      // Clipboard access can be refused: the link is in the box, selectable
      this.renderRoot.querySelector('input')?.select()
    }
  }

  /** The setlist's date, name, event and leader, then its songs with their CCLI numbers */
  _songListText(setlist: Setlist) {
    return songListText(this.songs, { date: setlist.date, leader: this.leader })
  }

  /** The first line of the song list ("Songs for Sunday 18th October"): the email's subject */
  _listSubject(setlist: Setlist) {
    return this._songListText(setlist).split('\n')[0]
  }

  /** The email's body: no title line (the subject), links to SongSelect, and a signature */
  _listEmailBody(setlist: Setlist) {
    const list = songListText(
      this.songs,
      { date: setlist.date, leader: this.leader },
      { title: false, links: true }
    )
    return `${list}\n\n--\n${t('share-signature', { url: APP_URL })}\n`
  }

  /**
   * An email with the song list and no address, for the user to fill in. Gmail's compose window
   * where there is no share sheet (a desktop: mailto: does nothing without a mail app set up),
   * else mailto:, which phones and tablets handle.
   */
  _listEmail(setlist: Setlist) {
    const subject = encodeURIComponent(this._listSubject(setlist))
    const body = encodeURIComponent(this._listEmailBody(setlist))
    return typeof navigator.share === 'function'
      ? `mailto:?subject=${subject}&body=${body}`
      : `https://mail.google.com/mail/?view=cm&su=${subject}&body=${body}`
  }

  /** Rich text (titles link to SongSelect) with the plain text as well, where the browser can */
  async _writeList(setlist: Setlist) {
    const text = this._songListText(setlist)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob(
            [songListHtml(this.songs, { date: setlist.date, leader: this.leader })],
            { type: 'text/html' }
          ),
        }),
      ])
    } catch {
      await navigator.clipboard.writeText(text)
    }
  }

  async _copyList(setlist: Setlist) {
    try {
      await this._writeList(setlist)
      this._copied = true
      setTimeout(() => {
        this._copied = false
      }, SetlistShare.copiedMs)
    } catch {
      // Clipboard access can be refused: the text is in the box, selectable
      this.renderRoot.querySelector('textarea')?.select()
    }
  }

  /** What to say with the link, in a message */
  get _message() {
    const setlist = this.setlist
    if (!setlist || !this.shared) return ''
    return t('share-message', { title: setlistTitle(setlist) })
  }

  /** Where to send people when there is no share sheet (Chrome on Linux has none) */
  get _whatsapp() {
    return `https://wa.me/?text=${encodeURIComponent(`${this._message}\n\n${this._url}`)}`
  }

  /** Gmail's compose window: a mailto: link does nothing on a desktop with no mail app set up */
  get _gmail() {
    const subject = t('share-subject', { title: this.setlist ? setlistTitle(this.setlist) : '' })
    const body = `${this._message}\n\n${this._url}\n`
    return `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  /** The phone's (or the system's) share sheet: WhatsApp, Messages, and so on */
  async _send() {
    try {
      await navigator.share({
        title: t('share-subject', { title: this.setlist ? setlistTitle(this.setlist) : '' }),
        text: this._message,
        url: this._url,
      })
    } catch {
      // Cancelled, or not allowed: nothing to do
    }
  }

  /** Open the dialog */
  show() {
    // Without the link (read-only), the list is all there is
    if (!this.linkable) this._mode = 'list'
    this._dialog.value?.show()
  }

  override render() {
    const setlist = this.setlist
    if (!setlist) return nothing
    return html`
      <app-modal ${ref(this._dialog)} size="large" heading=${t('share-heading')}>
        ${this.linkable ? this._renderModes() : nothing}
        <div class="panels">
          ${
            this.linkable
              ? html`<div class="panel" ?inert=${this._mode !== 'link'}>
                  ${this._renderPanel(setlist.share)}
                </div>`
              : nothing
          }
          <div class="panel" ?inert=${this.linkable && this._mode !== 'list'}>
            ${this._renderList(setlist)}
          </div>
        </div>
      </app-modal>
      <app-modal
        ${ref(this._stopModal)}
        type="confirm"
        size="small"
        heading=${t('confirm-share-stop-heading')}
        confirm-label=${t('confirm-share-stop-button')}
        message=${t('confirm-share-stop-message')}
      ></app-modal>
    `
  }

  /** Link or song list */
  _renderModes() {
    const button = (mode: 'link' | 'list', label: string) => html`
      <button
        class="btn"
        id="mode-${mode}"
        aria-pressed=${this._mode === mode}
        @click=${() => {
          this._mode = mode
          this._copied = false
        }}
      >${label}</button>
    `
    return html`<div class="modes" style="padding: 1rem 1rem 0">
      ${button('link', t('share-mode-link'))} ${button('list', t('share-mode-list'))}
    </div>`
  }

  /** The song list to paste (to the media team, say) */
  _renderList(setlist: Setlist) {
    return html`
      <section>
        <p>${t('share-list-text')}</p>
        <textarea readonly aria-label=${t('share-list-label')} .value=${this._songListText(setlist)}></textarea>
        <div class="actions center">
          <button class="btn primary" id="copy-song-list" @click=${() => this._copyList(setlist)}>
            <app-icon name=${this._copied ? 'check' : 'copy'} size="18"></app-icon>
            ${this._copied ? t('storage-copied') : t('share-list-copy')}
          </button>
          <a class="btn" id="email-song-list" href=${this._listEmail(setlist)} target="_blank" rel="noopener">
            ${t('share-list-email')}
          </a>
        </div>
      </section>
    `
  }

  /** What the modal shows */
  _renderPanel(share: Setlist['share']) {
    if (!this._knowsSpace && !share)
      return html`<section><p class="note" id="share-checking">${t('share-checking')}</p></section>`
    if (this._moved) {
      // (a link made before the move, to the Drive file, is still copied and stopped as it was, until the files are deleted)
      return html`
        <section>
          ${
            share
              ? this._renderShared(formatSetlistDate(share.expires, 'long'), false)
              : this._server
                ? this._renderShared(
                    formatSetlistDate(this._server.expiresAt.slice(0, 10), 'long'),
                    true
                  )
                : this._server === null
                  ? this._renderNotShared(true)
                  : html`<p class="note" id="share-checking">${navigator.onLine ? t('share-checking') : t('share-offline-note')}</p>`
          }
          ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
        </section>
      `
    }
    if (!share) {
      return html`
        <section>
          <p class="note">
            ${rich('share-sign-in', undefined, { account: words => html`<a href="/account">${words}</a>` })}
          </p>
        </section>
      `
    }
    return html`
      <section>
        ${this._renderShared(formatSetlistDate(share.expires, 'long'), false)}
        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      </section>
    `
  }

  _renderNotShared(onServer = false) {
    return html`
      <p>${t('share-link-text')}</p>
      <ul>
        <li>${t('share-link-point-1')}</li>
        <li>${t('share-link-point-2')}</li>
        <li>${onServer ? t('share-server-point-3') : t('share-link-point-3')}</li>
        <li>${t('share-link-point-4')}</li>
      </ul>
      <div class="actions center">
        <button class="btn primary" ?disabled=${this._busy} @click=${this._create}>
          ${this._busy ? t('share-making') : t('share-create')}
        </button>
      </div>
    `
  }

  /** The link, its QR code and how to stop it. `ends` is the date in words; a link on Chordless has nothing to update */
  _renderShared(ends: string, onServer: boolean) {
    return html`
      <div class="link">
        <input readonly aria-label=${t('share-link-label')} .value=${this._url} @focus=${(e: FocusEvent) => (e.target as HTMLInputElement).select()} />
        <button class="btn icon-button" aria-label=${t('share-copy-link')} @click=${this._copy}>
          <app-icon name=${this._copied ? 'check' : 'copy'} size="20"></app-icon>
        </button>
      </div>
      <div class="actions center">
        ${
          typeof navigator.share === 'function'
            ? html`<button class="btn primary" id="share-to" @click=${this._send}>${t('share-to')}</button>`
            : html`
              <a class="btn primary" id="share-whatsapp" href=${this._whatsapp} target="_blank" rel="noopener">${t('share-whatsapp')}</a>
              <a class="btn" id="share-gmail" href=${this._gmail} target="_blank" rel="noopener">${t('share-gmail')}</a>
            `
        }
      </div>
      <img src=${qrDataUrl(this._url)} alt=${t('share-qr')} />
      <p class="note">
        ${onServer ? t('share-server-ends', { date: ends }) : t('share-ends', { date: ends })}
      </p>
      <div class="actions center">
        <button class="btn danger" ?disabled=${this._busy} @click=${this._stop}>${t('confirm-share-stop-button')}</button>
      </div>
    `
  }
}

customElements.define('setlist-share', SetlistShare)

declare global {
  interface HTMLElementTagNameMap {
    'setlist-share': SetlistShare
  }
}
