import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space } from '../js/data-types.ts'
import type { SignInState } from '../js/google-auth.ts'
import { forgetSync } from '../js/last-sync.ts'
import { loadMediaSettings } from '../js/media-settings.ts'
import { goTo } from '../js/navigation.ts'
import { deleteSpace, getCurrentSpace, getSpaceById, switchSpace } from '../js/space.ts'
import { spaceRole, spaceTitle } from '../js/space-label.ts'
import { type SpaceSummary, summaryOf } from '../js/space-summary.ts'
import { isTeamMember } from '../js/storage/space-storage.ts'
import { formatBytes } from '../js/utils/bytes.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './drive-sync-panel.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'
import './space-export-panel.ts'
import './team-share-panel.ts'

/**
 * One Personal space or Team, and everything to do with it (docs/ACCOUNT.md): sync, export and
 * import, its people (a Team), and deleting it from this device. It works on any space on this
 * device, not only the one in use; switching to it is a button, not a step.
 */
export class SpacePage extends LitElement {
  static override properties = {
    spaceId: { type: String },
    _space: { state: true },
    _summary: { state: true },
    _signIn: { state: true },
    _missing: { state: true },
    _error: { state: true },
  }

  /** The space to show (from the address) */
  declare spaceId: string
  declare _space: Space | null
  declare _summary: SpaceSummary | null
  declare _signIn: SignInState | null
  declare _missing: boolean
  declare _error: string

  /** Starts the app afresh in the space switched to (a test gives its own) */
  /* v8 ignore next 3 -- reloading the page would end the test run: tests give their own */
  // biome-ignore lint/plugin: the database is another space's now, so start afresh
  reload: () => void = () => window.location.reload()

