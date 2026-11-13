import { css, html, LitElement, nothing } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { chordColours, contrastRatio, normaliseTint, TINT_PRESETS } from '../js/chord-tint.ts'
import { FONT_AREAS, FONT_CHOICES, type FontArea, normaliseFont } from '../js/fonts.ts'
import {
  AppearancePreferenceEvent,
  getChordTint,
  getFontChoice,
  setChordTint,
  setFontChoice,
} from '../js/preferences.ts'
import { ThemeManager } from '../js/theme-manager.ts'
import { fieldStyles } from './shared-styles.ts'

const AREA_LABELS: Record<FontArea, { label: string; description: string }> = {
  ui: { label: 'App', description: 'menus, buttons and settings' },
  lyrics: { label: 'Lyrics', description: 'the words of the song' },
  chords: { label: 'Chords', description: 'the chord names above the words' },
}

/** A verse to show the choices on: the chords and the words they fall on */
const SAMPLE: readonly (readonly [string, string])[][] = [
  [
    ['G', 'A-ma'],
    ['', 'zing '],
    ['C', 'grace, '],
    ['G', 'how '],
    ['Em', 'sweet '],
  ],
  [
    ['G', 'the '],
    ['D', 'sound '],
    ['', 'that '],
    ['C', 'saved a '],
    ['G', 'wretch'],
  ],
]

const THEMES = ['light', 'dark'] as const

/**
 * Chord highlight and fonts (Preferences): a tint behind the chords (not the words) to help
 * readers with dyslexia or visual stress, and a typeface for the app, the lyrics and the chords
 * each. A verse is drawn in the light theme and the dark, whichever is on, so a choice can be
 * seen in both before it is made. Changes apply at once, with no reload.
 */
export class ReadabilitySettings extends LitElement {
  static override properties = {
    _tint: { state: true },
    _fonts: { state: true },
  }

  declare _tint: string
  declare _fonts: Record<FontArea, string>

  static override styles = [
    fieldStyles,
    css`
      :host {
        display: block;
      }

      .group {
        margin-bottom: 1.5rem;
      }

      .group:last-child {
        margin-bottom: 0;
      }

      .label {
        display: block;
        font-size: var(--font-ui);
        font-weight: 600;
        margin-bottom: 0.5rem;
        opacity: 0.9;
      }

      .description {
        font-size: var(--font-ui-small);
        opacity: 0.7;
        margin-bottom: 0.75rem;
        line-height: 1.4;
      }

      .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: flex-start;
      }

      .swatch {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        padding: 0;
        border: none;
        background: none;
        color: inherit;
        font: inherit;
        font-size: var(--font-ui-small);
        cursor: pointer;
      }

      .swatch .chip {
        box-sizing: border-box;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 50%;
        border: 2px solid var(--tint-border);
        /* the light theme's colour above the diagonal, the dark theme's below */
        background: linear-gradient(135deg, var(--light) 50%, var(--dark) 50%);
      }

      .swatch.none .chip {
        background: var(--bg-color);
        position: relative;
      }

      .swatch.none .chip::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: linear-gradient(
          135deg,
          transparent calc(50% - 1px),
          var(--text-secondary) calc(50% - 1px),
          var(--text-secondary) calc(50% + 1px),
          transparent calc(50% + 1px)
        );
      }

      .swatch[aria-pressed='true'] .chip {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-primary);
      }

      .swatch:focus-visible .chip {
        outline: 2px solid var(--focus-ring);
        outline-offset: 3px;
      }

      .custom input[type='color'] {
        width: 2.75rem;
        height: 2.75rem;
        padding: 0;
        border: 2px solid var(--tint-border);
        border-radius: 50%;
        background: none;
        cursor: pointer;
      }

      .custom.on input[type='color'] {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-primary);
      }

      .previews {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        gap: 0.75rem;
        margin-top: 1rem;
      }

      .preview {
        border: 1px solid var(--tint-border);
        border-radius: 6px;
        padding: 0.75rem 1rem;
        /* Drawn in a theme of its own: the colours come from that theme, set inline */
        background: var(--pv-bg);
        color: var(--pv-text);
      }

      .preview .name {
        font-size: var(--font-ui-small);
        font-family: var(--font-family-base);
        opacity: 0.7;
        margin-bottom: 0.5rem;
      }

      .verse {
        font-size: var(--font-lyrics);
        font-family: var(--font-family-lyrics);
        line-height: 1.4;
      }

      .verse .line {
        display: flex;
        flex-wrap: wrap;
        margin-bottom: 0.4em;
      }

      .verse .seg {
        display: inline-flex;
        flex-direction: column;
        white-space: pre;
      }

      .verse .chord {
        font-family: var(--font-family-chords);
        font-size: var(--font-chords);
        font-weight: bold;
        line-height: 1.1em;
        min-height: 1.1em;
        color: var(--pv-chord);
      }

      .verse .chord span {
        background: var(--pv-tint, transparent);
        color: var(--pv-ink, var(--pv-chord));
        border-radius: 0.2em;
        box-shadow: 0 0 0 0.15em var(--pv-tint, transparent);
      }

      .ratio {
        margin-top: 0.5rem;
        font-size: var(--font-ui-small);
        opacity: 0.7;
      }

      .fonts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        gap: 0.75rem;
      }

      .fonts label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: var(--font-ui-small);
      }

      .fonts .area {
        font-weight: 600;
      }

      .fonts .hint {
        opacity: 0.7;
      }
    `,
  ]

