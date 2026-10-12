import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { DialogPopup } from '../js/dialog-popup.ts'

/**
 * OptionPicker: a label and a value which, in edit mode, is a button opening
 * a popup of options to choose from (a modal <dialog>: see DialogPopup). key-selector and capo-selector extend
 * it, giving their options and the event they send:
 *
 *   _options() { return [{ value, label, hint }] }
 *   _changeEvent(value) { return new KeyChangeEvent(value) }
 *
 * Outside edit mode the value is plain text. Choosing a different option
 * closes the popup and sends a ChangeEvent with the chosen value; the owner
 * sets value in response.
 *
 * Colours follow the text colour (--header-text, for the navy header), so a
 * light context can restyle it by setting --header-text and --header-bg.
 *
 * @property {String} label - Shown before the value, with a colon (optional)
 * @property {Boolean} editMode - Whether the value can be changed (attribute edit-mode)
 */
/** One choice in the popup */
export interface PickerOption<V> {
  value: V
  label: string
  hint: string
}

export abstract class OptionPicker<V extends string | number> extends LitElement {
  static override properties = {
    label: { type: String },
    editMode: { type: Boolean, attribute: 'edit-mode', reflect: true },
  }

  declare label: string
  declare editMode: boolean
  /** The current value; the subclasses declare their properties and set a default */
  declare value: V

  _button: Ref<HTMLButtonElement>
  _popup: DialogPopup

  static override styles = css`
    :host {
      display: contents;
    }

    .meta-label {
      opacity: 0.8;
      font-size: var(--font-ui-small);
      color: var(--header-text, #fff);
      margin: 0;
    }

    .picker-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2.5rem;
      min-height: 2.5rem;
      padding: 0.4rem 0.6rem;
      border: 2px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--header-text, #fff);
      font-family: inherit;
      font-size: var(--font-ui);
      text-align: center;
      white-space: nowrap;
      cursor: default;
      pointer-events: none;
      transition: all 0.2s;
    }

    /* In edit mode, it looks and behaves like a button */
    :host([edit-mode]) .picker-button {
      background-color: color-mix(in srgb, currentColor 20%, transparent);
      border-color: color-mix(in srgb, currentColor 30%, transparent);
      cursor: pointer;
      pointer-events: auto;
    }

    .picker-popover {
      margin: 0;
      inset: unset;
      max-height: 70vh;
      overflow-y: auto;
      padding: 0.5rem;
      border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
      border-radius: 8px;
      background-color: var(--header-bg, #2c3e50);
      color: var(--header-text, #fff);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .picker-popover::backdrop {
      background-color: rgba(0, 0, 0, 0.3);
    }

    .picker-option {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      width: 100%;
      padding: 0.75rem 1rem;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font-family: inherit;
      font-size: var(--font-ui);
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .picker-option:hover {
      background-color: color-mix(in srgb, currentColor 20%, transparent);
    }

    .picker-option.selected {
      background-color: color-mix(in srgb, currentColor 30%, transparent);
    }

    .option-hint {
      color: color-mix(in srgb, currentColor 60%, transparent);
    }
  `

  constructor() {
    super()
    this._button = createRef()
    this._popup = new DialogPopup(this, { position: dialog => this._positionPopover(dialog) })
    this.label = ''
    this.editMode = false
  }

  /** The options: [{value, label, hint}] (subclasses implement it) */
  abstract _options(): PickerOption<V>[]

  /** The event sent when a different option is chosen (subclasses implement it) */
  abstract _changeEvent(value: V): Event

  /** The value as shown on the button */
  _displayValue(): string | number {
    return this.value ?? '-'
  }

  _choose(value: V): void {
    if (value === this.value) return
    this._popup.close()
    this.dispatchEvent(this._changeEvent(value))
  }

  /**
   * As the popup opens, put it under the button, or above it if there's
   * more room there, kept within the screen
   */
  _positionPopover(popover: HTMLDialogElement): void {
    const buttonElement = this._button.value
    if (!buttonElement) return
    const button = buttonElement.getBoundingClientRect()
    const margin = 8
    const height = popover.offsetHeight
    const below = window.innerHeight - button.bottom - margin
    const above = button.top - margin
    let top = below >= height || below >= above ? button.bottom + 4 : button.top - height - 4
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin))
    const left = Math.max(
      margin,
      Math.min(button.left, window.innerWidth - popover.offsetWidth - margin)
    )
    popover.style.top = `${top}px`
    popover.style.left = `${left}px`
  }

  override render() {
    return html`
      ${this.label ? html`<span class="meta-label">${this.label}:</span>` : ''}
      <button
        ${ref(this._button)}
        class="picker-button"
        type="button"
        aria-haspopup="listbox"
        aria-label=${this.label ? `${this.label}: ${this._displayValue()}` : nothing}
        aria-expanded=${this._popup.isOpen ? 'true' : 'false'}
        @click=${() => this._popup.toggle()}
      >
        ${this._displayValue()}
      </button>
      <dialog
        id="options"
        ${ref(this._popup.ref)}
        class="picker-popover"
        aria-label=${this.label || 'Options'}
        @click=${this._popup.onClick}
        @close=${this._popup.onClose}
      >
        <div role="listbox" aria-label=${this.label || 'Options'}>
          ${this._options().map(
            option => html`
              <button
                type="button"
                role="option"
                class="picker-option ${option.value === this.value ? 'selected' : ''}"
                aria-selected=${option.value === this.value ? 'true' : 'false'}
                @click=${() => this._choose(option.value)}
              >
                <span class="option-label">${option.label}</span>
                <span class="option-hint">${option.hint}</span>
              </button>
            `
          )}
        </div>
      </dialog>
    `
  }
}
