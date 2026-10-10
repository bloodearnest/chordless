import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/select-organisation.ts'
import '../../components/storage-page.js'
import { PageView } from './page-view.ts'

/** The Storage page: organisations, Google Drive sync and local data */
export class StorageView extends PageView {
  render() {
    return html`
      <app-header heading="Storage"></app-header>
      <main class="home-content">
        <storage-page id="storage-page"></storage-page>
      </main>
    `
  }
}
customElements.define('storage-view', StorageView)
