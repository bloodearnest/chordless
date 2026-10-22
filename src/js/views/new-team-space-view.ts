import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/team-space-wizard.ts'
import { PageView } from './page-view.ts'

/** Make a team space: /spaces/new (team-space-wizard.ts) */
export class NewTeamSpaceView extends PageView {
  override render() {
    return html`
      <app-header heading="New team space"></app-header>
      <team-space-wizard></team-space-wizard>
    `
  }
}
customElements.define('new-team-space-view', NewTeamSpaceView)

declare global {
  interface HTMLElementTagNameMap {
    'new-team-space-view': NewTeamSpaceView
  }
}
