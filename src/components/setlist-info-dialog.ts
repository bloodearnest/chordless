import { css, html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Person, Setlist } from '../js/data-types.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './icon.ts'
import type { SetlistDetails, SetlistDetailsSaveEvent } from './setlist-details-form.ts'
import './setlist-details-form.ts'
import { setlistTitle } from '../js/utils/date-utils.ts'
import { buttonStyles } from './shared-styles.ts'
import './setlist-info.ts'

/** The setlist's details were edited and saved: changes is the form's details */
export class SetlistInfoSaveEvent extends Event {
  static readonly type = 'setlist-info-dialog:save'
  readonly setlistId: string
  readonly changes: SetlistDetails
  constructor(setlistId: string, changes: SetlistDetails) {
    super(SetlistInfoSaveEvent.type, { bubbles: true, composed: true })
    this.setlistId = setlistId
    this.changes = changes
  }
}

/** Delete was pressed on a setlist that can be deleted: the page asks, then deletes */
export class SetlistInfoDeleteEvent extends Event {
  static readonly type = 'setlist-info-dialog:delete'
  readonly setlistId: string
  constructor(setlistId: string) {
    super(SetlistInfoDeleteEvent.type, { bubbles: true, composed: true })
    this.setlistId = setlistId
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
 * @fires SetlistInfoDeleteEvent - setlistId; only offered, while editing, for a setlist that is
 *   not in Google Drive
 */
export class SetlistInfoDialog extends LitElement {
  static override properties = {
    /** Who can be chosen as leader when editing: [{id, name}] (see people.js) */
    people: { attribute: false },
    /** A setlist received by link: no editing or deleting */
    readonly: { type: Boolean },
    _setlist: { state: true },
    _editing: { state: true },
  }

  static override styles = [
    buttonStyles,
    css`
      .delete-setlist {
        margin: 1.5rem 1rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .delete-setlist p {
        margin: 0;
        font-size: var(--font-ui-small);
        opacity: 0.7;
      }
    `,
  ]

  declare people: Person[]
  declare readonly: boolean
  declare _setlist: Setlist | null
  declare _editing: boolean

  _modalRef: Ref<AppModal>

  constructor() {
    super()
    this._modalRef = createRef()
    this.people = []
    this.readonly = false
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

  /** Only a setlist that is not in Google Drive can be deleted (see Database.deleteUnsyncedSetlist) */
  _deletable(): boolean {
    return Boolean(this._setlist && !this._setlist.fileRef)
  }

  _delete(): void {
    if (this._setlist && this._deletable()) {
      this.dispatchEvent(new SetlistInfoDeleteEvent(this._setlist.id))
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
          this._editing || this.readonly
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
              <div class="delete-setlist">
                ${
                  this._deletable()
                    ? html`<button class="btn danger" @click=${this._delete}>Delete setlist</button>`
                    : html`<p>This setlist is in Google Drive, so it can't be deleted here.</p>`
                }
              </div>
            `
            : html`
              <setlist-info .setlist=${this._setlist}></setlist-info>
            `
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

declare global {
  interface GlobalEventHandlersEventMap {
    [SetlistInfoSaveEvent.type]: SetlistInfoSaveEvent
    [SetlistInfoDeleteEvent.type]: SetlistInfoDeleteEvent
  }
}
