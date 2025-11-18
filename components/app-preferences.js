import { LitElement, html, css } from 'lit';
import {
  getUseNashvilleNumbers,
  setUseNashvilleNumbers,
  getUseUnicodeAccidentals,
  setUseUnicodeAccidentals,
} from '../js/preferences.js';
import './theme-settings.js';
import './media-player-settings.js';

/**
 * AppPreferences Component
 *
 * Preferences interface for the application
 */
export class AppPreferences extends LitElement {
  static properties = {
    useNashville: { type: Boolean, attribute: false },
    useUnicodeAccidentals: { type: Boolean, attribute: false },
  };

  static styles = css`
    :host {
      display: block;
    }

    .preferences-content {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .preferences-section {
      background: var(--settings-bg, #34495e);
      border-radius: 8px;
      padding: 1.5rem;
      color: var(--settings-text, white);
    }

    h3 {
      font-size: 1.2rem;
      margin: 0 0 1rem 0;
      font-weight: 600;
    }

    h4 {
      font-size: 1rem;
      margin: 1.5rem 0 1rem 0;
      font-weight: 600;
      color: #e74c3c;
    }

    p {
      font-size: 0.85rem;
      margin: 0 0 1rem 0;
      opacity: 0.7;
      line-height: 1.4;
    }

    .setlist-button {
      display: inline-block;
      width: auto;
      padding: 0.75rem 1.5rem;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }

    .setlist-button:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .danger-button {
      background-color: rgba(231, 76, 60, 0.2);
    }

    .danger-button:hover {
      background-color: rgba(231, 76, 60, 0.3);
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

    a {
      text-decoration: none;
    }
  `;

  constructor() {
    super();
    this.useNashville = getUseNashvilleNumbers();
    this.useUnicodeAccidentals = getUseUnicodeAccidentals();
  }

  render() {
    return html`
      <div class="preferences-content">
        <div class="preferences-section">
          <h3>Appearance</h3>
          <p>Customize the look and feel of the app with theme and display settings.</p>
          <theme-settings></theme-settings>
        </div>

        <div class="preferences-section">
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

        <div class="preferences-section">
          <h3>Media Player</h3>
          <p>Configure global media player settings. These settings apply to all setlists.</p>
          <media-player-settings></media-player-settings>
        </div>
      </div>
    `;
  }

  _onNashvilleToggle(event) {
    const value = event.currentTarget.checked;
    this.useNashville = value;
    setUseNashvilleNumbers(value);
  }

  _onAccidentalToggle(event) {
    const value = event.currentTarget.checked;
    this.useUnicodeAccidentals = value;
    setUseUnicodeAccidentals(value);
  }
}

customElements.define('app-preferences', AppPreferences);
