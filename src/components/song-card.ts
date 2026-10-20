import { css, html, LitElement } from 'lit'
import type { ParsedChart } from '../js/data-types.ts'
import { formatArtistNames } from '../js/song-utils.ts'
import { getWeeksAgo } from '../js/utils/date-utils.ts'
import { lyricSnippet, matchedFields, normalizeTerm } from '../js/utils/song-filter.ts'
import './icon.ts'
import type { KeyChangeEvent } from './key-selector.ts'
import './key-selector.ts'

/** A song as the card shows it: from the library (with its last use) or a setlist (with its key) */
export interface SongCardSong {
  title: string
  artist?: string | null
  /** The chart, to show where a search matched its lyrics */
  parsed?: ParsedChart | null
  metadata?: {
    key?: string | null
    tempo?: string | number | null
    timeSignature?: string | null
  } | null
  /** In a setlist: the key it is in, and the key the chart was written in */
  currentKey?: string
  originalKey?: string | null
  lastUsageInfo?: { date: string; leader: string; key: string | null }
  /** Set for a song from another database than the space's: where it is from */
  source?: { label: string }
  /** The older record of when it was last played */
  lastUsedAt?: string
}

/** The card was clicked (not in edit mode) */
export class SongCardClickEvent extends Event {
  static readonly type = 'song-card:click'
  readonly song: SongCardSong
  constructor(song: SongCardSong) {
    super(SongCardClickEvent.type, { bubbles: true, composed: true })
    this.song = song
  }
}

/** The delete button was pressed */
export class SongCardDeleteEvent extends Event {
  static readonly type = 'song-card:delete'
  readonly song: SongCardSong
  constructor(song: SongCardSong) {
    super(SongCardDeleteEvent.type, { bubbles: true, composed: true })
    this.song = song
  }
}

/** A new key was chosen */
export class SongCardKeyChangeEvent extends Event {
  static readonly type = 'song-card:key-change'
  readonly key: string
  constructor(key: string) {
    super(SongCardKeyChangeEvent.type, { bubbles: true, composed: true })
    this.key = key
  }
}

/** A new tempo was chosen */
export class SongCardBpmChangeEvent extends Event {
  static readonly type = 'song-card:bpm-change'
  readonly bpm: number
  constructor(bpm: number) {
    super(SongCardBpmChangeEvent.type, { bubbles: true, composed: true })
    this.bpm = bpm
  }
}

/** The tempos the player and the song's own BPM stepper allow */
const BPM_MIN = 40
const BPM_MAX = 240

const MAJOR_KEYS = ['Ab', 'A', 'Bb', 'B', 'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G']
const MINOR_KEYS = ['Abm', 'Am', 'Bbm', 'Bm', 'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm']

/**
 * SongCard Component
 *
 * A reusable card component for displaying song information in different contexts.
 *
 * Variants:
 * - 'setlist': Compact view for live performance (title, key, BPM only)
 * - 'library': Full view with artist, last played, and appearance count
 *
 * Properties:
 * @property {Object} song - Song data object containing title, artist, metadata, etc.
 * @property {String} variant - Display variant: 'setlist' | 'library'
 *
 * Events:
 * @fires SongCardClickEvent - When the card is clicked, outside edit mode (song)
 * @fires SongCardDeleteEvent - When the delete button is pressed in edit mode (song)
 * @fires SongCardKeyChangeEvent - When a new key is chosen in edit mode (key)
 * @fires SongCardBpmChangeEvent - When a new tempo is entered in edit mode, in a setlist (bpm)
 *
 * CSS Parts:
 * @csspart card - The main card container
 * @csspart title - The song title element
 * @csspart artist - The artist element
 * @csspart meta - The metadata container
 * @csspart info - The additional info container
 */
export class SongCard extends LitElement {
  static override properties = {
    song: { type: Object, attribute: false },
    variant: { type: String, reflect: true },
    editMode: { type: Boolean, reflect: true, attribute: 'edit-mode' },
    search: { type: String },
  }

  declare song: SongCardSong | null
  declare variant: string
  declare editMode: boolean
  /** The library search the song matched: its matches are marked, and a lyrics match is quoted */
  declare search: string

