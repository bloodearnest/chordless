import { css, html, LitElement, nothing } from 'lit'
import type { TeamLink } from '../js/data-types.ts'
import { teamApi } from '../js/team-client.ts'
import { MEMBER_ROLES, type MemberRole } from '../js/team-roles.ts'
import { inviteLink, type Leader, roleLabel } from '../js/team-spaces.ts'
import { t } from '../js/text.ts'
import { errorMessage } from '../js/utils/errors.ts'
import './invite-send.ts'
import { buttonStyles } from './shared-styles.ts'

/** Someone to invite, and the role to give them */
interface Entry {
  email: string
  name: string
  on: boolean
  role: MemberRole
}

/** What came of an invite: the link to send (shown once), or why not */
interface Outcome {
  email: string
  url?: string
  role?: MemberRole
  emailed?: boolean
  error?: string
}

/**
 * The last step of making a team space (docs/SPACES.md, "Creating a team space"): invite the
 * people who lead its setlists, and anyone else, each with a role. Nothing is sent without being
 * ticked. Each invite is mailed to its address (the Worker does it), and its link is shown once, for the
 * owner to pass on as well. A leader typed in by name alone has no email, so is listed as someone who cannot be
 * invited.
 */
export class TeamInviteStep extends LitElement {
  static override properties = {
    team: { attribute: false },
    teamName: { type: String },
    leaders: { attribute: false },
    _entries: { state: true },
    _outcomes: { state: true },
    _busy: { state: true },
    _copied: { state: true },
  }

  /** The team space to invite people to */
  declare team: TeamLink
  /** Its name, for the message that goes with a link */
  declare teamName: string
  /** The people its setlists name as leaders */
  declare leaders: Leader[]
  declare _entries: Entry[]
  declare _outcomes: Outcome[]
  declare _busy: boolean
  /** The email whose link was copied last */
  declare _copied: string

  static override styles = [
    buttonStyles,
    css`
    :host { display: block; }
    h3 { margin: 1.5rem 0 0.5rem; font-size: var(--font-ui); }
    ul { list-style: none; margin: 0.5rem 0; padding: 0; }
    li { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin: 0.4rem 0; }
    .who { flex: 1; min-width: 12rem; }
    .email, .hint { color: var(--text-secondary, #5f6b6d); }
    .add { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
    .add input { flex: 1; min-width: 12rem; font: inherit; padding: 0.4rem; }
    select { font: inherit; padding: 0.3rem; }
    .error { color: var(--color-danger, #e74c3c); }
    .link { flex: 1; min-width: 14rem; font: inherit; padding: 0.3rem; }
    .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1rem; }
    `,
  ]

  constructor() {
    super()
    this.leaders = []
    this._entries = []
    this._outcomes = []
    this._busy = false
    this._copied = ''
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // (everyone who can be invited starts ticked, as a writer: the owner unticks)
    if (changed.has('leaders')) {
      this._entries = this.leaders
        .filter((leader): leader is Leader & { email: string } => Boolean(leader.email))
        .map(leader => ({ email: leader.email, name: leader.name, on: true, role: 'writer' }))
    }
  }

  /** Those named only by name */
  get _nameOnly(): Leader[] {
    return this.leaders.filter(leader => !leader.email)
  }

  _tick(email: string, on: boolean): void {
    this._entries = this._entries.map(each => (each.email === email ? { ...each, on } : each))
  }

  _role(email: string, role: MemberRole): void {
    this._entries = this._entries.map(each => (each.email === email ? { ...each, role } : each))
  }

  _add(event: Event): void {
    event.preventDefault()
    const input = this.renderRoot.querySelector('#extra') as HTMLInputElement
    const email = input.value.trim().toLowerCase()
    if (!email) return
    if (!this._entries.some(each => each.email === email)) {
      this._entries = [...this._entries, { email, name: email, on: true, role: 'writer' }]
    }
    input.value = ''
  }

  get _chosen(): Entry[] {
    return this._entries.filter(each => each.on)
  }

