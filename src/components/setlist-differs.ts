import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Setlist } from '../js/data-types.ts'
import type { ChordlessDB } from '../js/db.ts'
import { revertSetlistToOfficial } from '../js/sync/revert.ts'
import { toast } from '../js/toast.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles } from './shared-styles.ts'

/** The setlist was put back to the official one: the page should show it again */
export class SetlistRevertedEvent extends Event {
  static readonly type = 'setlist-differs:reverted'
  constructor() {
    super(SetlistRevertedEvent.type, { bubbles: true, composed: true })
  }
}

/**
 * What the header's "differs from official" button opens, for a user who can only read the
 * setlist's Drive folder and has changed it here: those changes stay on this device (a pull
 * leaves them, nothing is uploaded), and this offers to put the setlist back to the official one.
 */
export class SetlistDiffers extends LitElement {
  static override properties = {
    setlist: { attribute: false },
    db: { attribute: false },
    _busy: { state: true },
  }

  static override styles = [
    buttonStyles,
    css`
      p {
        margin: 0 0 1rem;
        line-height: 1.5;
      }
    `,
  ]

  declare setlist: Setlist | null
  declare db: ChordlessDB | null
  declare _busy: boolean
  _dialog: Ref<AppModal> = createRef()

  constructor() {
    super()
    this.setlist = null
    this.db = null
    this._busy = false
  }

  show() {
    this._dialog.value?.show()
  }

  async _revert() {
    if (!this.setlist || !this.db) return
    this._busy = true
    try {
      await revertSetlistToOfficial(this.db, this.setlist)
      this._dialog.value?.close()
      this.dispatchEvent(new SetlistRevertedEvent())
    } catch (error) {
      toast("Couldn't put the setlist back to the official one.", {
        kind: 'error',
        details: errorMessage(error),
      })
    } finally {
      this._busy = false
    }
  }

  override render() {
    if (!this.setlist) return nothing
    return html`
      <app-modal ${ref(this._dialog)} size="medium" heading="Differs from the official setlist">
        <p>
          You can only read this organisation's Google Drive folder, so the changes you made to
          this setlist stay on this device. Nothing is uploaded, and what the leader changes in
          Drive does not replace them.
        </p>
        <button class="btn" id="revert-to-official" ?disabled=${this._busy} @click=${() => this._revert()}>
          ${this._busy ? 'Putting it back…' : 'Put it back to the official setlist'}
        </button>
      </app-modal>
    `
  }
}
customElements.define('setlist-differs', SetlistDiffers)

declare global {
  interface HTMLElementTagNameMap {
    'setlist-differs': SetlistDiffers
  }
}
