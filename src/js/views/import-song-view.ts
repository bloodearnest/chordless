import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-header.ts'
import '../../components/song-import.ts'
import { PageView } from './page-view.ts'

/** Import songs from ChordPro files or pasted text, or from SongSelect via the bookmarklet */
export class ImportSongView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('menu-import')}></app-header>
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
