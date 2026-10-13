import { css, html, LitElement } from 'lit'
import { ref } from 'lit/directives/ref.js'
import { DialogPopup } from '../js/dialog-popup.ts'
import { frameBounds } from '../js/utils/frame.ts'

/** The BPM was changed with - or + */
export class BpmChangeEvent extends Event {
  static readonly type = 'song-settings:bpm-change'
  readonly value: number
  constructor(value: number) {
    super(BpmChangeEvent.type, { bubbles: true, composed: true })
    this.value = value
  }
}

/** A pad set was chosen for the song, or undefined for the device's own */
export class PadSetChoiceEvent extends Event {
  static readonly type = 'song-settings:pad-set-choice'
  readonly value: string | undefined
  constructor(value: string | undefined) {
    super(PadSetChoiceEvent.type, { bubbles: true, composed: true })
    this.value = value
  }
}

/** Reset was pressed */
export class SongResetClickEvent extends Event {
  static readonly type = 'song-settings:reset-click'
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
  static override properties = {
    popoverId: { type: String, attribute: 'popover-id' },
    bpmValue: { type: Number, attribute: 'bpm-value' },
    bpmMin: { type: Number, attribute: 'bpm-min' },
    bpmMax: { type: Number, attribute: 'bpm-max' },
    bpmLocked: { type: Boolean, attribute: 'bpm-locked' },
    mediaAvailable: { type: Boolean, attribute: false },
    padSetId: { type: String, attribute: false },
    padSets: { type: Array, attribute: false },
  }

  declare popoverId: string
  declare bpmValue: number
  declare bpmMin: number
  declare bpmMax: number
  /** The BPM can't be changed (it is part of the setlist, which this user can't edit) */
  declare bpmLocked: boolean
  /** The media player is on this device and switched on: its choices are shown */
  declare mediaAvailable: boolean
  /** This user's pad set for the song, if not the device's own */
  declare padSetId: string | undefined
  declare padSets: { id: string; name: string }[]

  _popup: DialogPopup
  triggerButton: HTMLElement | null

  static override styles = css`
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

    /* The BPM row starts a row of its own, whether or not the capo picker above fills the
       first row's other two cells */
    .bpm-label {
      grid-column-start: 1;
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

    .media-choice {
      grid-column: 2 / 5;
      min-height: 2.5rem;
      background-color: color-mix(in srgb, currentColor 20%, transparent);
      border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
      color: var(--header-text, #fff);
      border-radius: 6px;
      padding: 0.4rem 0.6rem;
      font: inherit;
      font-size: var(--font-ui);
    }

    .media-choice option {
      color: #1a1a1a;
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
    this.bpmLocked = false
    this.mediaAvailable = false
    this.padSetId = undefined
    this.padSets = []
  }

  /** The <dialog> (once rendered) */
  get dialog(): HTMLDialogElement | undefined {
    return this._popup.element
  }

  setTriggerButton(button: HTMLElement | null): void {
    this.triggerButton = button
  }

  _positionPopover(dialog: HTMLDialogElement): void {
    if (!this.triggerButton) return
    const buttonRect = this.triggerButton.getBoundingClientRect()
    const frame = frameBounds()
    const left = Math.min(buttonRect.left, frame.right - dialog.offsetWidth - 8)
    dialog.style.top = `${buttonRect.bottom + 4}px`
    dialog.style.left = `${Math.max(frame.left + 8, left)}px`
  }

  show(): void {
    this._popup.show()
  }

  close(): void {
    this._popup.close()
  }

  toggle(): void {
    this._popup.toggle()
  }

  isOpen(): boolean {
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

  _handlePadSetChoice(event: Event) {
    const value = (event.target as HTMLSelectElement).value
    this.dispatchEvent(new PadSetChoiceEvent(value === '' ? undefined : value))
  }

  _renderMediaChoices() {
    if (!this.mediaAvailable) return ''
    // A pad set that is no longer there is still shown, so the choice can be seen and undone
    const padSets =
      this.padSets.some(set => set.id === this.padSetId) || !this.padSetId
        ? this.padSets
        : [...this.padSets, { id: this.padSetId, name: 'Not on this device' }]
    return html`
      <label class="meta-label bpm-label" for="pad-set-choice">Pads:</label>
      <select id="pad-set-choice" class="media-choice" @change=${this._handlePadSetChoice}>
        <option value="" ?selected=${!this.padSetId}>Default</option>
        ${padSets.map(
          set =>
            html`<option value=${set.id} ?selected=${set.id === this.padSetId}>${set.name}</option>`
        )}
      </select>
    `
  }

  _handleReset() {
    this.dispatchEvent(new SongResetClickEvent())
  }

  override render() {
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
          <label class="meta-label bpm-label">BPM:</label>
          <button
            class="control-button"
            @click=${this._handleBPMDecrement}
            ?disabled=${this.bpmLocked || !canDecrementBPM}
            aria-label="Decrease BPM"
            type="button"
          >
            −
          </button>
          <span class="bpm-value">${this.bpmValue || '—'}</span>
          <button
            class="control-button"
            @click=${this._handleBPMIncrement}
            ?disabled=${this.bpmLocked || !canIncrementBPM}
            aria-label="Increase BPM"
            type="button"
          >
            +
          </button>

          <!-- Row 3: this user's pad set for the song -->
          ${this._renderMediaChoices()}

          <!-- Last row: Reset -->
          <button class="reset-button" @click=${this._handleReset} aria-label="Reset song" type="button">
            Reset
          </button>
        </div>
      </dialog>
    `
  }
}

customElements.define('song-settings-popover', SongSettingsPopover)

declare global {
  interface HTMLElementTagNameMap {
    'song-settings-popover': SongSettingsPopover
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [BpmChangeEvent.type]: BpmChangeEvent
    [PadSetChoiceEvent.type]: PadSetChoiceEvent
    [SongResetClickEvent.type]: SongResetClickEvent
  }
}
