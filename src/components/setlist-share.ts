import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import qrcode from 'qrcode-generator'
import type { Setlist } from '../js/data-types.ts'
import type { ChordlessDB } from '../js/db.ts'
import { createSyncManager, isSyncAvailable } from '../js/drive-sync.ts'
import { getCurrentOrganisation } from '../js/organisation.ts'
import { shareUrl } from '../js/share-crypto.ts'
import { createShare, refreshShare, stopShare } from '../js/share-manager.ts'
import { formatSetlistDate } from '../js/utils/date-utils.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles } from './shared-styles.ts'

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
 * Needs the setlist and the organisation's database. Anyone signed in to Google can share,
 * if their account can write to the organisation's Drive folder.
 */
export class SetlistShare extends LitElement {
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
      }

      h3 {
        margin: 0;
        font-size: var(--font-ui);
        font-weight: 600;
        color: var(--text-secondary, #5f6b6d);
        text-transform: uppercase;
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
    try {
      this._available = await isSyncAvailable()
    } catch {
      this._available = false
    }
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
        organisationFolderId: this.#folderOf(manager),
      })
      setlist.share = share
      await db.saveSetlist(setlist)
      this.requestUpdate()
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
        { db, organisationId: id, organisationFolderId: this.#folderOf(manager) }
      )
      if (share !== setlist.share) {
        setlist.share = share
        await db.saveSetlist(setlist)
      }
      this.requestUpdate()
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
    })
  }

  #folderOf(manager: { driveFolderId: string | null }): string {
    if (!manager.driveFolderId) throw new Error("This organisation's Drive folder isn't known yet")
    return manager.driveFolderId
  }

  get _url() {
    const share = this.setlist?.share
    return share ? shareUrl(location.origin, share.fileId, share.key) : ''
  }

  async _copy() {
    try {
      await navigator.clipboard.writeText(this._url)
      this._copied = true
      setTimeout(() => {
        this._copied = false
      }, 2000)
    } catch {
      // Clipboard access can be refused: the link is in the box, selectable
      this.renderRoot.querySelector('input')?.select()
    }
  }

  async _send() {
    try {
      await navigator.share({ title: 'Setlist', url: this._url })
    } catch {
      // Cancelled, or not allowed: nothing to do
    }
  }

  override render() {
    const setlist = this.setlist
    if (!setlist) return nothing
    const share = setlist.share
    if (!share && !this._available) {
      return html`
        <section>
          <h3>Share link</h3>
          <p class="note">
            Sign in with Google on the <a href="/storage">Storage page</a> to share this setlist by
            link.
          </p>
        </section>
      `
    }
    return html`
      <section>
        <h3>Share link</h3>
        ${share ? this._renderShared(share.expires) : this._renderNotShared()}
        ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      </section>
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

  _renderNotShared() {
    return html`
      <p class="note">
        Send this setlist and its charts to people who don't use Chordless. They need no account:
        they open the link and see the set, and can keep it on their phone for the service. The
        link is encrypted, updates when you change the setlist, and stops working two weeks after.
      </p>
      <div class="actions">
        <button class="btn primary" ?disabled=${this._busy} @click=${this._create}>
          ${this._busy ? 'Making link…' : 'Create share link'}
        </button>
      </div>
    `
  }

  _renderShared(expires: string) {
    return html`
      <input readonly aria-label="Share link" .value=${this._url} @focus=${(e: FocusEvent) => (e.target as HTMLInputElement).select()} />
      <div class="actions">
        <button class="btn primary" @click=${this._copy}>${this._copied ? 'Copied' : 'Copy link'}</button>
        ${
          typeof navigator.share === 'function'
            ? html`<button class="btn" @click=${this._send}>Send…</button>`
            : nothing
        }
        <button class="btn" ?disabled=${this._busy} @click=${this._update}>
          ${this._busy ? 'Working…' : 'Update now'}
        </button>
        <button class="btn danger" ?disabled=${this._busy} @click=${this._stop}>Stop sharing</button>
      </div>
      <img src=${qrDataUrl(this._url)} alt="QR code for the share link" />
      <p class="note">
        Ends after ${formatSetlistDate(expires, 'long')}. It updates by itself when you sync; "Update
        now" does it straight away.
      </p>
    `
  }
}

customElements.define('setlist-share', SetlistShare)

declare global {
  interface HTMLElementTagNameMap {
    'setlist-share': SetlistShare
  }
}
