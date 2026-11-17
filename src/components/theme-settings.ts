import { css, html, LitElement } from 'lit'
import { t } from '../js/text.ts'
import {
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  type ThemeObserver,
  themeManager,
} from '../js/theme-manager.ts'

/**
 * ThemeSettings Component
 *
 * Provides UI controls for theme customization
 *
 * Events:
 */
export class ThemeSettings extends LitElement {
  static override properties = {
    _currentTheme: { state: true },
    _fontScale: { state: true },
  }

  declare _currentTheme: string
  declare _fontScale: number

  _themeObserver: ThemeObserver

  static override styles = css`
    :host {
      display: block;
    }

    .settings-group {
      margin-bottom: 1rem;
    }

    .settings-group:last-child {
      margin-bottom: 0;
    }

    .settings-label {
      display: block;
      font-size: var(--font-ui-small);
      font-weight: 600;
      margin-bottom: 0.25rem;
    }

    .settings-description {
      font-size: var(--font-ui-small);
      opacity: 0.7;
      margin-bottom: 0.75rem;
      line-height: 1.4;
    }

    /* Always the three side by side: they are short words */
    .theme-buttons {
      display: flex;
      gap: 0.5rem;
    }

    .theme-button {
      flex: 1 1 0;
      min-width: 0;
      padding: 0.6rem 0.5rem;
      border: 2px solid var(--tint-border);
      border-radius: 6px;
      background: var(--tint-subtle);
      color: inherit;
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
      background: var(--tint-strong);
    }

    .theme-button.active {
      background: var(--color-primary, #2477ad);
      border-color: var(--color-primary, #2477ad);
      color: var(--button-text, white);
      box-shadow: 0 2px 8px rgba(52, 152, 219, 0.3);
    }

    .theme-button.active:hover {
      background: var(--button-hover, #1f6a9a);
      border-color: var(--button-hover, #1f6a9a);
    }

    .font-scale-controls {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .scale-slider {
      flex: 1;
      height: 6px;
      background: var(--tint-border);
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
      background: var(--color-primary, #2477ad);
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .scale-slider::-moz-range-thumb {
      width: 20px;
      height: 20px;
      background: var(--color-primary, #2477ad);
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
      background: var(--tint);
      border-radius: 4px;
    }

    .preset-buttons {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .preset-button {
      padding: 0.4rem 0.8rem;
      border: 1px solid var(--tint-border);
      border-radius: 4px;
      background: var(--tint-subtle);
      color: inherit;
      font-size: var(--font-ui-small);
      cursor: pointer;
      transition: all 0.2s;
    }

    .preset-button:hover {
      background: var(--tint-strong);
    }

    .system-preference {
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: color-mix(in srgb, var(--color-primary, #2477ad) 10%, transparent);
      border-left: 3px solid var(--color-primary, #2477ad);
      border-radius: 2px;
      font-size: var(--font-ui-small);
    }
  `

  constructor() {
    super()
    this._currentTheme = themeManager.getCurrentTheme()
    this._fontScale = parseFloat(themeManager.getVariable('font-scale')) || 1.0

    // Bind theme observer
    this._themeObserver = this._handleThemeChange.bind(this)
  }

  override connectedCallback() {
    super.connectedCallback()
    themeManager.addObserver(this._themeObserver)
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    themeManager.removeObserver(this._themeObserver)
  }

  _handleThemeChange(theme: string): void {
    this._currentTheme = theme
    this._fontScale = parseFloat(themeManager.getVariable('font-scale')) || 1.0
  }

  _setTheme(theme: string): void {
    themeManager.setTheme(theme)
  }

  _handleFontScaleChange(e: Event): void {
    const scale = parseFloat((e.target as HTMLInputElement).value)
    this._fontScale = scale
    themeManager.setFontScale(scale)

    // Save to localStorage
    try {
      localStorage.setItem('font-scale', scale.toString())
    } catch (err) {
      console.warn('[ThemeSettings] Failed to save font scale:', err)
    }
  }

  _setPresetScale(scale: number): void {
    this._fontScale = scale
    themeManager.setFontScale(scale)

    try {
      localStorage.setItem('font-scale', scale.toString())
    } catch (err) {
      console.warn('[ThemeSettings] Failed to save font scale:', err)
    }
  }

  _detectSystemPreference(): void {
    this._setTheme('system')
  }

  override render() {
    const systemPreference = themeManager.detectSystemPreference()
    const usingSystemMode = this._currentTheme === 'system'

    return html`
      <div class="settings-group">
        <span class="settings-label">${t('theme-heading')}</span>
        <div class="theme-buttons">
          <button
            class="theme-button ${this._currentTheme === 'system' ? 'active' : ''}"
            @click=${this._detectSystemPreference}
            aria-label=${t('theme-system-label')}
            title=${t('theme-system-title')}
          >
            <span>${t('theme-system')}</span>
          </button>
          <button
            class="theme-button ${this._currentTheme === 'light' ? 'active' : ''}"
            @click=${() => this._setTheme('light')}
            aria-label=${t('theme-light-label')}
          >
            <span>${t('theme-light')}</span>
          </button>
          <button
            class="theme-button ${this._currentTheme === 'dark' ? 'active' : ''}"
            @click=${() => this._setTheme('dark')}
            aria-label=${t('theme-dark-label')}
          >
            <span>${t('theme-dark')}</span>
          </button>
        </div>
        ${
          usingSystemMode
            ? html`
              <div class="system-preference">
                ${t('theme-following', { current: systemPreference })}
              </div>
            `
            : ''
        }
      </div>

      <div class="settings-group">
        <span class="settings-label">${t('scale-heading')}</span>
        <div class="settings-description">
          ${t('scale-text')}
        </div>
        <div class="font-scale-controls">
          <input
            type="range"
            class="scale-slider"
            min=${MIN_FONT_SCALE}
            max=${MAX_FONT_SCALE}
            step="0.05"
            .value=${this._fontScale.toString()}
            @input=${this._handleFontScaleChange}
            aria-label=${t('scale-slider-label')}
          />
          <div class="scale-value">${Math.round(this._fontScale * 100)}%</div>
        </div>
        <div class="preset-buttons">
          <button class="preset-button" @click=${() => this._setPresetScale(0.8)}>
            ${t('scale-small')}
          </button>
          <button class="preset-button" @click=${() => this._setPresetScale(1.0)}>
            ${t('scale-normal')}
          </button>
          <button class="preset-button" @click=${() => this._setPresetScale(1.25)}>
            ${t('scale-large')}
          </button>
          <button class="preset-button" @click=${() => this._setPresetScale(1.5)}>
            ${t('scale-largest')}
          </button>
        </div>
      </div>

    `
  }
}

customElements.define('theme-settings', ThemeSettings)

declare global {
  interface HTMLElementTagNameMap {
    'theme-settings': ThemeSettings
  }
}
