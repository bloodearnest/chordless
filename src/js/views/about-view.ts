import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-about.ts'
import '../../components/app-header.ts'
import { PageView } from './page-view.ts'

/** The About page: the version and updates, installing, offline use, and the device's storage */
export class AboutView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('menu-about')}></app-header>
      <main class="home-content">
        <h2 style="margin: 2rem 1rem 1rem 1rem">${t('about-heading')}</h2>
        <p id="about-blurb" style="margin: 0 1rem 1rem">
          ${t('about-blurb')}
        </p>
        <app-about id="app-about"></app-about>
        <p style="margin: 2rem 1rem">
          <a href="/contact">${t('footer-contact')}</a> ·
          <a href="/privacy.html" rel="external">${t('footer-privacy')}</a> ·
          <a href="/terms.html" rel="external">${t('footer-terms')}</a> ·
          <a href="/licences.html" rel="external">${t('footer-licences')}</a>
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
