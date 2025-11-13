import { LitElement, html, css } from 'lit';
import { getWeeksAgo } from '../js/utils/date-utils.js';

/**
 * SongInfo Component
 *
 * Displays detailed information about a song including metadata and usage history
 *
 * Properties:
 * @property {Object} song - Song data object
 * @property {Array} appearances - Array of appearance records
 *
 * Events:
 * @fires edit - When edit button is clicked (detail: {song})
 */
export class SongInfo extends LitElement {
    static properties = {
        song: { type: Object },
        appearances: { type: Array },
        loading: { type: Boolean }
    };

    static styles = css`
        :host {
            display: block;
            font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }

        .song-info-container {
            display: flex;
            flex-direction: column;
            gap: 2rem;
        }

        .song-title {
            font-size: 2.4rem;
            font-weight: 600;
            color: var(--color-text, #2c3e50);
            margin: 0 0 2rem 0;
        }

        .modal-columns-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 3rem;
        }

        @media (max-width: 768px) {
            .modal-columns-container {
                grid-template-columns: 1fr;
            }
        }

        .modal-left-column,
        .modal-right-column {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .modal-info-item {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }

        .modal-info-label {
            font-size: 1.1rem;
            color: #95a5a6;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }

        .modal-info-value {
            font-size: 1.6rem;
            color: var(--color-text, #2c3e50);
            font-weight: 500;
        }

        .modal-appearances-title {
            font-size: 1.4rem;
            color: #95a5a6;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
            margin-bottom: 0.5rem;
        }

        .modal-appearances-list {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }

        .modal-appearance-item {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            padding: 0.75rem;
            background-color: #f8f9fa;
            border-radius: 6px;
            border-left: 3px solid var(--button-bg, #3498db);
        }

        .appearance-date {
            font-size: 1.1rem;
            color: var(--color-text, #2c3e50);
            font-weight: 500;
        }

        .appearance-relative {
            font-size: 0.9rem;
            color: #7f8c8d;
        }

        .appearance-meta {
            font-size: 1.2rem;
            color: #95a5a6;
            margin-top: 0.3rem;
        }

        .modal-ccli {
            margin-top: 2rem;
            padding-top: 2rem;
            border-top: 1px solid #ecf0f1;
        }

        .ccli-link {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--button-bg, #3498db);
            text-decoration: none;
            font-size: 1.4rem;
            transition: color 0.2s;
        }

        .ccli-link:hover {
            color: #2980b9;
            text-decoration: underline;
        }

        .songselect-logo {
            height: 16px;
            width: auto;
            vertical-align: middle;
        }

        .ccli-trailer {
            margin-top: 1.5rem;
            padding: 1rem;
            background-color: #f8f9fa;
            border-radius: 6px;
            font-size: 1.2rem;
            color: #7f8c8d;
            white-space: pre-line;
            line-height: 1.6;
        }

        .loading {
            text-align: center;
            padding: 2rem;
            color: #7f8c8d;
        }

        .empty {
            text-align: center;
            padding: 2rem;
            color: #7f8c8d;
            font-style: italic;
        }
    `;

    constructor() {
        super();
        this.song = null;
        this.appearances = [];
        this.loading = false;
    }

