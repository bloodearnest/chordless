import { css, html, LitElement, nothing } from 'lit'
import type { Space } from '../js/data-types.ts'
import { type TeamCredential, teamApi } from '../js/team-client.ts'
import { returnToOwnSignIn } from '../js/team-spaces.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'

/**
 * Team-managed storage, for a Team's owner (docs/SPACES.md, "Credentials: two ways to back a team
 * space"). A Team reaches its files with its owner's Google sign-in, so it stops syncing if they
 * leave or their sign-in stops working. If the Team's folder is in a Google shared drive, it can
 * use Chordless's own account instead: the owner adds its address to the shared drive as a Content
 * manager, and "Check and switch" has the Worker try it before it is used (and the owner's sign-in
 * is forgotten). They can go back to their own sign-in at any time.
 *
 * It shows nothing to anyone but the owner, nor where the server has no team storage.
 */
export class TeamStoragePanel extends LitElement {
  static override properties = {
    space: { attribute: false },
    _credential: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _copied: { state: true },
  }

  /** The current space */
  declare space: Space | null
  /** How the Worker reaches the folder, once asked */
  declare _credential: TeamCredential | null
  declare _busy: boolean
  declare _error: string
  declare _copied: boolean

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
      :host { display: block; }
      .address { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin: 0.5rem 0 1rem; }
      .address code { overflow-wrap: anywhere; padding: 0.35rem 0.5rem; border-radius: 6px; background: color-mix(in srgb, currentColor 8%, transparent); }
      .error { color: var(--color-danger, #e74c3c); font-weight: 600; }
      .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1rem; }
    `,
  ]

  constructor() {
    super()
    this.space = null
    this._credential = null
    this._busy = false
    this._error = ''
    this._copied = false
  }

  /** The Team's id, if this person owns it */
  get _ownedTeam(): string | null {
    const team = this.space?.team
    return team?.role === 'owner' ? team.id : null
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('space')) return
    const previous = changed.get('space') as Space | null | undefined
    if (previous?.team?.id === this.space?.team?.id) return
    this._credential = null
    this._error = ''
    if (this._ownedTeam) void this._load()
  }

  async _load(): Promise<void> {
    try {
      this._credential = await teamApi.credential(this._ownedTeam as string)
    } catch (error) {
      this._error = errorMessage(error)
    }
  }

  async _switch(): Promise<void> {
    await this._run(async team => {
      this._credential = await teamApi.useTeamStorage(team)
    })
  }

  async _goBack(): Promise<void> {
    await this._run(async team => {
      await returnToOwnSignIn(team)
      this._credential = { ...(this._credential as TeamCredential), kind: 'owner' }
    })
  }

  async _run(work: (team: string) => Promise<void>): Promise<void> {
    this._busy = true
    this._error = ''
    try {
      await work(this._ownedTeam as string)
    } catch (error) {
      this._error = errorMessage(error)
    } finally {
      this._busy = false
    }
  }

  async _copy(address: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(address)
      this._copied = true
    } catch {
      // (no clipboard here: the address is there to select)
      this._copied = false
    }
  }

  override render() {
    const credential = this._credential
    if (!this._ownedTeam || (!credential && !this._error)) return nothing
    if (credential && !credential.serviceAccount) return nothing
    return html`
      <div class="panel">
        <h3>Team storage</h3>
        ${credential ? this._renderCredential(credential, credential.serviceAccount as string) : nothing}
        ${this._error ? html`<p class="error" role="alert">✗ ${this._error}</p>` : nothing}
      </div>
    `
  }

  _renderCredential(credential: TeamCredential, address: string) {
    const addressBox = html`<div class="address">
      <code>${address}</code>
      <button class="btn" @click=${() => this._copy(address)}>${this._copied ? 'Copied' : 'Copy'}</button>
    </div>`
    if (credential.kind === 'service-account') {
      return html`
        <p>
          This Team reaches its files with Chordless’s own account, a Content manager of your shared
          drive, so it does not depend on your Google sign-in, which is not kept for it.
        </p>
        ${addressBox}
        <div class="actions">
          <button class="btn" ?disabled=${this._busy} @click=${this._goBack}>
            Use my Google sign-in instead
          </button>
        </div>
      `
    }
    return html`
      <p>
        This Team reaches its files with your Google sign-in, so its syncing stops if you leave or
        your sign-in stops working.
      </p>
      <p>
        If the Team’s folder is in a Google shared drive, Chordless can reach it with an account of
        its own instead. Add this address to the shared drive as a Content manager, then check it:
      </p>
      ${addressBox}
      <div class="actions">
        <button class="btn primary" ?disabled=${this._busy} @click=${this._switch}>
          ${this._busy ? 'Checking…' : 'Check and switch'}
        </button>
      </div>
    `
  }
}

customElements.define('team-storage-panel', TeamStoragePanel)

declare global {
  interface HTMLElementTagNameMap {
    'team-storage-panel': TeamStoragePanel
  }
}
