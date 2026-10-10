import { css, html, LitElement } from 'lit'
import { ref } from 'lit/directives/ref.js'
import { DialogPopup } from '../js/dialog-popup.ts'

/** The BPM was changed with - or + */
export class BpmChangeEvent extends Event {
  static type = 'song-settings:bpm-change'
  constructor(value) {
    super(BpmChangeEvent.type, { bubbles: true, composed: true })
    this.value = value
  }
}

/** Reset was pressed */
export class SongResetClickEvent extends Event {
  static type = 'song-settings:reset-click'
  constructor() {
    super(SongResetClickEvent.type, { bubbles: true, composed: true })
  }
}

/**
 * SongSettingsPopover Component
 *
 * A popup, in a modal <dialog> under its trigger (see DialogPopup), containing
 * song editing controls (key, capo, BPM, reset).
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
      color: var(--header-text, #fff);
      border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
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
      background-color: color-mix(in srgb, currentColor 20%, transparent);
      border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
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
      background-color: color-mix(in srgb, currentColor 20%, transparent);
      border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
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
    this._popup = new DialogPopup(this, { position: dialog => this._positionPopover(dialog) })
    this.popoverId = 'song-settings-popover'
    this.triggerButton = null
    this.bpmValue = 120
    this.bpmMin = 40
    this.bpmMax = 240
  }

  /** The <dialog> (once rendered) */
  get dialog() {
    return this._popup.element
  }

  setTriggerButton(button) {
    this.triggerButton = button
  }

  _positionPopover(dialog) {
    if (!this.triggerButton) return
    const buttonRect = this.triggerButton.getBoundingClientRect()
    const left = Math.min(buttonRect.left, window.innerWidth - dialog.offsetWidth - 8)
    dialog.style.top = `${buttonRect.bottom + 4}px`
    dialog.style.left = `${Math.max(8, left)}px`
  }

  show() {
    this._popup.show()
  }

  close() {
    this._popup.close()
  }

  toggle() {
    this._popup.toggle()
  }

  isOpen() {
    return this._popup.isOpen
  }

  _handleBPMDecrement() {
    const newValue = Math.max(this.bpmMin, this.bpmValue - 1)
    if (newValue !== this.bpmValue) {
      this.dispatchEvent(new BpmChangeEvent(newValue))
    }
  }

  _handleBPMIncrement() {
    const newValue = Math.min(this.bpmMax, this.bpmValue + 1)
    if (newValue !== this.bpmValue) {
      this.dispatchEvent(new BpmChangeEvent(newValue))
    }
  }

  _handleReset() {
    this.dispatchEvent(new SongResetClickEvent())
  }

  render() {
    const canDecrementBPM = this.bpmValue > this.bpmMin
    const canIncrementBPM = this.bpmValue < this.bpmMax

    return html`
      <dialog
        id="${this.popoverId}"
        ${ref(this._popup.ref)}
        class="settings-popover"
        aria-label="Song settings"
        @click=${this._popup.onClick}
        @close=${this._popup.onClose}
      >
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
      </dialog>
    `
  }
}

customElements.define('song-settings-popover', SongSettingsPopover)
