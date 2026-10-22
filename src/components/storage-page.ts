import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { StoredBlob } from '../js/auth-db.ts'
import type { Space } from '../js/data-types.ts'
import type { UserInfo } from '../js/google-auth.ts'
import { deleteSpace, getCurrentSpace, getSpaceById, listSpaces } from '../js/space.ts'
import { isTeamMember } from '../js/storage/space-storage.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './drive-sync-panel.ts'
import './storage-summary.ts'
import './team-share-panel.ts'
import './space-export-panel.ts'
import './select-space.ts'
import { buttonStyles, panelStyles, spinnerStyles } from './shared-styles.ts'

/** The result of the last sign-in step, shown under the Google section */
interface AuthMessage {
  text: string
  type: 'success' | 'error'
}

/**
 * StoragePage Component
 *
 * Unified interface for storage features including:
 * - Google Drive authorization
 * - Drive sync controls
 * - Filesystem import
 */
export class StoragePage extends LitElement {
  static override properties = {
    isAuthenticated: { type: Boolean, attribute: false },
    signInExpired: { type: Boolean, attribute: false },
    noDrive: { type: Boolean, attribute: false },
    teamMember: { type: Boolean, attribute: false },
    _space: { state: true },
    authStatus: { type: String, attribute: 'auth-status' },
    userInfo: { type: Object, attribute: false },
    _clearError: { state: true },
    _otherSpaces: { state: true },
    _deleteSpaceError: { state: true },
    _deleteSpaceMessage: { state: true },
    _authMessage: { state: true }, // {text, type: 'success' | 'error'}, the last sign-in result
  }

  declare isAuthenticated: boolean
  /** Signed in here, but Google no longer honours it: sync cannot work until the user reconnects */
  declare signInExpired: boolean
  /** Signed in, but without Google Drive: nothing can sync until it is connected */
  declare noDrive: boolean
  /** The current space is a team's and this person is in it, not its owner: its files come through the Worker, not Drive */
  declare teamMember: boolean
  /** The current space's record: whether it is shared with a team, and as what */
  declare _space: Space | null
  declare authStatus: string
  declare userInfo: UserInfo | null
  declare _clearError: string
  /** The spaces on this device other than the current one: the ones that can be deleted */
  declare _otherSpaces: Space[]
  declare _deleteSpaceError: string
  declare _deleteSpaceMessage: string
  declare _authMessage: AuthMessage | null

  /** Starts the app afresh once everything stored has been cleared (a test gives its own) */
  /* v8 ignore next 2 -- reloading the page would end the test run: tests give their own */
  // biome-ignore lint/plugin: everything stored was cleared, so start afresh
  reload: () => void = () => window.location.reload()

  _logoutModal: Ref<AppModal>
  _clearDataModal: Ref<AppModal>
  _deleteSpaceModal: Ref<AppModal>

  static override styles = [
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

    .space-rows {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .space-rows li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--tint, currentColor);
      border-radius: 8px;
    }

    .space-row-name {
      font-size: var(--font-ui);
      font-weight: 500;
      overflow-wrap: anywhere;
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
    this._deleteSpaceModal = createRef()
    this._otherSpaces = []
    this._deleteSpaceError = ''
    this._deleteSpaceMessage = ''
    this.isAuthenticated = false
    this.signInExpired = false
    this.noDrive = false
    this.teamMember = false
    this._space = null
    this.authStatus = 'checking'
    this.userInfo = null
  }

  override async connectedCallback() {
    super.connectedCallback()
    await Promise.all([this.checkAuthStatus(), this._loadOtherSpaces()])
  }

  async _loadOtherSpaces(): Promise<void> {
    try {
      const { id } = getCurrentSpace()
      this._otherSpaces = (await listSpaces()).filter(space => space.id !== id)
    } catch (error) {
      console.error('[Storage] Failed to list the spaces:', error)
      this._otherSpaces = []
    }
  }

  async checkAuthStatus(): Promise<void> {
    // (neither of these throws: a failed check is a user who is not signed in)
    const { getSignInState, getCurrentUserInfo } = await import('../js/google-auth.ts')
    const state = await getSignInState()
    this.isAuthenticated = state !== 'signed-out'
    this.signInExpired = state === 'expired'
    this.noDrive = state === 'no-drive'
    this._space = (await getSpaceById(getCurrentSpace().id)) ?? null
    this.teamMember = isTeamMember(this._space)
    this.userInfo = this.isAuthenticated ? await getCurrentUserInfo() : null
    this.authStatus = 'ready'
  }

