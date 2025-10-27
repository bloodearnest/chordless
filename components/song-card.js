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
 * @fires song-long-press - When card is long-pressed (detail: {song})
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
        variant: { type: String }
    };

    static styles = css`
        :host {
            display: block;
            font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }

        .card {
            background: var(--card-bg, #ffffff);
            border: var(--card-border, 2px solid #ecf0f1);
            border-radius: var(--card-radius, 8px);
            padding: var(--card-padding, 1.5rem);
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: var(--card-shadow, 0 2px 4px rgba(0,0,0,0.1));
            user-select: none;
            -webkit-user-select: none;
            -webkit-touch-callout: none;
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            border-color: var(--color-primary, #3498db);
        }

        .card:active {
            transform: translateY(0);
        }

        .card.pressing {
            background-color: #ffebee;
            border-color: #e74c3c;
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
        :host([variant="setlist"]) .card {
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
    `;

    constructor() {
        super();
        this.song = null;
        this.variant = 'library';
        this.longPressTimer = null;
        this.touchStarted = false;
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
            <div
                class="card"
                part="card"
                @click=${this.handleClick}
                @pointerdown=${this.handlePointerDown}
                @pointerup=${this.handlePointerUp}
                @pointermove=${this.handlePointerMove}
                @pointercancel=${this.handlePointerCancel}
                @pointerleave=${this.handlePointerLeave}
                @contextmenu=${this.handleContextMenu}
            >
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
        // Only fire click if we're not in a long press
        if (!this.longPressTimer) {
            this.dispatchEvent(new CustomEvent('song-click', {
                detail: { song: this.song },
                bubbles: true,
                composed: true
            }));
        }
    }

    // Long press detection - Pointer Events
    handlePointerDown(e) {
        // Only handle primary button (left click, primary touch)
        if (e.button === 0) {
            this.touchStarted = true;
            this.startLongPress();
        }
    }

    handlePointerUp(e) {
        this.touchStarted = false;
        this.cancelLongPress();
    }

    handlePointerMove(e) {
        this.cancelLongPress();
    }

    handlePointerCancel(e) {
        this.touchStarted = false;
        this.cancelLongPress();
    }

    handlePointerLeave(e) {
        this.touchStarted = false;
        this.cancelLongPress();
    }

    // Prevent context menu on long press
    handleContextMenu(e) {
        e.preventDefault();
    }

    startLongPress() {
        const card = this.shadowRoot.querySelector('.card');
        this.longPressTimer = setTimeout(() => {
            if (this.touchStarted) {
                card.classList.add('pressing');
                this.dispatchEvent(new CustomEvent('song-long-press', {
                    detail: { song: this.song },
                    bubbles: true,
                    composed: true
                }));
            }
        }, 600);
    }

    cancelLongPress() {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
        const card = this.shadowRoot.querySelector('.card');
        if (card) {
            card.classList.remove('pressing');
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.cancelLongPress();
    }
}

// Define the custom element
customElements.define('song-card', SongCard);
