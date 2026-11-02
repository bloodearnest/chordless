import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { DialogPopup } from '../js/dialog-popup.ts'
import { frameBounds } from '../js/utils/frame.ts'
import type { RangeNote } from '../js/voice-range.ts'

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
  /** How the option fares for the melody's range (key-selector), shown by a mark and words, not by colour alone */
  range?: RangeNote
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
      /* A host may be non-interactive (song-card's controls, outside edit mode); the popup is not */
      pointer-events: auto;
      max-height: 70dvh;
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

    .option-end {
      display: inline-flex;
      align-items: baseline;
      gap: 1rem;
    }

    /*
     * A key's range: a mark and words on a pill of its tone. Dark text on a solid colour reads
     * the same on the popup's navy and on the lighter row of the key in use, which coloured text
     * does not (it fails the contrast check there)
     */
    .range-note {
      display: inline-flex;
      align-items: baseline;
      gap: 0.35rem;
      padding: 0.1rem 0.55rem;
      border-radius: 999px;
      font-size: var(--font-ui-small);
      font-weight: 600;
    }

    .range-mark {
      font-weight: 700;
    }

    .tone-green {
      background: var(--color-success, #27ae60);
      color: #14202b;
    }

    .tone-yellow {
      background: var(--color-warning, #f39c12);
      color: #14202b;
    }

    .tone-red {
      background: color-mix(in srgb, var(--color-danger, #e74c3c) 70%, white);
      color: #14202b;
    }

    /* On the button: just the mark, in a round badge */
    .picker-button .range-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.3em;
      height: 1.3em;
      margin-left: 0.4rem;
      border-radius: 50%;
      font-size: var(--font-ui-small);
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
    const frame = frameBounds()
    const left = Math.max(
      frame.left + margin,
      Math.min(button.left, frame.right - popover.offsetWidth - margin)
    )
    popover.style.top = `${top}px`
    popover.style.left = `${left}px`
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // Edit mode ended with the popup open: its owner may now be hidden, so don't leave it stranded
    if (changed.has('editMode') && !this.editMode) this._popup.close()
  }

  override render() {
    const options = this._options()
    // (how the current value fares, on the button too: it is the one in use)
    const current = options.find(option => option.value === this.value)?.range
    const spoken = current ? `, ${current.words || 'in range'}` : ''
    return html`
      ${this.label ? html`<span class="meta-label">${this.label}:</span>` : ''}
      <button
        ${ref(this._button)}
        class="picker-button"
        type="button"
        aria-haspopup="listbox"
        aria-label=${this.label ? `${this.label}: ${this._displayValue()}${spoken}` : nothing}
        aria-expanded=${this._popup.isOpen ? 'true' : 'false'}
        @click=${() => this._popup.toggle()}
      >
        ${this._displayValue()}${current ? html`<span class="range-mark tone-${current.tone}" aria-hidden="true">${current.mark}</span>` : nothing}
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
          ${options.map(
            option => html`
              <button
                type="button"
                role="option"
                class="picker-option ${option.value === this.value ? 'selected' : ''}"
                aria-selected=${option.value === this.value ? 'true' : 'false'}
                aria-label=${option.range ? `${[option.label, option.hint].filter(Boolean).join(' ')}, ${option.range.words || 'in range'}` : nothing}
                @click=${() => this._choose(option.value)}
              >
                <span class="option-label">${option.label}</span>
                <span class="option-end">
                  <span class="option-hint">${option.hint}</span>
                  ${
                    option.range
                      ? html`<span class="range-note tone-${option.range.tone}"><span class="range-mark" aria-hidden="true">${option.range.mark}</span>${option.range.words}</span>`
                      : nothing
                  }
                </span>
              </button>
            `
          )}
        </div>
      </dialog>
    `
  }
}
