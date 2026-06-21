import { css, html, LitElement } from 'lit'

/**
 * BPMEditor Component
 *
 * Allows adjusting BPM (Beats Per Minute) with +/- buttons.
 * Shows current BPM and allows small adjustments up or down.
 *
 * Properties:
 * @property {string} label - Label text (default: 'BPM')
 * @property {number} value - Current BPM value
 * @property {number} min - Minimum BPM value (default: 40)
 * @property {number} max - Maximum BPM value (default: 240)
 * @property {number} step - Amount to increment/decrement (default: 5)
 * @property {boolean} editMode - Whether component is in edit mode (affects styling)
 *
 * Events:
 * @fires bpm-change - When BPM is changed (detail: {value: number})
 */
export class BPMEditor extends LitElement {
  static properties = {
    label: { type: String },
    value: { type: Number },
    min: { type: Number },
    max: { type: Number },
    step: { type: Number },
    editMode: { type: Boolean, attribute: false },
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
      white-space: nowrap;
    }

    .bpm-value {
      color: var(--header-text, #fff);
      font-size: var(--font-ui);
      min-width: 3ch;
      text-align: center;
      font-family: inherit;
    }

    .bpm-button {
      background-color: rgba(255, 255, 255, 0.2);
      border: 2px solid rgba(255, 255, 255, 0.3);
      color: var(--header-text, #fff);
      border-radius: 6px;
      min-width: 2.5rem;
      min-height: 2.5rem;
      padding: 0.4rem 0.6rem;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: var(--font-ui);
      font-weight: bold;
      font-family: inherit;
    }

    .bpm-button:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
  `

  constructor() {
    super()
    this.label = 'BPM'
    this.value = 120
    this.min = 40
    this.max = 240
    this.step = 1
    this.editMode = false
  }

  _handleDecrement() {
    const newValue = Math.max(this.min, this.value - this.step)
    if (newValue !== this.value) {
      this._dispatchChange(newValue)
    }
  }

  _handleIncrement() {
    const newValue = Math.min(this.max, this.value + this.step)
    if (newValue !== this.value) {
      this._dispatchChange(newValue)
    }
  }

  _dispatchChange(newValue) {
    this.dispatchEvent(
      new CustomEvent('bpm-change', {
        detail: { value: newValue },
        bubbles: true,
        composed: true,
      })
    )
  }

  render() {
    const canDecrement = this.value > this.min
    const canIncrement = this.value < this.max

    return html`
      ${this.label ? html`<label class="meta-label">${this.label}:</label>` : ''}
      <button
        class="bpm-button bpm-minus"
        @click=${this._handleDecrement}
        ?disabled=${!canDecrement}
        aria-label="Decrease BPM"
        type="button"
      >
        −
      </button>
      <span class="bpm-value">${this.value || '—'}</span>
      <button
        class="bpm-button bpm-plus"
        @click=${this._handleIncrement}
        ?disabled=${!canIncrement}
        aria-label="Increase BPM"
        type="button"
      >
        +
      </button>
    `
  }
}

customElements.define('bpm-editor', BPMEditor)
