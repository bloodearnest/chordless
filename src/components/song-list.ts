import { css, html, LitElement } from 'lit'
import type { SongWithContent } from '../js/data-types.ts'
import './song-card.ts'
import './status-message.ts'

/** A song was chosen; index is its place in the list */
export class SongSelectEvent extends Event {
  static readonly type = 'song-list:select'
  readonly song: SongWithContent
  readonly index: number
  readonly originalEvent: Event
  constructor(song: SongWithContent, index: number, originalEvent: Event) {
    super(SongSelectEvent.type, { bubbles: true, composed: true })
    this.song = song
    this.index = index
    this.originalEvent = originalEvent
  }
}

/**
 * SongList component
 *
 * Renders a vertical list of <song-card> entries with a consistent empty state.
 * Emits a "song-select" event whenever a song card is clicked.
 */
export class SongList extends LitElement {
  static override properties = {
    songs: { type: Array, attribute: false },
    variant: { type: String, attribute: 'variant' },
    search: { type: String },
    emptyMessage: { type: String, attribute: 'empty-message' },
    emptyDetail: { type: String, attribute: 'empty-detail' },
    dense: { type: Boolean, reflect: true },
  }

  declare songs: SongWithContent[]
  declare variant: string
  /** The search the songs were filtered by: each card marks where it matched */
  declare search: string
  declare emptyMessage: string
  declare emptyDetail: string
  declare dense: boolean

  constructor() {
    super()
    this.songs = []
    this.variant = 'library'
    this.search = ''
    this.emptyMessage = 'No songs to display.'
    this.emptyDetail = ''
    this.dense = false
  }

  static override styles = css`
    :host {
      display: block;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: var(--song-list-gap, 1rem);
    }

    :host([dense]) .list {
      gap: var(--song-list-gap-dense, 0.6rem);
    }

    song-card {
      margin: 0;
    }
  `

  _handleSongClick(song: SongWithContent, index: number, originalEvent: Event): void {
    this.dispatchEvent(new SongSelectEvent(song, index, originalEvent))
  }

  _renderEmptyState() {
    return html`
      <status-message state="empty" .message=${this.emptyMessage} .detail=${this.emptyDetail}>
      </status-message>
    `
  }

  override render() {
    if (!this.songs || this.songs.length === 0) {
      return this._renderEmptyState()
    }

    return html`
      <div class="list">
        ${this.songs.map(
          (song, index) => html`
            <song-card
              .song=${song}
              .variant=${this.variant}
              .search=${this.search}
              @song-card:click=${(event: Event) => this._handleSongClick(song, index, event)}
            >
            </song-card>
          `
        )}
      </div>
    `
  }
}

customElements.define('song-list', SongList)

declare global {
  interface HTMLElementTagNameMap {
    'song-list': SongList
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [SongSelectEvent.type]: SongSelectEvent
  }
}
