import { html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Person, Setlist } from '../js/data-types.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './icon.ts'
import type { SetlistDetails, SetlistDetailsSaveEvent } from './setlist-details-form.ts'
import './setlist-details-form.ts'
import { setlistTitle } from '../js/utils/date-utils.ts'
import './setlist-info.ts'

/** The setlist's details were edited and saved: changes is the form's details */
export class SetlistInfoSaveEvent extends Event {
  static type = 'setlist-info-dialog:save'
  readonly setlistId: string
  readonly changes: SetlistDetails
  constructor(setlistId: string, changes: SetlistDetails) {
    super(SetlistInfoSaveEvent.type, { bubbles: true, composed: true })
    this.setlistId = setlistId
    this.changes = changes
  }
}

/**
 * SetlistInfoDialog Component
 *
 * Modal dialog showing a setlist's details, with its date and name as the
 * heading. The pencil button in the header switches to an edit form; nothing
 * changes until Save. Cancel, or closing the dialog, discards the edits.
 *
 * The dialog doesn't save anything itself: it fires details-save, and the page
 * saves the setlist and calls show() with the updated one.
 *
 * Usage:
 *   <setlist-info-dialog id="setlist-info-dialog"></setlist-info-dialog>
 *   dialog.show(setlist)
 *
 * Events:
 * @fires SetlistInfoSaveEvent - setlistId, and changes: {date, time, type, name, owner}
 */
export class SetlistInfoDialog extends LitElement {
  static override properties = {
    /** Who can be chosen as leader when editing: [{id, name}] (see people.js) */
    people: { attribute: false },
    _setlist: { state: true },
    _editing: { state: true },
  }

  declare people: Person[]
  declare _setlist: Setlist | null
  declare _editing: boolean

  _modalRef: Ref<AppModal>

  constructor() {
    super()
    this._modalRef = createRef()
    this.people = []
    this._setlist = null
    this._editing = false
  }

  /** Show a setlist's details (read-only until the pencil is pressed) */
  async show(setlist: Setlist): Promise<void> {
    this._setlist = setlist
    this._editing = false
    await this.updateComplete
    this._modal()?.show()
  }

  /** Open straight into editing */
  async edit(setlist: Setlist): Promise<void> {
    await this.show(setlist)
    this._editing = true
  }

  close(): void {
    this._modal()?.close()
  }

  _modal(): AppModal | undefined {
    return this._modalRef.value
  }

  _save(event: SetlistDetailsSaveEvent): void {
    // Re-dispatch from the dialog rather than letting the form's save escape
    event.stopPropagation()
    if (this._setlist) {
      this.dispatchEvent(new SetlistInfoSaveEvent(this._setlist.id, event.details))
    }
  }

  _cancel(event: Event): void {
    event.stopPropagation()
    this._editing = false
  }

  override render() {
    const heading = this._setlist ? setlistTitle(this._setlist, 'long') : 'Setlist info'
    return html`
      <app-modal
        ${ref(this._modalRef)}
        size="fullscreen"
        heading=${this._editing ? `Edit: ${heading}` : heading}
        @app-modal:close=${() => {
          this._editing = false
        }}
      >
        ${
          this._editing
            ? ''
            : html`
              <button
                slot="header-actions"
                class="edit-button"
                aria-label="Edit setlist details"
                @click=${() => {
                  this._editing = true
                }}
              >
                <app-icon name="edit"></app-icon>
              </button>
            `
        }
        ${
          this._editing
            ? html`
              <setlist-details-form
                .setlist=${this._setlist}
                .people=${this.people}
                submit-label="Save"
                @setlist-details-form:save=${this._save}
                @setlist-details-form:cancel=${this._cancel}
              ></setlist-details-form>
            `
            : html`<setlist-info .setlist=${this._setlist}></setlist-info>`
        }
      </app-modal>
    `
  }
}

customElements.define('setlist-info-dialog', SetlistInfoDialog)

declare global {
  interface HTMLElementTagNameMap {
    'setlist-info-dialog': SetlistInfoDialog
  }
}
