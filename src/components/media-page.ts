import { css, html, LitElement } from 'lit'
import { loadMediaSettings } from '../js/media-settings.ts'
import { MediaSettingsChangeEvent } from './media-player-settings.ts'
import './media-player-settings.ts'
import './pad-set-manager.ts'
import { panelStyles } from './shared-styles.ts'

/**
 * The media player (docs/ACCOUNT.md, "Pad sets and the media player"): everything about it is here
 * and nowhere in Preferences. Its switch is at the top; the pad sets are shown only while the
 * player is on, as nothing else uses them.
 */
export class MediaPage extends LitElement {
  static override properties = {
    _enabled: { state: true },
  }

  declare _enabled: boolean

  static override styles = [
    panelStyles,
    css`
      :host {
        display: block;
      }
      .content {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-width: 800px;
        margin: 0 auto;
      }
    `,
  ]

  constructor() {
    super()
    this._enabled = loadMediaSettings().mediaPlayerEnabled
  }

  _onChange = (event: Event): void => {
    this._enabled = (event as MediaSettingsChangeEvent).settings.mediaPlayerEnabled
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener(MediaSettingsChangeEvent.type, this._onChange)
  }

  override disconnectedCallback(): void {
    this.removeEventListener(MediaSettingsChangeEvent.type, this._onChange)
    super.disconnectedCallback()
  }

  override render() {
    return html`
      <div class="content">
        <div class="panel">
          <h3>Media player</h3>
          <p>Pads and a click track for your setlists. These settings apply to all of them.</p>
          <media-player-settings></media-player-settings>
        </div>
        ${
          this._enabled
            ? html`<div class="panel">
              <h3>Pad sets</h3>
              <p>
                Upload zipped pad libraries (with all 12 keys). They are stored on this device for
                instant use and uploaded to Google Drive when you are signed in.
              </p>
              <pad-set-manager></pad-set-manager>
            </div>`
            : html`<div class="panel">
              <p>The media player is off, so there is nothing else to set up.</p>
            </div>`
        }
      </div>
    `
  }
}
customElements.define('media-page', MediaPage)

declare global {
  interface HTMLElementTagNameMap {
    'media-page': MediaPage
  }
}
