import { LitElement, html, css } from 'lit';
import './media-player-settings.js';
import './select-organisation.js';

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
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        .settings-section {
            background: var(--settings-bg, #34495e);
            border-radius: 8px;
            padding: 1.5rem;
            color: var(--settings-text, white);
        }

        h3 {
            font-size: 1.2rem;
            margin: 0 0 1rem 0;
            font-weight: 600;
        }

        h4 {
            font-size: 1rem;
            margin: 1.5rem 0 1rem 0;
            font-weight: 600;
            color: #e74c3c;
        }

        p {
            font-size: 0.85rem;
            margin: 0 0 1rem 0;
            opacity: 0.7;
            line-height: 1.4;
        }

        .setlist-button {
            display: inline-block;
            width: auto;
            padding: 0.75rem 1.5rem;
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }

        .setlist-button:hover {
            background: rgba(255, 255, 255, 0.15);
        }

        .danger-button {
            background-color: rgba(231, 76, 60, 0.2);
        }

        .danger-button:hover {
            background-color: rgba(231, 76, 60, 0.3);
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
                    <h3>Church</h3>
                    <p>
                        Select which church you're currently working with. Each church has its own setlists.
                    </p>
                    <select-organisation></select-organisation>
                </div>

                <div class="settings-section">
                    <h3>Media Player</h3>
                    <p>
                        Configure global media player settings. These settings apply to all setlists.
                    </p>
                    <media-player-settings></media-player-settings>
                </div>

                <div class="settings-section">
                    <h3>Cloud Features</h3>
                    <p>
                        Connect with Google Drive to enable cloud storage, sync, and collaboration features.
                    </p>
                    <a href="/authorize" class="setlist-button">
                        Manage Google Authorization
                    </a>
                </div>

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
