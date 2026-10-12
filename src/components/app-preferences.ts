import { css, html, LitElement } from 'lit'
import {
  getCapoPreference,
  getKeepAwakePreference,
  getMusicianType,
  getUseNashvilleNumbers,
  getUseUnicodeAccidentals,
  KeepAwakePreferenceEvent,
  type MusicianType,
  setCapoPreference,
  setKeepAwakePreference,
  setMusicianType,
  setUseNashvilleNumbers,
  setUseUnicodeAccidentals,
} from '../js/preferences.ts'
import { WakeLockController, WakeLockStateEvent, wakeLock } from '../js/wake-lock.ts'
import './theme-settings.ts'
import './media-player-settings.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'

/**
 * AppPreferences Component
 *
 * Preferences interface for the application
 */
export class AppPreferences extends LitElement {
  static override properties = {
    useNashville: { type: Boolean, attribute: false },
    useUnicodeAccidentals: { type: Boolean, attribute: false },
    musicianType: { type: String, attribute: false },
    capoEnabled: { type: Boolean, attribute: false },
    keepAwake: { type: Boolean, attribute: false },
    _checking: { state: true },
  }

  declare useNashville: boolean
  declare useUnicodeAccidentals: boolean
  declare musicianType: MusicianType
  declare capoEnabled: boolean
  declare keepAwake: boolean
  declare _checking: boolean

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
    :host {
      display: block;
    }

    .preferences-content {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      font-weight: 600;
    }

    .toggle input[type='checkbox'] {
      width: 1.25rem;
      height: 1.25rem;
    }

