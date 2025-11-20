import { css, html, LitElement } from 'lit'
import { getCurrentOrganisation } from '../js/organisation.js'
import { createSyncOrchestrator, isSyncAvailable } from '../js/sync-orchestrator.js'

/**
 * DriveSyncPanel Component
 *
 * UI for triggering and monitoring Google Drive sync
 */
export class DriveSyncPanel extends LitElement {
  static properties = {
    syncAvailable: { type: Boolean, attribute: false },
    syncing: { type: Boolean, attribute: false },
    syncProgress: { type: Object, attribute: false },
    lastSyncTime: { type: String, attribute: false },
    syncError: { type: String, attribute: false },
    disabled: { type: Boolean, reflect: true },
  }

  static styles = css`
    :host {
      display: block;
    }

    .sync-panel {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .sync-panel.disabled {
      opacity: 0.5;
      pointer-events: none;
    }

    .sync-status {
      padding: 1rem;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.05);
    }

    .sync-status.syncing {
      background: rgba(52, 152, 219, 0.1);
      border: 1px solid rgba(52, 152, 219, 0.3);
    }

    .sync-status.error {
      background: rgba(231, 76, 60, 0.1);
      border: 1px solid rgba(231, 76, 60, 0.3);
    }

    .sync-status.success {
      background: rgba(46, 204, 113, 0.1);
      border: 1px solid rgba(46, 204, 113, 0.3);
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.9rem;
    }

    .status-icon {
      font-size: 1.2rem;
    }

    .status-text {
      flex: 1;
    }

    .progress-bar {
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 0.5rem;
    }

    .progress-fill {
      height: 100%;
      background: var(--accent-color, #3498db);
      transition: width 0.3s;
      border-radius: 2px;
    }

    .sync-button {
      padding: 0.75rem 1.5rem;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .sync-button:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.15);
    }

    .sync-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .sync-button.primary {
      background: rgba(52, 152, 219, 0.2);
    }

    .sync-button.primary:hover:not(:disabled) {
      background: rgba(52, 152, 219, 0.3);
    }

    .last-sync {
      font-size: 0.85rem;
      opacity: 0.7;
      text-align: center;
    }

    .error-message {
      color: #e74c3c;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }

    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .unavailable-notice {
      padding: 1rem;
      background: rgba(243, 156, 18, 0.1);
      border: 1px solid rgba(243, 156, 18, 0.3);
      border-radius: 6px;
      font-size: 0.9rem;
    }

    .unavailable-notice a {
      color: inherit;
      text-decoration: underline;
    }
  `

  constructor() {
    super()
    this.syncAvailable = false
    this.syncing = false
    this.syncProgress = null
    this.lastSyncTime = null
    this.syncError = null
    this.disabled = false
  }

  async connectedCallback() {
    super.connectedCallback()
    await this.checkSyncAvailability()
    this.loadLastSyncTime()
  }

  async checkSyncAvailability() {
    this.syncAvailable = await isSyncAvailable()
  }

  loadLastSyncTime() {
    const stored = localStorage.getItem('last-sync-time')
    if (stored) {
      this.lastSyncTime = stored
    }
  }

  async handleSync() {
    if (this.syncing || !this.syncAvailable || this.disabled) return

    this.syncing = true
    this.syncError = null
    this.syncProgress = { stage: 'starting', message: 'Initializing...' }

    try {
      const { id, name } = getCurrentOrganisation()

      // Use the SW-compatible orchestrator
      const orchestrator = await createSyncOrchestrator(name, id)

      await orchestrator.sync(progress => {
        this.syncProgress = progress
        this.requestUpdate()
      })

      // Success!
      const now = new Date().toISOString()
      this.lastSyncTime = now
      localStorage.setItem('last-sync-time', now)

      // Show success briefly
      this.syncProgress = { stage: 'success', message: '✓ Sync complete!' }
      setTimeout(() => {
        this.syncing = false
        this.syncProgress = null
      }, 2000)
    } catch (error) {
      console.error('[DriveSyncPanel] Sync failed:', error)
      this.syncError = error.message
      this.syncProgress = { stage: 'error', message: `Failed: ${error.message}` }
      this.syncing = false
    }
  }

