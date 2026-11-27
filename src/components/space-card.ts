import { css, html, LitElement, nothing } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import type { SignInState } from '../js/google-auth.ts'
import { formatSyncTime, lastSyncOf, recordSync } from '../js/last-sync.ts'
import { trashMovedSpaceDriveFiles } from '../js/space-deletion.ts'
import { spaceKind, spaceRole } from '../js/space-label.ts'
import { ServerHasDataError } from '../js/space-move.ts'
import { type SpaceSummary, summaryOf } from '../js/space-summary.ts'
import { syncSpaceAfterAdoptionAnswer, syncSpaceNow } from '../js/space-sync.ts'
import { isTeamMember } from '../js/storage/space-storage.ts'
import { AdoptFolderError } from '../js/sync-manager.ts'
import { t } from '../js/text.ts'
import { formatBytes } from '../js/utils/bytes.ts'
import { errorMessage, failedWith } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, spinnerStyles } from './shared-styles.ts'

/** A space was synced from its card: the page may want to read its list again (a space can be renamed by it) */
export class SpaceSyncedEvent extends Event {
  static readonly type = 'space-card:synced'
  constructor() {
    super(SpaceSyncedEvent.type, { bubbles: true, composed: true })
  }
}

/** A person asked to make this space the default (docs/SPACES.md, "Presenting spaces"): the page keeps it */
export class SpaceDefaultEvent extends Event {
  static readonly type = 'space-card:default'
  readonly spaceId: string
  constructor(spaceId: string) {
    super(SpaceDefaultEvent.type, { bubbles: true, composed: true })
    this.spaceId = spaceId
  }
}

/** A person asked to connect (or reconnect) Google Drive, to sync a Personal space between their devices: the page does it */
export class SpaceConnectDriveEvent extends Event {
  static readonly type = 'space-card:connect-drive'
  constructor() {
    super(SpaceConnectDriveEvent.type, { bubbles: true, composed: true })
  }
}

/** A person asked to disconnect Google Drive from the account, for every device: the page asks first, and does it */
export class SpaceDisconnectDriveEvent extends Event {
  static readonly type = 'space-card:disconnect-drive'
  constructor() {
    super(SpaceDisconnectDriveEvent.type, { bubbles: true, composed: true })
  }
}

/** A person asked for this space's data (export, import, reset, delete): the page shows it in a dialogue */
export class SpaceDataEvent extends Event {
  static readonly type = 'space-card:data'
  readonly spaceId: string
  constructor(spaceId: string) {
    super(SpaceDataEvent.type, { bubbles: true, composed: true })
    this.spaceId = spaceId
  }
}

/** A person asked to manage this space's users: the page goes to the space's own page */
export class SpaceManageEvent extends Event {
  static readonly type = 'space-card:manage'
  readonly spaceId: string
  constructor(spaceId: string) {
    super(SpaceManageEvent.type, { bubbles: true, composed: true })
    this.spaceId = spaceId
  }
}

/**
 * One space on the Account and Teams page (docs/ACCOUNT.md): its name, with what kind it is (and
 * the person's role in a Team) as labels on the right, how big it is, when it last synced, and the
 * things done most: switch to it, sync it. Its data (export and import, resetting from Drive, delete)
 * is under "Manage", which opens the space's own page (space-page.ts).
 */
export class SpaceCard extends LitElement {
  static override properties = {
    space: { attribute: false },
    isDefault: { type: Boolean },
    several: { type: Boolean },
    signIn: { attribute: false },
    driveEmail: { attribute: false },
    _summary: { state: true },
    _syncing: { state: true },
    _progress: { state: true },
    _error: { state: true },
    _syncedAt: { state: true },
  }

  declare space: Space
  /** Whether this is the space in use */
  /** Whether this is the default space, which is the first tab and where imports from outside go */
  declare isDefault: boolean
  /** Whether the device has more than one space: with one there is no default to choose */
  declare several: boolean
  /** How the person is signed in, or null while that is not known yet */
  declare signIn: SignInState | null
  /** The Google account the account's Drive is connected as, when it is (a Personal space syncs through it) */
  declare driveEmail: string | null
  declare _summary: SpaceSummary | null
  declare _syncing: boolean
  declare _progress: string
  declare _error: string
  declare _syncedAt: string | null

