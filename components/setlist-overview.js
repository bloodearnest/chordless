import { LitElement, html } from 'lit';

/**
 * SetlistOverview Component
 *
 * Renders the overview list of songs for the setlist page, using song-card
 * components, and exposes events for navigation, deletion, and adding songs.
 */
export class SetlistOverview extends LitElement {
    static properties = {
        songs: { type: Array },
        editMode: { type: Boolean, attribute: 'edit-mode' }
    };

    constructor() {
        super();
        this.songs = [];
        this.editMode = false;
    }

    // Render into light DOM so existing CSS/selectors keep working
    createRenderRoot() {
        return this;
    }

    render() {
        return html`
            <div class="setlist-overview">
                <div class="overview-songs">
                    ${this.songs.map((song, index) => html`
                        <song-card
                            class="overview-song-card"
                            data-song-index=${index}
                            .song=${song}
                            variant="setlist"
                            .editMode=${this.editMode}
                            @song-click=${() => this._handleSongClick(index)}
                            @song-delete=${() => this._handleSongDelete(index)}
                        ></song-card>
                    `)}

                    <button
                        class="song-card add-song-button"
                        ?hidden=${!this.editMode}
                        @click=${this._handleAddSong}
                    >
                        <div class="song-card-info">
                            <div class="song-card-title-row">
                                <div class="song-card-title">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 8px;">
                                        <line x1="12" y1="5" x2="12" y2="19"></line>
                                        <line x1="5" y1="12" x2="19" y2="12"></line>
                                    </svg>
                                    Add Song
                                </div>
                            </div>
                        </div>
                    </button>
                </div>
            </div>
        `;
    }

    _handleSongClick(index) {
        this.dispatchEvent(new CustomEvent('overview-song-click', {
            detail: { index },
            bubbles: true,
            composed: true
        }));
    }

    _handleSongDelete(index) {
        this.dispatchEvent(new CustomEvent('overview-song-delete', {
            detail: { index },
            bubbles: true,
            composed: true
        }));
    }

    _handleAddSong() {
        this.dispatchEvent(new CustomEvent('overview-add-song', {
            bubbles: true,
            composed: true
        }));
    }
}

customElements.define('setlist-overview', SetlistOverview);
