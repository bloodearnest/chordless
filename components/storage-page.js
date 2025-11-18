import { LitElement, html, css } from 'lit';
import './drive-sync-panel.js';
import './storage-summary.js';
import './pad-set-manager.js';
import './select-organisation.js';

/**
 * StoragePage Component
 *
 * Unified interface for storage features including:
 * - Google Drive authorization
 * - Drive sync controls
 * - Filesystem import
 */
export class StoragePage extends LitElement {
  static properties = {
    isAuthenticated: { type: Boolean, attribute: false },
    authStatus: { type: String, attribute: 'auth-status' },
    userInfo: { type: Object, attribute: false },
  };

  static styles = css`
    :host {
      display: block;
    }

    .storage-content {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      max-width: 800px;
      margin: 0 auto;
    }

    .storage-section {
      background: var(--settings-bg, #34495e);
      border-radius: 8px;
      padding: 1.5rem;
      color: var(--settings-text, white);
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .storage-section.is-disabled {
      opacity: 0.5;
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
    }

    p {
      font-size: 0.85rem;
      margin: 0 0 1rem 0;
      opacity: 0.7;
      line-height: 1.4;
    }

    .auth-status {
      padding: 1.25rem;
      border-radius: 8px;
      text-align: center;
    }

    .auth-status.authenticated {
      background: rgba(39, 174, 96, 0.2);
      border: 2px solid #27ae60;
    }

    .auth-status.pending {
      background: rgba(255, 255, 255, 0.05);
      border: 2px solid rgba(255, 255, 255, 0.1);
    }

    .auth-status h4 {
      margin: 0 0 0.5rem 0;
      font-size: 1.1rem;
    }

    .auth-status p {
      margin: 0;
      opacity: 1;
    }

    .feature-list {
      margin: 1rem 0;
      padding-left: 1.5rem;
    }

    .feature-list li {
      padding: 0.4rem 0;
      opacity: 0.8;
    }

    .button-group {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .storage-button {
      display: inline-block;
      width: 100%;
      padding: 0.75rem 1.5rem;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      text-align: center;
    }

    .storage-button:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .storage-button.primary {
      background: var(--header-bg, #3498db);
    }

    .storage-button.primary:hover {
      background: #2980b9;
    }

    .storage-button.danger {
      background-color: rgba(231, 76, 60, 0.2);
    }

    .storage-button.danger:hover {
      background-color: rgba(231, 76, 60, 0.3);
    }

    .sync-hint {
      font-size: 0.85rem;
      opacity: 0.8;
    }

    .spinner {
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top: 3px solid white;
      border-radius: 50%;
      width: 30px;
      height: 30px;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }

    @keyframes spin {
      0% {
        transform: rotate(0deg);
      }
      100% {
        transform: rotate(360deg);
      }
    }

    .divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
      margin: 0.5rem 0;
    }

    .user-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 8px;
    }

    .user-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
    }

    .user-details {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .user-name {
      font-size: 1rem;
      font-weight: 600;
    }

    .user-email {
      font-size: 0.85rem;
      opacity: 0.8;
    }
  `;

  constructor() {
    super();
    this.isAuthenticated = false;
    this.authStatus = 'checking';
    this.userInfo = null;
  }

  async connectedCallback() {
    super.connectedCallback();
    await this.checkAuthStatus();
  }

  async checkAuthStatus() {
    try {
      const { isAuthenticated, getCurrentUserInfo } = await import('/js/google-auth.js');
      this.isAuthenticated = await isAuthenticated();
      this.userInfo = this.isAuthenticated ? await getCurrentUserInfo() : null;
      this.authStatus = 'ready';
    } catch (error) {
      console.error('[StoragePage] Failed to check auth:', error);
      this.authStatus = 'error';
    }
  }

  render() {
    return html`
      <div class="storage-content">
        ${this._renderLocalSummarySection()} ${this._renderOrganisationSection()}
        ${this._renderAuthSection()} ${this._renderSyncSection(!this.isAuthenticated)}
        ${this._renderPadSetSection()} ${this._renderImportSection()} ${this._renderDangerSection()}
      </div>
    `;
  }

