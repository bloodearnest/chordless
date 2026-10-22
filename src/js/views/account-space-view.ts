import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/space-page.ts'
import { PageView } from './page-view.ts'

/** One Personal space or Team: /account/<id> */
export class AccountSpaceView extends PageView {
  override render() {
    const spaceId = this.route?.name === 'account-space' ? this.route.spaceId : ''
    return html`
      <app-header heading="Account and Teams"></app-header>
      <main class="home-content">
        <space-page id="space-page" .spaceId=${spaceId}></space-page>
      </main>
    `
  }
}
customElements.define('account-space-view', AccountSpaceView)

declare global {
  interface HTMLElementTagNameMap {
    'account-space-view': AccountSpaceView
  }
}
