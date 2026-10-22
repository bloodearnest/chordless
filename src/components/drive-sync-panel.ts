import type { PropertyValues } from 'lit'
import { css, html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import { DriveFolderGoneError } from '../js/drive-sync.ts'
import { nameSpaceBeforeSync } from '../js/first-time-auth.ts'
import { formatSyncTime, lastSyncOf, recordSync } from '../js/last-sync.ts'
import { getCurrentSpace, getSpaceById, syncsBack } from '../js/space.ts'
import { driveFolderProblem } from '../js/space-access.ts'
import {
  createSyncOrchestrator,
  isSyncAvailable,
  SyncOrchestrator,
} from '../js/sync-orchestrator.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, spinnerStyles } from './shared-styles.ts'

/** What the panel shows of a sync: how far it has got (the panel also adds a 'success' stage) */
interface PanelProgress {
  stage: string
  message: string
  current?: number
  total?: number
}

/**
 * DriveSyncPanel Component
 *
 * UI for triggering and monitoring Google Drive sync
 */
export class DriveSyncPanel extends LitElement {
  static override properties = {
    space: { attribute: false },
    syncAvailable: { type: Boolean, attribute: false },
    syncing: { type: Boolean, attribute: false },
    syncProgress: { type: Object, attribute: false },
    lastSyncTime: { type: String, attribute: false },
    syncError: { type: String, attribute: false },
    folderProblem: { type: String, attribute: false },
    disabled: { type: Boolean, reflect: true },
  }

  /** The space to sync: any on this device, not only the one in use */
  declare space: Space
  declare syncAvailable: boolean
  declare syncing: boolean

  /** Starts the app afresh once local data has been replaced (a test gives its own) */
  /* v8 ignore next 2 -- reloading the page would end the test run: tests give their own */
  // biome-ignore lint/plugin: the database was replaced under every view, so start afresh
  reload: () => void = () => window.location.reload()
  declare syncProgress: PanelProgress | null
  declare lastSyncTime: string | null
  declare syncError: string | null
  /** What to tell the user when the space's Drive folder is gone (null: it is there, or not known) */
  declare folderProblem: string | null
  declare disabled: boolean

  _resetModal: Ref<AppModal>
  _startOverModal: Ref<AppModal>

  static override styles = [
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
      background: color-mix(in srgb, var(--color-primary, #2477ad) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-primary, #2477ad) 30%, transparent);
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
      background: var(--color-primary, #2477ad);
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
    this._startOverModal = createRef()
    this.folderProblem = null
    this.syncAvailable = false
    this.syncing = false
    this.syncProgress = null
    this.lastSyncTime = null
    this.syncError = null
    this.disabled = false
  }

  override async connectedCallback() {
    super.connectedCallback()
    await this.checkSyncAvailability()
    this.loadLastSyncTime()
    if (this.syncAvailable) {
      this.folderProblem = (await driveFolderProblem(this.space))?.message ?? null
    }
  }

  override updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has('disabled') && !this.disabled) {
      this.checkSyncAvailability()
    }
  }

  async checkSyncAvailability(): Promise<void> {
    this.syncAvailable = await isSyncAvailable(this.space)
  }

  loadLastSyncTime(): void {
    this.lastSyncTime = lastSyncOf(this.space.id)
  }

  _recordSyncTime(): void {
    this.lastSyncTime = recordSync(this.space.id)
  }

  async _handleReset(): Promise<void> {
    if (this.syncing || !this.syncAvailable || this.disabled) return

    if (!(await this._resetModal.value?.ask())) return

    this.syncing = true
    this.syncError = null
    this.syncProgress = { stage: 'starting', message: 'Starting reset...' }

    try {
      await nameSpaceBeforeSync(this.space)
      const { id, name } = this.space
      const orchestrator = await createSyncOrchestrator(name, id)

      await orchestrator.resetLocalFromDrive(progress => {
        this.syncProgress = progress
        this.requestUpdate()
      })

      this._recordSyncTime()

      if (this.space.id !== getCurrentSpace().id) {
        // (not the space in use: no page is showing it, so nothing needs to start afresh)
        this.syncProgress = { stage: 'success', message: '✓ Reset complete' }
        setTimeout(() => {
          this.syncing = false
          this.syncProgress = null
        }, 2000)
        return
      }
      // Local data changed underneath every page, so reload to show it
      this.syncProgress = { stage: 'success', message: '✓ Reset complete, reloading...' }
      setTimeout(() => this.reload(), 1000)
    } catch (error) {
      console.error('[DriveSyncPanel] Reset from Drive failed:', error)
      this.syncError = errorMessage(error)
      this.syncProgress = { stage: 'error', message: `Failed: ${errorMessage(error)}` }
      this.syncing = false
    }
  }

  async _handleSync(): Promise<void> {
    if (this.syncing || !this.syncAvailable || this.disabled) return

    this.syncing = true
    this.syncError = null
    this.syncProgress = { stage: 'starting', message: 'Initializing...' }

    try {
      await nameSpaceBeforeSync(this.space)
      const { id, name } = this.space

      const orchestrator = await createSyncOrchestrator(name, id)

      await orchestrator.sync(progress => {
        this.syncProgress = progress
        this.requestUpdate()
      })

      await this._syncSucceeded()
    } catch (error) {
      this._syncFailed(error)
    }
  }

  /** Show success briefly */
  async _syncSucceeded(): Promise<void> {
    this._recordSyncTime()
    this.folderProblem = null
    // (the sync may have found the space is read-only: ask the record, not the one this page was given)
    const fresh = (await getSpaceById(this.space.id)) as Space
    this.syncProgress = {
      stage: 'success',
      message: syncsBack(fresh)
        ? '✓ Sync complete!'
        : '✓ Sync complete (view-only access: your changes stay on this device)',
    }
    setTimeout(() => {
      this.syncing = false
      this.syncProgress = null
    }, 2000)
  }

  _syncFailed(error: unknown): void {
    console.error('[DriveSyncPanel] Sync failed:', error)
    this.syncing = false
    if (error instanceof DriveFolderGoneError) {
      // Told with the way on, rather than as an error
      this.folderProblem = error.message
      this.syncProgress = null
      return
    }
    this.syncError = errorMessage(error)
    this.syncProgress = { stage: 'error', message: `Failed: ${errorMessage(error)}` }
  }

  /** Let go of the folder that is gone, and upload everything on this device to a new one */
  async _handleStartOver(): Promise<void> {
    if (this.syncing || !this.syncAvailable || this.disabled) return
    if (!(await this._startOverModal.value?.ask())) return

    this.syncing = true
    this.syncError = null
    this.syncProgress = { stage: 'starting', message: 'Starting over in Drive...' }

    try {
      await nameSpaceBeforeSync(this.space)
      const { id, name } = this.space
      await new SyncOrchestrator(name, id).startOverInDrive(progress => {
        this.syncProgress = progress
        this.requestUpdate()
      })
      await this._syncSucceeded()
    } catch (error) {
      this._syncFailed(error)
    }
  }

  override render() {
    if (!this.syncAvailable || this.disabled) {
      return html`
        <div class="sync-panel disabled">
          <div class="unavailable-notice">
            <strong>⚠️ Drive Sync Unavailable</strong>
            <p style="margin: 0.5rem 0 0 0;">
              You need to <a href="/account">connect with Google Drive</a> to enable sync.
            </p>
          </div>
        </div>
      `
    }

    return html`
      <div class="sync-panel">
        ${
          this.folderProblem && !this.syncing && !this.syncError
            ? this._renderFolderProblem()
            : this._renderSyncStatus()
        }

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

  _renderFolderProblem() {
    return html`
      <div class="sync-status error">
        <div class="status-row">
          <span class="status-icon">⚠️</span>
          <span class="status-text">Drive folder not found</span>
        </div>
        <div class="error-message">${this.folderProblem}</div>
        <button class="btn" ?disabled=${this.syncing} @click=${this._handleStartOver}>
          ↻ Start over in Drive
        </button>
        <app-modal
          ${ref(this._startOverModal)}
          type="confirm"
          size="small"
          heading="Start over in Google Drive?"
          confirm-label="Start over"
          message="Everything on this device is kept, and uploaded again to a new Drive folder. Share links to this space's setlists stop working: make them again. If you can still see the old folder in Drive, it is left alone: delete it by hand when you are sure."
        ></app-modal>
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

    // (with no progress and no error, it is ready: above)
    const { stage, message } = this.syncProgress as PanelProgress
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
    const { current, total } = this.syncProgress as PanelProgress
    const hasProgress = typeof current === 'number' && typeof total === 'number' && total > 0
    const percent = hasProgress ? Math.min(100, Math.round((current / total) * 100)) : null
    const width = percent !== null ? `${percent}%` : '50%'
    return html`
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${width}"></div>
      </div>
    `
  }

  _formatSyncTime(isoString: string): string {
    return formatSyncTime(isoString)
  }
}

customElements.define('drive-sync-panel', DriveSyncPanel)

declare global {
  interface HTMLElementTagNameMap {
    'drive-sync-panel': DriveSyncPanel
  }
}