  _onChange = () => this._read()

  constructor() {
    super()
    this._tint = normaliseTint(getChordTint())
    this._fonts = this._readFonts()
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener(AppearancePreferenceEvent.type, this._onChange)
    this._read()
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener(AppearancePreferenceEvent.type, this._onChange)
  }

  _readFonts(): Record<FontArea, string> {
    return Object.fromEntries(
      FONT_AREAS.map(area => [area, normaliseFont(getFontChoice(area))])
    ) as Record<FontArea, string>
  }

  /** Follow a choice made elsewhere (another tab is not heard; this page's own changes are) */
  _read(): void {
    this._tint = normaliseTint(getChordTint())
    this._fonts = this._readFonts()
  }

  _chooseTint(tint: string): void {
    this._tint = tint
    setChordTint(tint)
  }

  _chooseFont(area: FontArea, event: Event): void {
    const id = normaliseFont((event.target as HTMLSelectElement).value)
    this._fonts = { ...this._fonts, [area]: id }
    setFontChoice(area, id)
  }

  _renderSwatches() {
    const custom = this._tint.startsWith('#')
    return html`
      <div class="swatches" role="group" aria-label="Chord highlight colour">
        <button
          class="swatch none"
          type="button"
          aria-pressed=${this._tint === ''}
          aria-label="No highlight"
          @click=${() => this._chooseTint('')}
        >
          <span class="chip"></span>None
        </button>
        ${TINT_PRESETS.map(
          preset => html`
            <button
              class="swatch"
              type="button"
              aria-pressed=${this._tint === preset.id}
              aria-label="${preset.label} highlight"
              @click=${() => this._chooseTint(preset.id)}
            >
              <span
                class="chip"
                style=${styleMap({ '--light': preset.light, '--dark': preset.dark })}
              ></span
              >${preset.label}
            </button>
          `
        )}
        <label class="swatch custom ${custom ? 'on' : ''}">
          <input
            type="color"
            aria-label="Your own highlight colour"
            .value=${custom ? this._tint : '#ffe08a'}
            @input=${(event: Event) => this._chooseTint((event.target as HTMLInputElement).value)}
          />
          Your own
        </label>
      </div>
    `
  }

  _renderPreview(theme: (typeof THEMES)[number]) {
    const colours = ThemeManager.themes[theme] as Record<string, string>
    const chord = colours['chord-color'] ?? '#1d6a9c'
    const tinted = chordColours(this._tint, theme, chord)
    const ratio = tinted ? contrastRatio(tinted.ink, tinted.background) : null
    return html`
      <div
        class="preview"
        data-theme=${theme}
        style=${styleMap({
          '--pv-bg': colours['bg-color'],
          '--pv-text': colours['text-color'],
          '--pv-chord': chord,
          '--pv-tint': tinted?.background ?? null,
          '--pv-ink': tinted?.ink ?? null,
        })}
      >
        <div class="name">${theme === 'light' ? 'Light theme' : 'Dark theme'}</div>
        <div class="verse" aria-hidden="true">
          ${SAMPLE.map(
            line => html`
              <div class="line">
                ${line.map(
                  ([chordName, words]) => html`
                    <span class="seg">
                      <span class="chord"
                        >${chordName ? html`<span>${chordName}</span>` : html`&nbsp;`}</span
                      >
                      <span>${words}</span>
                    </span>
                  `
                )}
              </div>
            `
          )}
        </div>
        ${
          ratio
            ? html`<div class="ratio">Chords read at ${ratio.toFixed(1)}:1 contrast</div>`
            : nothing
        }
      </div>
    `
  }

  _renderFontPicker(area: FontArea) {
    const { label, description } = AREA_LABELS[area]
    return html`
      <label>
        <span class="area">${label}</span>
        <span class="hint">${description}</span>
        <select
          class="field"
          aria-label="${label} font"
          .value=${this._fonts[area]}
          @change=${(event: Event) => this._chooseFont(area, event)}
        >
          ${FONT_CHOICES.map(
            choice => html`
              <option value=${choice.id} ?selected=${this._fonts[area] === choice.id}>
                ${choice.label}
              </option>
            `
          )}
        </select>
        <span class="hint">${FONT_CHOICES.find(choice => choice.id === this._fonts[area])?.note}</span>
      </label>
    `
  }

  override render() {
    return html`
      <div class="group">
        <span class="label">Chord highlight</span>
        <div class="description">
          A coloured background behind the chords, not the words, which some readers with dyslexia
          or visual stress find easier to read. Pick whichever suits you: the effect differs from
          person to person. Each colour has a pale form in the light theme and a deep one in the
          dark; "Your own" is used as it is in both. The chord text changes colour if it would
          otherwise be hard to read.
        </div>
        ${this._renderSwatches()}
        <div class="previews">${THEMES.map(theme => this._renderPreview(theme))}</div>
      </div>

      <div class="group">
        <span class="label">Fonts</span>
        <div class="description">
          A typeface for each part on its own. They are fonts your device already has, so they work
          offline; the verse above shows the lyrics and chords ones. Saved on this device only.
        </div>
        <div class="fonts">${FONT_AREAS.map(area => this._renderFontPicker(area))}</div>
      </div>
    `
  }
}

customElements.define('readability-settings', ReadabilitySettings)

declare global {
  interface HTMLElementTagNameMap {
    'readability-settings': ReadabilitySettings
  }
}
