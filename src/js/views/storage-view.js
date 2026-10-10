import { html } from 'lit'
import '../../components/app-header.js'
import '../../components/select-organisation.js'
import '../../components/storage-page.js'
import { PageView } from './page-view.js'

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
