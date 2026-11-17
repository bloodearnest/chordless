import { css, html, LitElement, nothing } from 'lit'
import type { Space } from '../js/data-types.ts'
import type { SignInState } from '../js/google-auth.ts'
import { formatSyncTime, lastSyncOf } from '../js/last-sync.ts'
import { spaceKind, spaceRole } from '../js/space-label.ts'
import { type SpaceSummary, summaryOf } from '../js/space-summary.ts'
import { syncSpaceNow } from '../js/space-sync.ts'
import { isTeamMember } from '../js/storage/space-storage.ts'
import { t } from '../js/text.ts'
import { formatBytes } from '../js/utils/bytes.ts'
import { errorMessage } from '../js/utils/errors.ts'
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

/** A person asked to manage this space: the page goes to the space's own page */
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
    current: { type: Boolean },
    isDefault: { type: Boolean },
    several: { type: Boolean },
    signIn: { attribute: false },
    _summary: { state: true },
    _syncing: { state: true },
    _progress: { state: true },
    _error: { state: true },
    _syncedAt: { state: true },
  }

  declare space: Space
  /** Whether this is the space in use */
  declare current: boolean
  /** Whether this is the default space, which is the first tab and where imports from outside go */
  declare isDefault: boolean
  /** Whether the device has more than one space: with one there is no default to choose */
  declare several: boolean
  /** How the person is signed in, or null while that is not known yet */
  declare signIn: SignInState | null
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
      .card.current {
        border-color: var(--color-primary, #2477ad);
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
      .badge {
        margin-left: auto;
        font-size: var(--font-ui-small);
        font-weight: 600;
        color: var(--color-primary, #2477ad);
      }
      .line { font-size: var(--font-ui-small); opacity: 0.8; margin: 0; }
      .line.error { color: var(--color-danger, #e74c3c); opacity: 1; }
      .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.25rem; }
      .switch { margin-left: auto; }
    `,
  ]

  constructor() {
    super()
    this.current = false
    this.signIn = null
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

  /** Whether syncing can be done now: a team's member needs only a sign-in, everyone else Drive too */
  get _canSync(): boolean {
    if (this.signIn === 'signed-in') return true
    return this.signIn === 'no-drive' && isTeamMember(this.space)
  }

  async _sync(): Promise<void> {
    if (this._syncing) return
    this._syncing = true
    this._error = ''
    this._progress = t('space-sync-starting')
    try {
      this._syncedAt = await syncSpaceNow(this.space, progress => {
        this._progress = progress.message
      })
      this.dispatchEvent(new SpaceSyncedEvent())
      void this._loadSummary()
    } catch (error) {
      console.error('[SpaceCard] Sync failed:', error)
      this._error = t('space-sync-failed', { reason: errorMessage(error) })
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
        return t('account-status-expired')
      case 'no-drive':
        if (!isTeamMember(this.space)) return t('space-sync-connect-drive')
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
      <div class="card ${this.current ? 'current' : ''}">
        <div class="head">
          <span class="title">${space.name}</span>
          ${kind ? html`<span class="chip">${kind}</span>` : nothing}
          ${role ? html`<span class="chip">${role}</span>` : nothing}
          ${this.several && this.isDefault ? html`<span class="chip default">${t('space-default')}</span>` : nothing}
          ${this.current ? html`<span class="badge">${t('space-current')}</span>` : nothing}
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
        <div class="actions">
          ${
            this._canSync
              ? html`<button class="btn primary" id="sync" ?disabled=${this._syncing} @click=${this._sync}>
                ${t('action-sync')}
              </button>`
              : nothing
          }
          <button class="btn" id="manage" @click=${() => this.dispatchEvent(new SpaceManageEvent(space.id))}>
            ${t('action-manage')}
          </button>
          ${
            this.several && !this.isDefault
              ? html`<button class="btn" id="make-default" @click=${() => this.dispatchEvent(new SpaceDefaultEvent(space.id))}>
                ${t('action-make-default')}
              </button>`
              : nothing
          }
        </div>
      </div>
    `
  }
}
customElements.define('space-card', SpaceCard)

declare global {
  interface HTMLElementTagNameMap {
    'space-card': SpaceCard
  }
}
