import { css, html, LitElement } from 'lit'
import { loadMediaSettings, saveMediaSettings } from '../js/media-settings.js'
import { getActivePadSet, listPadSets, selectPadSet } from '../js/pad-set-service.js'
import { fieldStyles, switchStyles } from './shared-styles.js'

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
 * @fires settings-change - When any setting changes
 */
export class MediaPlayerSettings extends LitElement {
  static properties = {
    mediaPlayerEnabled: { type: Boolean, attribute: false },
    padsEnabled: { type: Boolean, attribute: false },
    metronomeEnabled: { type: Boolean, attribute: false },
    stereoSplitEnabled: { type: Boolean, attribute: false },
    padSets: { state: true },
    selectedPadSetId: { state: true },
    padSetLoading: { state: true },
    padSetError: { state: true },
  }

  static styles = [
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

    this.padSets = []
    this.selectedPadSetId = getActivePadSet().id
    this.padSetLoading = false
    this.padSetError = ''
  }

  connectedCallback() {
    super.connectedCallback()
    this._loadPadSets()
    this._boundPadSetListUpdated = () => this._loadPadSets(true)
    this._boundPadSetChanged = event => {
      const padSet = event.detail?.padSet
      if (padSet) {
        this.selectedPadSetId = padSet.id
      }
    }
    window.addEventListener('pad-set-list-updated', this._boundPadSetListUpdated)
    window.addEventListener('pad-set-changed', this._boundPadSetChanged)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('pad-set-list-updated', this._boundPadSetListUpdated)
    window.removeEventListener('pad-set-changed', this._boundPadSetChanged)
  }

  _saveSettings() {
    const settings = {
      mediaPlayerEnabled: this.mediaPlayerEnabled,
      padsEnabled: this.padsEnabled,
      metronomeEnabled: this.metronomeEnabled,
      stereoSplitEnabled: this.stereoSplitEnabled,
    }

    saveMediaSettings(settings)

    // Dispatch event so media player can react
    this.dispatchEvent(
      new CustomEvent('settings-change', {
        detail: settings,
        bubbles: true,
        composed: true,
      })
    )
  }

  /** An on/off switch, a real button so it works from the keyboard and screen readers */
  _renderSwitch(label, on, onToggle, { master = false, disabled = false } = {}) {
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

  _toggleMediaPlayer() {
    this.mediaPlayerEnabled = !this.mediaPlayerEnabled
    this._saveSettings()
  }

  _togglePads() {
    this.padsEnabled = !this.padsEnabled
    this._saveSettings()
  }

  _toggleMetronome() {
    this.metronomeEnabled = !this.metronomeEnabled
    this._saveSettings()
  }

  _toggleStereoSplit() {
    this.stereoSplitEnabled = !this.stereoSplitEnabled
    this._saveSettings()
  }

  async _loadPadSets(force = false) {
    this.padSetLoading = true
    this.padSetError = ''
    try {
      const sets = await listPadSets(force)
      this.padSets = sets
      if (!sets.some(set => set.id === this.selectedPadSetId)) {
        this.selectedPadSetId = getActivePadSet().id
      }
    } catch (error) {
      console.error('[MediaPlayerSettings] Failed to load pad sets:', error)
      this.padSetError = error.message || 'Unable to load pad sets.'
    } finally {
      this.padSetLoading = false
    }
  }

  async _handlePadSetChange(event) {
    const newId = event.target.value
    const previousId = this.selectedPadSetId
    this.selectedPadSetId = newId
    this.padSetLoading = true
    this.padSetError = ''

    try {
      await selectPadSet(newId)
    } catch (error) {
      console.error('[MediaPlayerSettings] Failed to switch pad set:', error)
      this.padSetError = error.message || 'Unable to switch pad set.'
      this.selectedPadSetId = previousId
      event.target.value = previousId
    } finally {
      this.padSetLoading = false
    }
  }

  render() {
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
              <div class="setting-label">Pad Sound Set</div>
              <div class="setting-description">Select which pad audio library to use</div>
              <select
                id="padset-select"
                name="padset-select"
                class="field padset-select"
                @change=${this._handlePadSetChange}
                ?disabled=${this.padSetLoading || !this.mediaPlayerEnabled || !this.padsEnabled}
              >
                ${
                  // Selected on the option, not .value on the select: Lit sets the
                  // select's value before rendering its options, so a value whose
                  // option is new in this render was ignored
                  this.padSets && this.padSets.length
                    ? this.padSets.map(
                        set => html`
                          <option value=${set.id} .selected=${set.id === this.selectedPadSetId}>
                            ${set.name}
                          </option>
                        `
                      )
                    : html`<option value="builtin">Built-in Pads</option>`
                }
              </select>
              ${
                this.padSetLoading ? html`<div class="padset-message">Preparing pad set…</div>` : ''
              }
              ${
                this.padSetError
                  ? html`<div class="padset-message error">
                    ${this.padSetError}
                  </div>`
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
