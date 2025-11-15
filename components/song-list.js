import { LitElement, html, css } from 'lit';
import './song-card.js';
import './status-message.js';

/**
 * SongList component
 *
 * Renders a vertical list of <song-card> entries with a consistent empty state.
 * Emits a "song-select" event whenever a song card is clicked.
 */
export class SongList extends LitElement {
    static properties = {
        songs: { type: Array, attribute: false },
        variant: { type: String, attribute: 'variant' },
        emptyMessage: { type: String, attribute: 'empty-message' },
        emptyDetail: { type: String, attribute: 'empty-detail' },
        dense: { type: Boolean, reflect: true }
    };

    constructor() {
        super();
        this.songs = [];
        this.variant = 'library';
        this.emptyMessage = 'No songs to display.';
        this.emptyDetail = '';
        this.dense = false;
    }

    static styles = css`
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
    `;

    handleSongClick(song, index, originalEvent) {
        this.dispatchEvent(new CustomEvent('song-select', {
            detail: { song, index, originalEvent },
            bubbles: true,
            composed: true
        }));
    }

    renderEmptyState() {
        return html`
            <status-message
                state="empty"
                .message=${this.emptyMessage}
                .detail=${this.emptyDetail}>
            </status-message>
        `;
    }

    render() {
        if (!this.songs || this.songs.length === 0) {
            return this.renderEmptyState();
        }

        return html`
            <div class="list">
                ${this.songs.map((song, index) => html`
                    <song-card
                        .song=${song}
                        .variant=${this.variant}
                        @song-click=${(event) => this.handleSongClick(song, index, event)}>
                    </song-card>
                `)}
            </div>
        `;
    }
}

customElements.define('song-list', SongList);
