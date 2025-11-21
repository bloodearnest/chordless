import { css, html, LitElement } from 'lit'
import { themeManager } from '../js/theme-manager.js'

/**
 * ThemeSettings Component
 *
 * Provides UI controls for theme customization
 *
 * Events:
 * @fires theme-change - When theme is changed (detail: { theme: 'light' | 'dark' })
 */
export class ThemeSettings extends LitElement {
  static properties = {
    currentTheme: { type: String, state: true },
    fontScale: { type: Number, state: true },
  }

  static styles = css`
    :host {
      display: block;
    }

    .settings-group {
      margin-bottom: 1.5rem;
    }

    .settings-group:last-child {
      margin-bottom: 0;
    }

    .settings-label {
      display: block;
      font-size: var(--font-ui);
      font-weight: 600;
      margin-bottom: 0.5rem;
      opacity: 0.9;
    }

    .settings-description {
      font-size: var(--font-ui-small);
      opacity: 0.7;
      margin-bottom: 0.75rem;
      line-height: 1.4;
    }

    .theme-buttons {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .theme-button {
      flex: 1;
      min-width: 120px;
      padding: 0.75rem 1.25rem;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.05);
      color: white;
      font-size: var(--font-ui);
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .theme-button:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .theme-button.active {
      background: var(--color-primary, #3498db);
      border-color: var(--color-primary, #3498db);
      box-shadow: 0 2px 8px rgba(52, 152, 219, 0.3);
    }

    .theme-button.active:hover {
      background: var(--button-hover, #2980b9);
      border-color: var(--button-hover, #2980b9);
    }

    .theme-icon {
      font-size: var(--font-ui-small);
    }

    .font-scale-controls {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .scale-slider {
      flex: 1;
      height: 6px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
      outline: none;
      -webkit-appearance: none;
      appearance: none;
    }

    .scale-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      background: var(--color-primary, #3498db);
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .scale-slider::-moz-range-thumb {
      width: 20px;
      height: 20px;
      background: var(--color-primary, #3498db);
      border-radius: 50%;
      cursor: pointer;
      border: none;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .scale-value {
      min-width: 60px;
      text-align: center;
      font-weight: 600;
      font-size: var(--font-ui);
      padding: 0.25rem 0.5rem;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }

    .preset-buttons {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
      flex-wrap: wrap;
    }

    .preset-button {
      padding: 0.4rem 0.8rem;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
      color: white;
      font-size: var(--font-ui-small);
      cursor: pointer;
      transition: all 0.2s;
    }

    .preset-button:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .current-theme-info {
      margin-top: 1rem;
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      font-size: var(--font-ui-small);
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.25rem;
    }

    .info-row:last-child {
      margin-bottom: 0;
    }

    .info-label {
      opacity: 0.7;
    }

    .info-value {
      font-weight: 600;
    }

    .system-preference {
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: rgba(52, 152, 219, 0.1);
      border-left: 3px solid var(--color-primary, #3498db);
      border-radius: 2px;
      font-size: var(--font-ui-small);
    }
  `

  constructor() {
    super()
    this.currentTheme = themeManager.getCurrentTheme()
    this.fontScale = parseFloat(themeManager.getVariable('font-scale')) || 1.0

    // Bind theme observer
    this._themeObserver = this._handleThemeChange.bind(this)
  }

  connectedCallback() {
    super.connectedCallback()
    themeManager.addObserver(this._themeObserver)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    themeManager.removeObserver(this._themeObserver)
  }

  _handleThemeChange(theme) {
    this.currentTheme = theme
    this.fontScale = parseFloat(themeManager.getVariable('font-scale')) || 1.0
  }

  _setTheme(theme) {
    themeManager.setTheme(theme)

    // Dispatch event for parent components
    this.dispatchEvent(
      new CustomEvent('theme-change', {
        detail: { theme },
        bubbles: true,
        composed: true,
      })
    )
  }

