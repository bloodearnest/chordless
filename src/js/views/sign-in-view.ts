import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-header.ts'
import '../../components/sign-in-page.ts'
import { PageView } from './page-view.ts'

/** Sign in with the link in the email Chordless sends: /sign-in#<address and code> */
export class SignInView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('page-sign-in')}></app-header>
      <sign-in-page .route=${this.route}></sign-in-page>
    `
  }
}
customElements.define('sign-in-view', SignInView)

declare global {
  interface HTMLElementTagNameMap {
    'sign-in-view': SignInView
  }
}