  /** Make an invite for each ticked person, one after another, keeping each link or reason */
  async _send(): Promise<void> {
    this._busy = true
    const outcomes: Outcome[] = []
    for (const entry of this._chosen) {
      try {
        const { code, emailed } = await teamApi.createInvite(this.team.id, entry.role, entry.email)
        outcomes.push({
          email: entry.email,
          role: entry.role,
          emailed: emailed === true,
          url: inviteLink(window.location.origin, this.team.id, code),
        })
      } catch (error) {
        outcomes.push({ email: entry.email, error: errorMessage(error) })
      }
    }
    // (those that worked are done with; the others stay to try again)
    const failed = new Set(outcomes.filter(each => each.error).map(each => each.email))
    this._entries = this._entries.filter(each => !each.on || failed.has(each.email))
    this._outcomes = [...this._outcomes.filter(each => !each.error), ...outcomes]
    this._busy = false
  }

  async _copy(outcome: Outcome): Promise<void> {
    try {
      await navigator.clipboard.writeText(outcome.url as string)
      this._copied = outcome.email
    } catch {
      // (no clipboard here: the link is selected, to copy by hand)
    }
  }

  override render() {
    const chosen = this._chosen.length
    return html`
      <h3>${t('invite-heading')}</h3>
      <p class="hint">
        ${t(this._entries.length ? 'invite-text-leaders' : 'invite-text')}
        ${t('invite-text-links')}
      </p>
      <p class="hint">${t('invite-roles')}</p>
      <ul>
        ${this._entries.map(
          entry => html`<li>
            <label class="who">
              <input
                type="checkbox"
                .checked=${entry.on}
                ?disabled=${this._busy}
                @change=${(event: Event) =>
                  this._tick(entry.email, (event.target as HTMLInputElement).checked)}
              />
              ${entry.name !== entry.email ? html`${entry.name} <span class="email">${entry.email}</span>` : entry.email}
            </label>
            <select
              aria-label=${t('invite-role-label', { email: entry.email })}
              ?disabled=${this._busy}
              @change=${(event: Event) =>
                this._role(entry.email, (event.target as HTMLSelectElement).value as MemberRole)}
            >
              ${MEMBER_ROLES.map(
                role =>
                  html`<option value=${role} ?selected=${role === entry.role}>${roleLabel(role)}</option>`
              )}
            </select>
          </li>`
        )}
      </ul>
      ${
        this._nameOnly.length
          ? html`<p class="hint">
            ${t('invite-name-only', { names: this._nameOnly.map(leader => leader.name).join(', ') })}
          </p>`
          : nothing
      }
      <form class="add" @submit=${this._add}>
        <input id="extra" type="email" placeholder=${t('invite-email-example')} aria-label=${t('invite-another-label')} required />
        <button class="btn" type="submit" ?disabled=${this._busy}>${t('action-add')}</button>
      </form>
      <div class="actions">
        <button class="btn primary" ?disabled=${this._busy || chosen === 0} @click=${this._send}>
          ${this._busy ? t('invite-making') : t('invite-make', { count: chosen })}
        </button>
      </div>
      ${
        this._outcomes.length
          ? html`<h3>${t('invite-invites-heading')}</h3>
            <p class="hint">${t('invite-invites-text')}</p>
            <ul>
              ${this._outcomes.map(outcome =>
                outcome.url
                  ? html`<li>
                    <span class="who">${outcome.email}</span>
                    <p class="hint">${t(outcome.emailed ? 'invite-emailed' : 'invite-not-emailed', { email: outcome.email })}</p>
                    <input class="link" readonly .value=${outcome.url} aria-label=${t('invite-link-label', { email: outcome.email })} />
                    <button class="btn" @click=${() => this._copy(outcome)}>
                      ${this._copied === outcome.email ? t('invite-copied') : t('invite-copy')}
                    </button>
                    <invite-send
                      .teamName=${this.teamName}
                      .role=${outcome.role as MemberRole}
                      .email=${outcome.email}
                      .url=${outcome.url}
                    ></invite-send>
                  </li>`
                  : html`<li class="error" role="alert">${outcome.email}: ${outcome.error}</li>`
              )}
            </ul>`
          : nothing
      }
    `
  }
}
customElements.define('team-invite-step', TeamInviteStep)

declare global {
  interface HTMLElementTagNameMap {
    'team-invite-step': TeamInviteStep
  }
}
