import { css, html, LitElement } from 'lit'
import { loadMediaSettings, type MediaSettings, saveMediaSettings } from '../js/media-settings.ts'
import { PadSetsController } from '../js/pad-sets-controller.ts'
import { fieldStyles, switchStyles } from './shared-styles.ts'

/** The media player settings changed; settings is the new settings */
export class MediaSettingsChangeEvent extends Event {
  static type = 'media-player-settings:change'
  readonly settings: MediaSettings
  constructor(settings: MediaSettings) {
    super(MediaSettingsChangeEvent.type, { bubbles: true, composed: true })
    this.settings = settings
  }
}

/**
 * MediaPlayerSettings Component
 *
 * Global settings for the media player functionality.
 * Controls which features are enabled/disabled globally.
 *
 * Properties:
 * @property {Boolean} mediaPlayerEnabled - Master enable/disable for all media player features
 * @property {Boolean} padsEnabled - Enable/disable pad audio playback
 * @property {Boolean} metronomeEnabled - Enable/disable metronome/click track
 * @property {Boolean} stereoSplitEnabled - Enable L/R channel split (pads left, click right)
 *
 * Events:
 * @fires MediaSettingsChangeEvent - When any setting changes (settings)
 */
export class MediaPlayerSettings extends LitElement {
  static override properties = {
    mediaPlayerEnabled: { type: Boolean, attribute: false },
    padsEnabled: { type: Boolean, attribute: false },
    metronomeEnabled: { type: Boolean, attribute: false },
    stereoSplitEnabled: { type: Boolean, attribute: false },
  }

  declare mediaPlayerEnabled: boolean
  declare padsEnabled: boolean
  declare metronomeEnabled: boolean
  declare stereoSplitEnabled: boolean

  _padSets: PadSetsController

  static override styles = [
    switchStyles,
    fieldStyles,
    css`
      :host {
        display: block;
      }

      h2 {
        margin: 0 0 1rem 0;
        font-size: var(--font-ui-small);
        font-weight: 600;
      }

      .setting-group {
        margin-bottom: 1.5rem;
      }

      .setting-group:last-child {
        margin-bottom: 0;
      }

      .setting-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.75rem;
        background: var(--tint);
        border-radius: 4px;
        margin-bottom: 0.5rem;
      }

      .setting-item:last-child {
        margin-bottom: 0;
      }

      .setting-item.disabled {
        opacity: 0.5;
        pointer-events: none;
      }

      .setting-item.indent {
        margin-left: 1.5rem;
        background: var(--tint-subtle);
      }

      .setting-label {
        display: block;
        font-size: var(--font-ui);
        font-weight: 500;
      }

      .setting-description {
        font-size: var(--font-ui-small);
        opacity: 0.7;
        margin-top: 0.25rem;
      }

      .padset-select {
        margin-top: 0.5rem;
      }

      .padset-message {
        font-size: var(--font-ui-small);
        margin-top: 0.4rem;
        opacity: 0.8;
      }

      .padset-message.error {
        color: var(--color-danger, #e74c3c);
        opacity: 1;
      }
    `,
  ]

  constructor() {
    super()

    Object.assign(this, loadMediaSettings())

    this._padSets = new PadSetsController(this)
  }

  _saveSettings(): void {
    const settings: MediaSettings = {
      mediaPlayerEnabled: this.mediaPlayerEnabled,
      padsEnabled: this.padsEnabled,
      metronomeEnabled: this.metronomeEnabled,
      stereoSplitEnabled: this.stereoSplitEnabled,
    }

    saveMediaSettings(settings)

    // Dispatch event so media player can react
    this.dispatchEvent(new MediaSettingsChangeEvent(settings))
  }

  /** An on/off switch, a real button so it works from the keyboard and screen readers */
  _renderSwitch(
    label: string,
    on: boolean,
    onToggle: () => void,
    { master = false, disabled = false }: { master?: boolean; disabled?: boolean } = {}
  ) {
    return html`
      <button
        type="button"
        role="switch"
        class="toggle-switch ${master ? 'master' : ''} ${on ? 'active' : ''}"
        aria-checked=${on ? 'true' : 'false'}
        aria-label=${label}
        ?disabled=${disabled}
        @click=${onToggle}
      ></button>
    `
  }

  _toggleMediaPlayer(): void {
    this.mediaPlayerEnabled = !this.mediaPlayerEnabled
    this._saveSettings()
  }