  _handleFontScaleChange(e) {
    const scale = parseFloat(e.target.value)
    this.fontScale = scale
    themeManager.setFontScale(scale)

    // Save to localStorage
    try {
      localStorage.setItem('font-scale', scale.toString())
    } catch (err) {
      console.warn('[ThemeSettings] Failed to save font scale:', err)
    }
  }

  _setPresetScale(scale) {
    this.fontScale = scale
    themeManager.setFontScale(scale)

    try {
      localStorage.setItem('font-scale', scale.toString())
    } catch (err) {
      console.warn('[ThemeSettings] Failed to save font scale:', err)
    }
  }

  _detectSystemPreference() {
    this._setTheme('system')
  }

  render() {
    const systemPreference = themeManager.detectSystemPreference()
    const usingSystemMode = this.currentTheme === 'system'

    return html`
      <div class="settings-group">
        <label class="settings-label">Appearance</label>
        <div class="settings-description">
          Choose between light and dark mode. Your preference is saved automatically.
        </div>
        <div class="theme-buttons">
          <button
            class="theme-button ${this.currentTheme === 'system' ? 'active' : ''}"
            @click=${this._detectSystemPreference}
            aria-label="Use system preference"
            title="Follow your system's theme preference automatically"
          >
            <span class="theme-icon">💻</span>
            <span>System</span>
          </button>
          <button
            class="theme-button ${this.currentTheme === 'light' ? 'active' : ''}"
            @click=${() => this._setTheme('light')}
            aria-label="Light theme"
          >
            <span class="theme-icon">☀️</span>
            <span>Light</span>
          </button>
          <button
            class="theme-button ${this.currentTheme === 'dark' ? 'active' : ''}"
            @click=${() => this._setTheme('dark')}
            aria-label="Dark theme"
          >
            <span class="theme-icon">🌙</span>
            <span>Dark</span>
          </button>
        </div>
        ${
          usingSystemMode
            ? html`
              <div class="system-preference">
                ✓ Following system preference (currently ${systemPreference})
              </div>
            `
            : ''
        }
      </div>

      <div class="settings-group">
        <label class="settings-label">Font Scale</label>
        <div class="settings-description">
          Adjust the global font size. This affects all text in the app including lyrics display.
        </div>
        <div class="font-scale-controls">
          <input
            type="range"
            class="scale-slider"
            min="0.5"
            max="2.0"
            step="0.05"
            .value=${this.fontScale.toString()}
            @input=${this._handleFontScaleChange}
            aria-label="Font scale slider"
          />
          <div class="scale-value">${Math.round(this.fontScale * 100)}%</div>
        </div>
        <div class="preset-buttons">
          <button class="preset-button" @click=${() => this._setPresetScale(0.65)}>
            Phone (65%)
          </button>
          <button class="preset-button" @click=${() => this._setPresetScale(1.0)}>
            Normal (100%)
          </button>
          <button class="preset-button" @click=${() => this._setPresetScale(1.125)}>
            Tablet (113%)
          </button>
          <button class="preset-button" @click=${() => this._setPresetScale(1.5)}>
            Large (150%)
          </button>
        </div>
      </div>

      <div class="current-theme-info">
        <div class="info-row">
          <span class="info-label">Theme preference:</span>
          <span class="info-value"
            >${this.currentTheme}${usingSystemMode ? ` (${systemPreference})` : ''}</span
          >
        </div>
        <div class="info-row">
          <span class="info-label">Font scale:</span>
          <span class="info-value">${Math.round(this.fontScale * 100)}%</span>
        </div>
        ${
          !usingSystemMode
            ? html`
              <div class="info-row">
                <span class="info-label">System prefers:</span>
                <span class="info-value">${systemPreference}</span>
              </div>
            `
            : ''
        }
      </div>
    `
  }
}

customElements.define('theme-settings', ThemeSettings)
