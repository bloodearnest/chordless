import { css, html, LitElement } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import { nameOrganisationBeforeSync } from '../js/first-time-auth.js'
import { getCurrentOrganisation } from '../js/organisation.js'
import { createSyncOrchestrator, isSyncAvailable } from '../js/sync-orchestrator.js'
import './app-modal.js'
import { buttonStyles, spinnerStyles } from './shared-styles.js'

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

  static styles = [
    buttonStyles,
    spinnerStyles,
    css`
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
      background: var(--tint-subtle);
    }

    .sync-status.syncing {
      background: color-mix(in srgb, var(--color-primary, #3498db) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-primary, #3498db) 30%, transparent);
    }

    .sync-status.error {
      background: color-mix(in srgb, var(--color-danger, #e74c3c) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-danger, #e74c3c) 30%, transparent);
    }

    .sync-status.success {
      background: color-mix(in srgb, var(--color-success, #27ae60) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-success, #27ae60) 30%, transparent);
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: var(--font-ui);
    }

    .status-icon {
      font-size: var(--font-ui-small);
    }

    .status-text {
      flex: 1;
    }

    .progress-bar {
      width: 100%;
      height: 4px;
      background: var(--tint);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 0.5rem;
    }

    .progress-fill {
      height: 100%;
      background: var(--color-primary, #3498db);
      transition: width 0.3s;
      border-radius: 2px;
    }

    .last-sync {
      font-size: var(--font-ui-small);
      opacity: 0.7;
      text-align: center;
    }

    .error-message {
      color: var(--color-danger, #e74c3c);
      font-size: var(--font-ui-small);
      margin-top: 0.5rem;
    }

    .unavailable-notice {
      padding: 1rem;
      background: color-mix(in srgb, var(--color-warning, #f39c12) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-warning, #f39c12) 30%, transparent);
      border-radius: 6px;
      font-size: var(--font-ui);
    }

    .unavailable-notice a {
      color: inherit;
      text-decoration: underline;
    }
  `,
  ]

  constructor() {
    super()
    this._resetModal = createRef()
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

  updated(changedProperties) {
    if (changedProperties.has('disabled') && !this.disabled) {
      this.checkSyncAvailability()
    }
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

  async _handleReset() {
    if (this.syncing || !this.syncAvailable || this.disabled) return

    if (!(await this._resetModal.value.ask())) return

    this.syncing = true
    this.syncError = null
    this.syncProgress = { stage: 'starting', message: 'Starting reset...' }

    try {
      await nameOrganisationBeforeSync()
      const { id, name } = getCurrentOrganisation()
      const orchestrator = await createSyncOrchestrator(name, id)

      await orchestrator.resetLocalFromDrive(progress => {
        this.syncProgress = progress
        this.requestUpdate()
      })

      const now = new Date().toISOString()
      this.lastSyncTime = now
      localStorage.setItem('last-sync-time', now)

      // Local data changed underneath every page, so reload to show it
      this.syncProgress = { stage: 'success', message: '✓ Reset complete, reloading...' }
      setTimeout(() => window.location.reload(), 1000)
    } catch (error) {
      console.error('[DriveSyncPanel] Reset from Drive failed:', error)
      this.syncError = error.message
      this.syncProgress = { stage: 'error', message: `Failed: ${error.message}` }
      this.syncing = false
    }
  }

  async _handleSync() {
    if (this.syncing || !this.syncAvailable || this.disabled) return

    this.syncing = true
    this.syncError = null
    this.syncProgress = { stage: 'starting', message: 'Initializing...' }

    try {
      await nameOrganisationBeforeSync()
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
        ${this._renderSyncStatus()}

        <button class="btn primary" ?disabled=${this.syncing} @click=${this._handleSync}>
          ${
            this.syncing ? html`<span class="spinner"></span> Syncing...` : html`🔄 Sync with Drive`
          }
        </button>

        <button class="btn" ?disabled=${this.syncing} @click=${this._handleReset}>
          ⤓ Reset from Google Drive
        </button>
        <app-modal
          ${ref(this._resetModal)}
          type="confirm"
          size="small"
          heading="Reset from Google Drive?"
          confirm-label="Reset"
          message="This replaces this device's setlists and songs with the copy in Google Drive. Anything removed from Drive is removed here too. If this device has changes that aren't in Drive yet, nothing is changed."
        ></app-modal>

        ${
          this.lastSyncTime
            ? html`
              <div class="last-sync">Last synced: ${this._formatSyncTime(this.lastSyncTime)}</div>
            `
            : ''
        }
      </div>
    `
  }

  _renderSyncStatus() {
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
        ${!isError && !isSuccess ? this._renderProgressBar() : ''}
      </div>
    `
  }

  _renderProgressBar() {
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

  _formatSyncTime(isoString) {
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
