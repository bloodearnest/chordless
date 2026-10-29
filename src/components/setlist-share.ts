import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import qrcode from 'qrcode-generator'
import type { Setlist } from '../js/data-types.ts'
import type { ChordlessDB } from '../js/db.ts'
import { type ListedSong, songListHtml, songListText } from '../js/setlist/song-list-text.ts'
import { shareUrl } from '../js/share-crypto.ts'
import { createShare, refreshShare, stopShare } from '../js/share-manager.ts'
import { getCurrentSpace } from '../js/space.ts'
import { createSyncManager, isSyncAvailable } from '../js/sync-manager.ts'
import { formatSetlistDate, setlistTitle } from '../js/utils/date-utils.ts'
import { errorMessage } from '../js/utils/errors.ts'
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
    _available: { state: true },
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
  declare _available: boolean
  declare _busy: boolean
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
    this._available = false
    this._busy = false
    this._error = ''
    this._copied = false
  }

  override async connectedCallback() {
    super.connectedCallback()
    // (a failed check is no access: it does not throw)
    this._available = await isSyncAvailable()
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
        ? `Couldn't do that: ${errorMessage(error)}`
        : "You're offline: connect to the internet to share."
    } finally {
      this._busy = false
    }
  }

  _create() {
    return this._run(async (setlist, db) => {
      const { id, name } = getCurrentSpace()
      const manager = await createSyncManager(name, id)
      const share = await createShare(setlist, {
        db,
        spaceId: id,
        space: manager.space, // (init found or made its folder)
      })
      setlist.share = share
      // (on the setlist as it is stored now: making the share took a while)
      await db.updateSetlist(setlist.id, stored => {
        stored.share = share
      })
      this.requestUpdate()
      this.dispatchEvent(new SetlistShareChangeEvent())
    })
  }

  /** Make the shared copy match the setlist now, rather than at the next sync */
  _update() {
    return this._run(async (setlist, db) => {
      if (!setlist.share) return
      const { id, name } = getCurrentSpace()
      const manager = await createSyncManager(name, id)
      const share = await refreshShare(
        { ...setlist, share: setlist.share },
        { db, spaceId: id, space: manager.space }
      )
      if (share !== setlist.share) {
        setlist.share = share
        await db.updateSetlist(setlist.id, stored => {
          stored.share = share
        })
      }
      this.requestUpdate()
      this.dispatchEvent(new SetlistShareChangeEvent())
    })
  }

  async _stop() {
    if (!(await this._stopModal.value?.ask())) return
    return this._run(async (setlist, db) => {
      if (!setlist.share) return
      const { id, name } = getCurrentSpace()
      const manager = await createSyncManager(name, id)
      await stopShare(setlist.share, manager.space)
      setlist.share = null
      await db.updateSetlist(setlist.id, stored => {
        stored.share = null
      })
      this.requestUpdate()
      this.dispatchEvent(new SetlistShareChangeEvent())
    })
  }

  get _url() {
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
    return `${list}\n\n--\nSent from Chordless: ${APP_URL}\n`
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
    if (!setlist?.share) return ''
    return `Chordless setlist: ${setlistTitle(setlist)}. It opens in your browser, no login needed.`
  }

  /** Where to send people when there is no share sheet (Chrome on Linux has none) */
  get _whatsapp() {
    return `https://wa.me/?text=${encodeURIComponent(`${this._message}\n\n${this._url}`)}`
  }

  /** Gmail's compose window: a mailto: link does nothing on a desktop with no mail app set up */
  get _gmail() {
    const subject = `Setlist: ${this.setlist ? setlistTitle(this.setlist) : ''}`
    const body = `${this._message}\n\n${this._url}\n`
    return `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  /** The phone's (or the system's) share sheet: WhatsApp, Messages, and so on */
  async _send() {
    try {
      await navigator.share({
        title: `Setlist: ${this.setlist ? setlistTitle(this.setlist) : ''}`,
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
      <app-modal ${ref(this._dialog)} size="large" heading="Share this setlist">
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
        heading="Stop sharing?"
        confirm-label="Stop sharing"
        message="Anyone with the link will lose access, and their copy is removed the next time they open it. You can make a new link later."
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
      ${button('link', 'Link / QR')} ${button('list', 'Song list')}
    </div>`
  }

  /** The song list to paste (to the media team, say) */
  _renderList(setlist: Setlist) {
    return html`
      <section>
        <p>The details and songs as text, with CCLI numbers, to paste into a message.</p>
        <textarea readonly aria-label="Song list" .value=${this._songListText(setlist)}></textarea>
        <div class="actions center">
          <button class="btn primary" id="copy-song-list" @click=${() => this._copyList(setlist)}>
            <app-icon name=${this._copied ? 'check' : 'copy'} size="18"></app-icon>
            ${this._copied ? 'Copied' : 'Copy song list'}
          </button>
          <a class="btn" id="email-song-list" href=${this._listEmail(setlist)} target="_blank" rel="noopener">
            Email song list
          </a>
        </div>
      </section>
    `
  }

  /** What the modal shows */
  _renderPanel(share: Setlist['share']) {
    if (!share && !this._available) {
      return html`
        <section>
          <p class="note">
            Sign in with Google on the <a href="/account">Account and Teams page</a> to share this setlist by
            link.
          </p>
        </section>
      `
    }
    return html`
      <section>
        ${share ? this._renderShared(share.expires) : this._renderNotShared()}
        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      </section>
    `
  }

  _renderNotShared() {
    return html`
      <p>
        Make a link to this setlist for people outside your Chordless space, whether or not
        they use Chordless.
      </p>
      <ul>
        <li>They need no account or install, and can keep it on their phone.</li>
        <li>They can read it, but not change it.</li>
        <li>It updates when you change the setlist, and ends two weeks after its date.</li>
        <li>Anyone with the link can open it. You can stop sharing at any time.</li>
      </ul>
      <div class="actions center">
        <button class="btn primary" ?disabled=${this._busy} @click=${this._create}>
          ${this._busy ? 'Making link…' : 'Create share link'}
        </button>
      </div>
    `
  }

  _renderShared(expires: string) {
    return html`
      <div class="link">
        <input readonly aria-label="Share link" .value=${this._url} @focus=${(e: FocusEvent) => (e.target as HTMLInputElement).select()} />
        <button class="btn icon-button" aria-label="Copy link" @click=${this._copy}>
          <app-icon name=${this._copied ? 'check' : 'copy'} size="20"></app-icon>
        </button>
      </div>
      <div class="actions center">
        ${
          typeof navigator.share === 'function'
            ? html`<button class="btn primary" id="share-to" @click=${this._send}>Share to…</button>`
            : html`
              <a class="btn primary" id="share-whatsapp" href=${this._whatsapp} target="_blank" rel="noopener">WhatsApp</a>
              <a class="btn" id="share-gmail" href=${this._gmail} target="_blank" rel="noopener">Email (Gmail)</a>
            `
        }
      </div>
      <img src=${qrDataUrl(this._url)} alt="QR code for the share link" />
      <p class="note">
        Ends after ${formatSetlistDate(expires, 'long')}. It updates by itself when you sync; "Update
        now" does it straight away.
      </p>
      <div class="actions center">
        <button class="btn" ?disabled=${this._busy} @click=${this._update}>
          ${this._busy ? 'Working…' : 'Update now'}
        </button>
        <button class="btn danger" ?disabled=${this._busy} @click=${this._stop}>Stop sharing</button>
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
