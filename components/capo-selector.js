import { css, html, LitElement } from 'lit'
import { transposeKeyName } from '../js/transpose.js'

/**
 * Capo selector component.
 * Displays the currently selected capo, and when in edit mode allows choosing 0-11 via a popover.
 */
export class CapoSelector extends LitElement {
  static properties = {
    label: { type: String },
    value: { type: Number },
    maxValue: { type: Number, attribute: 'max-value' },
    editMode: { type: Boolean, attribute: 'edit-mode', reflect: true },
    referenceKey: { type: String, attribute: 'reference-key' },
  }

  static styles = css`
    :host {
      display: inline-flex;
    }

    .capo-wrapper {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }

    .meta-label {
      opacity: 0.8;
      font-size: var(--font-ui-small);
      color: var(--header-text, #fff);
      margin: 0;
    }

    .capo-button {
      background: transparent;
      color: var(--header-text, #fff);
      border: 2px solid transparent;
      border-radius: 6px;
      padding: 0.2rem 0.4rem;
      font-size: var(--font-ui-small);
      font-family: inherit;
      min-width: 0;
      text-align: center;
      cursor: default;
      pointer-events: none;
      transition: all 0.2s;
      white-space: nowrap;
    }

    :host([edit-mode]) .capo-button {
      background-color: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.3);
      cursor: pointer;
      pointer-events: auto;
    }

    :host([edit-mode]) .capo-button:hover {
      background-color: rgba(255, 255, 255, 0.3);
      border-color: rgba(255, 255, 255, 0.5);
    }

    :host([edit-mode]) .capo-button:focus {
      outline: none;
      border-color: var(--header-text, #fff);
    }

    .capo-popover {
      background-color: var(--header-bg, #2c3e50);
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      padding: 0.5rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      max-height: 70vh;
      overflow-y: auto;
      margin: 0;
      inset: unset;
    }

    .capo-popover::backdrop {
      background-color: rgba(0, 0, 0, 0.3);
    }

    .capo-option {
      width: 100%;
      border: none;
      background: transparent;
      color: var(--header-text, #fff);
      font-size: var(--font-ui-small);
      padding: 0.5rem 0.75rem;
      text-align: left;
      display: flex;
      justify-content: space-between;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      transition: background-color 0.2s;
    }

    .capo-option:hover,
    .capo-option.selected {
      background-color: rgba(255, 255, 255, 0.2);
    }

    .capo-option-value {
      font-weight: bold;
    }

    .capo-option-hint {
      font-size: var(--font-ui);
      opacity: 0.7;
    }
  `

  constructor() {
    super()
    this.label = 'Capo'
    this.value = 0
    this.maxValue = 11
    this.editMode = false
    this.referenceKey = ''
    this._options = Array.from({ length: 12 }, (_, index) => index)
    this._popoverId = `capo-popover-${Math.random().toString(36).slice(2)}`
  }

  firstUpdated() {
    this._setupPopoverPositioning()
  }

  _setupPopoverPositioning() {
    const button = this.shadowRoot.querySelector('.capo-button')
    const popover = this.shadowRoot.querySelector('.capo-popover')
    if (!button || !popover) return

    const handler = event => {
      if (event.newState === 'open') {
        const rect = button.getBoundingClientRect()
        popover.style.top = `${rect.bottom + 4}px`
        popover.style.left = `${rect.left}px`
      }
    }
    popover.addEventListener('toggle', handler)
  }

  updated(changed) {
    if (changed.has('maxValue')) {
      const max = Number(this.maxValue)
      const clamp = Number.isFinite(max) && max >= 0 ? Math.min(Math.floor(max), 11) : 11
      this._options = Array.from({ length: clamp + 1 }, (_, index) => index)
    }
  }

  _handleSelection(newValue) {
    if (typeof newValue !== 'number' || newValue === this.value) {
      return
    }
    const popover = this.shadowRoot.querySelector('.capo-popover')
    popover?.hidePopover()
    this.dispatchEvent(
      new CustomEvent('capo-change', {
        detail: { value: newValue },
        bubbles: true,
        composed: true,
      })
    )
  }

  _renderOptions() {
    return this._options.map(option => {
      const hint = this._getTargetKeyLabel(option)
      const isSelected = option === this.value
      return html`
        <button
          class="capo-option ${isSelected ? 'selected' : ''}"
          type="button"
          @click=${() => this._handleSelection(option)}
        >
          <span class="capo-option-value">${option}</span>
          <span class="capo-option-hint">${hint}</span>
        </button>
      `
    })
  }

  _getTargetKeyLabel(option) {
    if (!this.referenceKey) {
      return option === 0 ? 'Open' : `Down ${option}`
    }
    if (option === 0) {
      return this.referenceKey
    }
    const key = transposeKeyName(this.referenceKey, -option)
    return key || `Down ${option}`
  }

  render() {
    const displayValue = Number.isFinite(this.value) ? this.value : 0
    return html`
      <div class="capo-wrapper">
        ${this.label ? html`<label class="meta-label">${this.label}:</label>` : ''}
        <button class="capo-button" type="button" popovertarget=${this._popoverId}>
          ${displayValue}
        </button>
        <div id=${this._popoverId} class="capo-popover" popover>${this._renderOptions()}</div>
      </div>
    `
  }
}

customElements.define('capo-selector', CapoSelector)
