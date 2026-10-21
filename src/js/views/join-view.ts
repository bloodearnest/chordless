import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/team-join.ts'
import { PageView } from './page-view.ts'

/** Join a team space with the link someone sent: /join, with the space and the code in the fragment */
export class JoinView extends PageView {
  override render() {
    return html`
      <app-header heading="Join a team space"></app-header>
      <team-join></team-join>
    `
  }
}
customElements.define('join-view', JoinView)

declare global {
  interface HTMLElementTagNameMap {
    'join-view': JoinView
  }
}