  _renderAuthSection() {
    return html`
      <div class="storage-section">
        <h3>🔐 Google Drive Authorization</h3>

        ${this.authStatus === 'checking'
          ? html`
              <div class="auth-status pending">
                <div class="spinner"></div>
                <p>Checking authorization status...</p>
              </div>
            `
          : this.isAuthenticated
            ? html`
                <div class="auth-status authenticated">
                  <h4>✓ Connected</h4>

                  ${this.userInfo
                    ? html`
                        <div class="user-card">
                          ${this.userInfo.avatarDataUrl || this.userInfo.picture
                            ? html`
                                <img
                                  class="user-avatar"
                                  src="${this.userInfo.avatarDataUrl || this.userInfo.picture}"
                                  alt="${this.userInfo.name || 'Google account photo'}"
                                  referrerpolicy="no-referrer"
                                />
                              `
                            : html`
                                <div class="user-avatar">
                                  ${(this.userInfo.name || this.userInfo.email || '?')
                                    .charAt(0)
                                    .toUpperCase()}
                                </div>
                              `}
                          <div class="user-details">
                            <span class="user-name">${this.userInfo.name || 'Signed in user'}</span>
                            ${this.userInfo.email
                              ? html`<span class="user-email">${this.userInfo.email}</span>`
                              : ''}
                          </div>
                        </div>
                      `
                    : ''}
                </div>

                <p>
                  Cloud features are enabled for this device. Your setlists and songs can be synced
                  to Google Drive.
                </p>

                <div class="button-group">
                  <button class="storage-button" @click=${this._testTokenRefresh}>
                    🔄 Test Token Refresh
                  </button>
                  <button class="storage-button" @click=${this._downloadBackup}>
                    📥 Download Auth Backup
                  </button>
                  <button class="storage-button danger" @click=${this._logout}>
                    🚪 Logout & Revoke Access
                  </button>
                </div>
              `
            : html`
                <div class="auth-status pending">
                  <h4>Not Connected</h4>
                  <p>Connect with Google to enable cloud features.</p>
                </div>

                <p>Connecting with Google Drive enables:</p>

                <ul class="feature-list">
                  <li>📁 Store setlists and songs in Google Drive</li>
                  <li>🔄 Sync across all your devices</li>
                  <li>🤝 Share setlists with your team</li>
                  <li>📱 Access from any device with a browser</li>
                </ul>

                <p style="opacity: 0.6; font-size: 0.8rem;">
                  <strong>Note:</strong> Authorization happens locally on your device. Your
                  credentials are encrypted and never stored on our servers.
                </p>

                <div class="button-group">
                  <button class="storage-button primary" @click=${this._authorize}>
                    🔑 Connect with Google
                  </button>
                  <button class="storage-button" @click=${this._showImportBackup}>
                    📤 Import Auth Backup
                  </button>
                </div>
              `}
      </div>
    `;
  }

  _renderLocalSummarySection() {
    return html`
      <div class="storage-section">
        <h3>📊 Local Data</h3>
        <p>
          Overview of the setlists, songs, and cached files stored in this browser. Useful for
          estimating offline storage impact before clearing data.
        </p>
        <storage-summary></storage-summary>
      </div>
    `;
  }

  _renderOrganisationSection() {
    return html`
      <div class="storage-section">
        <h3>🏢 Organisation</h3>
        <p>
          Select which organisation you're currently working with. Each organisation has its own
          setlists.
        </p>
        <select-organisation></select-organisation>
      </div>
    `;
  }

  _renderSyncSection(disabled = false) {
    return html`
      <div class="storage-section ${disabled ? 'is-disabled' : ''}">
        <h3>🔄 Google Drive Sync</h3>
        <p>
          Sync your setlists and songs with Google Drive. Your data will be stored in the
          "Setalight" folder.
        </p>
        <div class="sync-body">
          <drive-sync-panel ?disabled=${disabled}></drive-sync-panel>
          ${disabled
            ? html` <p class="sync-hint">Connect with Google above to enable syncing features.</p> `
            : ''}
        </div>
      </div>
    `;
  }

  _renderPadSetSection() {
    return html`
      <div class="storage-section">
        <h3>🎚️ Pad Sets</h3>
        <p>
          Upload zipped pad libraries (with all 12 keys). They are stored locally for instant use
          and uploaded to Google Drive when available.
        </p>
        <pad-set-manager></pad-set-manager>
      </div>
    `;
  }

  _renderImportSection() {
    return html`
      <div class="storage-section">
        <h3>📂 Import from Filesystem</h3>
        <p>
          Import setlists and songs from the filesystem. This will scan the sets/ directory and add
          all found setlists to the database.
        </p>
        <button class="storage-button" @click=${this._handleImport}>
          Import Setlists from Filesystem
        </button>
      </div>
    `;
  }

  _renderDangerSection() {
    return html`
      <div class="storage-section" style="border: 1px solid rgba(231, 76, 60, 0.4);">
        <h3>⚠️ Danger Zone</h3>
        <p>
          Clear all data from IndexedDB and localStorage for this browser. This action cannot be
          undone!
        </p>
        <button class="storage-button danger" @click=${this._handleClearDatabase}>
          Clear Local Data
        </button>
      </div>
    `;
  }

