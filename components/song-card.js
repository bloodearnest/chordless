import { LitElement, html, css } from 'lit';

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
 * @fires song-click - When card is clicked (detail: {song})
 * @fires song-delete - When delete button is clicked in edit mode (detail: {song})
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
        song: { type: Object },
        variant: { type: String, reflect: true },
        editMode: { type: Boolean, reflect: true }
    };

    static styles = css`
        :host {
            display: block;
            font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            touch-action: manipulation;
            -webkit-user-select: none;
            user-select: none;
            position: relative;
        }

        .card-wrapper {
            position: relative;
        }

        .card {
            background: var(--card-bg, #ffffff);
            border: var(--card-border, 2px solid #ecf0f1);
            border-radius: var(--card-radius, 8px);
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: var(--card-shadow, 0 2px 4px rgba(0,0,0,0.1));
            user-select: none;
            -webkit-user-select: none;
            -webkit-touch-callout: none;
            position: relative;
            overflow: hidden;
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            border-color: var(--color-primary, #3498db);
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
            font-size: 1.8rem;
            font-weight: 600;
            color: var(--color-text, #2c3e50);
            line-height: 1.3;
            flex: 1;
            min-width: 0;
        }

        .artist {
            font-size: 1.4rem;
            color: var(--color-text-secondary, #7f8c8d);
            font-style: italic;
            text-align: right;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .meta {
            font-size: 1.4rem;
            color: var(--color-text-secondary, #7f8c8d);
            flex: 1;
        }

        .last-played {
            font-size: 1.3rem;
            color: var(--color-text-secondary, #7f8c8d);
            text-align: right;
            white-space: nowrap;
        }

        /* Variant-specific styles */
        :host([variant="setlist"]) .card-content {
            padding: 1.2rem 1.5rem;
        }

        :host([variant="setlist"]) .title {
            font-size: 1.6rem;
        }

        /* Empty state */
        .empty {
            color: var(--color-text-secondary, #7f8c8d);
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
            background: #f8f9fa;
            box-shadow: -8px 0 16px rgba(0,0,0,0.08);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.5s ease;
        }

        :host([editmode]) .edit-controls {
            opacity: 1;
            pointer-events: auto;
        }

        .delete-button {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding: 0.8rem 1.5rem;
            margin: 0 1rem;
            height: auto;
            background: #e74c3c;
            border: 2px solid #e74c3c;
            border-radius: 6px;
            color: white;
            font-size: 1.4rem;
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
            flex-shrink: 0;
            transition: background 0.2s ease;
        }

        .delete-button:hover {
            background: #c0392b;
            border-color: #c0392b;
        }

        .delete-button:active {
            background: #a93226;
            border-color: #a93226;
        }

        .delete-icon {
            flex-shrink: 0;
        }

        .drag-handle {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 50px;
            background: #f8f9fa;
            border-left: 1px solid #f8f9fa;
            cursor: grab;
            color: var(--color-text-secondary, #95a5a6);
            font-size: 24px;
            user-select: none;
            touch-action: none;
            transition: background 0.2s ease, color 0.2s ease;
        }

        .drag-handle:hover {
            background: #ecf0f1;
            color: var(--color-primary, #3498db);
        }

        .drag-handle:active {
            cursor: grabbing;
            background: #e0e0e0;
        }

        /* Hide drag handle in library variant */
        :host([variant="library"]) .drag-handle {
            display: none;
        }

        :host([variant="setlist"]) .card-content {
            padding: 1.2rem 1.5rem;
        }
    `;

    constructor() {
        super();
        this.song = null;
        this.variant = 'library';
        this.editMode = false;
    }

    render() {
        if (!this.song) {
            return html`
                <div class="card" part="card">
                    <div class="title empty" part="title">No song data</div>
                </div>
            `;
        }

        return html`
            <div class="card-wrapper">
                <div
                    class="card"
                    part="card"
                    @click=${this.handleClick}
                >
                    <div class="card-content">
                        <div class="line1">
                            <div class="title" part="title">${this.song.title}</div>
                            ${this.variant !== 'setlist' && this.song.artist ? html`
                                <div class="artist" part="artist">${this.formatArtist(this.song.artist)}</div>
                            ` : ''}
                        </div>

                        <div class="line2">
                            <div class="meta" part="meta">${this.renderMeta()}</div>
                            ${this.variant !== 'setlist' ? this.renderLastPlayed() : ''}
                        </div>
                    </div>

                    <div class="edit-controls">
                        <button
                            class="delete-button"
                            part="delete-button"
                            @click=${this.handleDelete}
                            aria-label="Remove song"
                        >
                            <svg class="delete-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                            <span>Remove</span>
                        </button>
                        <div class="drag-handle" part="drag-handle">
                            ☰
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderMeta() {
        const { metadata } = this.song;
        if (!metadata) return '';

        const items = [];

        if (metadata.key) {
            items.push(`Key: ${metadata.key}`);
        }

        if (metadata.tempo) {
            items.push(`BPM: ${metadata.tempo}`);
        }

        if (metadata.timeSignature) {
            items.push(`Time: ${metadata.timeSignature}`);
        }

        return items.join('   ');
    }

    formatArtist(artistString) {
        if (!artistString) return '';

        // Split by comma, semicolon, or pipe
        const artists = artistString.split(/[,;|]/).map(a => a.trim());

        // Clean up each artist name by removing "Words by", "Music by", "Music:", etc.
        const cleanedArtists = artists.map(artist => {
            return artist
                .replace(/^Words\s+by\s+/i, '')
                .replace(/^Music\s+by\s+/i, '')
                .replace(/^Music:\s*/i, '')
                .trim();
        }).filter(a => a.length > 0); // Remove empty strings

        if (cleanedArtists.length === 0) return '';

        if (cleanedArtists.length > 2) {
            return html`${cleanedArtists[0]} <i>et al</i>`;
        }

        return cleanedArtists.join(', ');
    }

    renderLastPlayed() {
        const { lastUsedAt } = this.song;

        if (!lastUsedAt) {
            return '';
        }

        const weeksAgo = this.getWeeksAgo(lastUsedAt);
        return html`<div class="last-played" part="last-played">Last played ${weeksAgo}</div>`;
    }

    getWeeksAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffWeeks = Math.floor(diffDays / 7);

        if (diffDays === 0) return 'today';
        if (diffDays === 1) return 'yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffWeeks === 1) return '1 week ago';
        if (diffWeeks < 52) return `${diffWeeks} weeks ago`;

        const diffYears = Math.floor(diffWeeks / 52);
        if (diffYears === 1) return '1 year ago';
        return `${diffYears} years ago`;
    }

    // Click handler
    handleClick(e) {
        // In edit mode, don't fire click (avoid accidental navigation)
        if (this.editMode) {
            return;
        }

        this.dispatchEvent(new CustomEvent('song-click', {
            detail: { song: this.song },
            bubbles: true,
            composed: true
        }));
    }

    // Delete button handler
    handleDelete(e) {
        e.stopPropagation(); // Prevent click from bubbling to card
        this.dispatchEvent(new CustomEvent('song-delete', {
            detail: { song: this.song },
            bubbles: true,
            composed: true
        }));
    }

    connectedCallback() {
        super.connectedCallback();
        // Prevent context menu at host level for touch devices
        this.contextMenuHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        this.addEventListener('contextmenu', this.contextMenuHandler);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.contextMenuHandler) {
            this.removeEventListener('contextmenu', this.contextMenuHandler);
        }
    }
}

// Define the custom element
customElements.define('song-card', SongCard);