  contextMenuHandler?: (e: Event) => void

  static override styles = css`
    :host {
      display: block;
      font-family: var(
        --font-family,
        -apple-system,
        BlinkMacSystemFont,
        'Segoe UI',
        Roboto,
        sans-serif
      );
      touch-action: manipulation;
      -webkit-user-select: none;
      user-select: none;
      position: relative;
    }

    .card-wrapper {
      position: relative;
    }

    .card {
      background: var(--bg-secondary, #ecf0f1);
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      position: relative;
      overflow: hidden;
    }

    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
      border-color: var(--color-primary, #2477ad);
    }

    .card:active {
      transform: translateY(0);
    }

    /* Card content area */
    .card-content {
      padding: var(--card-padding, 1.5rem);
    }

    /* Two-line layout */
    .line1 {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 1rem;
      margin-bottom: 0.5rem;
    }

    .line2 {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 1rem;
    }

    .title {
      font-size: var(--font-ui);
      font-weight: 600;
      color: var(--text-color, #2c3e50);
      line-height: 1.3;
      flex: 1;
      min-width: 0;
    }

    .artist {
      font-size: var(--font-ui);
      color: var(--text-secondary, #5f6b6d);
      font-style: italic;
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    mark {
      background: var(--search-match-bg, rgba(255, 200, 0, 0.4));
      color: inherit;
      border-radius: 2px;
    }

    .lyric-match {
      font-size: var(--font-ui-small);
      color: var(--text-secondary, #5f6b6d);
      margin-top: 0.5rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .match-label {
      font-weight: 600;
      margin-inline-end: 0.5em;
    }

    .meta {
      font-size: var(--font-ui);
      color: var(--text-secondary, #5f6b6d);
      flex: 1;
    }

    .last-played {
      font-size: var(--font-ui-small);
      color: var(--text-secondary, #5f6b6d);
      text-align: right;
      white-space: nowrap;
    }

    /* Variant-specific styles */
    :host([variant='setlist']) .card-content {
      padding: 1.2rem 1.5rem;
    }

    :host([variant='setlist']) .title {
      font-size: var(--font-ui);
    }

    /* Empty state */
    .empty {
      color: var(--text-secondary, #5f6b6d);
      font-style: italic;
    }

    /* Edit mode controls container */
    .edit-controls {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: row;
      align-items: center;
      background: var(--bg-tertiary, #f8f9fa);
      box-shadow: -8px 0 16px rgba(0, 0, 0, 0.08);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.5s ease;
    }

    :host([edit-mode]) .edit-controls {
      opacity: 1;
      pointer-events: auto;
    }

    .delete-button {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.8rem;
      margin: 0 1rem;
      height: auto;
      background: var(--color-danger, #e74c3c);
      border: 2px solid var(--color-danger, #e74c3c);
      border-radius: 6px;
      color: white;
      font-size: var(--font-ui);
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition:
        background 0.2s ease,
        border-color 0.2s ease;
    }

    .delete-button:hover {
      filter: brightness(0.9);
    }

    .delete-button:active {
      filter: brightness(0.8);
    }

    .delete-icon {
      flex-shrink: 0;
    }

    .drag-handle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 50px;
      background: var(--bg-tertiary, #f8f9fa);
      cursor: grab;
      color: var(--text-secondary, #5f6b6d);
      font-size: 24px;
      user-select: none;
      touch-action: none;
      transition:
        background 0.2s ease,
        color 0.2s ease;
    }

    .drag-handle:hover {
      background: var(--bg-secondary, #ecf0f1);
      color: var(--color-primary, #2477ad);
    }

    .drag-handle:active {
      cursor: grabbing;
      background: var(--hover-bg, rgba(0, 0, 0, 0.1));
    }

    /* Hide drag handle in library variant */
    :host([variant='library']) .drag-handle {
      display: none;
    }

    .key-edit-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 0.5rem;
      align-self: stretch;
      /* Override key-selector colors to use theme text instead of header-text */
      --header-text: var(--text-color, #1a1a1a);
      --header-bg: var(--bg-tertiary, #ecf0f1);
    }

    :host([variant='library']) .key-edit-wrapper {
      display: none;
    }

    .bpm-edit {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0 0.5rem;
      font-size: var(--font-ui-small);
      color: var(--text-color, #1a1a1a);
    }

    .bpm-edit input {
      box-sizing: border-box;
      width: 4.5rem;
      min-height: 2.5rem;
      padding: 0.4rem 0.6rem;
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 6px;
      background: var(--bg-secondary, #ecf0f1);
      color: inherit;
      font: inherit;
      font-size: var(--font-ui);
      text-align: center;
    }

    :host([variant='setlist']) .card-content {
      padding: 1.2rem 1.5rem;
    }
  `

