import { css, html, LitElement } from 'lit'
import {
  getCapoPreference,
  getMusicianType,
  getUseNashvilleNumbers,
  getUseUnicodeAccidentals,
  setCapoPreference,
  setMusicianType,
  setUseNashvilleNumbers,
  setUseUnicodeAccidentals,
} from '../js/preferences.ts'
import './theme-settings.js'
import './media-player-settings.js'
import { panelStyles } from './shared-styles.ts'

/**
 * AppPreferences Component
 *
 * Preferences interface for the application
 */
export class AppPreferences extends LitElement {
  static properties = {
    useNashville: { type: Boolean, attribute: false },
    useUnicodeAccidentals: { type: Boolean, attribute: false },
    musicianType: { type: String, attribute: false },
    capoEnabled: { type: Boolean, attribute: false },
  }

  static styles = [
    panelStyles,
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
  }

  render() {
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

  _isLyricsOnlySelection() {
    return this.musicianType === 'singer' || this.musicianType === 'drummer'
  }

  _onMusicianTypeChange(event) {
    const value = event.currentTarget.value
    this.musicianType = value
    setMusicianType(value)
  }

  _onNashvilleToggle(event) {
    const value = event.currentTarget.checked
    this.useNashville = value
    setUseNashvilleNumbers(value)
  }

  _onAccidentalToggle(event) {
    const value = event.currentTarget.checked
    this.useUnicodeAccidentals = value
    setUseUnicodeAccidentals(value)
  }

  _onCapoToggle(event) {
    const value = event.currentTarget.checked
    this.capoEnabled = value
    setCapoPreference(value)
  }
}

customElements.define('app-preferences', AppPreferences)
