import { html, LitElement } from 'lit'
import './icon.ts'
import type { SongCardKeyChangeEvent } from './song-card.ts'

/** A song's card was clicked; index is its place in the setlist */
export class OverviewSongClickEvent extends Event {
  static readonly type = 'setlist-overview:song-click'
  readonly index: number
  constructor(index: number) {
    super(OverviewSongClickEvent.type, { bubbles: true, composed: true })
    this.index = index
  }
}

/** A song's delete button was pressed */
export class OverviewSongDeleteEvent extends Event {
  static readonly type = 'setlist-overview:song-delete'
  readonly index: number
  constructor(index: number) {
    super(OverviewSongDeleteEvent.type, { bubbles: true, composed: true })
    this.index = index
  }
}

/** A song's key was changed */
export class OverviewSongKeyChangeEvent extends Event {
  static readonly type = 'setlist-overview:song-key-change'
  readonly index: number
  readonly key: string
  constructor(index: number, key: string) {
    super(OverviewSongKeyChangeEvent.type, { bubbles: true, composed: true })
    this.index = index
    this.key = key
  }
}

/** Add Song was pressed */
export class OverviewAddSongEvent extends Event {
  static readonly type = 'setlist-overview:add-song'
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
  static override properties = {
    songs: { type: Array, attribute: false },
    editMode: { type: Boolean, attribute: 'edit-mode' },
  }

  declare songs: unknown[] /* TYPE */
  declare editMode: boolean

  constructor() {
    super()
    this.songs = []
    this.editMode = false
  }

  // Render into light DOM so existing CSS/selectors keep working
  override createRenderRoot() {
    return this
  }

  override render() {
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
                @song-card:key-change=${(e: SongCardKeyChangeEvent) => this._handleSongKeyChange(index, e.key)}
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

  _handleSongClick(index: number): void {
    this.dispatchEvent(new OverviewSongClickEvent(index))
  }

  _handleSongDelete(index: number): void {
    this.dispatchEvent(new OverviewSongDeleteEvent(index))
  }

  _handleSongKeyChange(index: number, key: string): void {
    this.dispatchEvent(new OverviewSongKeyChangeEvent(index, key))
  }

  _handleAddSong() {
    this.dispatchEvent(new OverviewAddSongEvent())
  }
}

customElements.define('setlist-overview', SetlistOverview)

declare global {
  interface HTMLElementTagNameMap {
    'setlist-overview': SetlistOverview
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [OverviewSongClickEvent.type]: OverviewSongClickEvent
    [OverviewSongDeleteEvent.type]: OverviewSongDeleteEvent
    [OverviewSongKeyChangeEvent.type]: OverviewSongKeyChangeEvent
    [OverviewAddSongEvent.type]: OverviewAddSongEvent
  }
}