    render() {
        if (this.loading) {
            return html`<div class="loading">Loading song information...</div>`;
        }

        if (!this.song) {
            return html`<div class="empty">No song data available.</div>`;
        }

        const stats = this.calculateAppearanceStats();
        const recentAppearances = this.getRecentAppearances();

        return html`
            <div class="song-info-container">
                <h2 class="song-title">${this.song.title}</h2>

                <div class="modal-columns-container">
                    <!-- Left column: Metadata -->
                    <div class="modal-left-column">
                        ${this.song.artist ? html`
                            <div class="modal-info-item">
                                <div class="modal-info-label">Artist</div>
                                <div class="modal-info-value">${this.song.artist}</div>
                            </div>
                        ` : ''}

                        ${this.song.metadata?.key ? html`
                            <div class="modal-info-item">
                                <div class="modal-info-label">Original Key / Tempo</div>
                                <div class="modal-info-value">
                                    Key: ${this.song.metadata.key}${this.song.metadata.tempo ? ` • ${this.song.metadata.tempo} BPM` : ''}
                                </div>
                            </div>
                        ` : ''}

                        ${this.song.metadata?.timeSignature ? html`
                            <div class="modal-info-item">
                                <div class="modal-info-label">Time Signature</div>
                                <div class="modal-info-value">${this.song.metadata.timeSignature}</div>
                            </div>
                        ` : ''}

                        ${stats.totalAppearances > 0 ? html`
                            <div class="modal-info-item">
                                <div class="modal-info-label">Times Played (Total)</div>
                                <div class="modal-info-value">${stats.totalAppearances}</div>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Right column: Recent appearances -->
                    <div class="modal-right-column">
                        ${recentAppearances.length > 0 ? html`
                            <div class="modal-appearances-title">Recent Plays</div>
                            <div class="modal-appearances-list">
                                ${recentAppearances.map(appearance => html`
                                    <div class="modal-appearance-item">
                                        <span class="appearance-date">${appearance.formattedDate}</span>
                                        <span class="appearance-relative">${appearance.weeksAgo}</span>
                                        ${this.renderAppearanceMeta(appearance)}
                                    </div>
                                `)}
                            </div>
                        ` : ''}
                    </div>
                </div>

                <!-- CCLI section -->
                ${this.renderCCLI()}
            </div>
        `;
    }

    renderAppearanceMeta(appearance) {
        const metaParts = [];
        if (appearance.leader) {
            metaParts.push(appearance.leader);
        }
        const keyPlayed = appearance.playedInKey || this.song?.metadata?.key;
        if (keyPlayed) {
            metaParts.push(`Key: ${keyPlayed}`);
        }

        if (metaParts.length > 0) {
            return html`<span class="appearance-meta">${metaParts.join(' • ')}</span>`;
        }
        return '';
    }

    renderCCLI() {
        const ccliNumber = this.song.metadata?.ccli || this.song.metadata?.ccliSongNumber || this.song.ccliNumber;
        const ccliTrailer = this.song.metadata?.ccliTrailer;

        if (!ccliNumber && !ccliTrailer) {
            return '';
        }

        return html`
            <div class="modal-ccli">
                ${ccliNumber ? html`
                    <div class="modal-info-item">
                        <div class="modal-info-label">CCLI Number</div>
                        <div class="modal-info-value">
                            ${ccliNumber}
                            <a
                                href="https://songselect.ccli.com/songs/${ccliNumber}"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="ccli-link"
                            >
                                <img
                                    src="https://songselect.ccli.com/favicon.ico"
                                    alt="SongSelect"
                                    class="songselect-logo"
                                />
                                View on SongSelect
                            </a>
                        </div>
                    </div>
                ` : ''}

                ${ccliTrailer ? html`
                    <div class="ccli-trailer">${ccliTrailer}</div>
                ` : ''}
            </div>
        `;
    }

    calculateAppearanceStats() {
        if (!this.appearances || this.appearances.length === 0) {
            return {
                totalAppearances: 0,
                last12MonthsAppearances: 0,
                lastPlayedDate: null
            };
        }

        const totalAppearances = this.appearances.length;

        // Calculate date 12 months ago
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

        // Filter appearances in last 12 months
        const last12MonthsAppearances = this.appearances.filter(appearance => {
            const appearanceDate = new Date(appearance.date);
            return appearanceDate >= twelveMonthsAgo;
        }).length;

        // Find most recent appearance date
        const sortedAppearances = [...this.appearances].sort((a, b) =>
            b.date.localeCompare(a.date)
        );
        const lastPlayedDate = sortedAppearances[0].date;

        return {
            totalAppearances,
            last12MonthsAppearances,
            lastPlayedDate
        };
    }

    getRecentAppearances() {
        if (!this.appearances || this.appearances.length === 0) {
            return [];
        }

        // Sort by date (most recent first) and take the last 6 appearances
        return this.appearances
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 6)
            .map(appearance => ({
                date: appearance.date,
                formattedDate: this.formatDate(appearance.date),
                weeksAgo: getWeeksAgo(appearance.date),
                playedInKey: appearance.playedInKey,
                leader: appearance.leader
            }));
    }

    formatDate(dateStr) {
        // Parse YYYY-MM-DD format and convert to readable format
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

}

// Define the custom element
customElements.define('song-info', SongInfo);
