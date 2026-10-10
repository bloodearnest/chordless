import { css, html, LitElement } from 'lit'
import { formatArtistNames } from '../js/song-utils.js'
import { getWeeksAgo } from '../js/utils/date-utils.js'
import './icon.js'
import './key-selector.js'

/** The card was clicked (not in edit mode) */
export class SongCardClickEvent extends Event {
  static type = 'song-card:click'
  constructor(song) {
    super(SongCardClickEvent.type, { bubbles: true, composed: true })
    this.song = song
  }
}

/** The delete button was pressed */
export class SongCardDeleteEvent extends Event {
  static type = 'song-card:delete'
  constructor(song) {
    super(SongCardDeleteEvent.type, { bubbles: true, composed: true })
    this.song = song
  }
}

/** A new key was chosen */
export class SongCardKeyChangeEvent extends Event {
  static type = 'song-card:key-change'
  constructor(key) {
    super(SongCardKeyChangeEvent.type, { bubbles: true, composed: true })
    this.key = key
  }
}

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
 *
 * CSS Parts:
 * @csspart card - The main card container
 * @csspart title - The song title element
 * @csspart artist - The artist element
 * @csspart meta - The metadata container
 * @csspart info - The additional info container
 */
export class SongCard extends LitElement {
  static properties = {
    song: { type: Object, attribute: false },
    variant: { type: String, reflect: true },
    editMode: { type: Boolean, reflect: true, attribute: 'edit-mode' },
  }

  static styles = css`
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

    :host([variant='setlist']) .card-content {
      padding: 1.2rem 1.5rem;
    }
  `

  constructor() {
    super()
    this.song = null
    this.variant = 'library'
    this.editMode = false
  }

  render() {
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
              <div class="title" part="title">${this.song.title}</div>
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
            ${this._renderKeyEdit()}
            <div class="drag-handle" part="drag-handle">☰</div>
          </div>
        </div>
      </div>
    `
  }

  _renderMeta() {
    const { metadata } = this.song
    if (!metadata) return ''

    const items = []

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

  _formatArtist(artistString) {
    const cleanedArtists = formatArtistNames(artistString)

    if (cleanedArtists.length === 0) return ''

    if (cleanedArtists.length > 2) {
      return html`${cleanedArtists[0]} <i>et al</i>`
    }

    return cleanedArtists.join(', ')
  }

  _renderLastPlayed() {
    const { lastUsageInfo, lastUsedAt } = this.song

    // Use new lastUsageInfo if available
    if (lastUsageInfo?.date) {
      const weeksAgo = getWeeksAgo(lastUsageInfo.date)
      const parts = []

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
      <div class="key-edit-wrapper" @click=${e => e.stopPropagation()}>
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

  _handleKeyEditChange(e) {
    e.stopPropagation()
    this.dispatchEvent(new SongCardKeyChangeEvent(e.value))
  }

  // Click handler
  _handleClick() {
    // In edit mode, don't fire click (avoid accidental navigation)
    if (this.editMode) {
      return
    }

    this.dispatchEvent(new SongCardClickEvent(this.song))
  }

  // Delete button handler
  _handleDelete(e) {
    e.stopPropagation() // Prevent click from bubbling to card
    this.dispatchEvent(new SongCardDeleteEvent(this.song))
  }

  connectedCallback() {
    super.connectedCallback()
    // Prevent context menu at host level for touch devices
    this.contextMenuHandler = e => {
      e.preventDefault()
      e.stopPropagation()
    }
    this.addEventListener('contextmenu', this.contextMenuHandler)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    if (this.contextMenuHandler) {
      this.removeEventListener('contextmenu', this.contextMenuHandler)
    }
  }
}

// Define the custom element
customElements.define('song-card', SongCard)
