import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/select-space.ts'
import '../../components/storage-page.ts'
import { PageView } from './page-view.ts'

/** The Storage page: spaces, Google Drive sync and local data */
export class StorageView extends PageView {
  override render() {
    return html`
      <app-header heading="Storage"></app-header>
      <main class="home-content">
        <storage-page id="storage-page"></storage-page>
      </main>
    `
  }
}
customElements.define('storage-view', StorageView)

declare global {
  interface HTMLElementTagNameMap {
    'storage-view': StorageView
  }
}
