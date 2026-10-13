import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/song-import.ts'
import { isReadOnlyOrganisation } from '../organisation.ts'
import { PageView } from './page-view.ts'

/** Import songs from ChordPro files or pasted text, or from SongSelect via the bookmarklet */
export class ImportSongView extends PageView {
  override render() {
    return html`
      <app-header heading="Import Songs"></app-header>
      ${
        isReadOnlyOrganisation()
          ? html`<main class="home-content">
            <div class="settings-content">
              <p>
                You have view-only access to this organisation's Google Drive folder, so songs
                can't be added to its library. Ask the person who runs it for edit access.
              </p>
            </div>
          </main>`
          : html`<song-import></song-import>`
      }
    `
  }
}
customElements.define('import-song-view', ImportSongView)

declare global {
  interface HTMLElementTagNameMap {
    'import-song-view': ImportSongView
  }
}
