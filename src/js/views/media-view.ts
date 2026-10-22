import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/media-page.ts'
import { PageView } from './page-view.ts'

/** The media player's page (media-page.ts): its settings, and the pad sets */
export class MediaView extends PageView {
  override render() {
    return html`
      <app-header heading="Media player"></app-header>
      <main class="home-content">
        <media-page id="media-page"></media-page>
      </main>
    `
  }
}
customElements.define('media-view', MediaView)

declare global {
  interface HTMLElementTagNameMap {
    'media-view': MediaView
  }
}
