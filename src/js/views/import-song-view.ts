import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/song-import.js'
import { PageView } from './page-view.ts'

/** Import songs from ChordPro files or pasted text, or from SongSelect via the bookmarklet */
export class ImportSongView extends PageView {
  override render() {
    return html`
      <app-header heading="Import Songs"></app-header>
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
