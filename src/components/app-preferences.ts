import { css, html, LitElement } from 'lit'
import type { IconName } from '../js/icons.ts'
import {
  getCapoPreference,
  getKeepAwakeMinutes,
  getKeepAwakePreference,
  getMusicianType,
  getUseNashvilleNumbers,
  getUseUnicodeAccidentals,
  KEEP_AWAKE_LIMITS,
  KeepAwakeLimitEvent,
  KeepAwakePreferenceEvent,
  type MusicianType,
  setCapoPreference,
  setKeepAwakeMinutes,
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
/** How the wake lock's state looks: the colour of its badge */
type WakeLockLook = 'good' | 'warn' | 'bad' | 'idle' | 'none'

export class AppPreferences extends LitElement {
  static override properties = {
    useNashville: { type: Boolean, attribute: false },
    useUnicodeAccidentals: { type: Boolean, attribute: false },
    musicianType: { type: String, attribute: false },
    capoEnabled: { type: Boolean, attribute: false },
    keepAwake: { type: Boolean, attribute: false },
    keepAwakeMinutes: { type: Number, attribute: false },
  }

  declare useNashville: boolean
  declare useUnicodeAccidentals: boolean
  declare musicianType: MusicianType
  declare capoEnabled: boolean
  declare keepAwake: boolean
  declare keepAwakeMinutes: number

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

    /* The wake lock's state: a badge whose icon and colour show it, with a word and the why */
    .wake-status {
      --look: var(--text-tertiary, #95a5a6);
      display: flex;
      align-items: center;
      gap: 1rem;
      margin: 0.75rem 0;
    }

    .wake-status[data-look='good'] {
      --look: var(--color-success, #27ae60);
    }

    .wake-status[data-look='warn'] {
      --look: var(--color-warning, #f39c12);
    }

    .wake-status[data-look='bad'] {
      --look: var(--color-danger, #e74c3c);
    }

    .wake-badge {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 3.5rem;
      height: 3.5rem;
      border-radius: 50%;
      border: 3px solid var(--look);
      background: color-mix(in srgb, var(--look) 18%, transparent);
    }

    /* A lit screen has a glow around it */
    .wake-status[data-look='good'] .wake-badge {
      box-shadow: 0 0 0.75rem color-mix(in srgb, var(--look) 70%, transparent);
    }

    .wake-text {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .wake-label {
      font-weight: 700;
      font-size: var(--font-ui);
    }

    .wake-detail {
      font-size: var(--font-ui-small);
      opacity: 0.75;
      line-height: 1.3;
    }

    .field {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin: 0.75rem 0;
      font-size: var(--font-ui-small);
    }

    .wake-power {
      margin: 0 0 0.75rem;
      font-size: var(--font-ui-small);
      opacity: 0.75;
    }

    .field select {
      font: inherit;
      padding: 0.5rem;
      border-radius: 4px;
      border: 1px solid var(--border-color, #d5dbdb);
      background: var(--bg-color, white);
      color: inherit;
      min-height: 2.5rem;
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
    this.keepAwakeMinutes = getKeepAwakeMinutes()
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener(WakeLockStateEvent.type, this._onWakeLockState)
    // The menu's modal outlives each visit, and the setting can change elsewhere meanwhile
    window.addEventListener(KeepAwakePreferenceEvent.type, this._onKeepAwakeChanged)
    window.addEventListener(KeepAwakeLimitEvent.type, this._onKeepAwakeLimitChanged)
    this.keepAwake = getKeepAwakePreference()
    this.keepAwakeMinutes = getKeepAwakeMinutes()
  }

  override disconnectedCallback() {
    window.removeEventListener(WakeLockStateEvent.type, this._onWakeLockState)
    window.removeEventListener(KeepAwakePreferenceEvent.type, this._onKeepAwakeChanged)
    window.removeEventListener(KeepAwakeLimitEvent.type, this._onKeepAwakeLimitChanged)
    super.disconnectedCallback()
  }

  _onWakeLockState = (): void => this.requestUpdate()

  _onKeepAwakeChanged = (event: KeepAwakePreferenceEvent): void => {
    this.keepAwake = event.enabled
  }

  _onKeepAwakeLimitChanged = (event: KeepAwakeLimitEvent): void => {
    this.keepAwakeMinutes = event.minutes
  }

  /** A limit in words: "15 minutes", "1 hour", "2 hours" */
  _limitLabel(minutes: number): string {
    if (minutes === 0) return 'no limit'
    if (minutes < 60) return `${minutes} minutes`
    const hours = minutes / 60
    return hours === 1 ? '1 hour' : `${hours} hours`
  }

  /** What the wake lock is doing, to show: a look (see data-state), an icon, a word, and why */
  _wakeLockDisplay(): { look: WakeLockLook; icon: IconName; label: string; detail: string } {
    const refused = (error: string) => ({
      look: 'bad' as const,
      icon: 'warning' as const,
      label: 'Refused',
      detail: `The device refused it (${error}). Battery Saver can cause this.`,
    })
    switch (wakeLock.state) {
      case 'unsupported':
        return {
          look: 'none',
          icon: 'ban',
          label: 'Unsupported',
          detail: "This browser can't keep the screen awake.",
        }
      case 'off':
        return {
          look: 'none',
          icon: 'moon',
          label: 'Off',
          detail: 'The screen may turn off while you play.',
        }
      case 'active':
        return {
          look: 'good',
          icon: 'sun',
          label: 'Awake',
          detail:
            (wakeLock.manual
              ? 'The screen is being kept awake, on any page, until you stop it'
              : 'The screen is being kept awake') +
            (this.keepAwakeMinutes === 0 || wakeLock.onMains
              ? '.'
              : `${wakeLock.manual ? ', or' : ','} until there is no touch for ${this._limitLabel(this.keepAwakeMinutes)}.`),
        }
      case 'released':
        return {
          look: 'warn',
          icon: 'moon',
          label: 'Let go',
          detail:
            'The device let go (another app, the screen off, or a low battery). It is taken again when you come back.',
        }
      case 'expired':
        return {
          look: 'warn',
          icon: 'clock',
          label: 'Timed out',
          detail: `Let go after ${this._limitLabel(this.keepAwakeMinutes)} with no touch, to spare the battery. Touch the screen to keep it awake again.`,
        }
      case 'failed':
        return refused(wakeLock.error)
      default: {
        return {
          look: 'idle',
          icon: 'sun',
          label: 'Ready',
          detail: 'The screen is kept awake while a setlist is open, or when you ask for it here.',
        }
      }
    }
  }

  /** Whether the device is on mains power, and so whether the idle limit applies */
  _powerStatus(): string {
    switch (wakeLock.onMains) {
      case true:
        return 'On mains power: there is no time limit.'
      case false:
        return 'On battery: the time limit applies.'
      default:
        return "This device can't say whether it is on mains power, so the time limit always applies."
    }
  }

  _renderWakeLockAction() {
    const action = this._wakeLockAction()
    return action
      ? html`<button class="btn" type="button" @click=${action.run}>${action.label}</button>`
      : ''
  }

  _renderWakeLockStatus() {
    const { look, icon, label, detail } = this._wakeLockDisplay()
    return html`
      <div
        class="wake-status"
        id="wake-lock-status"
        role="status"
        data-state=${wakeLock.state}
        data-look=${look}
      >
        <span class="wake-badge"><app-icon name=${icon} size="28"></app-icon></span>
        <span class="wake-text">
          <span class="wake-label">${label}</span>
          <span class="wake-detail">${detail}</span>
        </span>
      </div>
    `
  }

  /** What the button does: ask again after a drop or a refusal, else start or stop keeping awake */
  _wakeLockAction(): { label: string; run: () => void } | null {
    if (!WakeLockController.supported) return null
    if (['released', 'failed', 'expired'].includes(wakeLock.state)) {
      return { label: 'Ask again', run: () => void wakeLock.requestAgain() }
    }
    if (wakeLock.manual) {
      return { label: 'Stop keeping awake', run: () => wakeLock.setManual(false) }
    }
    // Over a setlist it is already held; otherwise it can be asked for here
    if (wakeLock.state === 'active') return null
    return { label: 'Keep awake now', run: () => wakeLock.setManual(true) }
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
          ${this._renderWakeLockStatus()}
          <label class="field" for="keep-awake-limit">
            <span>On battery, let go after no touch for</span>
            <select
              id="keep-awake-limit"
              name="keep-awake-limit"
              ?disabled=${!this.keepAwake || !WakeLockController.supported}
              @change=${this._onKeepAwakeLimitChange}
            >
              ${KEEP_AWAKE_LIMITS.map(
                minutes => html`<option
                  value=${minutes}
                  ?selected=${minutes === this.keepAwakeMinutes}
                >
                  ${minutes === 0 ? 'No limit' : this._limitLabel(minutes)}
                </option>`
              )}
            </select>
          </label>
          <p class="wake-power" id="wake-power" data-mains=${String(wakeLock.onMains)}>
            ${this._powerStatus()}
          </p>
          ${this._renderWakeLockAction()}
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

  _onKeepAwakeLimitChange(event: Event): void {
    const minutes = Number((event.currentTarget as HTMLSelectElement).value)
    this.keepAwakeMinutes = minutes
    setKeepAwakeMinutes(minutes)
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
