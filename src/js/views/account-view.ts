import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/account-page.ts'
import '../../components/app-header.ts'
import { PageView } from './page-view.ts'

/** Account and Teams: who is signed in, and the Personal space and Teams on this device */
export class AccountView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('menu-account')}></app-header>
      <main class="home-content">
        <account-page id="account-page"></account-page>
      </main>
    `
  }
}
customElements.define('account-view', AccountView)

declare global {
  interface HTMLElementTagNameMap {
    'account-view': AccountView
  }
}
