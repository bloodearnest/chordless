import { html, LitElement } from 'lit'
import './app-modal.js'
import './icon.js'
import './setlist-details-form.js'
import { setlistTitle } from '../js/utils/date-utils.js'
import './setlist-info.js'

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
 * @fires details-save - detail: {setlistId, changes: {date, time, type, name, owner}}
 */
export class SetlistInfoDialog extends LitElement {
  static properties = {
    /** Who can be chosen as leader when editing: [{id, name}] (see people.js) */
    people: { attribute: false },
    _setlist: { state: true },
    _editing: { state: true },
  }

  constructor() {
    super()
    this.people = []
    this._setlist = null
    this._editing = false
  }

  /** Show a setlist's details (read-only until the pencil is pressed) */
  async show(setlist) {
    this._setlist = setlist
    this._editing = false
    await this.updateComplete
    this._modal().show()
  }

  /** Open straight into editing */
  async edit(setlist) {
    await this.show(setlist)
    this._editing = true
  }

  close() {
    this._modal()?.close()
  }

  _modal() {
    return this.renderRoot?.querySelector('app-modal')
  }

  _save(event) {
    // Re-dispatch from the dialog rather than letting the form's save escape
    event.stopPropagation()
    this.dispatchEvent(
      new CustomEvent('details-save', {
        bubbles: true,
        composed: true,
        detail: { setlistId: this._setlist.id, changes: event.detail },
      })
    )
  }

  _cancel(event) {
    event.stopPropagation()
    this._editing = false
  }

  render() {
    const heading = this._setlist ? setlistTitle(this._setlist, 'long') : 'Setlist info'
    return html`
      <app-modal
        size="fullscreen"
        heading=${this._editing ? `Edit: ${heading}` : heading}
        @close=${() => {
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
                @save=${this._save}
                @cancel=${this._cancel}
              ></setlist-details-form>
            `
            : html`<setlist-info .setlist=${this._setlist}></setlist-info>`
        }
      </app-modal>
    `
  }
}

customElements.define('setlist-info-dialog', SetlistInfoDialog)
