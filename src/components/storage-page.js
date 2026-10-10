import { css, html, LitElement } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import './app-modal.js'
import './drive-sync-panel.js'
import './storage-summary.js'
import './pad-set-manager.js'
import './select-organisation.js'
import { buttonStyles, panelStyles, spinnerStyles } from './shared-styles.js'

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
    _clearError: { state: true },
    _authMessage: { state: true }, // {text, type: 'success' | 'error'}, the last sign-in result
  }

  static styles = [
    panelStyles,
    buttonStyles,
    spinnerStyles,
    css`
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

    .panel {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .panel.is-disabled {
      opacity: 0.5;
    }

    .danger-zone {
      border-color: color-mix(in srgb, var(--color-danger, #e74c3c) 40%, transparent);
    }

    h4 {
      font-size: var(--font-ui);
      margin: 1.5rem 0 1rem 0;
      font-weight: 600;
    }

    .auth-status {
      padding: 1.25rem;
      border-radius: 8px;
      text-align: center;
    }

    .auth-status.authenticated {
      background: color-mix(in srgb, var(--color-success, #27ae60) 15%, transparent);
      border: 2px solid var(--color-success, #27ae60);
    }

    .auth-status.pending {
      background: var(--tint-subtle);
      border: 2px solid var(--tint);
    }

    .auth-status h4 {
      margin: 0 0 0.5rem 0;
      font-size: var(--font-ui);
    }

    .panel .auth-status p {
      margin: 0;
      opacity: 1;
    }

    .panel .auth-note {
      opacity: 0.6;
    }

    .auth-message {
      margin: 1rem 0 0;
      font-weight: 600;
    }

    .auth-message.success {
      color: var(--color-success, #27ae60);
    }

    .auth-message.error {
      color: var(--color-danger, #e74c3c);
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

    .sync-hint {
      font-size: var(--font-ui-small);
      opacity: 0.8;
    }

    .auth-status .spinner {
      display: block;
      width: 30px;
      height: 30px;
      margin: 0 auto 1rem;
    }

    .divider {
      height: 1px;
      background: var(--tint);
      margin: 0.5rem 0;
    }

    .user-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      background: var(--tint);
      border-radius: 8px;
    }

    .user-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid var(--tint-border);
      background: var(--tint-strong);
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
      font-size: var(--font-ui);
      font-weight: 600;
    }

    .user-email {
      font-size: var(--font-ui-small);
      opacity: 0.8;
    }
  `,
  ]

  constructor() {
    super()
    this._logoutModal = createRef()
    this._clearDataModal = createRef()
    this.isAuthenticated = false
    this.authStatus = 'checking'
    this.userInfo = null
  }

  async connectedCallback() {
    super.connectedCallback()
    await this.checkAuthStatus()
  }

  async checkAuthStatus() {
    try {
      const { isAuthenticated, getCurrentUserInfo } = await import('../js/google-auth.js')
      this.isAuthenticated = await isAuthenticated()
      this.userInfo = this.isAuthenticated ? await getCurrentUserInfo() : null
      this.authStatus = 'ready'
    } catch (error) {
      console.error('[StoragePage] Failed to check auth:', error)
      this.authStatus = 'error'
    }
  }

  render() {
    return html`
      <div class="storage-content">
        ${this._renderLocalSummarySection()} ${this._renderOrganisationSection()}
        ${this._renderAuthSection()} ${this._renderSyncSection(!this.isAuthenticated)}
        ${this._renderPadSetSection()} ${this._renderDangerSection()}
      </div>
    `
  }

  _renderAuthSection() {
    return html`
      <div class="panel">
        <h3>🔐 Google Drive Authorization</h3>

        ${
          this.authStatus === 'checking'
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

                  ${
                    this.userInfo
                      ? html`
                        <div class="user-card">
                          ${
                            this.userInfo.avatarDataUrl || this.userInfo.picture
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
                              `
                          }
                          <div class="user-details">
                            <span class="user-name">${this.userInfo.name || 'Signed in user'}</span>
                            ${
                              this.userInfo.email
                                ? html`<span class="user-email">${this.userInfo.email}</span>`
                                : ''
                            }
                          </div>
                        </div>
                      `
                      : ''
                  }
                </div>

                <p>
                  Cloud features are enabled for this device. Your setlists and songs can be synced
                  to Google Drive.
                </p>

                <div class="button-group">
                  <button class="btn block" @click=${this._testTokenRefresh}>
                    🔄 Test Token Refresh
                  </button>
                  <button class="btn block" @click=${this._downloadBackup}>
                    📥 Download Auth Backup
                  </button>
                  <button class="btn block danger" @click=${this._logout}>
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

                <p class="auth-note">
                  <strong>Note:</strong> Authorization happens locally on your device. Your
                  credentials are encrypted and never stored on our servers.
                </p>

                <div class="button-group">
                  <button class="btn block primary" @click=${this._authorize}>
                    🔑 Connect with Google
                  </button>
                  <button class="btn block" @click=${this._showImportBackup}>
                    📤 Import Auth Backup
                  </button>
                </div>
              `
        }
        ${
          this._authMessage
            ? html`<p
                class="auth-message ${this._authMessage.type}"
                role=${this._authMessage.type === 'error' ? 'alert' : 'status'}
              >
                ${this._authMessage.text}
              </p>`
            : ''
        }
      </div>
    `
  }

  _renderLocalSummarySection() {
    return html`
      <div class="panel">
        <h3>📊 Local Data</h3>
        <p>
          Overview of the setlists, songs, and cached files stored in this browser. Useful for
          estimating offline storage impact before clearing data.
        </p>
        <storage-summary></storage-summary>
      </div>
    `
  }

  _renderOrganisationSection() {
    return html`
      <div class="panel">
        <h3>🏢 Organisation</h3>
        <p>
          Select which organisation you're currently working with. Each organisation has its own
          setlists.
        </p>
        <select-organisation></select-organisation>
      </div>
    `
  }

  _renderSyncSection(disabled = false) {
    return html`
      <div class="panel ${disabled ? 'is-disabled' : ''}">
        <h3>🔄 Google Drive Sync</h3>
        <p>
          Sync your setlists and songs with Google Drive. Your data will be stored in the
          "Chordless" folder.
        </p>
        <div class="sync-body">
          <drive-sync-panel ?disabled=${disabled}></drive-sync-panel>
          ${
            disabled
              ? html` <p class="sync-hint">Connect with Google above to enable syncing features.</p> `
              : ''
          }
        </div>
      </div>
    `
  }

  _renderPadSetSection() {
    return html`
      <div class="panel">
        <h3>🎚️ Pad Sets</h3>
        <p>
          Upload zipped pad libraries (with all 12 keys). They are stored locally for instant use
          and uploaded to Google Drive when available.
        </p>
        <pad-set-manager></pad-set-manager>
      </div>
    `
  }

  _renderDangerSection() {
    return html`
      <div class="panel danger-zone">
        <h3>⚠️ Danger Zone</h3>
        <p>
          Clear all data from IndexedDB and localStorage for this browser. This action cannot be
          undone!
        </p>
        <button class="btn block danger" @click=${this._handleClearDatabase}>
          Clear Local Data
        </button>
        ${this._clearError ? html`<p role="alert">❌ Failed to clear data: ${this._clearError}</p>` : ''}
      </div>
      <app-modal
        id="clear-data-modal"
        ${ref(this._clearDataModal)}
        type="confirm"
        heading="Clear local data?"
        confirm-label="Clear Local Data"
        message="This deletes this organisation's setlists and songs on this device, and all settings. Anything not yet synced to Google Drive is lost. This can't be undone."
      ></app-modal>
      <app-modal
        ${ref(this._logoutModal)}
        type="confirm"
        size="small"
        heading="Log out of Google Drive?"
        confirm-label="Log Out"
        message="This revokes Chordless's access to your Google Drive on this device. You'll need to connect again to sync."
      ></app-modal>
    `
  }

  async _authorize() {
    this.authStatus = 'authorizing'
    this._authMessage = null
    this.requestUpdate()

    try {
      const { authorizeWithGoogle, getCurrentUserInfo } = await import('../js/google-auth.js')
      await authorizeWithGoogle()
      this.userInfo = await getCurrentUserInfo()

      this.isAuthenticated = true
      this.authStatus = 'ready'

      this._authMessage = { text: '✓ Authorization successful!', type: 'success' }
    } catch (error) {
      console.error('[StoragePage] Authorization failed:', error)
      this.authStatus = 'ready'

      this._authMessage = { text: `✗ Authorization failed: ${error.message}`, type: 'error' }
    }
  }

  async _logout() {
    if (!(await this._logoutModal.value.ask())) return

    try {
      const { logout } = await import('../js/google-auth.js')
      await logout()

      this.isAuthenticated = false
      this.userInfo = null
      this.requestUpdate()

      this._authMessage = { text: '✓ Successfully logged out', type: 'success' }
    } catch (error) {
      console.error('[StoragePage] Logout failed:', error)
      this._authMessage = { text: `✗ Logging out failed: ${error.message}`, type: 'error' }
    }
  }

  async _downloadBackup() {
    try {
      const { downloadBlobBackup } = await import('../js/google-auth.js')
      await downloadBlobBackup()
    } catch (error) {
      console.error('[StoragePage] Backup download failed:', error)
      this._authMessage = {
        text: `✗ Downloading the backup failed: ${error.message}`,
        type: 'error',
      }
    }
  }

  _showImportBackup() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async e => {
      const file = e.target.files[0]
      if (!file) return

      try {
        const text = await file.text()
        const backup = JSON.parse(text)

        const { importBlobBackup, getCurrentUserInfo } = await import('../js/google-auth.js')
        await importBlobBackup(backup)

        this.isAuthenticated = true
        this.userInfo = await getCurrentUserInfo()
        this.requestUpdate()

        this._authMessage = { text: '✓ Auth backup imported successfully!', type: 'success' }
      } catch (error) {
        console.error('[StoragePage] Import backup failed:', error)
        this._authMessage = {
          text: `✗ Importing the backup failed: ${error.message}`,
          type: 'error',
        }
      }
    }
    input.click()
  }

  async _testTokenRefresh() {
    try {
      const { getAccessToken, getStoredBlob } = await import('../js/google-auth.js')

      // Check if Service Worker is active
      if (!navigator.serviceWorker.controller) {
        this._authMessage = {
          text: '✗ Service Worker not active. Reload the page and try again.',
          type: 'error',
        }
        return
      }

      const blobData = await getStoredBlob()
      if (!blobData) {
        this._authMessage = { text: '✗ Not connected: connect with Google first', type: 'error' }
        return
      }

      const { blob, metadata } = blobData
      console.log('[Test] Current token expires at:', metadata.expires_at)

      // Force expiry by setting expires_at to the past
      const expiredMetadata = {
        ...metadata,
        expires_at: new Date(Date.now() - 60000).toISOString(),
      }

      await new Promise((resolve, reject) => {
        const messageChannel = new MessageChannel()
        const messageId = crypto.randomUUID()
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)

        messageChannel.port1.onmessage = event => {
          clearTimeout(timeout)
          if (event.data.messageId === messageId) {
            resolve(event.data)
          }
        }

        navigator.serviceWorker.controller.postMessage(
          { type: 'STORE_BLOB', data: { blob, metadata: expiredMetadata }, messageId },
          [messageChannel.port2]
        )
      })

      console.log('[Test] Token expiry set to past, now calling getAccessToken()...')
      await getAccessToken()
      console.log('[Test] ✅ Token refresh successful!')

      const updatedBlob = await getStoredBlob()
      const oldExpiry = new Date(metadata.expires_at)
      const newExpiry = new Date(updatedBlob.metadata.expires_at)

      if (newExpiry > new Date()) {
        this._authMessage = {
          text: `✓ Token refresh test passed: expiry ${oldExpiry.toLocaleTimeString()} → ${newExpiry.toLocaleTimeString()}`,
          type: 'success',
        }
      } else {
        throw new Error('New token still expired!')
      }
    } catch (error) {
      console.error('[Test] ❌ Token refresh failed:', error)
      this._authMessage = { text: `✗ Token refresh test failed: ${error.message}`, type: 'error' }
    }
  }

  async _handleClearDatabase() {
    const modal = this._clearDataModal.value
    if (!(await modal.ask())) return
    try {
      const { getCurrentDB } = await import('../js/db.ts')
      const db = await getCurrentDB()
      await db.clearAll()
      localStorage.clear()
      sessionStorage.clear()
      // biome-ignore lint/plugin: everything stored was cleared, so start afresh
      window.location.reload()
    } catch (error) {
      console.error('[Storage] Failed to clear local data:', error)
      this._clearError = error.message
    }
  }
}

customElements.define('storage-page', StoragePage)
