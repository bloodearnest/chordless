import { css, html, LitElement } from 'lit'

/**
 * OptionPicker: a label and a value which, in edit mode, is a button opening
 * a popover of options to choose from. key-selector and capo-selector extend
 * it, giving their options and the event class they send:
 *
 *   static ChangeEvent = KeyChangeEvent
 *   _options() { return [{ value, label, hint }] }
 *
 * Outside edit mode the value is plain text. Choosing a different option
 * closes the popover and sends a ChangeEvent with the chosen value; the owner
 * sets value in response.
 *
 * Colours follow the text colour (--header-text, for the navy header), so a
 * light context can restyle it by setting --header-text and --header-bg.
 *
 * @property {String} label - Shown before the value, with a colon (optional)
 * @property {Boolean} editMode - Whether the value can be changed (attribute edit-mode)
 */
export class OptionPicker extends LitElement {
  static properties = {
    label: { type: String },
    editMode: { type: Boolean, attribute: 'edit-mode', reflect: true },
  }

  static styles = css`
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

  /** The Event class sent when a different option is chosen (subclasses set it) */
  static ChangeEvent = null

  constructor() {
    super()
    this.label = ''
    this.editMode = false
  }

  /** The options: [{value, label, hint}] (subclasses implement it) */
  _options() {
    return []
  }

  /** The value as shown on the button */
  _displayValue() {
    return this.value ?? '-'
  }

  _popover() {
    return this.renderRoot.querySelector('.picker-popover')
  }

  _choose(value) {
    if (value === this.value) return
    this._popover()?.hidePopover()
    this.dispatchEvent(new this.constructor.ChangeEvent(value))
  }

  /**
   * As the popover opens, put it under the button, or above it if there's
   * more room there, kept within the screen
   */
  _positionPopover(event) {
    if (event.newState !== 'open') return
    const popover = event.currentTarget
    const button = this.renderRoot.querySelector('.picker-button').getBoundingClientRect()
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

  render() {
    return html`
      ${this.label ? html`<span class="meta-label">${this.label}:</span>` : ''}
      <button class="picker-button" type="button" popovertarget="options">
        ${this._displayValue()}
      </button>
      <div id="options" class="picker-popover" popover @toggle=${this._positionPopover}>
        ${this._options().map(
          option => html`
            <button
              type="button"
              class="picker-option ${option.value === this.value ? 'selected' : ''}"
              aria-pressed=${option.value === this.value ? 'true' : 'false'}
              @click=${() => this._choose(option.value)}
            >
              <span class="option-label">${option.label}</span>
              <span class="option-hint">${option.hint}</span>
            </button>
          `
        )}
      </div>
    `
  }
}