  async handleClearAndReupload() {
    if (this.syncing || !this.syncAvailable || this.disabled) return

    if (
      !confirm(
        '⚠️ This will DELETE all files in your Google Drive Setalight folder and re-upload everything with the new file structure.\n\nThis action cannot be undone!\n\nAre you sure?'
      )
    ) {
      return
    }

    this.syncing = true
    this.syncError = null
    this.syncProgress = { stage: 'starting', message: 'Starting clear and re-upload...' }

    try {
      const { id, name } = getCurrentOrganisation()

      // Use the SW-compatible orchestrator
      const orchestrator = await createSyncOrchestrator(name, id)

      await orchestrator.clearAndReupload(progress => {
        this.syncProgress = progress
        this.requestUpdate()
      })

      // Success!
      const now = new Date().toISOString()
      this.lastSyncTime = now
      localStorage.setItem('last-sync-time', now)

      // Show success briefly
      this.syncProgress = { stage: 'success', message: '✓ Re-upload complete!' }
      setTimeout(() => {
        this.syncing = false
        this.syncProgress = null
      }, 2000)
    } catch (error) {
      console.error('[DriveSyncPanel] Clear and re-upload failed:', error)
      this.syncError = error.message
      this.syncProgress = { stage: 'error', message: `Failed: ${error.message}` }
      this.syncing = false
    }
  }

  render() {
    if (!this.syncAvailable || this.disabled) {
      return html`
        <div class="sync-panel disabled">
          <div class="unavailable-notice">
            <strong>⚠️ Drive Sync Unavailable</strong>
            <p style="margin: 0.5rem 0 0 0;">
              You need to <a href="/storage">connect with Google Drive</a> to enable sync.
            </p>
          </div>
        </div>
      `
    }

    return html`
      <div class="sync-panel">
        ${this.renderSyncStatus()}

        <button class="sync-button primary" ?disabled=${this.syncing} @click=${this.handleSync}>
          ${
            this.syncing ? html`<span class="spinner"></span> Syncing...` : html`🔄 Sync with Drive`
          }
        </button>

        <button
          class="sync-button"
          ?disabled=${this.syncing}
          @click=${this.handleClearAndReupload}
          style="background: rgba(231, 76, 60, 0.2);"
        >
          🗑️ Clear & Re-upload (New File Structure)
        </button>

        ${
          this.lastSyncTime
            ? html`
              <div class="last-sync">Last synced: ${this.formatSyncTime(this.lastSyncTime)}</div>
            `
            : ''
        }
      </div>
    `
  }

  renderSyncStatus() {
    if (!this.syncProgress && !this.syncError) {
      return html`
        <div class="sync-status">
          <div class="status-row">
            <span class="status-icon">☁️</span>
            <span class="status-text">Ready to sync</span>
          </div>
        </div>
      `
    }

    if (this.syncError) {
      return html`
        <div class="sync-status error">
          <div class="status-row">
            <span class="status-icon">❌</span>
            <span class="status-text">Sync failed</span>
          </div>
          <div class="error-message">${this.syncError}</div>
        </div>
      `
    }

    const { stage, message } = this.syncProgress
    const isError = stage === 'error'
    const isSuccess = stage === 'complete' || stage === 'success'
    const statusClass = isError ? 'error' : isSuccess ? 'success' : 'syncing'

    return html`
      <div class="sync-status ${statusClass}">
        <div class="status-row">
          <span class="status-icon"> ${isError ? '❌' : isSuccess ? '✓' : '🔄'} </span>
          <span class="status-text">${message}</span>
        </div>
        ${!isError && !isSuccess ? this.renderProgressBar() : ''}
      </div>
    `
  }

  renderProgressBar() {
    const { current, total } = this.syncProgress || {}
    const hasProgress = typeof current === 'number' && typeof total === 'number' && total > 0
    const percent = hasProgress ? Math.min(100, Math.round((current / total) * 100)) : null
    const width = percent !== null ? `${percent}%` : '50%'
    return html`
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${width}"></div>
      </div>
    `
  }

  formatSyncTime(isoString) {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`

    return date.toLocaleDateString()
  }
}

customElements.define('drive-sync-panel', DriveSyncPanel)
