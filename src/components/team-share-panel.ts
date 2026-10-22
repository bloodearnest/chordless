import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Space, SpaceMember, TeamLink, TeamRole } from '../js/data-types.ts'
import { type Invite, teamApi } from '../js/team-client.ts'
import {
  GRANTABLE_ROLES,
  inviteLink,
  leaveSpace,
  outranks,
  stopSharing,
} from '../js/team-spaces.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'

/** The space was shared or stopped being shared: the page should read it again */
export class TeamShareChangedEvent extends Event {
  static readonly type = 'team-share-panel:changed'
  constructor() {
    super(TeamShareChangedEvent.type, { bubbles: true, composed: true })
  }
}

/** The person left the space, and it is gone from this device: the app should start afresh */
export class TeamShareLeftEvent extends Event {
  static readonly type = 'team-share-panel:left'
  constructor() {
    super(TeamShareLeftEvent.type, { bubbles: true, composed: true })
  }
}

/**
 * Sharing the current space with a team, and looking after it (docs/SPACES.md, "Setting up and
 * joining a team space"). A space of this person's can be shared once it has synced to Google Drive;
 * the owner and admins then see the members and their roles and invite people by email (the invite
 * is a link to send them, shown once), and every member can see who is in the space and leave it.
 * What a role may do is the Worker's rule, and the controls shown follow it: a role acts only on
 * those below it.
 *
 * @fires TeamShareChangedEvent - sharing was stopped
 * @fires TeamShareLeftEvent - the person left the space, which is gone from this device
 */
export class TeamSharePanel extends LitElement {
  static override properties = {
    space: { attribute: false },
    _members: { state: true },
    _invites: { state: true },
    _error: { state: true },
    _busy: { state: true },
    _link: { state: true },
    _copied: { state: true },
  }

  /** The current space */
  declare space: Space | null
  declare _members: SpaceMember[]
  declare _invites: Invite[]
  declare _error: string
  declare _busy: boolean
  /** The invite just made: its link is shown once, to send */
  declare _link: { email: string; url: string } | null
  declare _copied: boolean

