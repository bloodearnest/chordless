import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-header.ts'
import '../../components/setlist-email-import.ts'
import { PageView } from './page-view.ts'

/** Make a setlist from a leader's email: its songs, date and leader */
export class ImportSetlistView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('page-import-setlist')}></app-header>
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
