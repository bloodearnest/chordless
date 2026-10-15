import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import qrcode from 'qrcode-generator'
import type { Setlist } from '../js/data-types.ts'
import type { ChordlessDB } from '../js/db.ts'
import { createSyncManager, isSyncAvailable } from '../js/drive-sync.ts'
import { getCurrentOrganisation } from '../js/organisation.ts'
import { shareUrl } from '../js/share-crypto.ts'
import { createShare, refreshShare, stopShare } from '../js/share-manager.ts'
import { formatSetlistDate, setlistTitle } from '../js/utils/date-utils.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './icon.ts'
import { buttonStyles } from './shared-styles.ts'

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
 * Sharing a setlist by link (docs/SHARING.md Part 2): make the link, show it with a QR code
 * for the room, copy or send it, and stop sharing. The setlist's `share` is saved on the
 * setlist itself; sync keeps the shared copy up to date and ends it when the setlist is past.
 *
 * It is a modal: the explanation and Create, or once shared the link, QR code, Update and Stop.
 * The page opens it from the header's share button (show()), and listens for the change event.
 *
 * Needs the setlist and the organisation's database. Anyone signed in to Google can share,
 * if their account can write to the organisation's Drive folder.
 */
export class SetlistShare extends LitElement {
  /** How long "Copied" is shown (a property for tests to shorten) */
  static copiedMs = 2000

  static override properties = {
    setlist: { attribute: false },
    db: { attribute: false },
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
      const { id, name } = getCurrentOrganisation()
      const manager = await createSyncManager(name, id)
      const share = await createShare(setlist, {
        db,
        organisationId: id,
        organisationFolderId: manager.driveFolderId as string, // (init found or made it)
      })
      setlist.share = share
      await db.saveSetlist(setlist)
      this.requestUpdate()
      this.dispatchEvent(new SetlistShareChangeEvent())
    })
  }

  /** Make the shared copy match the setlist now, rather than at the next sync */
  _update() {
    return this._run(async (setlist, db) => {
      if (!setlist.share) return
      const { id, name } = getCurrentOrganisation()
      const manager = await createSyncManager(name, id)
      const share = await refreshShare(
        { ...setlist, share: setlist.share },
        { db, organisationId: id, organisationFolderId: manager.driveFolderId as string }
      )
      if (share !== setlist.share) {
        setlist.share = share
        await db.saveSetlist(setlist)
      }
      this.requestUpdate()
      this.dispatchEvent(new SetlistShareChangeEvent())
    })
  }

  async _stop() {
    if (!(await this._stopModal.value?.ask())) return
    return this._run(async (setlist, db) => {
      if (!setlist.share) return
      await stopShare(setlist.share)
      setlist.share = null
      await db.saveSetlist(setlist)
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
    this._dialog.value?.show()
  }

  override render() {
    const setlist = this.setlist
    if (!setlist) return nothing
    return html`
      <app-modal ${ref(this._dialog)} size="medium" heading="Share this setlist">
        ${this._renderPanel(setlist.share)}
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

  /** What the modal shows */
  _renderPanel(share: Setlist['share']) {
    if (!share && !this._available) {
      return html`
        <section>
          <p class="note">
            Sign in with Google on the <a href="/storage">Storage page</a> to share this setlist by
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
        Make a link to this setlist for people outside your Chordless organisation, whether or not
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
