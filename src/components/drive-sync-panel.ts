import type { PropertyValues } from 'lit'
import { css, html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import { formatSyncTime, lastSyncOf, recordSync } from '../js/last-sync.ts'
import { rich } from '../js/rich-text.ts'
import { getCurrentSpace } from '../js/space.ts'
import { driveFolderProblem } from '../js/space-access.ts'
import {
  createSyncOrchestrator,
  isSyncAvailable,
  SyncOrchestrator,
} from '../js/sync-orchestrator.ts'
import { t } from '../js/text.ts'
import { errorMessage, failedWith, whatToSay } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './progress-bar.ts'
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
  /** How long a finished reset or start-over is shown, and how long before the reload that
   * follows one (time to read it; properties for tests to shorten) */
  static doneMs = 2000
  static reloadMs = 1000

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
  _replaceModal: Ref<AppModal>

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
    this._replaceModal = createRef()
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
    this.syncProgress = { stage: 'starting', message: t('drive-sync-starting-reset') }

    try {
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
        }, DriveSyncPanel.doneMs)
        return
      }
      // Local data changed underneath every page, so reload to show it
      this.syncProgress = { stage: 'success', message: '✓ Reset complete, reloading...' }
      setTimeout(() => this.reload(), DriveSyncPanel.reloadMs)
    } catch (error) {
      console.error('[DriveSyncPanel] Reset from Drive failed:', error)
      this.syncError = whatToSay(error, t('drive-sync-reset-failed'))
      this.syncProgress = {
        stage: 'error',
        message: failedWith(
          error,
          t('drive-sync-failed', { reason: errorMessage(error) }),
          t('drive-sync-failed-plain')
        ),
      }
      this.syncing = false
    }
  }

  /** Let go of the folder that is gone, and upload everything on this device to a new one */
  async _handleStartOver(): Promise<void> {
    if (this.syncing || !this.syncAvailable || this.disabled) return
    if (!(await this._startOverModal.value?.ask())) return

    this.syncing = true
    this.syncError = null
    this.syncProgress = { stage: 'starting', message: t('drive-sync-starting-over') }

    try {
      const { id, name } = this.space
      await new SyncOrchestrator(name, id).startOverInDrive(progress => {
        this.syncProgress = progress
        this.requestUpdate()
      })
      this._recordSyncTime()
      this.folderProblem = null
      this.syncProgress = { stage: 'success', message: '✓ Started over in Drive' }
      setTimeout(() => {
        this.syncing = false
        this.syncProgress = null
      }, DriveSyncPanel.doneMs)
    } catch (error) {
      console.error('[DriveSyncPanel] Starting over in Drive failed:', error)
      this.syncing = false
      this.syncError = whatToSay(error, t('drive-sync-start-over-failed'))
      this.syncProgress = {
        stage: 'error',
        message: failedWith(
          error,
          t('drive-sync-failed', { reason: errorMessage(error) }),
          t('drive-sync-failed-plain')
        ),
      }
    }
  }

  /** Replace what is on this device with the copy in the Drive folder of this space's name that this app can see */
  async _handleReplaceFromFolder(): Promise<void> {
    if (this.syncing || !this.syncAvailable || this.disabled) return
    if (!(await this._replaceModal.value?.ask())) return

    this.syncing = true
    this.syncError = null
    this.syncProgress = { stage: 'starting', message: t('drive-sync-replacing') }

    try {
      const { id, name } = this.space
      await new SyncOrchestrator(name, id).resetFromFolderByName(progress => {
        this.syncProgress = progress
        this.requestUpdate()
      })
      this._recordSyncTime()
      this.folderProblem = null
      // Local data changed underneath every page, so reload to show it
      this.syncProgress = { stage: 'success', message: '✓ Replaced from Drive, reloading...' }
      setTimeout(() => this.reload(), DriveSyncPanel.reloadMs)
    } catch (error) {
      console.error('[DriveSyncPanel] Replacing from a Drive folder failed:', error)
      this.syncing = false
      this.syncError = whatToSay(error, t('drive-sync-replace-failed'))
      this.syncProgress = {
        stage: 'error',
        message: failedWith(
          error,
          t('drive-sync-failed', { reason: errorMessage(error) }),
          t('drive-sync-failed-plain')
        ),
      }
    }
  }

  override render() {
    if (!this.syncAvailable || this.disabled) {
      return html`
        <div class="sync-panel disabled">
          <div class="unavailable-notice">
            <strong>${t('drive-sync-unavailable')}</strong>
            <p style="margin: 0.5rem 0 0 0;">
              ${rich('drive-sync-unavailable-text', undefined, {
                connect: words => html`<a href="/account">${words}</a>`,
              })}
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

        <button class="btn" ?disabled=${this.syncing} @click=${this._handleReset}>
          ${t('drive-sync-reset')}
        </button>
        <app-modal
          ${ref(this._resetModal)}
          type="confirm"
          size="small"
          heading=${t('confirm-drive-reset-heading')}
          confirm-label=${t('confirm-drive-reset-button')}
          message=${t('confirm-drive-reset-message')}
        ></app-modal>

        ${
          this.lastSyncTime
            ? html`
              <div class="last-sync">${t('drive-sync-last', { when: this._formatSyncTime(this.lastSyncTime) })}</div>
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
          <span class="status-text">${t('drive-sync-folder-missing')}</span>
        </div>
        <div class="error-message">${this.folderProblem}</div>
        <button class="btn" ?disabled=${this.syncing} @click=${this._handleStartOver}>
          ${t('drive-sync-start-over')}
        </button>
        <app-modal
          ${ref(this._startOverModal)}
          type="confirm"
          size="small"
          heading=${t('confirm-drive-start-over-heading')}
          confirm-label=${t('confirm-drive-start-over-button')}
          message=${t('confirm-drive-start-over-message')}
        ></app-modal>
        <button class="btn" ?disabled=${this.syncing} @click=${this._handleReplaceFromFolder}>
          ${t('drive-sync-replace')}
        </button>
        <app-modal
          ${ref(this._replaceModal)}
          type="confirm"
          size="small"
          heading=${t('confirm-drive-replace-heading')}
          confirm-label=${t('confirm-drive-replace-button')}
          message=${t('confirm-drive-replace-message')}
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
            <span class="status-text">${t('drive-sync-ready')}</span>
          </div>
        </div>
      `
    }

    if (this.syncError) {
      return html`
        <div class="sync-status error">
          <div class="status-row">
            <span class="status-icon">❌</span>
            <span class="status-text">${t('drive-sync-failed-status')}</span>
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
    return html`<progress-bar
      label=${t('drive-sync-progress-label')}
      .current=${current}
      .total=${total}
    ></progress-bar>`
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
