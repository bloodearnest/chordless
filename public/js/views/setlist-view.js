import { html } from 'lit'
import '../../components/app-header.js'
import '../../components/app-modal.js'
import '../../components/capo-selector.js'
import '../../components/key-selector.js'
import '../../components/musical-metadata-display.js'
import '../../components/setlist-info-dialog.js'
import '../../components/setlist-overview.js'
import '../../components/song-card.js'
import '../../components/song-display.js'
import '../../components/song-info-dialog.js'
import '../../components/song-section.js'
import '../../components/song-settings-popover.js'
import { SetlistPage } from '../setlist-page.js'
import { PageView } from './page-view.js'

/**
 * A setlist: its overview, and each of its songs next to it. The page logic is
 * SetlistPage, which this starts when the view is shown and disposes of when
 * it is left, so nothing it did to the window, <body> or the menu is left behind.
 */
export class SetlistView extends PageView {
  #page = null

  firstUpdated() {
    const { setlistId, songIndex } = this.route
    this.#page = new SetlistPage({ setlistId, songIndex })
    this.#page
      .start()
      // The route may have moved on while the setlist was loading
      .then(() => this.#page?.routeChanged(this.route))
      .catch(error => console.error('[SetlistView] Failed to start:', error))
  }

  updated(changed) {
    // Moves within this setlist (the first route was given to the page at the start)
    if (changed.get('route') !== undefined) this.#page?.routeChanged(this.route)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.#page?.dispose()
    this.#page = null
  }

  render() {
    return html`
      <app-header id="app-header" heading="Loading..." show-edit-toggle show-info-button>
        <div slot="controls" class="header-controls-slot">
          <!-- Musical metadata display / settings trigger -->
          <musical-metadata-display
            id="musical-metadata"
            key-value=""
            capo-value="0"
            bpm=""
            time-signature=""
          ></musical-metadata-display>

          <!-- Song settings popover (contains key, capo, reset, BPM controls) -->
          <song-settings-popover id="song-settings-popover">
            <key-selector id="key-selector" slot="key-selector"></key-selector>
            <capo-selector id="capo-selector" slot="capo-selector"></capo-selector>
          </song-settings-popover>
        </div>
      </app-header>

      <main id="main-content">
        <div class="song-container">
          <p>Loading setlist...</p>
        </div>
      </main>

      <song-info-dialog id="song-info-dialog"></song-info-dialog>
      <setlist-info-dialog id="setlist-info-dialog"></setlist-info-dialog>

      <app-modal
        id="reset-confirm-modal"
        type="confirm"
        heading="Reset Song?"
        message="This will reset the key, capo, and all section states back to defaults. This cannot be undone."
        confirm-label="Reset"
        cancel-label="Cancel"
      >
      </app-modal>

      <app-modal id="add-song-modal" size="fullscreen">
        <div slot="header" class="song-library-header">
          <input
            type="text"
            id="add-song-search-input"
            class="song-search-input"
            placeholder="Search songs by title, artist, or lyrics..."
            autocomplete="off"
          />
        </div>
        <div id="add-song-results" class="song-library-list">
          <p style="text-align: center; color: #95a5a6">Start typing to search songs...</p>
        </div>
      </app-modal>

      <app-modal
        id="delete-song-modal"
        type="confirm"
        heading="Remove Song from Setlist?"
        confirm-label="Remove"
        cancel-label="Cancel"
      >
        <p>
          Are you sure you want to remove "<strong id="delete-song-title"></strong>" from this
          setlist?
        </p>
      </app-modal>
    `
  }
}
customElements.define('setlist-view', SetlistView)