  async _authorize() {
    this.authStatus = 'authorizing';
    this.requestUpdate();

    try {
      const { authorizeWithGoogle, getCurrentUserInfo } = await import('/js/google-auth.js');
      await authorizeWithGoogle();
      this.userInfo = await getCurrentUserInfo();

      this.isAuthenticated = true;
      this.authStatus = 'ready';

      this.dispatchEvent(
        new CustomEvent('show-message', {
          bubbles: true,
          composed: true,
          detail: { message: '✓ Authorization successful!', type: 'success' },
        })
      );
    } catch (error) {
      console.error('[StoragePage] Authorization failed:', error);
      this.authStatus = 'ready';

      this.dispatchEvent(
        new CustomEvent('show-message', {
          bubbles: true,
          composed: true,
          detail: { message: `✗ Authorization failed: ${error.message}`, type: 'error' },
        })
      );
    }
  }

  async _logout() {
    if (
      !confirm(
        'Are you sure you want to logout and revoke Google Drive access?\n\nYou will need to re-authorize to use cloud features.'
      )
    ) {
      return;
    }

    try {
      const { logout } = await import('/js/google-auth.js');
      await logout();

      this.isAuthenticated = false;
      this.userInfo = null;
      this.requestUpdate();

      this.dispatchEvent(
        new CustomEvent('show-message', {
          bubbles: true,
          composed: true,
          detail: { message: '✓ Successfully logged out', type: 'success' },
        })
      );
    } catch (error) {
      console.error('[StoragePage] Logout failed:', error);
      alert('Error logging out: ' + error.message);
    }
  }

  async _downloadBackup() {
    try {
      const { downloadBlobBackup } = await import('/js/google-auth.js');
      await downloadBlobBackup();
    } catch (error) {
      console.error('[StoragePage] Backup download failed:', error);
      alert('Error downloading backup: ' + error.message);
    }
  }

  _showImportBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const backup = JSON.parse(text);

        const { importBlobBackup, getCurrentUserInfo } = await import('/js/google-auth.js');
        await importBlobBackup(backup);

        this.isAuthenticated = true;
        this.userInfo = await getCurrentUserInfo();
        this.requestUpdate();

        this.dispatchEvent(
          new CustomEvent('show-message', {
            bubbles: true,
            composed: true,
            detail: { message: '✓ Auth backup imported successfully!', type: 'success' },
          })
        );
      } catch (error) {
        console.error('[StoragePage] Import backup failed:', error);
        alert('Error importing backup: ' + error.message);
      }
    };
    input.click();
  }

  async _testTokenRefresh() {
    try {
      const { getAccessToken, getStoredBlob } = await import('/js/google-auth.js');

      // Check if Service Worker is active
      if (!navigator.serviceWorker.controller) {
        alert('⚠️ Service Worker not active. Please refresh the page and try again.');
        return;
      }

      const blobData = await getStoredBlob();
      if (!blobData) {
        alert('Not authenticated - authorize first');
        return;
      }

      const { blob, metadata } = blobData;
      console.log('[Test] Current token expires at:', metadata.expires_at);

      // Force expiry by setting expires_at to the past
      const expiredMetadata = {
        ...metadata,
        expires_at: new Date(Date.now() - 60000).toISOString(),
      };

      await new Promise((resolve, reject) => {
        const messageChannel = new MessageChannel();
        const messageId = crypto.randomUUID();
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

        messageChannel.port1.onmessage = event => {
          clearTimeout(timeout);
          if (event.data.messageId === messageId) {
            resolve(event.data);
          }
        };

        navigator.serviceWorker.controller.postMessage(
          { type: 'STORE_BLOB', data: { blob, metadata: expiredMetadata }, messageId },
          [messageChannel.port2]
        );
      });

      console.log('[Test] Token expiry set to past, now calling getAccessToken()...');
      await getAccessToken();
      console.log('[Test] ✅ Token refresh successful!');

      const updatedBlob = await getStoredBlob();
      const oldExpiry = new Date(metadata.expires_at);
      const newExpiry = new Date(updatedBlob.metadata.expires_at);

      if (newExpiry > new Date()) {
        alert(
          '✅ Token refresh test passed!\n\n' +
            `Old expiry: ${oldExpiry.toLocaleTimeString()}\n` +
            `New expiry: ${newExpiry.toLocaleTimeString()}\n\n` +
            'Check console for details.'
        );
      } else {
        throw new Error('New token still expired!');
      }
    } catch (error) {
      console.error('[Test] ❌ Token refresh failed:', error);
      alert('❌ Token refresh test failed:\n\n' + error.message);
    }
  }

  _handleImport() {
    this.dispatchEvent(
      new CustomEvent('import-requested', {
        bubbles: true,
        composed: true,
      })
    );
  }

  _handleClearDatabase() {
    this.dispatchEvent(
      new CustomEvent('clear-database-requested', {
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define('storage-page', StoragePage);
