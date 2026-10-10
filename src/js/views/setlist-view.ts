import { html, type PropertyValues } from 'lit'
import '../../components/app-header.ts'
import '../../components/app-modal.ts'
import '../../components/capo-selector.ts'
import '../../components/key-selector.ts'
import '../../components/musical-metadata-display.ts'
import '../../components/setlist-info-dialog.ts'
import '../../components/setlist-overview.ts'
import '../../components/song-card.ts'
import '../../components/song-display.ts'
import '../../components/song-info-dialog.ts'
import '../../components/song-section.ts'
import '../../components/song-settings-popover.ts'
import { SetlistPage } from '../setlist-page.ts'
import { PageView } from './page-view.ts'

/**
 * A setlist: its overview, and each of its songs next to it. The page logic is
 * SetlistPage, which this starts when the view is shown and disposes of when
 * it is left, so nothing it did to the window, <body> or the menu is left behind.
 */
export class SetlistView extends PageView {
  #page: SetlistPage | null = null

  /** This view is only shown for the setlist route */
  #setlistRoute() {
    const route = this.route
    if (route?.name !== 'setlist') throw new Error('The setlist view has no setlist route')
    return route
  }

  override firstUpdated() {
    const { setlistId, songIndex } = this.#setlistRoute()
    this.#page = new SetlistPage({
      root: this,
      setlistId,
      songIndex,
      restoredState: this.restoredState,
    })
    this.#page
      .start()
      // The route may have moved on while the setlist was loading
      .then(() => this.#page?.routeChanged(this.#setlistRoute()))
      .catch(error => console.error('[SetlistView] Failed to start:', error))
  }

  /** How far each song (and the overview) was scrolled */
  override captureViewState() {
    return this.#page?.captureViewState()
  }

  override updated(changed: PropertyValues<this>) {
    // Moves within this setlist (the first route was given to the page at the start)
    if (changed.get('route') !== undefined) this.#page?.routeChanged(this.#setlistRoute())
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    this.#page?.dispose()
    this.#page = null
  }

  override render() {
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
