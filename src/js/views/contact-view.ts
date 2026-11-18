import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-contact.ts'
import '../../components/app-header.ts'
import { PageView } from './page-view.ts'

/** The Contact page: an email to us that carries the Support ID and the device */
export class ContactView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('footer-contact')}></app-header>
      <main class="home-content">
        <h2 style="margin: 2rem 1rem 1rem 1rem">${t('footer-contact')}</h2>
        <app-contact id="app-contact"></app-contact>
        <p style="margin: 2rem 1rem">
          <a href="/privacy.html" rel="external">${t('footer-privacy')}</a> ·
          <a href="/terms.html" rel="external">${t('footer-terms')}</a>
        </p>
      </main>
    `
  }
}
customElements.define('contact-view', ContactView)

declare global {
  interface HTMLElementTagNameMap {
    'contact-view': ContactView
  }
}
