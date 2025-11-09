import { LitElement, html, css } from 'lit';
import * as GoogleAuth from '/js/google-auth.js';

/**
 * ShareSetlist Component
 *
 * Provides UI for sharing setlists via:
 * - Google Drive (requires auth)
 * - Direct link (stores setlist on server)
 *
 * Properties:
 * @property {Object} setlist - The setlist to share
 *
 * Events:
 * @fires share-complete - When sharing is complete
 */
export class ShareSetlist extends LitElement {
    static properties = {
        setlist: { type: Object },
        _isAuthenticated: { type: Boolean, state: true },
        _shareLink: { type: String, state: true },
        _isSharing: { type: Boolean, state: true },
        _error: { type: String, state: true }
    };

    static styles = css`
        :host {
            display: block;
        }

        .share-content {
            padding: 1rem;
        }

        .auth-section {
            padding: 2rem;
            background: #f8f9fa;
            border-radius: 8px;
            margin-bottom: 2rem;
            text-align: center;
        }

        .auth-section h3 {
            margin-top: 0;
            color: var(--header-bg, #3498db);
        }

        .share-method {
            padding: 2rem;
            border: 1px solid #ecf0f1;
            border-radius: 8px;
            margin-bottom: 1.5rem;
        }

        .share-method h3 {
            margin-top: 0;
            font-size: 1.6rem;
            color: #2c3e50;
        }

        .share-method p {
            color: #7f8c8d;
            font-size: 1.1rem;
            margin-bottom: 1.5rem;
        }

        .share-link-container {
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: 8px;
            margin: 1.5rem 0;
        }

        .share-link {
            word-break: break-all;
            font-family: monospace;
            font-size: 1.2rem;
            color: #3498db;
            padding: 1rem;
            background: white;
            border-radius: 4px;
            border: 1px solid #ecf0f1;
        }

        .button-group {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
        }

        .setlist-button {
            flex: 1;
            min-width: 120px;
        }

        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid #ecf0f1;
            border-top: 2px solid currentColor;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .error-message {
            padding: 1rem;
            background: #fadbd8;
            color: #e74c3c;
            border-radius: 4px;
            margin: 1rem 0;
        }

        .success-message {
            padding: 1rem;
            background: #d5f4e6;
            color: #27ae60;
            border-radius: 4px;
            margin: 1rem 0;
        }

        .backup-section {
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 2px solid #ecf0f1;
        }

        .backup-section h3 {
            color: #7f8c8d;
            font-size: 1.4rem;
        }
    `;

    constructor() {
        super();
        this.setlist = null;
        this._isAuthenticated = false;
        this._shareLink = null;
        this._isSharing = false;
        this._error = null;
    }

    async connectedCallback() {
        super.connectedCallback();
        this._isAuthenticated = await GoogleAuth.isAuthenticated();
    }

    render() {
        return html`
            <div class="share-content">
                <div class="share-method">
                    <h3>📤 Share via Link</h3>
                    <p>
                        Generate a shareable link that expires in 30 days. Anyone with the link
                        can import this setlist into their Setalight library.
                    </p>

                    ${this._error ? html`
                        <div class="error-message">${this._error}</div>
                    ` : ''}

                    ${this._shareLink ? html`
                        <div class="success-message">
                            ✓ Share link created! This link will expire in 30 days.
                        </div>
                        <div class="share-link-container">
                            <div class="share-link" id="share-link">${this._shareLink}</div>
                        </div>
                        <div class="button-group">
                            <button class="setlist-button" @click=${this._copyLink}>
                                📋 Copy Link
                            </button>
                            <button class="setlist-button" @click=${this._shareNative}>
                                📱 Share
                            </button>
                        </div>
                    ` : html`
                        <button
                            class="setlist-button"
                            @click=${this._generateShareLink}
                            ?disabled=${this._isSharing}
                        >
                            ${this._isSharing ? html`<span class="spinner"></span> Generating...` : 'Generate Share Link'}
                        </button>
                    `}
                </div>

                <!-- Google Drive sharing (future feature) -->
                ${this._isAuthenticated ? html`
                    <div class="share-method">
                        <h3>☁️ Share via Google Drive (Coming Soon)</h3>
                        <p>
                            Share via Google Drive to enable real-time collaboration and live performance sync.
                        </p>
                        <button class="setlist-button" disabled>
                            Coming Soon
                        </button>
                    </div>
                ` : ''}

                <!-- Not authorized message -->
                ${!this._isAuthenticated ? html`
                    <div class="auth-section">
                        <h3>🔐 Cloud Features Not Enabled</h3>
                        <p style="color: #7f8c8d;">
                            To enable Google Drive storage and real-time sync features,
                            you need to authorize Setalight to access your Google Drive.
                        </p>
                        <a href="/authorize" class="setlist-button" style="display: inline-block; text-decoration: none;">
                            Go to Authorization Page →
                        </a>
                        <p style="color: #95a5a6; font-size: 0.9rem; margin-top: 1rem;">
                            Authorization is optional. Link sharing works without it.
                        </p>
                    </div>
                ` : ''}
            </div>
        `;
    }

    async _generateShareLink() {
        this._isSharing = true;
        this._error = null;

        try {
            const AUTH_PROXY_URL = window.location.hostname === 'localhost'
                ? 'http://localhost:8787'
                : 'https://setalight-auth-proxy.YOUR-SUBDOMAIN.workers.dev';

            const response = await fetch(`${AUTH_PROXY_URL}/api/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ setlist: this.setlist })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create share link');
            }

            const { id } = await response.json();
            this._shareLink = `${window.location.origin}/share/${id}`;

            // Fire event
            this.dispatchEvent(new CustomEvent('share-complete', {
                bubbles: true,
                composed: true,
                detail: { shareLink: this._shareLink }
            }));

        } catch (error) {
            console.error('[Share] Error generating link:', error);
            this._error = error.message;
        } finally {
            this._isSharing = false;
        }
    }

    async _copyLink() {
        try {
            await navigator.clipboard.writeText(this._shareLink);
            // TODO: Show toast notification
            alert('Link copied to clipboard!');
        } catch (error) {
            console.error('[Share] Error copying link:', error);
            // Fallback: select the text
            const linkElement = this.shadowRoot.getElementById('share-link');
            const range = document.createRange();
            range.selectNode(linkElement);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        }
    }

    async _shareNative() {
        if (!navigator.share) {
            this._copyLink();
            return;
        }

        try {
            await navigator.share({
                title: `Setlist: ${this.setlist.name || this.setlist.date}`,
                text: 'Check out this setlist on Setalight',
                url: this._shareLink
            });
        } catch (error) {
            // User cancelled or error
            console.log('[Share] Native share cancelled or failed:', error);
        }
    }

}

customElements.define('share-setlist', ShareSetlist);
