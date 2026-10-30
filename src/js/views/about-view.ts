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
        <p id="about-blurb" style="margin: 0 1rem 1rem">
          Chordless shows the lyrics and chords of worship songs for church, as a setlist you can
          arrange and play from. Chords can be hidden or shown for each verse, the key can be
          changed, and one touch moves between songs. It works offline, and your songs are kept in
          your own Google Drive.
        </p>
        <app-about id="app-about"></app-about>
        <p style="margin: 2rem 1rem">
          <a href="/contact">Contact</a> ·
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
