import { html } from 'lit'
import '../../components/app-about.ts'
import '../../components/app-header.ts'
import { PageView } from './page-view.ts'

/** The About page: the version and updates, installing, offline use, and the device's storage */
export class AboutView extends PageView {
  override render() {
    return html`
      <app-header heading="About"></app-header>
      <main class="home-content">
        <h2 style="margin: 2rem 1rem 1rem 1rem">About Chordless</h2>
        <app-about id="app-about"></app-about>
        <p style="margin: 2rem 1rem">
          <a href="/privacy.html" rel="external">Privacy policy</a> ·
          <a href="/terms.html" rel="external">Terms of service</a>
        </p>
      </main>
    `
  }
}
customElements.define('about-view', AboutView)

declare global {
  interface HTMLElementTagNameMap {
    'about-view': AboutView
  }
}
