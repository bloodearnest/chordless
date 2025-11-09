import { LitElement, html, css } from 'lit';
import './media-player-settings.js';

/**
 * AppSettings Component
 *
 * Settings interface for the application
 */
export class AppSettings extends LitElement {
    static properties = {};

    static styles = css`
        :host {
            display: block;
        }

        .settings-content {
            padding: 1rem;
        }

        .settings-section {
            margin-bottom: 2rem;
        }

        h3 {
            font-size: 1.6rem;
            margin-top: 2rem;
            margin-bottom: 1rem;
            color: var(--header-bg, #3498db);
        }

        h4 {
            font-size: 1.4rem;
            margin-top: 2rem;
            margin-bottom: 1rem;
            color: #e74c3c;
        }

        p {
            color: #7f8c8d;
            font-size: 1.1rem;
            margin-bottom: 1.5rem;
        }

        .setlist-button {
            display: inline-block;
            width: auto;
        }

        .danger-button {
            background-color: #e74c3c;
            border-color: #c0392b;
        }

        a {
            text-decoration: none;
        }
    `;

    constructor() {
        super();
    }

    render() {
        return html`
            <div class="settings-content">
                <div class="settings-section">
                    <h3>Data Management</h3>
                    <p>
                        Import setlists and songs from the filesystem. This will scan the sets/ directory and add all found setlists to the database.
                    </p>
                    <button class="setlist-button" @click=${this._handleImport}>
                        Import Setlists from Filesystem
                    </button>

                    <h4>Danger Zone</h4>
                    <p>
                        Clear all data from IndexedDB and localStorage. This action cannot be undone!
                    </p>
                    <button class="setlist-button danger-button" @click=${this._handleClearDatabase}>
                        Clear Database
                    </button>
                </div>

                <div class="settings-section">
                    <h3>CCLI Bookmarklet</h3>
                    <p>
                        Import songs directly from SongSelect with a single click using the bookmarklet.
                    </p>
                    <a href="/bookmarklet" class="setlist-button">
                        Install Bookmarklet
                    </a>
                </div>

                <div class="settings-section">
                    <h3>Cloud Features</h3>
                    <p>
                        Connect with Google Drive to enable cloud storage, sync, and collaboration features.
                    </p>
                    <a href="/authorize" class="setlist-button" style="display: inline-block; width: auto; text-decoration: none;">
                        Manage Google Authorization
                    </a>
                </div>

                <div class="settings-section">
                    <h3>Media Player</h3>
                    <p>
                        Configure global media player settings. These settings apply to all setlists.
                    </p>
                    <media-player-settings></media-player-settings>
                </div>
            </div>
        `;
    }

    async _handleImport() {
        this.dispatchEvent(new CustomEvent('import-requested', {
            bubbles: true,
            composed: true
        }));
    }

    async _handleClearDatabase() {
        this.dispatchEvent(new CustomEvent('clear-database-requested', {
            bubbles: true,
            composed: true
        }));
    }
}

customElements.define('app-settings', AppSettings);