  _modal: Ref<AppModal> = createRef()
  _inviteEmail: Ref<HTMLInputElement> = createRef()
  _inviteRole: Ref<HTMLSelectElement> = createRef()

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
    :host { display: block; }
    h4 { font-size: var(--font-ui-small); margin: 1.25rem 0 0.5rem; }
    ul.people { list-style: none; margin: 0 0 1rem; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
    ul.people li { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .who { flex: 1; min-width: 12rem; overflow-wrap: anywhere; }
    .role { opacity: 0.7; }
    .invite-form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-bottom: 1rem; }
    .invite-form input[type='email'] { flex: 1; min-width: 12rem; font: inherit; padding: 0.35rem 0.5rem; }
    select { font: inherit; padding: 0.3rem 0.4rem; }
    .link-box { border: 2px solid var(--color-success, #27ae60); border-radius: 8px; padding: 0.75rem 1rem; margin: 0 0 1rem; }
    .link-box input { width: 100%; box-sizing: border-box; font: inherit; padding: 0.35rem 0.5rem; margin: 0.5rem 0; }
    .error { color: var(--color-danger, #e74c3c); font-weight: 600; }
    .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1rem; }
    `,
  ]

  constructor() {
    super()
    this.space = null
    this._members = []
    this._invites = []
    this._error = ''
    this._busy = false
    this._link = null
    this._copied = false
  }

  /** The space and its team link: the actions below are only offered when there are both */
  get _current(): Space {
    return this.space as Space
  }

  get _team(): TeamLink {
    return this._current.team as TeamLink
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('space')) return
    const previous = changed.get('space') as Space | null | undefined
    if (previous?.team?.id !== this.space?.team?.id) {
      this._members = []
      this._invites = []
      this._link = null
      if (this.space?.team) void this._load()
    }
  }

  /** Who is in the space, and (for an admin) who is invited */
  async _load(): Promise<void> {
    const team = this._team
    try {
      const [members, invites] = await Promise.all([
        teamApi.members(team.id),
        outranks(team.role, 'writer') ? teamApi.invites(team.id) : [],
      ])
      this._members = members
      this._invites = invites
    } catch (error) {
      this._error = errorMessage(error)
    }
  }

  /** Do something to the space, saying what went wrong, and read the people again after */
  async _run(work: () => Promise<void>, reload = true): Promise<void> {
    this._error = ''
    this._busy = true
    try {
      await work()
      if (reload) await this._load()
    } catch (error) {
      this._error = errorMessage(error)
    } finally {
      this._busy = false
    }
  }

  async _confirm(heading: string, message: string, confirmLabel: string): Promise<boolean> {
    const modal = this._modal.value as AppModal
    modal.heading = heading
    modal.message = message
    modal.confirmLabel = confirmLabel
    await this.updateComplete
    await modal.updateComplete
    return modal.ask()
  }

  async _stopSharing(): Promise<void> {
    const space = this._current
    const sure = await this._confirm(
      'Stop sharing this space?',
      'Everyone else loses access, and Chordless forgets the sign-in it kept for this space. The folder and its files stay in your Drive, and on every device that has them.',
      'Stop sharing'
    )
    if (!sure) return
    await this._run(async () => {
      await stopSharing(space.id)
      this.dispatchEvent(new TeamShareChangedEvent())
    }, false)
  }

  async _leave(): Promise<void> {
    const space = this._current
    const sure = await this._confirm(
      `Leave ${space.name}?`,
      'You lose access to the team space, and it is removed from this device. The team keeps its songs and setlists, and an admin can invite you again.',
      'Leave'
    )
    if (!sure) return
    await this._run(async () => {
      await leaveSpace(space.id)
      this.dispatchEvent(new TeamShareLeftEvent())
    }, false)
  }

  async _setRole(email: string, role: Invite['role']): Promise<void> {
    const team = this._team
    await this._run(() => teamApi.setRole(team.id, email, role))
  }

  async _remove(email: string): Promise<void> {
    const team = this._team
    const sure = await this._confirm(
      `Remove ${email}?`,
      'They lose access to this space. What is already on their device stays there, but it no longer syncs.',
      'Remove'
    )
    if (sure) await this._run(() => teamApi.removeMember(team.id, email))
  }

  async _invite(event: Event): Promise<void> {
    event.preventDefault()
    const team = this._team
    const email = this._inviteEmail.value as HTMLInputElement
    const role = this._inviteRole.value as HTMLSelectElement
    await this._run(async () => {
      const { code } = await teamApi.createInvite(
        team.id,
        role.value as Invite['role'],
        email.value
      )
      this._link = {
        email: email.value.trim().toLowerCase(),
        url: inviteLink(window.location.origin, team.id, code),
      }
      this._copied = false
      email.value = ''
    })
  }

  async _revoke(id: string): Promise<void> {
    const team = this._team
    await this._run(() => teamApi.revokeInvite(team.id, id))
  }

  async _copy(): Promise<void> {
    const url = (this._link as { url: string }).url
    try {
      await navigator.clipboard.writeText(url)
      this._copied = true
    } catch {
      // (no clipboard here: the link is selected, to copy by hand)
      this.renderRoot.querySelector<HTMLInputElement>('input.link')?.select()
    }
  }

  override render() {
    const space = this.space
    if (!space) return nothing
    return html`
      <div class="panel">
        <h3>🤝 Team Space</h3>
        ${space.team ? this._renderTeam(space.team.role) : this._renderOffer()}
        ${this._error ? html`<p class="error" role="alert">✗ ${this._error}</p>` : nothing}
      </div>
      <app-modal ${ref(this._modal)} type="confirm" size="small"></app-modal>
    `
  }

  _renderOffer() {
    return html`
      <p>
        A team space is shared with your team: they sync its songs and setlists with you and each
        other, each with a role you choose. It is a new space with a folder of its own in Google
        Drive, separate from this one, and you can bring songs across when you make it.
      </p>
      <div class="actions">
        <a class="btn primary" href="/spaces/new">🤝 Create a team space</a>
      </div>
    `
  }

  _renderTeam(mine: TeamRole) {
    const canInvite = outranks(mine, 'writer')
    return html`
      <p>You are ${mine === 'owner' ? 'the owner of' : `a${mine === 'admin' ? 'n' : ''} ${mine} in`} this team space.</p>
      <h4>People</h4>
      <ul class="people">${this._members.map(member => this._renderMember(member, mine))}</ul>
      ${canInvite ? this._renderInvites(mine) : nothing}
      <div class="actions">
        ${
          mine === 'owner'
            ? html`<button class="btn danger" ?disabled=${this._busy} @click=${this._stopSharing}>
              Stop sharing
            </button>`
            : html`<button class="btn danger" ?disabled=${this._busy} @click=${this._leave}>
              Leave this space
            </button>`
        }
      </div>
    `
  }

  _renderMember(member: SpaceMember, mine: TeamRole) {
    const role = member.role as TeamRole
    // (only admins and the owner look after people, and only those below them)
    const manageable = outranks(mine, 'writer') && outranks(mine, role)
    return html`<li>
      <span class="who">${member.email}</span>
      ${
        manageable
          ? html`
            <select
              aria-label="Role of ${member.email}"
              ?disabled=${this._busy}
              @change=${(event: Event) =>
                this._setRole(
                  member.email,
                  (event.target as HTMLSelectElement).value as Invite['role']
                )}
            >
              ${this._grantable(mine).map(
                each => html`<option value=${each} ?selected=${each === role}>${each}</option>`
              )}
            </select>
            <button class="btn" ?disabled=${this._busy} @click=${() => this._remove(member.email)}>
              Remove
            </button>
          `
          : html`<span class="role">${role}</span>`
      }
    </li>`
  }

  /** The roles someone of this role can give: those below their own */
  _grantable(mine: TeamRole) {
    return GRANTABLE_ROLES.filter(each => outranks(mine, each))
  }

  _renderInvites(mine: TeamRole) {
    return html`
      <h4>Invite someone</h4>
      <p>
        Enter the email address of the Google account they will sign in with. You get a link to send
        them yourself: it works once, for a week, and only for that account.
      </p>
      <form class="invite-form" @submit=${this._invite}>
        <input
          ${ref(this._inviteEmail)}
          type="email"
          required
          placeholder="name@example.com"
          aria-label="Their email address"
        />
        <select ${ref(this._inviteRole)} aria-label="Their role">
          ${this._grantable(mine).map(
            each => html`<option value=${each} ?selected=${each === 'writer'}>${each}</option>`
          )}
        </select>
        <button class="btn primary" type="submit" ?disabled=${this._busy}>Make the invite</button>
      </form>
      ${
        this._link
          ? html`<div class="link-box" role="status">
            <strong>Link for ${this._link.email}</strong>
            <input class="link" readonly .value=${this._link.url} aria-label="Invite link" />
            <button class="btn" @click=${this._copy}>${this._copied ? '✓ Copied' : 'Copy the link'}</button>
            <p>It is shown once. Send it to them yourself.</p>
          </div>`
          : nothing
      }
      ${
        this._invites.length
          ? html`
            <h4>Waiting to be used</h4>
            <ul class="people">
              ${this._invites.map(
                invite => html`<li>
                  <span class="who">${invite.email}</span>
                  <span class="role">${invite.role}, until ${new Date(invite.expiresAt).toLocaleDateString()}</span>
                  <button class="btn" ?disabled=${this._busy} @click=${() => this._revoke(invite.id)}>
                    Withdraw
                  </button>
                </li>`
              )}
            </ul>
          `
          : nothing
      }
    `
  }
}
customElements.define('team-share-panel', TeamSharePanel)

declare global {
  interface HTMLElementTagNameMap {
    'team-share-panel': TeamSharePanel
  }
}