  constructor() {
    super()
    this.song = null
    this.variant = 'library'
    this.editMode = false
    this.search = ''
  }

  override render() {
    if (!this.song) {
      return html`
        <div class="card" part="card">
          <div class="title empty" part="title">No song data</div>
        </div>
      `
    }

    return html`
      <div class="card-wrapper">
        <div class="card" part="card" @click=${this._handleClick}>
          <div class="card-content">
            <div class="line1">
              <div class="title" part="title">${this._mark(this.song.title)}</div>
              ${
                this.variant !== 'setlist' && this.song.artist
                  ? html`
                    <div class="artist" part="artist">${this._formatArtist(this.song.artist)}</div>
                  `
                  : ''
              }
            </div>

            <div class="line2">
              <div class="meta" part="meta">${this._renderMeta()}</div>
              ${this.variant !== 'setlist' ? this._renderLastPlayed() : ''}
            </div>
            ${this._renderLyricMatch()}
          </div>

          <div class="edit-controls">
            <button
              class="delete-button"
              part="delete-button"
              @click=${this._handleDelete}
              aria-label="Remove song"
            >
              <app-icon name="delete" size="18" class="delete-icon"></app-icon>
            </button>
            ${this._renderBpmEdit()}
            ${this._renderKeyEdit()}
            <div class="drag-handle" part="drag-handle">☰</div>
          </div>
        </div>
      </div>
    `
  }

