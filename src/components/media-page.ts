import { css, html, LitElement } from 'lit'
import './media-player-settings.ts'
import { panelStyles } from './shared-styles.ts'

/**
 * The media player (docs/ACCOUNT.md, "Pad sets and the media player"): everything about it is here
 * and nowhere in Preferences. Its switch is at the top, then the click track, then the pads, whose
 * select is also where a new pad set is uploaded.
 */
export class MediaPage extends LitElement {
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

  override render() {
    return html`
      <div class="content">
        <div class="panel">
          <h3>Media player</h3>
          <p>Pads and a click track for your setlists. These settings apply to all of them.</p>
          <media-player-settings uploads></media-player-settings>
        </div>
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
