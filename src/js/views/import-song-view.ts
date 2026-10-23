import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/song-import.ts'
import '../../components/space-tabs.ts'
import { PageView } from './page-view.ts'

/** Import songs from ChordPro files or pasted text, or from SongSelect via the bookmarklet */
export class ImportSongView extends PageView {
  override render() {
    return html`
      <app-header heading="Import Songs"></app-header>
      <space-tabs></space-tabs>
      <song-import></song-import>
    `
  }
}
customElements.define('import-song-view', ImportSongView)

declare global {
  interface HTMLElementTagNameMap {
    'import-song-view': ImportSongView
  }
}
