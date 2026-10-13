import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/bookmarklet-installer.ts'
import { PageView } from './page-view.ts'

/** How to install the bookmarklet that imports a song from CCLI SongSelect (styled in style.css) */
export class BookmarkletView extends PageView {
  override render() {
    return html`
      <app-header heading="Bookmarklet"></app-header>

      <main class="home-content">
        <div class="settings-content">
          <h2>CCLI SongSelect Importer</h2>
          <p class="touch-tip">
            <strong>On a phone or tablet?</strong> The bookmarklet works best on a computer.
            Instead, download the song's ChordPro file from SongSelect, then open it in
            <a href="/import-song">Import Songs</a>.
          </p>
          <p class="note lead">
            Import songs from SongSelect directly into your Chordless library with one click using
            this bookmarklet.
          </p>

          <div class="settings-section">
            <h3>Install Bookmarklet</h3>
            <p class="note desktop-only">
              <strong>Drag this button to your bookmarks bar:</strong>
            </p>
            <bookmarklet-installer>
              <h4>Alternative Method</h4>
              <p class="note">
                <span class="desktop-only">If dragging doesn't work, you</span
                ><span class="touch-only">You</span> can create the bookmark yourself:
              </p>
              <ol class="note">
                <li>
                  Create a new bookmark<span class="desktop-only"> (Ctrl+D or Cmd+D)</span
                  ><span class="touch-only"> of any page, then edit it</span>
                </li>
                <li>Name it "🎵 Import to Chordless"</li>
                <li>Copy the code below and paste it as the URL</li>
              </ol>
            </bookmarklet-installer>
          </div>

          <div class="settings-section">
            <h3>Desktop Installation</h3>
            <div class="install-step">
              <span class="step-number">1</span>
              <strong>Show your bookmarks bar:</strong> Press <code>Ctrl+Shift+B</code> (Windows)
              or <code>Cmd+Shift+B</code> (Mac)
            </div>
            <div class="install-step">
              <span class="step-number">2</span>
              <strong>Drag the purple button above</strong> to your bookmarks bar
            </div>
            <div class="install-step">
              <span class="step-number">3</span>
              Navigate to a song page on SongSelect
            </div>
            <div class="install-step">
              <span class="step-number">4</span>
              Click the bookmark
            </div>
          </div>

          <div class="settings-section">
            <h3>Mobile Installation</h3>
            <p class="note">
              The easiest way on a phone or tablet is to download the song's ChordPro file from
              SongSelect, then open it in <a href="/import-song">Import Songs</a>.
            </p>
            <p class="note">
              To use the bookmarklet anyway, bookmark any page, then edit the bookmark and paste
              the code from the "Alternative Method" above as its URL. On Android, run it by
              typing the bookmark's name in the address bar and tapping it.
            </p>
            <p class="note">
              On iPhone and iPad, songs it imports in Safari don't reach Chordless installed on
              the home screen, which keeps its own separate storage.
            </p>
          </div>

          <div class="settings-section">
            <h3>How It Works</h3>
            <ol class="note">
              <li>Navigate to a song on SongSelect</li>
              <li>Click the bookmarklet</li>
              <li>
                It opens Chordless's Import Songs page, and downloads the song's ChordPro file
                from SongSelect using your login
              </li>
              <li>It sends the song to Chordless, which saves it to your library</li>
              <li>Choose a setlist to add it to, or just keep it in the library</li>
            </ol>
          </div>
        </div>
      </main>
    `
  }
}
customElements.define('bookmarklet-view', BookmarkletView)

declare global {
  interface HTMLElementTagNameMap {
    'bookmarklet-view': BookmarkletView
  }
}
