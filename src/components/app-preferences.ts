import { css, html, LitElement } from 'lit'
import type { IconName } from '../js/icons.ts'
import { PITCHES, type PitchId } from '../js/instrument-pitch.ts'
import {
  getCapoPreference,
  getKeepAwakeMinutes,
  getKeepAwakePreference,
  getLyricsOnlyPreference,
  getMusicianType,
  getPitchControlsPreference,
  getPitchPreference,
  getRealBookPreference,
  getScrollToTopOnSwipe,
  getTuningPreference,
  getUseNashvilleNumbers,
  getUseUnicodeAccidentals,
  KEEP_AWAKE_LIMITS,
  KeepAwakeLimitEvent,
  KeepAwakePreferenceEvent,
  type MusicianType,
  setCapoPreference,
  setKeepAwakeMinutes,
  setKeepAwakePreference,
  setLyricsOnlyPreference,
  setMusicianType,
  setPitchControlsPreference,
  setPitchPreference,
  setRealBookPreference,
  setScrollToTopOnSwipe,
  setTuningPreference,
  setUseNashvilleNumbers,
  setUseUnicodeAccidentals,
} from '../js/preferences.ts'
import { t } from '../js/text.ts'
import { TUNINGS, type Tuning } from '../js/tuning.ts'
import { WakeLockController, WakeLockStateEvent, wakeLock } from '../js/wake-lock.ts'
import { PLAYS } from '../js/what-do-you-play.ts'
import './readability-settings.ts'
import './theme-settings.ts'
import { buttonStyles, panelStyles, statusStyles } from './shared-styles.ts'
import { renderStatus } from './status-view.ts'

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
    realBook: { type: Boolean, attribute: false },
    musicianType: { type: String, attribute: false },
    capoEnabled: { type: Boolean, attribute: false },
    lyricsOnly: { type: Boolean, attribute: false },
    tuning: { type: Number, attribute: false },
    pitchControls: { type: Boolean, attribute: false },
    pitch: { attribute: false },
    scrollToTop: { type: Boolean, attribute: false },
    keepAwake: { type: Boolean, attribute: false },
    keepAwakeMinutes: { type: Number, attribute: false },
  }

  declare useNashville: boolean
  declare useUnicodeAccidentals: boolean
  declare realBook: boolean
  declare musicianType: MusicianType
  declare capoEnabled: boolean
  declare lyricsOnly: boolean
  /** The device's default tuning for a guitar (docs/PERSONAL_LAYER.md) */
  declare tuning: Tuning
  /** Whether the instrument pitch controls are on, and the device's default pitch (docs/PERSONAL_LAYER.md) */
  declare pitchControls: boolean
  declare pitch: PitchId
  declare scrollToTop: boolean
  declare keepAwake: boolean
  declare keepAwakeMinutes: number

  static override styles = [
    panelStyles,
    buttonStyles,
    statusStyles,
    css`
    :host {
      display: block;
    }

    .preferences-content {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    /* Smaller than the dialog's title, and bigger than the headings inside a panel */
    .panel {
      padding: 1rem;
    }

    /* A phone: the panels use the width, not the margins around them */
    @media (max-width: 30rem) {
      .preferences-content {
        padding: 0.5rem;
        gap: 0.5rem;
      }

      .panel {
        padding: 0.75rem;
      }
    }

    .panel h3 {
      font-size: var(--font-ui);
      margin: 0 0 0.75rem;
    }

    .group + .group {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--tint-border);
    }

    .group h4 {
      font-size: var(--font-ui-small);
      font-weight: 600;
      margin: 0 0 0.25rem;
    }

    .group p {
      margin: 0 0 0.5rem;
    }

    .toggle {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin: 0.5rem 0;
      font-size: var(--font-ui-small);
      font-weight: 600;
    }

    .toggle input[type='checkbox'] {
      width: 1.25rem;
      height: 1.25rem;
      flex-shrink: 0;
    }

    /* The settings Custom opens: under its text, set in from the radio buttons, with room between */
    .custom-switches {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
      margin: 0.75rem 0 0 2.25rem;
    }

    .field {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem 0.75rem;
      margin: 0.5rem 0;
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
      font-size: var(--font-ui-small);
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
    this.realBook = getRealBookPreference()
    this.musicianType = getMusicianType()
    this.capoEnabled = getCapoPreference()
    this.lyricsOnly = getLyricsOnlyPreference()
    this.tuning = getTuningPreference()
    this.pitchControls = getPitchControlsPreference()
    this.pitch = getPitchPreference()
    this.scrollToTop = getScrollToTopOnSwipe()
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
    if (minutes === 0) return t('pref-limit-none')
    if (minutes < 60) return t('pref-limit-minutes', { count: minutes })
    return t('pref-limit-hours', { count: minutes / 60 })
  }

  /** What the wake lock is doing, to show: a look (see data-state), an icon, a word, and why */
  _wakeLockDisplay(): { look: WakeLockLook; icon: IconName; label: string; detail: string } {
    const refused = (error: string) => ({
      look: 'bad' as const,
      icon: 'warning' as const,
      label: t('wake-refused'),
      detail: t('wake-refused-detail', { reason: error }),
    })
    switch (wakeLock.state) {
      case 'unsupported':
        return {
          look: 'none',
          icon: 'ban',
          label: t('wake-unsupported'),
          detail: t('wake-unsupported-detail'),
        }
      case 'off':
        return {
          look: 'none',
          icon: 'moon',
          label: t('wake-off'),
          detail: t('wake-off-detail'),
        }
      case 'active':
        return {
          look: 'good',
          icon: 'sun',
          label: t('wake-awake'),
          detail: t(
            this.keepAwakeMinutes === 0 || wakeLock.onMains
              ? wakeLock.live
                ? 'wake-awake-live'
                : 'wake-awake-detail'
              : wakeLock.live
                ? 'wake-awake-live-limit'
                : 'wake-awake-limit',
            { limit: this._limitLabel(this.keepAwakeMinutes) }
          ),
        }
      case 'released':
        return {
          look: 'warn',
          icon: 'moon',
          label: t('wake-released'),
          detail: t('wake-released-detail'),
        }
      case 'expired':
        return {
          look: 'warn',
          icon: 'clock',
          label: t('wake-expired'),
          detail: t('wake-expired-detail', { limit: this._limitLabel(this.keepAwakeMinutes) }),
        }
      case 'failed':
        return refused(wakeLock.error)
      default: {
        return {
          look: 'idle',
          icon: 'sun',
          label: t('wake-ready'),
          detail: t('wake-ready-detail'),
        }
      }
    }
  }

  /** Whether the device is on mains power, and so whether the idle limit applies */
  _powerStatus(): string {
    switch (wakeLock.onMains) {
      case true:
        return t('wake-power-mains')
      case false:
        return t('wake-power-battery')
      default:
        return t('wake-power-unknown')
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
    return renderStatus(
      { look: look === 'idle' ? 'none' : look, icon, label, detail },
      { id: 'wake-lock-status', state: wakeLock.state }
    )
  }

  /** What the button does: ask again after a drop or a refusal */
  _wakeLockAction(): { label: string; run: () => void } | null {
    if (!WakeLockController.supported) return null
    if (['released', 'failed', 'expired'].includes(wakeLock.state)) {
      return { label: t('wake-ask-again'), run: () => void wakeLock.requestAgain() }
    }
    return null
  }

  override render() {
    return html`
      <div class="preferences-content">
        <div class="panel">
          <h3>${t('pref-appearance-heading')}</h3>
          <theme-settings></theme-settings>
        </div>

        <div class="panel">
          <h3>${t('pref-behaviour-heading')}</h3>

          <section class="group">
            <h4>${t('pref-play-heading')}</h4>
            <p>${t('pref-play-text')}</p>
          <div class="radio-group">
            ${PLAYS.map(
              option => html`
                <label class="radio-option">
                  <input
                    type="radio"
                    name="musician-type"
                    value=${option.type}
                    ?checked=${this.musicianType === option.type}
                    @change=${this._onMusicianTypeChange}
                  />
                  <div class="radio-option-content">
                    <span class="radio-option-label">${option.label}</span>
                    <span class="radio-option-description">${option.description}</span>
                  </div>
                </label>
              `
            )}
          </div>
          ${
            this.musicianType === 'custom'
              ? html`
                <div class="custom-switches">
                <label class="toggle" for="toggle-lyrics-only">
                  <input
                    type="checkbox"
                    id="toggle-lyrics-only"
                    name="lyrics-only"
                    ?checked=${this.lyricsOnly}
                    @change=${this._onLyricsOnlyToggle}
                  />
                  <span>${t('pref-lyrics-only')}</span>
                </label>
                <label class="toggle" for="toggle-capo">
                  <input
                    type="checkbox"
                    id="toggle-capo"
                    name="enable-capo"
                    ?checked=${this.capoEnabled}
                    @change=${this._onCapoToggle}
                  />
                  <span>${t('pref-show-capo')}</span>
                </label>
                <label class="toggle" for="toggle-pitch">
                  <input
                    type="checkbox"
                    id="toggle-pitch"
                    name="enable-pitch"
                    ?checked=${this.pitchControls}
                    @change=${this._onPitchControlsToggle}
                  />
                  <span>${t('pref-show-pitch')}</span>
                </label>
                </div>
              `
              : ''
          }
          ${
            this.pitchControls
              ? html`
                <label class="field" for="pitch">
                  <span>${t('pref-my-instrument')}</span>
                  <select id="pitch" name="pitch" @change=${this._onPitchChange}>
                    ${PITCHES.map(
                      option => html`<option value=${option.id} ?selected=${option.id === this.pitch}>
                        ${option.label}
                      </option>`
                    )}
                  </select>
                </label>
                <p>${t('pref-pitch-text')}</p>
              `
              : ''
          }
          ${
            this.capoEnabled
              ? html`
                <label class="field" for="tuning">
                  <span>${t('pref-my-tuning')}</span>
                  <select id="tuning" name="tuning" @change=${this._onTuningChange}>
                    ${TUNINGS.map(
                      option => html`<option
                        value=${option.semitones}
                        ?selected=${option.semitones === this.tuning}
                      >
                        ${option.label}
                      </option>`
                    )}
                  </select>
                </label>
                <p>${t('pref-tuning-text')}</p>
              `
              : ''
          }
          </section>

          <section class="group">
            <h4>${t('pref-chords-heading')}</h4>
            <label class="toggle" for="toggle-use-nashville">
              <input
                type="checkbox"
                id="toggle-use-nashville"
                name="use-nashville-numbers"
                ?checked=${this.useNashville}
                @change=${this._onNashvilleToggle}
              />
              <span>${t('pref-nashville')}</span>
            </label>
            <label class="toggle" for="toggle-unicode-accidentals">
              <input
                type="checkbox"
                id="toggle-unicode-accidentals"
                name="use-unicode-accidentals"
                ?checked=${this.useUnicodeAccidentals}
                @change=${this._onAccidentalToggle}
              />
              <span>${t('pref-unicode')}</span>
            </label>
          </section>

          <section class="group">
            <h4>${t('pref-leadsheets-heading')}</h4>
            <label class="toggle" for="toggle-real-book">
              <input
                type="checkbox"
                id="toggle-real-book"
                name="lead-sheet-real-book"
                ?checked=${this.realBook}
                @change=${this._onRealBookToggle}
              />
              <span>${t('pref-real-book')}</span>
            </label>
          </section>

          <section class="group">
            <h4>${t('pref-moving-heading')}</h4>
            <label class="toggle" for="toggle-scroll-to-top">
              <input
                type="checkbox"
                id="toggle-scroll-to-top"
                name="scroll-to-top-on-swipe"
                ?checked=${this.scrollToTop}
                @change=${this._onScrollToTopToggle}
              />
              <span>${t('pref-scroll-top')}</span>
            </label>
          </section>

          <section class="group">
            <h4>${t('pref-screen-heading')}</h4>
            <p>${t('pref-screen-text')}</p>
          <label class="toggle" for="toggle-keep-awake">
            <input
              type="checkbox"
              id="toggle-keep-awake"
              name="keep-screen-awake"
              ?checked=${this.keepAwake}
              ?disabled=${!WakeLockController.supported}
              @change=${this._onKeepAwakeToggle}
            />
            <span>${t('pref-keep-awake')}</span>
          </label>
          ${this._renderWakeLockStatus()}
          <label class="field" for="keep-awake-limit">
            <span>${t('pref-battery-limit')}</span>
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
                  ${minutes === 0 ? t('pref-no-limit') : this._limitLabel(minutes)}
                </option>`
              )}
            </select>
          </label>
          <p class="wake-power" id="wake-power" data-mains=${String(wakeLock.onMains)}>
            ${this._powerStatus()}
          </p>
          ${this._renderWakeLockAction()}
          </section>
        </div>

        <div class="panel">
          <h3>${t('pref-accessibility-heading')}</h3>
          <readability-settings></readability-settings>
        </div>
      </div>
    `
  }

  _onMusicianTypeChange(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value as MusicianType
    setMusicianType(value)
    // (the type is what the switches now make, and they are what the type was chosen to set)
    this.musicianType = getMusicianType()
    this.lyricsOnly = getLyricsOnlyPreference()
    this.capoEnabled = getCapoPreference()
    this.pitchControls = getPitchControlsPreference()
  }

  _onPitchChange(event: Event): void {
    this.pitch = (event.currentTarget as HTMLSelectElement).value as PitchId
    setPitchPreference(this.pitch)
  }

  _onPitchControlsToggle(event: Event): void {
    this.pitchControls = (event.currentTarget as HTMLInputElement).checked
    setPitchControlsPreference(this.pitchControls)
  }

  _onTuningChange(event: Event): void {
    this.tuning = Number((event.currentTarget as HTMLSelectElement).value) as Tuning
    setTuningPreference(this.tuning)
  }

  _onLyricsOnlyToggle(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).checked
    this.lyricsOnly = value
    setLyricsOnlyPreference(value)
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

  _onRealBookToggle(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).checked
    this.realBook = value
    setRealBookPreference(value)
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

  _onScrollToTopToggle(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).checked
    this.scrollToTop = value
    setScrollToTopOnSwipe(value)
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
