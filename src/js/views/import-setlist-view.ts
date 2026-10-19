import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/setlist-email-import.ts'
import { PageView } from './page-view.ts'

/** Make a setlist from a leader's email: its songs, date and leader */
export class ImportSetlistView extends PageView {
  override render() {
    return html`
      <app-header heading="Import a Setlist"></app-header>
      <setlist-email-import></setlist-email-import>
    `
  }
}
customElements.define('import-setlist-view', ImportSetlistView)

declare global {
  interface HTMLElementTagNameMap {
    'import-setlist-view': ImportSetlistView
  }
}
