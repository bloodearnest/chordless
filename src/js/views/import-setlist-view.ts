import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/setlist-email-import.ts'
import { isReadOnlyOrganisation } from '../organisation.ts'
import { PageView } from './page-view.ts'

/** Make a setlist from a leader's email: its songs, date and leader */
export class ImportSetlistView extends PageView {
  override render() {
    return html`
      <app-header heading="Import a Setlist"></app-header>
      ${
        isReadOnlyOrganisation()
          ? html`<main class="home-content">
            <div class="settings-content">
              <p>
                You have view-only access to this organisation's Google Drive folder, so setlists
                can't be added to it. Ask the person who runs it for edit access.
              </p>
            </div>
          </main>`
          : html`<setlist-email-import></setlist-email-import>`
      }
    `
  }
}
customElements.define('import-setlist-view', ImportSetlistView)

declare global {
  interface HTMLElementTagNameMap {
    'import-setlist-view': ImportSetlistView
  }
}
