import { html, LitElement, nothing } from 'lit'
import { type ListedSong, songListText } from '../js/setlist/song-list-text.ts'
import './icon.ts'
import type { SongCardBpmChangeEvent, SongCardKeyChangeEvent } from './song-card.ts'

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

/** A song's tempo was changed */
export class OverviewSongBpmChangeEvent extends Event {
  static readonly type = 'setlist-overview:song-bpm-change'
  readonly index: number
  readonly bpm: number
  constructor(index: number, bpm: number) {
    super(OverviewSongBpmChangeEvent.type, { bubbles: true, composed: true })
    this.index = index
    this.bpm = bpm
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
    _copied: { state: true },
  }

  /** How long the button says Copied */
  static copiedMs = 2000

  declare songs: unknown[] /* TYPE */
  declare editMode: boolean
  declare _copied: boolean

  constructor() {
    super()
    this.songs = []
    this.editMode = false
    this._copied = false
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
                @song-card:bpm-change=${(e: SongCardBpmChangeEvent) => this._handleSongBpmChange(index, e.bpm)}
              ></song-card>
            `
          )}

          <button
            class="song-card add-song-button"
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
          ${
            this.songs.length
              ? html`<button class="copy-song-list" @click=${this._copySongList}>
                  <app-icon name=${this._copied ? 'check' : 'copy'} size="18"></app-icon>
                  ${this._copied ? 'Copied' : 'Copy song list'}
                </button>`
              : nothing
          }
        </div>
      </div>
    `
  }

  /** The titles with their CCLI numbers, as text to paste (to the media team, say) */
  async _copySongList() {
    try {
      await navigator.clipboard.writeText(songListText(this.songs as ListedSong[]))
      this._copied = true
      setTimeout(() => {
        this._copied = false
      }, SetlistOverview.copiedMs)
    } catch {
      // Clipboard access can be refused: nothing else to do
    }
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

  _handleSongBpmChange(index: number, bpm: number): void {
    this.dispatchEvent(new OverviewSongBpmChangeEvent(index, bpm))
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
    [OverviewSongBpmChangeEvent.type]: OverviewSongBpmChangeEvent
    [OverviewAddSongEvent.type]: OverviewAddSongEvent
  }
}
