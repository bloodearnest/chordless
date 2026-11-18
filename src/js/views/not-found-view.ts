import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-header.ts'
import { PageView } from './page-view.ts'

/** For a URL that is no page of the app */
export class NotFoundView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('page-not-found')}></app-header>
      <main class="home-content">
        <h2 style="margin: 2rem 1rem 1rem 1rem">${t('page-not-found-heading')}</h2>
        <p style="margin: 0 1rem"><a href="/">${t('page-not-found-link')}</a></p>
      </main>
    `
  }
}
customElements.define('not-found-view', NotFoundView)

declare global {
  interface HTMLElementTagNameMap {
    'not-found-view': NotFoundView
  }
}
