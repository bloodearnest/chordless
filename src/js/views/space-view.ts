import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/space-page.ts'
import { PageView } from './page-view.ts'

/** Everything about one Personal space or Team: /account/space/<id> */
export class SpaceView extends PageView {
  override render() {
    return html`
      <app-header heading="Space"></app-header>
      <space-page .route=${this.route}></space-page>
    `
  }
}
customElements.define('space-view', SpaceView)

declare global {
  interface HTMLElementTagNameMap {
    'space-view': SpaceView
  }
}