  _togglePads(): void {
    this.padsEnabled = !this.padsEnabled
    this._saveSettings()
  }

  _toggleMetronome(): void {
    this.metronomeEnabled = !this.metronomeEnabled
    this._saveSettings()
  }

  _toggleStereoSplit(): void {
    this.stereoSplitEnabled = !this.stereoSplitEnabled
    this._saveSettings()
  }

  async _handlePadSetChange(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement
    try {
      await this._padSets.select(select.value)
    } catch (error) {
      console.error('[MediaPlayerSettings] Failed to switch pad set:', error)
      select.value = this._padSets.activeId
    }
  }

  override render() {
    return html`
      <div class="container">
        <h2>🎵 Media Player Settings</h2>

        <!-- Master toggle -->
        <div class="setting-group">
          <div class="setting-item">
            <div>
              <div class="setting-label">Enable Media Player</div>
              <div class="setting-description">Master control for all media player features</div>
            </div>
            ${this._renderSwitch(
              'Enable Media Player',
              this.mediaPlayerEnabled,
              this._toggleMediaPlayer,
              { master: true }
            )}
          </div>
        </div>

        <!-- Pads settings -->
        <div class="setting-group">
          <div class="setting-item ${!this.mediaPlayerEnabled ? 'disabled' : ''}">
            <div>
              <div class="setting-label">Enable Pads</div>
              <div class="setting-description">Background pad audio playback</div>
            </div>
            ${this._renderSwitch('Enable Pads', this.padsEnabled, this._togglePads, {
              disabled: !this.mediaPlayerEnabled,
            })}
          </div>

          <div
            class="setting-item indent ${
              !this.mediaPlayerEnabled || !this.padsEnabled ? 'disabled' : ''
            }"
          >
            <div style="flex: 1;">
              <label class="setting-label" for="padset-select">Pad Sound Set</label>
              <div class="setting-description">Select which pad audio library to use</div>
              <select
                id="padset-select"
                name="padset-select"
                class="field padset-select"
                @change=${this._handlePadSetChange}
                ?disabled=${this._padSets.loading || this._padSets.switching || !this.mediaPlayerEnabled || !this.padsEnabled}
              >
                ${
                  // Selected on the option, not .value on the select: Lit sets the
                  // select's value before rendering its options, so a value whose
                  // option is new in this render was ignored
                  this._padSets.list.length
                    ? this._padSets.list.map(
                        set => html`
                          <option value=${set.id} .selected=${set.id === this._padSets.activeId}>
                            ${set.name}
                          </option>
                        `
                      )
                    : html`<option value="builtin">Built-in Pads</option>`
                }
              </select>
              ${
                this._padSets.loading || this._padSets.switching
                  ? html`<div class="padset-message">Preparing pad set…</div>`
                  : ''
              }
              ${
                this._padSets.error
                  ? html`<div class="padset-message error">${this._padSets.error}</div>`
                  : ''
              }
            </div>
          </div>
        </div>

        <!-- Metronome settings -->
        <div class="setting-group">
          <div class="setting-item ${!this.mediaPlayerEnabled ? 'disabled' : ''}">
            <div>
              <div class="setting-label">Enable Metronome</div>
              <div class="setting-description">Click track with tempo and time signature</div>
            </div>
            ${this._renderSwitch('Enable Metronome', this.metronomeEnabled, this._toggleMetronome, {
              disabled: !this.mediaPlayerEnabled,
            })}
          </div>

          <!-- Stereo split (only when metronome enabled) -->
          <div
            class="setting-item indent ${
              !this.mediaPlayerEnabled || !this.metronomeEnabled ? 'disabled' : ''
            }"
          >
            <div>
              <div class="setting-label">Stereo Split (L/R)</div>
              <div class="setting-description">Pads → Left, Click → Right</div>
            </div>
            ${this._renderSwitch(
              'Stereo Split (L/R)',
              this.stereoSplitEnabled,
              this._toggleStereoSplit,
              { disabled: !this.mediaPlayerEnabled || !this.metronomeEnabled }
            )}
          </div>
        </div>
      </div>
    `
  }
}

// Define the custom element
customElements.define('media-player-settings', MediaPlayerSettings)

declare global {
  interface HTMLElementTagNameMap {
    'media-player-settings': MediaPlayerSettings
  }
}
