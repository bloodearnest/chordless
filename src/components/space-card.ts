import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import type { SignInState } from '../js/google-auth.ts'
import { formatSyncTime, lastSyncOf } from '../js/last-sync.ts'
import { spaceKind, spaceRole } from '../js/space-label.ts'
import { type SpaceSummary, summaryOf } from '../js/space-summary.ts'
import { syncSpaceNow } from '../js/space-sync.ts'
import { isTeamMember } from '../js/storage/space-storage.ts'
import { formatBytes } from '../js/utils/bytes.ts'
import { errorMessage } from '../js/utils/errors.ts'
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

/** A person asked to switch to this space (and has said yes): the page does it */
export class SpaceSwitchEvent extends Event {
  static readonly type = 'space-card:switch'
  readonly spaceId: string
  constructor(spaceId: string) {
    super(SpaceSwitchEvent.type, { bubbles: true, composed: true })
    this.spaceId = spaceId
  }
}

/** A person asked to manage this space: the page shows everything to do with it in a modal */
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
 * things done most: switch to it, sync it. Everything else is under "Manage", which asks the page
 * to show it in a modal.
 */
export class SpaceCard extends LitElement {
  static override properties = {
    space: { attribute: false },
    current: { type: Boolean },
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
  /** How the person is signed in, or null while that is not known yet */
  declare signIn: SignInState | null
  declare _summary: SpaceSummary | null
  declare _syncing: boolean
  declare _progress: string
  declare _error: string
  declare _syncedAt: string | null

  _switchModal: Ref<AppModal> = createRef()

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
      .labels { margin-left: auto; display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
      .chip {
        font-size: var(--font-ui-small);
        padding: 0.1rem 0.6rem;
        border: 1px solid var(--panel-border, var(--tint, #ccc));
        border-radius: 999px;
        opacity: 0.85;
      }
      .badge {
        font-size: var(--font-ui-small);
        font-weight: 600;
        color: var(--color-primary, #2477ad);
      }
      .line { font-size: var(--font-ui-small); opacity: 0.8; margin: 0; }
      .line.error { color: var(--color-danger, #e74c3c); opacity: 1; }
      .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.25rem; }
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
    this._progress = 'Starting…'
    try {
      this._syncedAt = await syncSpaceNow(this.space, progress => {
        this._progress = progress.message
      })
      this.dispatchEvent(new SpaceSyncedEvent())
      void this._loadSummary()
    } catch (error) {
      console.error('[SpaceCard] Sync failed:', error)
      this._error = `Sync failed: ${errorMessage(error)}`
    } finally {
      this._syncing = false
      this._progress = ''
    }
  }

  async _switch(): Promise<void> {
    const modal = this._switchModal.value as AppModal
    modal.message = `Switch to "${this.space.name}"? This reloads the page.`
    if (await modal.ask()) this.dispatchEvent(new SpaceSwitchEvent(this.space.id))
  }

  /** The line about syncing: when it last did, or what stands in the way */
  _syncLine(): string {
    switch (this.signIn) {
      case null:
        return ''
      case 'signed-out':
        return 'Sign in to sync'
      case 'expired':
        return 'Sign-in expired: reconnect to sync'
      case 'no-drive':
        if (!isTeamMember(this.space)) return 'Connect Google Drive to sync'
        break
    }
    return this._syncedAt ? `Synced ${formatSyncTime(this._syncedAt)}` : 'Not synced yet'
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
          <span class="labels">
            ${kind ? html`<span class="chip">${kind}</span>` : nothing}
            ${role ? html`<span class="chip">${role}</span>` : nothing}
            ${this.current ? html`<span class="badge">Current</span>` : nothing}
          </span>
        </div>
        <p class="line">
          ${
            summary
              ? `${summary.songs} song${summary.songs === 1 ? '' : 's'} · ${summary.setlists} setlist${summary.setlists === 1 ? '' : 's'} · about ${formatBytes(summary.bytes)}`
              : '…'
          }
        </p>
        <p class="line ${this._error ? 'error' : ''}" role=${this._error ? 'alert' : nothing}>
          ${
            this._syncing
              ? html`<span class="spinner"></span> ${this._progress}`
              : this._error || this._syncLine()
          }
        </p>
        <div class="actions">
          ${
            this.current
              ? nothing
              : html`<button class="btn" id="switch" @click=${this._switch}>Switch</button>`
          }
          ${
            this._canSync
              ? html`<button class="btn primary" id="sync" ?disabled=${this._syncing} @click=${this._sync}>
                Sync
              </button>`
              : nothing
          }
          <button class="btn" id="manage" @click=${() => this.dispatchEvent(new SpaceManageEvent(space.id))}>
            Manage
          </button>
        </div>
      </div>
      <app-modal
        ${ref(this._switchModal)}
        type="confirm"
        size="small"
        heading="Switch?"
        confirm-label="Switch"
      ></app-modal>
    `
  }
}
customElements.define('space-card', SpaceCard)

declare global {
  interface HTMLElementTagNameMap {
    'space-card': SpaceCard
  }
}
