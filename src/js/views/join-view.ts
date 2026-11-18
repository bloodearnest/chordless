import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-header.ts'
import '../../components/team-join.ts'
import { PageView } from './page-view.ts'

/** Join a team space with the link someone sent: /join/<space id>/<code> */
export class JoinView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('page-join')}></app-header>
      <team-join .route=${this.route}></team-join>
    `
  }
}
customElements.define('join-view', JoinView)

declare global {
  interface HTMLElementTagNameMap {
    'join-view': JoinView
  }
}