  /** The text with the search term marked wherever it occurs */
  _mark(text: string) {
    const term = normalizeTerm(this.search)
    const lower = text.toLowerCase()
    if (!term || lower.length !== text.length || !lower.includes(term)) return text
    const parts: unknown[] = []
    let from = 0
    for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, from)) {
      parts.push(text.slice(from, at), html`<mark>${text.slice(at, at + term.length)}</mark>`)
      from = at + term.length
    }
    parts.push(text.slice(from))
    return parts
  }

  /** For a song found by its words alone: the line that matched */
  _renderLyricMatch() {
    const { song, search } = this
    if (!song?.parsed || !search) return ''
    const found = matchedFields(song, search)
    if (found.title || found.artist || !found.lyrics) return ''
    const snippet = lyricSnippet(song.parsed, search)
    if (!snippet) return ''
    return html`<div class="lyric-match" part="lyric-match">
      <span class="match-label">Lyrics</span>${snippet.before}<mark>${snippet.match}</mark>${snippet.after}
    </div>`
  }

  _renderMeta(): string {
    const metadata = this.song?.metadata
    if (!metadata) return ''

    const items: string[] = []

    if (metadata.key) {
      items.push(`Key: ${metadata.key}`)
    }

    if (metadata.tempo) {
      items.push(`BPM: ${metadata.tempo}`)
    }

    if (metadata.timeSignature) {
      items.push(`Time: ${metadata.timeSignature}`)
    }

    return items.join('   ')
  }

  _formatArtist(artistString: string) {
    const cleanedArtists = formatArtistNames(artistString)

    if (cleanedArtists.length === 0) return ''

    if (cleanedArtists.length > 2) {
      return html`${this._mark(cleanedArtists[0])} <i>et al</i>`
    }

    return this._mark(cleanedArtists.join(', '))
  }

  _renderLastPlayed() {
    const { lastUsageInfo, lastUsedAt, source } = this.song as SongCardSong

    if (source) {
      return html`<div class="last-played" part="last-played">From ${source.label}</div>`
    }

    // Use new lastUsageInfo if available
    if (lastUsageInfo?.date) {
      const weeksAgo = getWeeksAgo(lastUsageInfo.date)
      const parts: string[] = []

      // Add leader if available
      if (lastUsageInfo.leader) {
        parts.push(lastUsageInfo.leader)
      }

      // Add key if available
      if (lastUsageInfo.key) {
        parts.push(`in ${lastUsageInfo.key}`)
      }

      // Add time ago
      parts.push(weeksAgo)

      return html`<div class="last-played" part="last-played">${parts.join(' • ')}</div>`
    }

    // Fallback to old lastUsedAt field
    if (lastUsedAt) {
      const weeksAgo = getWeeksAgo(lastUsedAt)
      return html`<div class="last-played" part="last-played">Last played ${weeksAgo}</div>`
    }

    return ''
  }

  _renderKeyEdit() {
    const currentKey = this.song?.currentKey
    const isMinor = currentKey?.endsWith('m')
    const keys = isMinor ? MINOR_KEYS : MAJOR_KEYS
    return html`
      <div class="key-edit-wrapper" @click=${(e: Event) => e.stopPropagation()}>
        <key-selector
          label="Key"
          .value=${currentKey ?? '-'}
          .keys=${keys}
          .originalKey=${this.song?.originalKey ?? ''}
          .editMode=${true}
          @key-selector:change=${this._handleKeyEditChange}
        ></key-selector>
      </div>
    `
  }

  /** In a setlist, the tempo can be changed too: a number box, which a touch screen gives a number pad */
  _renderBpmEdit() {
    if (this.variant !== 'setlist') return ''
    const tempo = Number(this.song?.metadata?.tempo)
    return html`
      <label class="bpm-edit" @click=${(e: Event) => e.stopPropagation()}>
        BPM
        <input
          type="number"
          inputmode="numeric"
          min=${BPM_MIN}
          max=${BPM_MAX}
          .value=${tempo > 0 ? String(tempo) : ''}
          @change=${this._handleBpmEditChange}
        />
      </label>
    `
  }

  _handleBpmEditChange(e: Event): void {
    const input = e.target as HTMLInputElement
    const bpm = Math.round(input.valueAsNumber)
    // Anything else (empty, out of range) goes back to what the song has
    if (!(bpm >= BPM_MIN && bpm <= BPM_MAX)) {
      input.value = Number(this.song?.metadata?.tempo) > 0 ? String(this.song?.metadata?.tempo) : ''
      return
    }
    this.dispatchEvent(new SongCardBpmChangeEvent(bpm))
  }

  _handleKeyEditChange(e: KeyChangeEvent): void {
    e.stopPropagation()
    this.dispatchEvent(new SongCardKeyChangeEvent(e.value))
  }

  // Click handler
  _handleClick() {
    // In edit mode, don't fire click (avoid accidental navigation)
    if (this.editMode) {
      return
    }

    if (this.song) this.dispatchEvent(new SongCardClickEvent(this.song))
  }

  // Delete button handler
  _handleDelete(e: Event): void {
    e.stopPropagation() // Prevent click from bubbling to card
    if (this.song) this.dispatchEvent(new SongCardDeleteEvent(this.song))
  }

  override connectedCallback() {
    super.connectedCallback()
    // Prevent context menu at host level for touch devices
    this.contextMenuHandler = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    this.addEventListener('contextmenu', this.contextMenuHandler)
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    if (this.contextMenuHandler) {
      this.removeEventListener('contextmenu', this.contextMenuHandler)
    }
  }
}

// Define the custom element
customElements.define('song-card', SongCard)

declare global {
  interface HTMLElementTagNameMap {
    'song-card': SongCard
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [SongCardClickEvent.type]: SongCardClickEvent
    [SongCardDeleteEvent.type]: SongCardDeleteEvent
    [SongCardKeyChangeEvent.type]: SongCardKeyChangeEvent
    [SongCardBpmChangeEvent.type]: SongCardBpmChangeEvent
  }
}