  static override styles = [
    buttonStyles,
    spinnerStyles,
    css`
      :host {
        display: block;
      }
      .card {
        border: 1px solid var(--panel-border, var(--tint, #ccc));
        background: var(--panel-bg, #f5f6f7);
        border-radius: 8px;
        padding: 1rem 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        color: var(--text-color, #1a1a1a);
      }
      .head {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .title { font-weight: 600; font-size: var(--font-ui); overflow-wrap: anywhere; }
      .chip {
        font-size: var(--font-ui-small);
        padding: 0.1rem 0.6rem;
        border: 1px solid var(--panel-border, var(--tint, #ccc));
        border-radius: 999px;
        opacity: 0.85;
      }
      .line { font-size: var(--font-ui-small); opacity: 0.8; margin: 0; }
      .line.error { color: var(--color-danger, #e74c3c); opacity: 1; }
      .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.25rem; }
    `,
  ]

  constructor() {
    super()
    this.signIn = null
    this.driveEmail = null
    this._summary = null
    this._syncing = false
    this._progress = ''
    this._error = ''
    this._syncedAt = null
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('space')) {
      this._syncedAt = lastSyncOf(this.space.id)
      void this._loadSummary()
    }
  }

  async _loadSummary(): Promise<void> {
    const id = this.space.id
    const summary = await summaryOf(id)
    if (id === this.space.id) this._summary = summary
  }

  /** A Personal space syncs through the account's Google Drive; a Team's through the Worker */
  get _isPersonal(): boolean {
    return !this.space.team
  }

  /** Whether syncing can be done now: a team's member needs only a sign-in, everyone else Drive too */
  get _canSync(): boolean {
    if (this.space.server) return this.signIn === 'signed-in' || this.signIn === 'no-drive'
    if (this.signIn === 'signed-in') return true
    return this.signIn === 'no-drive' && isTeamMember(this.space)
  }

  _adoptModal = createRef<AppModal>()
  _confirmModal = createRef<AppModal>()

  /** Move the space to the server (a test gives its own: the real one is of the device and the Worker) */
  /* v8 ignore next 7 -- the real move needs the Worker and a session: its parts are tested in space-move.test.ts */
  moveSpace: (
    spaceId: string,
    combine?: boolean,
    progress?: (sent: number, total: number) => void
  ) => Promise<void> = async (spaceId, combine, progress) =>
    (await import('../js/space-data-runtime.ts')).moveSpaceToServerNow(spaceId, combine, progress)

  /** Put the Drive files a moved space left in the Drive bin (a test gives its own) */
  trashDriveFiles: (space: Space) => Promise<void> = trashMovedSpaceDriveFiles

  /** Ask the person to confirm something that cannot be undone; true if they do */
  async _confirm(heading: string, message: string, confirmLabel: string): Promise<boolean> {
    const modal = this._confirmModal.value as AppModal
    modal.heading = heading
    modal.message = message
    modal.confirmLabel = confirmLabel
    await this.updateComplete
    await modal.updateComplete
    return modal.ask()
  }

  /** A Personal space still on Drive, for someone signed in to Chordless: it can move to the server, for good */
  get _canMove(): boolean {
    return (
      this._isPersonal &&
      !this.space.server &&
      (this.signIn === 'signed-in' || this.signIn === 'no-drive')
    )
  }

  /** A moved space whose old Drive files are still there, for someone who can reach Drive: they can be deleted */
  get _canDeleteDriveFiles(): boolean {
    return Boolean(this.space.server && this.space.rootRef && this.signIn === 'signed-in')
  }

  /** What a move says as songs are sent: how many of how many */
  _moveProgress = (sent: number, total: number): void => {
    this._progress = total ? t('space-move-progress', { sent, total }) : t('space-move-starting')
  }

  async _move(): Promise<void> {
    if (this._syncing) return
    const { id, name } = this.space
    if (
      !(await this._confirm(
        t('space-move-heading', { name }),
        t('space-move-message'),
        t('action-move-to-server')
      ))
    )
      return
    this._syncing = true
    this._error = ''
    this._progress = t('space-move-starting')
    try {
      try {
        await this.moveSpace(id, false, this._moveProgress)
      } catch (error) {
        // the account has data of its own: nothing was changed, so ask whether to combine the two
        if (!(error instanceof ServerHasDataError)) throw error
        if (
          !(await this._confirm(
            t('space-combine-heading', { name }),
            t('space-combine-message'),
            t('action-combine-with-server')
          ))
        )
          return
        await this.moveSpace(id, true, this._moveProgress)
      }
      this._syncedAt = recordSync(id)
      this.dispatchEvent(new SpaceSyncedEvent())
      void this._loadSummary()
    } catch (error) {
      console.error('[SpaceCard] Move failed:', error)
      this._error = failedWith(
        error,
        t('space-move-failed', { reason: errorMessage(error) }),
        t('space-move-failed-plain')
      )
    } finally {
      this._syncing = false
      this._progress = ''
    }
  }

  async _deleteDriveFiles(): Promise<void> {
    if (this._syncing) return
    const { name } = this.space
    if (
      !(await this._confirm(
        t('space-drive-delete-heading', { name }),
        t('space-drive-delete-message'),
        t('space-drive-delete-confirm')
      ))
    )
      return
    this._error = ''
    try {
      await this.trashDriveFiles(this.space)
      this.dispatchEvent(new SpaceSyncedEvent())
    } catch (error) {
      console.error('[SpaceCard] Could not delete the Drive files:', error)
      this._error = failedWith(
        error,
        t('space-drive-delete-failed', { reason: errorMessage(error) }),
        t('space-drive-delete-failed-plain')
      )
    }
  }

  /** Ask whether the folder an AdoptFolderError names should be used; true to use it */
  async _askToAdopt(folder: { name: string }): Promise<boolean> {
    const modal = this._adoptModal.value as AppModal
    modal.heading = t('adopt-folder-heading')
    modal.message = t('adopt-folder-message', { name: folder.name })
    modal.confirmLabel = t('adopt-folder-use', { name: folder.name })
    modal.cancelLabel = t('adopt-folder-new')
    await this.updateComplete
    await modal.updateComplete
    return modal.ask()
  }

  async _sync(): Promise<void> {
    if (this._syncing) return
    this._syncing = true
    this._error = ''
    this._progress = t('space-sync-starting')
    const onProgress = (progress: { message: string }) => {
      this._progress = progress.message
    }
    try {
      try {
        this._syncedAt = await syncSpaceNow(this.space, onProgress)
      } catch (error) {
        if (!(error instanceof AdoptFolderError)) throw error
        const use = await this._askToAdopt(error.folder)
        this._syncedAt = await syncSpaceAfterAdoptionAnswer(
          this.space,
          use ? error.folder.ref : null,
          onProgress
        )
      }
      this.dispatchEvent(new SpaceSyncedEvent())
      void this._loadSummary()
    } catch (error) {
      console.error('[SpaceCard] Sync failed:', error)
      this._error = failedWith(
        error,
        t('space-sync-failed', { reason: errorMessage(error) }),
        t('space-sync-failed-plain')
      )
    } finally {
      this._syncing = false
      this._progress = ''
    }
  }

  /** The line about syncing: when it last did, or what stands in the way */
  _syncLine(): string {
    switch (this.signIn) {
      case null:
        return ''
      case 'signed-out':
        return t('space-sync-sign-in')
      case 'expired':
        return t(
          this._isPersonal && !this.space.server
            ? 'space-drive-reconnect'
            : 'account-status-expired'
        )
      case 'no-drive':
        if (this._isPersonal && !this.space.server) return t('space-drive-off')
        break
    }
    return this._syncedAt
      ? t('space-synced', { when: formatSyncTime(this._syncedAt) })
      : t('space-not-synced')
  }

  override render() {
    const space = this.space
    const kind = spaceKind(space)
    const role = spaceRole(space)
    const summary = this._summary
    return html`
      <div class="card">
        <div class="head">
          <span class="title">${space.name}</span>
          ${kind ? html`<span class="chip">${kind}</span>` : nothing}
          ${role ? html`<span class="chip">${role}</span>` : nothing}
          ${this.several && this.isDefault ? html`<span class="chip default">${t('space-default')}</span>` : nothing}
        </div>
        <p class="line">
          ${
            summary
              ? t('space-summary', {
                  songs: summary.songs,
                  setlists: summary.setlists,
                  size: formatBytes(summary.bytes),
                })
              : '…'
          }
        </p>
        ${space.ccliLicence ? html`<p class="line">${t('space-ccli', { licence: space.ccliLicence })}</p>` : nothing}
        <p class="line ${this._error ? 'error' : ''}" role=${this._error ? 'alert' : nothing}>
          ${
            this._syncing
              ? html`<span class="spinner"></span> ${this._progress}`
              : this._error || this._syncLine()
          }
        </p>
        ${
          this._isPersonal && this.space.server && this.signIn !== 'signed-out'
            ? html`<p class="line" id="server-line">${t('space-server-on')}</p>`
            : nothing
        }
        ${
          this._isPersonal && !this.space.server && this.signIn === 'signed-in' && this.driveEmail
            ? html`<p class="line" id="drive-line">${t('space-drive-on', { email: this.driveEmail })}</p>`
            : nothing
        }
        ${
          this._canDeleteDriveFiles
            ? html`<p class="line" id="drive-left-line">${t('space-drive-left')}</p>`
            : nothing
        }
        <div class="actions">
          ${
            this._canSync
              ? html`<button class="btn primary" id="sync" ?disabled=${this._syncing} @click=${this._sync}>
                ${t('action-sync')}
              </button>`
              : nothing
          }
          ${
            this._canMove
              ? html`<button class="btn" id="move-to-server" ?disabled=${this._syncing} @click=${this._move}>
                  ${t('action-move-to-server')}
                </button>`
              : nothing
          }
          ${
            this._canDeleteDriveFiles
              ? html`<button class="btn" id="delete-drive-files" ?disabled=${this._syncing} @click=${this._deleteDriveFiles}>
                  ${t('action-delete-drive-files')}
                </button>`
              : nothing
          }
          ${
            this._isPersonal && !this.space.server && this.signIn === 'no-drive'
              ? html`<button class="btn primary" id="connect-drive" @click=${() => this.dispatchEvent(new SpaceConnectDriveEvent())}>
                  ${t('action-connect-drive')}
                </button>`
              : nothing
          }
          ${
            this._isPersonal && !this.space.server && this.signIn === 'expired'
              ? html`<button class="btn primary" id="reconnect-drive" @click=${() => this.dispatchEvent(new SpaceConnectDriveEvent())}>
                  ${t('action-reconnect-drive')}
                </button>`
              : nothing
          }
          <button class="btn" id="manage" @click=${() => this.dispatchEvent(new SpaceManageEvent(space.id))}>
            ${t('action-manage-users')}
          </button>
          <button class="btn" id="manage-data" @click=${() => this.dispatchEvent(new SpaceDataEvent(space.id))}>
            ${t('action-manage-data')}
          </button>
          ${
            this.several && !this.isDefault
              ? html`<button class="btn" id="make-default" @click=${() => this.dispatchEvent(new SpaceDefaultEvent(space.id))}>
                ${t('action-make-default')}
              </button>`
              : nothing
          }
          ${
            this._isPersonal && !this.space.server && this.signIn === 'signed-in'
              ? html`<button class="btn" id="disconnect-drive" @click=${() => this.dispatchEvent(new SpaceDisconnectDriveEvent())}>
                  ${t('action-disconnect-drive')}
                </button>`
              : nothing
          }
        </div>
      </div>
      <app-modal ${ref(this._adoptModal)} type="confirm" size="small"></app-modal>
      <app-modal ${ref(this._confirmModal)} type="confirm" size="small"></app-modal>
    `
  }
}
customElements.define('space-card', SpaceCard)

declare global {
  interface HTMLElementTagNameMap {
    'space-card': SpaceCard
  }
}