    .radio-group {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .radio-option {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      cursor: pointer;
    }

    .radio-option input[type='radio'] {
      width: 1.25rem;
      height: 1.25rem;
      margin-top: 0.15rem;
      cursor: pointer;
      flex-shrink: 0;
    }

    .radio-option-content {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .radio-option-label {
      font-weight: 600;
      font-size: var(--font-ui);
    }

    .radio-option-description {
      font-size: var(--font-ui-small);
      opacity: 0.7;
      line-height: 1.3;
    }

  `,
  ]

  constructor() {
    super()
    this.useNashville = getUseNashvilleNumbers()
    this.useUnicodeAccidentals = getUseUnicodeAccidentals()
    this.musicianType = getMusicianType()
    this.capoEnabled = getCapoPreference()
    this.keepAwake = getKeepAwakePreference()
    this._checking = false
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener(WakeLockStateEvent.type, this._onWakeLockState)
    // The menu's modal outlives each visit, and the setting can change elsewhere meanwhile
    window.addEventListener(KeepAwakePreferenceEvent.type, this._onKeepAwakeChanged)
    this.keepAwake = getKeepAwakePreference()
  }

  override disconnectedCallback() {
    window.removeEventListener(WakeLockStateEvent.type, this._onWakeLockState)
    window.removeEventListener(KeepAwakePreferenceEvent.type, this._onKeepAwakeChanged)
    super.disconnectedCallback()
  }

  _onWakeLockState = (): void => this.requestUpdate()

  _onKeepAwakeChanged = (event: KeepAwakePreferenceEvent): void => {
    this.keepAwake = event.enabled
  }

  /** What the wake lock is doing, in words */
  _wakeLockStatus(): string {
    const refused = (error: string) =>
      `The device refused it (${error}). Battery Saver can cause this.`
    switch (wakeLock.state) {
      case 'unsupported':
        return "This browser can't keep the screen awake."
      case 'off':
        return 'Off: the screen may turn off while you play.'
      case 'active':
        return 'Active: the screen is being kept awake.'
      case 'released':
        return 'Let go by the device (another app, the screen off, or a low battery). It is taken again when you come back.'
      case 'failed':
        return refused(wakeLock.error)
      default: {
        const test = wakeLock.lastTest
        if (test?.ok) return 'Ready: checked just now, and the device gives it.'
        if (test) return refused(test.error ?? 'unknown error')
        return 'Ready: the screen is kept awake while a setlist is open.'
      }
    }
  }

  async _checkWakeLock(): Promise<void> {
    this._checking = true
    try {
      await wakeLock.check()
    } finally {
      this._checking = false
    }
  }

  override render() {
    return html`
      <div class="preferences-content">
        <div class="panel">
          <h3>Appearance</h3>
          <p>Customize the look and feel of the app with theme and display settings.</p>
          <theme-settings></theme-settings>
        </div>

        <div class="panel">
          <h3>Display Defaults</h3>
          <p>Choose how each section appears when you open a setlist.</p>
          <div class="radio-group">
            <label class="radio-option">
              <input
                type="radio"
                name="musician-type"
                value="general"
                ?checked=${this.musicianType === 'general'}
                @change=${this._onMusicianTypeChange}
              />
              <div class="radio-option-content">
                <span class="radio-option-label">Show chords and lyrics</span>
                <span class="radio-option-description">General musician</span>
              </div>
            </label>

            <label class="radio-option">
              <input
                type="radio"
                name="musician-type"
                value="singer"
                ?checked=${this._isLyricsOnlySelection()}
                @change=${this._onMusicianTypeChange}
              />
              <div class="radio-option-content">
                <span class="radio-option-label">Show only lyrics</span>
                <span class="radio-option-description">
                  Great for singers and drummers who don't need chords
                </span>
              </div>
            </label>
          </div>
        </div>

        <div class="panel">
          <h3>Capo</h3>
          <p>Show a capo control so guitarists can view transposed chords without changing pads.</p>
          <label class="toggle" for="toggle-capo">
            <input
              type="checkbox"
              id="toggle-capo"
              name="enable-capo"
              ?checked=${this.capoEnabled}
              @change=${this._onCapoToggle}
            />
            <span>Enable capo adjustments</span>
          </label>
        </div>

        <div class="panel">
          <h3>Screen</h3>
          <p>Keep the screen from turning off while a setlist is open, so you needn't touch it.</p>
          <label class="toggle" for="toggle-keep-awake">
            <input
              type="checkbox"
              id="toggle-keep-awake"
              name="keep-screen-awake"
              ?checked=${this.keepAwake}
              ?disabled=${!WakeLockController.supported}
              @change=${this._onKeepAwakeToggle}
            />
            <span>Keep the screen awake</span>
          </label>
          <p id="wake-lock-status" role="status">${this._wakeLockStatus()}</p>
          ${
            WakeLockController.supported && this.keepAwake
              ? html`<button
                class="btn"
                type="button"
                ?disabled=${this._checking || wakeLock.state === 'active'}
                @click=${this._checkWakeLock}
              >
                ${wakeLock.state === 'released' || wakeLock.state === 'failed' ? 'Ask again' : 'Check now'}
              </button>`
              : ''
          }
        </div>

        <div class="panel">
          <h3>Chords</h3>
          <p>Display chord charts using relative Nashville numbers instead of letter names.</p>
          <label class="toggle" for="toggle-use-nashville">
            <input
              type="checkbox"
              id="toggle-use-nashville"
              name="use-nashville-numbers"
              ?checked=${this.useNashville}
              @change=${this._onNashvilleToggle}
            />
            <span>Use Nashville numbers</span>
          </label>
          <p>Choose how accidentals are rendered.</p>
          <label class="toggle" for="toggle-unicode-accidentals">
            <input
              type="checkbox"
              id="toggle-unicode-accidentals"
              name="use-unicode-accidentals"
              ?checked=${this.useUnicodeAccidentals}
              @change=${this._onAccidentalToggle}
            />
            <span>Use unicode accidentals (♯/♭)</span>
          </label>
        </div>

        <div class="panel">
          <h3>Media Player</h3>
          <p>Configure global media player settings. These settings apply to all setlists.</p>
          <media-player-settings></media-player-settings>
        </div>
      </div>
    `
  }

  _isLyricsOnlySelection(): boolean {
    return this.musicianType === 'singer' || this.musicianType === 'drummer'
  }

  _onMusicianTypeChange(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value as MusicianType
    this.musicianType = value
    setMusicianType(value)
  }

  _onNashvilleToggle(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).checked
    this.useNashville = value
    setUseNashvilleNumbers(value)
  }

  _onAccidentalToggle(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).checked
    this.useUnicodeAccidentals = value
    setUseUnicodeAccidentals(value)
  }

  _onKeepAwakeToggle(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).checked
    this.keepAwake = value
    setKeepAwakePreference(value)
  }

  _onCapoToggle(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).checked
    this.capoEnabled = value
    setCapoPreference(value)
  }
}

customElements.define('app-preferences', AppPreferences)

declare global {
  interface HTMLElementTagNameMap {
    'app-preferences': AppPreferences
  }
}
