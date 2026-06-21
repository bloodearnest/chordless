import { css, html, LitElement } from 'lit'

/**
 * SongSettingsPopover Component
 *
 * A dropdown popover containing song editing controls (key, capo, BPM, reset).
 * All controls are rendered directly in this component to ensure proper grid alignment.
 */
export class SongSettingsPopover extends LitElement {
  static properties = {
    popoverId: { type: String, attribute: 'popover-id' },
    bpmValue: { type: Number, attribute: 'bpm-value' },
    bpmMin: { type: Number, attribute: 'bpm-min' },
    bpmMax: { type: Number, attribute: 'bpm-max' },
  }

  static styles = css`
    :host {
      display: contents;
    }

    .settings-popover {
      background-color: var(--header-bg, #2c3e50);
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      padding: 1rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      margin: 0;
      z-index: 1000;
      min-width: 250px;
      max-width: 90vw;
      max-height: 80vh;
      overflow-y: auto;
      position: fixed;
      inset: unset;
      top: -9999px;
      left: -9999px;
    }

    .settings-popover::backdrop {
      background-color: rgba(0, 0, 0, 0.3);
    }

    .settings-content {
      display: grid;
      grid-template-columns: auto auto auto auto;
      column-gap: 0.25rem;
      row-gap: 0.75rem;
      align-items: center;
      color: var(--header-text, #fff);
    }

    .meta-label {
      opacity: 0.8;
      font-size: var(--font-ui-small);
      color: var(--header-text, #fff);
      margin: 0;
      white-space: nowrap;
    }

    .control-button {
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
      font-weight: normal;
      font-family: inherit;
      text-align: center;
    }

    .control-button:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .bpm-value {
      color: var(--header-text, #fff);
      font-size: var(--font-ui);
      min-width: 3ch;
      text-align: center;
      font-family: inherit;
    }

    .reset-button {
      grid-column: 1 / 5;
      margin-top: 0.5rem;
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
      font-weight: normal;
      font-family: inherit;
      text-align: center;
    }
  `

  constructor() {
    super()
    this.popoverId = 'song-settings-popover'
    this.triggerButton = null
    this.bpmValue = 120
    this.bpmMin = 40
    this.bpmMax = 240
  }

  get popover() {
    return this.shadowRoot?.querySelector(`#${this.popoverId}`)
  }

  connectedCallback() {
    super.connectedCallback()
    this.updateComplete.then(() => {
      if (this.popover) {
        this.popover.addEventListener('toggle', e => {
          if (e.newState === 'open') {
            this._positionPopover()
            setTimeout(() => {
              document.addEventListener('click', this._handleClickOutside)
            }, 0)
          } else {
            document.removeEventListener('click', this._handleClickOutside)
          }
        })
      }
    })
    this._handleClickOutside = this._handleClickOutside.bind(this)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('click', this._handleClickOutside)
  }

  _handleClickOutside(e) {
    const popover = this.popover
    if (!popover) return
    const clickedInside = e.composedPath().includes(popover)
    const clickedTrigger = this.triggerButton && e.composedPath().includes(this.triggerButton)

    // Check if clicked inside key-selector or capo-selector (including their popovers)
    const keySelector = document.getElementById('key-selector')
    const capoSelector = document.getElementById('capo-selector')
    const clickedKeySelector = keySelector && e.composedPath().includes(keySelector)
    const clickedCapoSelector = capoSelector && e.composedPath().includes(capoSelector)

    if (!clickedInside && !clickedTrigger && !clickedKeySelector && !clickedCapoSelector) {
      this.closePopover()
    }
  }

  setTriggerButton(button) {
    this.triggerButton = button
  }

  _positionPopover() {
    const popover = this.popover
    if (!popover || !this.triggerButton) return
    const buttonRect = this.triggerButton.getBoundingClientRect()
    popover.style.top = `${buttonRect.bottom + 4}px`
    popover.style.left = `${buttonRect.left}px`
  }

  showPopover() {
    const popover = this.popover
    this._positionPopover()
    popover?.showPopover()
  }

  closePopover() {
    const popover = this.popover
    popover?.hidePopover()
  }

  togglePopover() {
    const popover = this.popover
    popover?.togglePopover()
  }

  isOpen() {
    const popover = this.popover
    return popover?.matches(':popover-open') || false
  }

  _handleBPMDecrement() {
    const newValue = Math.max(this.bpmMin, this.bpmValue - 1)
    if (newValue !== this.bpmValue) {
      this.dispatchEvent(
        new CustomEvent('bpm-change', {
          detail: { value: newValue },
          bubbles: true,
          composed: true,
        })
      )
    }
  }

  _handleBPMIncrement() {
    const newValue = Math.min(this.bpmMax, this.bpmValue + 1)
    if (newValue !== this.bpmValue) {
      this.dispatchEvent(
        new CustomEvent('bpm-change', {
          detail: { value: newValue },
          bubbles: true,
          composed: true,
        })
      )
    }
  }

  _handleReset() {
    this.dispatchEvent(new CustomEvent('reset-click', { bubbles: true, composed: true }))
  }

  render() {
    const canDecrementBPM = this.bpmValue > this.bpmMin
    const canIncrementBPM = this.bpmValue < this.bpmMax

    return html`
      <div id="${this.popoverId}" class="settings-popover" popover="manual">
        <div class="settings-content">
          <!-- Row 1: Key selector and Capo selector -->
          <slot name="key-selector"></slot>
          <slot name="capo-selector"></slot>

          <!-- Row 2: BPM controls -->
          <label class="meta-label">BPM:</label>
          <button
            class="control-button"
            @click=${this._handleBPMDecrement}
            ?disabled=${!canDecrementBPM}
            aria-label="Decrease BPM"
            type="button"
          >
            −
          </button>
          <span class="bpm-value">${this.bpmValue || '—'}</span>
          <button
            class="control-button"
            @click=${this._handleBPMIncrement}
            ?disabled=${!canIncrementBPM}
            aria-label="Increase BPM"
            type="button"
          >
            +
          </button>

          <!-- Row 3: Reset -->
          <button class="reset-button" @click=${this._handleReset} aria-label="Reset song" type="button">
            Reset
          </button>
        </div>
      </div>
    `
  }
}

customElements.define('song-settings-popover', SongSettingsPopover)