  _deleteModal: Ref<AppModal> = createRef()
  _switchModal: Ref<AppModal> = createRef()

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
      :host {
        display: block;
      }
      .content {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-width: 800px;
        margin: 0 auto;
      }
      .back { align-self: flex-start; font-size: var(--font-ui-small); }
      .head { display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; }
      h2 { font-size: var(--font-ui); margin: 0; overflow-wrap: anywhere; }
      .role, .meta { font-size: var(--font-ui-small); opacity: 0.75; }
      .badge { font-weight: 600; color: var(--color-primary, #2477ad); font-size: var(--font-ui-small); }
      .danger-zone {
        border-color: color-mix(in srgb, var(--color-danger, #e74c3c) 40%, transparent);
      }
      .error { color: var(--color-danger, #e74c3c); }
      .hint { font-size: var(--font-ui-small); opacity: 0.75; }
    `,
  ]

  constructor() {
    super()
    this.spaceId = ''
    this._space = null
    this._summary = null
    this._signIn = null
    this._missing = false
    this._error = ''
  }

  override connectedCallback(): void {
    super.connectedCallback()
    void this._load()
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('spaceId') && changed.get('spaceId') !== undefined) void this._load()
  }

  async _load(): Promise<void> {
    const { getSignInState } = await import('../js/google-auth.ts')
    this._signIn = await getSignInState()
    const space = await getSpaceById(this.spaceId)
    this._missing = !space
    this._space = space ?? null
    this._summary = space ? await summaryOf(space.id) : null
  }

  get _current(): boolean {
    return this._space?.id === getCurrentSpace().id
  }

  /** Whether syncing can be done now: a team's member needs only a sign-in, everyone else Drive too */
  get _canSync(): boolean {
    if (this._signIn === 'signed-in') return true
    return this._signIn === 'no-drive' && isTeamMember(this._space)
  }

  get _signedInWithDrive(): boolean {
    return this._signIn === 'signed-in'
  }

  async _switch(): Promise<void> {
    const space = this._space as Space
    const modal = this._switchModal.value as AppModal
    modal.message = `Switch to "${spaceTitle(space)}"? This reloads the page.`
    if (await modal.ask()) await switchSpace(space.id, this.reload)
  }

  async _delete(): Promise<void> {
    const space = this._space as Space
    const modal = this._deleteModal.value as AppModal
    modal.message =
      `Delete "${spaceTitle(space)}" from this device? Its songs and setlists here are deleted, and ` +
      'anything not yet synced to Google Drive is lost. Its folder in Google Drive is not touched.' +
      (isTeamMember(space)
        ? ' You stay in the Team: to get it back on this device, ask for a new invite link.'
        : '') +
      " This can't be undone."
    if (!(await modal.ask())) return
    this._error = ''
    try {
      await deleteSpace(space.id)
      forgetSync(space.id)
      goTo('/account')
    } catch (error) {
      console.error('[SpacePage] Failed to delete the space:', error)
      this._error = errorMessage(error)
    }
  }

  /** Read the space and what it holds again (it changed under the page: an import, or sharing ended) */
  _refresh(): Promise<void> {
    return this._load()
  }

  override render() {
    if (this._missing) {
      return html`<div class="content">
        <a class="back" href="/account">← Account and Teams</a>
        <div class="panel"><p>This device has no such Personal space or Team. It may have been deleted.</p></div>
      </div>`
    }
    const space = this._space
    if (!space) return html`<div class="content"><p class="hint">Loading…</p></div>`
    const role = spaceRole(space)
    const summary = this._summary
    return html`
      <div class="content">
        <a class="back" href="/account">← Account and Teams</a>
        <div class="head">
          <h2>${spaceTitle(space)}</h2>
          ${role ? html`<span class="role">${role}</span>` : nothing}
          ${
            this._current
              ? html`<span class="badge">Current</span>`
              : html`<button class="btn" id="switch" @click=${this._switch}>Switch</button>`
          }
        </div>
        ${
          summary
            ? html`<p class="meta">
              ${summary.songs} song${summary.songs === 1 ? '' : 's'} ·
              ${summary.setlists} setlist${summary.setlists === 1 ? '' : 's'} · about
              ${formatBytes(summary.bytes)}
            </p>`
            : nothing
        }

        <div class="panel">
          <h3>${isTeamMember(space) ? 'Team sync' : 'Sync'}</h3>
          <p>
            ${
              isTeamMember(space)
                ? "Sync this Team's songs and setlists with the rest of the Team."
                : space.team
                  ? "Sync this Team's songs and setlists with Google Drive, where the Team gets them."
                  : 'Sync your songs and setlists with Google Drive. Your data is kept in the "Chordless" folder.'
            }
          </p>
          <drive-sync-panel .space=${space} ?disabled=${!this._canSync}></drive-sync-panel>
          ${this._canSync ? nothing : html`<p class="hint">Sign in on the Account and Teams page to sync.</p>`}
        </div>

        <div class="panel">
          <h3>Export and import</h3>
          <p>
            Export this ${space.team ? 'Team' : 'space'}'s songs and setlists as a zip file, and import an export into
            it, on this device or another: it needs no Google account, and an import only adds what
            is missing.
          </p>
          <space-export-panel
            .space=${space}
            ?show-pads=${loadMediaSettings().mediaPlayerEnabled}
            ?signed-in=${this._signedInWithDrive}
            @space-export-panel:imported=${this._refresh}
          ></space-export-panel>
        </div>

        ${
          space.team
            ? html`<team-share-panel
              .space=${space}
              @team-share-panel:changed=${this._refresh}
              @team-share-panel:left=${() => goTo('/account')}
            ></team-share-panel>`
            : nothing
        }

        <div class="panel danger-zone">
          <h3>Delete from this device</h3>
          <p>
            Remove this ${space.team ? 'Team' : 'space'} and its songs and setlists from this device.
            ${this._current ? 'To delete the one you are working in, switch to another first.' : ''}
          </p>
          <button class="btn danger" id="delete" ?disabled=${this._current} @click=${this._delete}>
            Delete…
          </button>
          ${this._error ? html`<p class="error" role="alert">Failed to delete it: ${this._error}</p>` : nothing}
        </div>
      </div>
      <app-modal
        ${ref(this._deleteModal)}
        type="confirm"
        heading="Delete from this device?"
        confirm-label="Delete"
      ></app-modal>
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
customElements.define('space-page', SpacePage)

declare global {
  interface HTMLElementTagNameMap {
    'space-page': SpacePage
  }
}
