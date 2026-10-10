import { html, LitElement } from 'lit'
import './icon.js'

/** A song's card was clicked; index is its place in the setlist */
export class OverviewSongClickEvent extends Event {
  static type = 'setlist-overview:song-click'
  constructor(index) {
    super(OverviewSongClickEvent.type, { bubbles: true, composed: true })
    this.index = index
  }
}

/** A song's delete button was pressed */
export class OverviewSongDeleteEvent extends Event {
  static type = 'setlist-overview:song-delete'
  constructor(index) {
    super(OverviewSongDeleteEvent.type, { bubbles: true, composed: true })
    this.index = index
  }
}

/** A song's key was changed */
export class OverviewSongKeyChangeEvent extends Event {
  static type = 'setlist-overview:song-key-change'
  constructor(index, key) {
    super(OverviewSongKeyChangeEvent.type, { bubbles: true, composed: true })
    this.index = index
    this.key = key
  }
}

/** Add Song was pressed */
export class OverviewAddSongEvent extends Event {
  static type = 'setlist-overview:add-song'
  constructor() {
    super(OverviewAddSongEvent.type, { bubbles: true, composed: true })
  }
}

/**
 * SetlistOverview Component
 *
 * Renders the overview list of songs for the setlist page, using song-card
 * components, and exposes events for navigation, deletion, and adding songs.
 */
export class SetlistOverview extends LitElement {
  static properties = {
    songs: { type: Array, attribute: false },
    editMode: { type: Boolean, attribute: 'edit-mode' },
  }

  constructor() {
    super()
    this.songs = []
    this.editMode = false
  }

  // Render into light DOM so existing CSS/selectors keep working
  createRenderRoot() {
    return this
  }

  render() {
    return html`
      <div class="setlist-overview">
        <div class="overview-songs">
          ${this.songs.map(
            (song, index) => html`
              <song-card
                class="overview-song-card"
                data-song-index=${index}
                .song=${song}
                variant="setlist"
                .editMode=${this.editMode}
                @song-card:click=${() => this._handleSongClick(index)}
                @song-card:delete=${() => this._handleSongDelete(index)}
                @song-card:key-change=${e => this._handleSongKeyChange(index, e.key)}
              ></song-card>
            `
          )}

          <button
            class="song-card add-song-button"
            ?hidden=${!this.editMode}
            @click=${this._handleAddSong}
          >
            <div class="song-card-info">
              <div class="song-card-title-row">
                <div class="song-card-title">
                  <app-icon name="add" size="20" style="vertical-align: middle; margin-right: 8px;"></app-icon>
                  Add Song
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>
    `
  }

  _handleSongClick(index) {
    this.dispatchEvent(new OverviewSongClickEvent(index))
  }

  _handleSongDelete(index) {
    this.dispatchEvent(new OverviewSongDeleteEvent(index))
  }

  _handleSongKeyChange(index, key) {
    this.dispatchEvent(new OverviewSongKeyChangeEvent(index, key))
  }

  _handleAddSong() {
    this.dispatchEvent(new OverviewAddSongEvent())
  }
}

customElements.define('setlist-overview', SetlistOverview)
