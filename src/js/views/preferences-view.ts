import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-header.ts'
import '../../components/app-preferences.ts'
import { PageView } from './page-view.ts'

/** The Preferences page (the menu also opens the same preferences in a modal) */
export class PreferencesView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('menu-preferences')}></app-header>
      <main class="home-content">
        <h2 style="margin: 2rem 1rem 1rem 1rem">${t('menu-preferences')}</h2>
        <app-preferences id="app-preferences"></app-preferences>
        <p style="margin: 2rem 1rem">
          <a href="/contact">${t('footer-contact')}</a> ·
          <a href="/privacy.html" rel="external">${t('footer-privacy')}</a> ·
          <a href="/terms.html" rel="external">${t('footer-terms')}</a>
        </p>
      </main>
    `
  }
}
customElements.define('preferences-view', PreferencesView)

declare global {
  interface HTMLElementTagNameMap {
    'preferences-view': PreferencesView
  }
}