  override render() {
    return html`
      <div class="storage-content">
        ${this._renderLocalSummarySection()} ${this._renderSpaceSection()}
        ${this._renderAuthSection()} ${this._renderSyncSection(!this.isAuthenticated || this.signInExpired || (this.noDrive && !this.teamMember))}
        ${this._renderTeamSection()}
        ${this._renderExportSection()} ${this._renderDangerSection()}
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
                  ${
                    this.signInExpired
                      ? html`<h4>⚠ Sign-in expired</h4>`
                      : this.noDrive
                        ? this.teamMember
                          ? html`<h4>✓ Signed in</h4>`
                          : html`<h4>Signed in, Google Drive not connected</h4>`
                        : html`<h4>✓ Connected</h4>`
                  }

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

                ${
                  this.signInExpired
                    ? html`<p role="alert">
                      Google no longer accepts the sign-in stored on this device (it expired or the
                      access was removed), so nothing can sync until you connect again. Your setlists
                      and songs on this device are not affected.
                    </p>`
                    : this.noDrive
                      ? html`<p>
                        You are signed in, but Chordless has no access to Google Drive.
                        ${
                          this.teamMember
                            ? 'This team space does not need it: its songs and setlists come through Chordless. Connect Google Drive to sync spaces of your own.'
                            : 'Your setlists and songs are not being synced. They are safe on this device, and team spaces you have joined are not affected.'
                        }
                      </p>`
                      : html`<p>
                        Cloud features are enabled for this device. Your setlists and songs can be synced
                        to Google Drive.
                      </p>`
                }

                <div class="button-group">
                  ${
                    this.signInExpired
                      ? html`<button class="btn block primary" @click=${this._authorize}>
                        🔑 Reconnect with Google
                      </button>`
                      : this.noDrive
                        ? html`<button class="btn block primary" @click=${this._connectDrive}>
                          📁 Connect Google Drive
                        </button>`
                        : nothing
                  }
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

  _renderSpaceSection() {
    return html`
      <div class="panel">
        <h3>🏢 Space</h3>
        <p>
          Select which space you're currently working with. Each space has its own
          setlists.
        </p>
        <select-space></select-space>
      </div>
    `
  }

  _renderSyncSection(disabled = false) {
    return html`
      <div class="panel ${disabled ? 'is-disabled' : ''}">
        <h3>🔄 ${this.teamMember ? 'Team Sync' : 'Google Drive Sync'}</h3>
        <p>
          ${
            this.teamMember
              ? "Sync this space's setlists and songs with your team."
              : 'Sync your setlists and songs with Google Drive. Your data will be stored in the "Chordless" folder.'
          }
        </p>
        <div class="sync-body">
          ${this._space ? html`<drive-sync-panel .space=${this._space} ?disabled=${disabled}></drive-sync-panel>` : nothing}
          ${
            disabled
              ? html`<p class="sync-hint">
                ${
                  this.signInExpired
                    ? 'Reconnect with Google above to sync again.'
                    : this.noDrive
                      ? 'Connect Google Drive above to sync.'
                      : 'Connect with Google above to enable syncing features.'
                }
              </p>`
              : ''
          }
        </div>
      </div>
    `
  }

  _renderTeamSection() {
    return html`
      <team-share-panel
        .space=${this._space}
        @team-share-panel:changed=${this.checkAuthStatus}
        @team-share-panel:left=${() => this.reload()}
      ></team-share-panel>
    `
  }

  _renderExportSection() {
    return html`
      <div class="panel">
        <h3>📦 Export and import</h3>
        <p>
          Export this space's setlists and songs as a zip file, and import an export into this
          space, on this device or another: it needs no Google account, and an import only adds
          what is missing. Pad sets are large, so they are included only if you choose.
        </p>
        ${
          this._space
            ? html`<space-export-panel
                .space=${this._space}
                show-pads
                ?signed-in=${this.isAuthenticated && !this.signInExpired && !this.noDrive}
              ></space-export-panel>`
            : nothing
        }
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
        ${this._renderDeleteSpace()}
      </div>
      <app-modal
        id="delete-space-modal"
        ${ref(this._deleteSpaceModal)}
        type="confirm"
        heading="Delete space?"
        confirm-label="Delete Space"
        message=${this._deleteSpaceMessage}
      ></app-modal>
      <app-modal
        id="clear-data-modal"
        ${ref(this._clearDataModal)}
        type="confirm"
        heading="Clear local data?"
        confirm-label="Clear Local Data"
        message="This deletes this space's setlists and songs on this device, and all settings. Anything not yet synced to Google Drive is lost. This can't be undone."
      ></app-modal>
      <app-modal
        ${ref(this._logoutModal)}
        type="confirm"
        size="small"
        heading="Log out of Google Drive?"
        confirm-label="Log Out"
        message="This signs you out and revokes Chordless's access to your Google Drive at Google (which needs the network). Other devices signed in with this Google account will need to connect again too. Your setlists and songs stay on this device and in Drive."
      ></app-modal>
    `
  }

  _renderDeleteSpace() {
    if (this._otherSpaces.length === 0) return nothing
    return html`
      <h4>Delete a space</h4>
      <p>
        Remove a space you no longer use from this device, with its setlists and songs. To delete
        the space you are working in, switch to another first.
      </p>
      <ul class="space-rows">
        ${this._otherSpaces.map(
          space => html`
            <li>
              <span class="space-row-name">${space.name}</span>
              <button
                class="btn danger delete-space"
                aria-label="Delete ${space.name}"
                @click=${() => this._handleDeleteSpace(space)}
              >
                Delete
              </button>
            </li>
          `
        )}
      </ul>
      ${this._deleteSpaceError ? html`<p role="alert">❌ Failed to delete the space: ${this._deleteSpaceError}</p>` : ''}
    `
  }

  async _handleDeleteSpace(space: Space): Promise<void> {
    this._deleteSpaceMessage =
      `Delete "${space.name}"? This deletes its setlists and songs on this device, and anything ` +
      "not yet synced to Google Drive is lost. Its folder in Google Drive is not touched. This can't be undone."
    await this.updateComplete
    if (!(await this._deleteSpaceModal.value?.ask())) return
    this._deleteSpaceError = ''
    try {
      await deleteSpace(space.id)
      await this._loadOtherSpaces()
      this.renderRoot.querySelector('select-space')?.refresh()
    } catch (error) {
      console.error('[Storage] Failed to delete the space:', error)
      this._deleteSpaceError = errorMessage(error)
    }
  }

  async _authorize(): Promise<void> {
    this.authStatus = 'authorizing'
    this._authMessage = null
    this.requestUpdate()

    try {
      const { authorizeWithGoogle, getCurrentUserInfo, hasDriveAccess } = await import(
        '../js/google-auth.ts'
      )
      await authorizeWithGoogle()
      this.userInfo = await getCurrentUserInfo()

      this.isAuthenticated = true
      this.signInExpired = false
      this.noDrive = !(await hasDriveAccess())
      this.authStatus = 'ready'

      this._authMessage = this.noDrive
        ? {
            text: '✓ Signed in. Google Drive was not connected, so nothing will sync yet.',
            type: 'success',
          }
        : { text: '✓ Authorization successful!', type: 'success' }
    } catch (error) {
      console.error('[StoragePage] Authorization failed:', error)
      this.authStatus = 'ready'

      this._authMessage = { text: `✗ Authorization failed: ${errorMessage(error)}`, type: 'error' }
    }
  }

  /** Add Google Drive to a sign-in that has none: Google is asked for that alone */
  async _connectDrive(): Promise<void> {
    this._authMessage = null
    try {
      const { connectDrive, getCurrentUserInfo, hasDriveAccess } = await import(
        '../js/google-auth.ts'
      )
      await connectDrive()
      this.userInfo = await getCurrentUserInfo()
      this.noDrive = !(await hasDriveAccess())
      this._authMessage = this.noDrive
        ? { text: '✗ Google Drive was not connected.', type: 'error' }
        : { text: '✓ Google Drive connected!', type: 'success' }
    } catch (error) {
      console.error('[StoragePage] Connecting Google Drive failed:', error)
      this._authMessage = {
        text: `✗ Connecting Google Drive failed: ${errorMessage(error)}`,
        type: 'error',
      }
    }
  }

  async _logout(): Promise<void> {
    if (!(await this._logoutModal.value?.ask())) return

    try {
      const { logout } = await import('../js/google-auth.ts')
      const { revoked } = await logout()

      this.isAuthenticated = false
      this.signInExpired = false
      this.noDrive = false
      this.userInfo = null
      this.requestUpdate()

      this._authMessage = revoked
        ? {
            text: "✓ Successfully logged out, and Chordless's access to your Drive was revoked",
            type: 'success',
          }
        : {
            text: "✓ Logged out on this device, but Google could not be reached to revoke Chordless's access. You can remove it at myaccount.google.com/permissions",
            type: 'success',
          }
    } catch (error) {
      console.error('[StoragePage] Logout failed:', error)
      this._authMessage = { text: `✗ Logging out failed: ${errorMessage(error)}`, type: 'error' }
    }
  }

  async _downloadBackup(): Promise<void> {
    try {
      const { downloadBlobBackup } = await import('../js/google-auth.ts')
      await downloadBlobBackup()
    } catch (error) {
      console.error('[StoragePage] Backup download failed:', error)
      this._authMessage = {
        text: `✗ Downloading the backup failed: ${errorMessage(error)}`,
        type: 'error',
      }
    }
  }

  _showImportBackup(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async e => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const backup = JSON.parse(text)

        const { importBlobBackup, getCurrentUserInfo } = await import('../js/google-auth.ts')
        await importBlobBackup(backup)

        this.isAuthenticated = true
        this.userInfo = await getCurrentUserInfo()
        this.requestUpdate()

        this._authMessage = { text: '✓ Auth backup imported successfully!', type: 'success' }
      } catch (error) {
        console.error('[StoragePage] Import backup failed:', error)
        this._authMessage = {
          text: `✗ Importing the backup failed: ${errorMessage(error)}`,
          type: 'error',
        }
      }
    }
    input.click()
  }

  async _testTokenRefresh(): Promise<void> {
    try {
      const { getAccessToken, getStoredBlob } = await import('../js/google-auth.ts')

      // Check if Service Worker is active
      const controller = navigator.serviceWorker.controller
      if (!controller) {
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

      // Force expiry by setting expires_at to the past
      const expiredMetadata = {
        ...metadata,
        expires_at: new Date(Date.now() - 60000).toISOString(),
      }

      await new Promise<unknown>((resolve, reject) => {
        const messageChannel = new MessageChannel()
        const messageId = crypto.randomUUID()
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)

        messageChannel.port1.onmessage = event => {
          clearTimeout(timeout)
          if (event.data.messageId === messageId) {
            resolve(event.data)
          }
        }

        controller.postMessage(
          { type: 'STORE_BLOB', data: { blob, metadata: expiredMetadata }, messageId },
          [messageChannel.port2]
        )
      })

      await getAccessToken()

      // (the refresh has stored a token, with its expiry)
      const updatedBlob = (await getStoredBlob()) as StoredBlob
      const oldExpiry = new Date(metadata.expires_at as string)
      const newExpiry = new Date(updatedBlob.metadata.expires_at as string)

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
      const { SignInExpiredError } = await import('../js/google-auth.ts')
      if (error instanceof SignInExpiredError) this.signInExpired = true
      this._authMessage = {
        text: `✗ Token refresh test failed: ${errorMessage(error)}`,
        type: 'error',
      }
    }
  }

  async _handleClearDatabase(): Promise<void> {
    const modal = this._clearDataModal.value
    if (!(await modal?.ask())) return
    try {
      const { getCurrentDB } = await import('../js/db.ts')
      const db = await getCurrentDB()
      await db.clearAll()
      localStorage.clear()
      sessionStorage.clear()
      this.reload()
    } catch (error) {
      console.error('[Storage] Failed to clear local data:', error)
      this._clearError = errorMessage(error)
    }
  }
}

customElements.define('storage-page', StoragePage)

declare global {
  interface HTMLElementTagNameMap {
    'storage-page': StoragePage
  }
}
