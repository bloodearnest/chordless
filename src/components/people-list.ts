import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Person, Space, TeamLink } from '../js/data-types.ts'
import { openSpace } from '../js/db.ts'
import { isLive, leaderCounts, resolvePerson } from '../js/leaders.ts'
import { chosenMeId, getSignedInUser, personForMember } from '../js/people.ts'
import {
  daysLeft,
  filterRows,
  type PersonRow,
  personRows,
  type SortKey,
  sortRows,
} from '../js/person-rows.ts'
import { teamApi } from '../js/team-client.ts'
import {
  atLeast,
  type InviteInfo,
  MEMBER_ROLES,
  type MemberRole,
  outranks,
  type TeamMember,
  type TeamRole,
} from '../js/team-roles.ts'
import { inviteLink, roleLabel } from '../js/team-spaces.ts'
import { t } from '../js/text.ts'
import { toast } from '../js/toast.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './invite-send.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'
import './space-people.ts'

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** How many people there have to be before there is a search box */
const SEARCH_FROM = 8

/** The invite just made, shown once: the page's way to send it on if the email did not go, or does not arrive */
interface MadeInvite {
  email: string
  role: MemberRole
  url: string
  emailed: boolean
}

/**
 * A Team's people, as one list (docs/ACCOUNT.md, "People: one list"): its members, the invites waiting to be used and
 * the people who lead its setlists but are not members. A table that can be sorted, with a search box once the list is
 * long, and stacked cards on a phone. **Edit** opens one person: their name and addresses (the space's `people`), and a
 * member's role and removal (the Worker's). **Invite someone** emails the invite (the Worker does) and shows its link.
 * What a role may do is the Worker's rule, and the controls follow it: a role acts only on those below it.
 */
export class PeopleList extends LitElement {
  static override properties = {
    space: { attribute: false },
    _members: { state: true },
    _invites: { state: true },
    _people: { state: true },
    _counts: { state: true },
    _meId: { state: true },
    _loaded: { state: true },
    _query: { state: true },
    _sort: { state: true },
    _descending: { state: true },
    _editing: { state: true },
    _inviting: { state: true },
    _made: { state: true },
    _busy: { state: true },
    _error: { state: true },
  }

  /** The Team's space */
  declare space: Space | null
  declare _members: TeamMember[]
  declare _invites: InviteInfo[]
  declare _people: Person[]
  declare _counts: Map<string, number>
  declare _meId: string | null
  declare _loaded: boolean
  declare _query: string
  declare _sort: SortKey
  declare _descending: boolean
  /** The row being edited, by its key */
  declare _editing: string | null
  declare _inviting: boolean
  declare _made: MadeInvite | null
  declare _busy: boolean
  declare _error: string

  _editor: Ref<AppModal> = createRef()
  _inviteModal: Ref<AppModal> = createRef()
  _confirmModal: Ref<AppModal> = createRef()
  /** The question asked while the editor is open: inside it, as the rest of the page is inert behind a modal */
  _editorConfirm: Ref<AppModal> = createRef()
  /** Now (a test gives its own) */
  now: () => Date = () => new Date()

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
      :host { display: block; }
      .bar { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-bottom: 0.75rem; }
      .bar input[type='search'] { flex: 1; min-width: 10rem; font: inherit; padding: 0.4rem 0.6rem; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 0.5rem 0.5rem; vertical-align: middle; }
      thead th { font-size: var(--font-ui-small); border-bottom: 1px solid var(--border-color, #d5dbdb); }
      th button { all: unset; cursor: pointer; font-weight: 600; }
      th button:focus-visible { outline: 2px solid var(--focus-ring, #3498db); }
      tbody tr { border-bottom: 1px solid var(--border-color, #eee); }
      .name { font-weight: 600; overflow-wrap: anywhere; }
      .sub { font-size: var(--font-ui-small); opacity: 0.75; overflow-wrap: anywhere; }
      .chip {
        font-size: var(--font-ui-small);
        padding: 0.1rem 0.5rem;
        border: 1px solid var(--border-color, #d5dbdb);
        border-radius: 999px;
        white-space: nowrap;
      }
      .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
      .error { color: var(--color-danger, #e74c3c); font-weight: 600; }
      .hint { font-size: var(--font-ui-small); opacity: 0.75; margin: 0.5rem 0 0; }
      form.invite { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
      form.invite input[type='email'] { flex: 1; min-width: 12rem; font: inherit; padding: 0.4rem 0.6rem; }
      select { font: inherit; padding: 0.3rem 0.4rem; }
      .made { border: 2px solid var(--color-success, #27ae60); border-radius: 8px; padding: 0.75rem 1rem; margin-top: 1rem; }
      .made input { width: 100%; box-sizing: border-box; font: inherit; padding: 0.35rem 0.5rem; margin: 0.5rem 0; }
      .section { margin: 1rem 0; }
      @media (max-width: 700px) {
        thead { display: none; }
        table, tbody, tr, td { display: block; }
        tbody tr { padding: 0.5rem 0; }
        td { padding: 0.15rem 0; }
        .actions { justify-content: flex-start; }
      }
    `,
  ]

  constructor() {
    super()
    this.space = null
    this._members = []
    this._invites = []
    this._people = []
    this._counts = new Map()
    this._meId = null
    this._loaded = false
    this._query = ''
    this._sort = 'role'
    this._descending = false
    this._editing = null
    this._inviting = false
    this._made = null
    this._busy = false
    this._error = ''
  }

  get _team(): TeamLink {
    return (this.space as Space).team as TeamLink
  }

  /** Whether this is a Team's: a Personal space has people (who lead its setlists) and no members, roles or invites */
  get _isTeam(): boolean {
    return !!this.space?.team
  }

  /** What this person is: their role in the Team (only asked of a Team's people) */
  get _mine(): TeamRole {
    return this._team.role
  }

  /** Whether they may change people (names and addresses): worship leaders and above in a Team; anyone in a space of their own that is not view-only */
  get _canEdit(): boolean {
    return this._isTeam ? atLeast(this._mine, 'writer') : !this.space?.readOnly
  }

  /** Whether they look after members (roles, invites, removal): admins and the owner of a Team */
  get _canManage(): boolean {
    return this._isTeam && outranks(this._mine, 'writer')
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (!changed.has('space')) return
    const previous = changed.get('space') as Space | null | undefined
    if (
      this.space &&
      (previous?.id !== this.space.id || previous?.team?.id !== this.space.team?.id)
    ) {
      void this.load()
    }
  }

  /** The members the space kept at its last sync, until the Team is asked */
  _cachedMembers(): TeamMember[] {
    return (this.space?.members ?? []).flatMap(each =>
      each.role ? [{ email: each.email, emails: each.emails, role: each.role as TeamRole }] : []
    )
  }

  /** Read the people: members and invites from the Worker (the cached members offline), names and what each leads from the space */
  async load(): Promise<void> {
    const space = this.space as Space
    if (space.team) {
      const team = space.team
      this._members = this._members.length ? this._members : this._cachedMembers()
      const [members, invites] = await Promise.all([
        teamApi.members(team.id).catch(() => null),
        this._canManage ? teamApi.invites(team.id).catch(() => []) : Promise.resolve([]),
      ])
      if (members) this._members = members
      this._invites = invites
    }
    const db = await openSpace(space.id)
    try {
      const [people, setlists, user] = await Promise.all([
        db.getAllPeople(),
        db.getAllSetlists(),
        getSignedInUser(),
      ])
      this._people = people.filter(isLive)
      this._counts = leaderCounts(people, setlists)
      this._meId =
        resolvePerson(people, chosenMeId(space.id))?.id ??
        people.find(each => isLive(each) && user && each.emails.includes(user.email))?.id ??
        null
    } finally {
      db.db?.close()
    }
    this._loaded = true
    // (a person who was merged or deleted from the editor is not there to edit any more)
    if (this._editing && !this._rows().some(row => row.key === this._editing)) this._closeEditor()
  }

  _rows(): PersonRow[] {
    return personRows({
      people: this._people,
      members: this._members,
      invites: this._invites,
      counts: this._counts,
      meId: this._meId,
    })
  }

  _shown(): PersonRow[] {
    return sortRows(filterRows(this._rows(), this._query), this._sort, this._descending)
  }

  _sortBy(key: SortKey): void {
    if (this._sort === key) this._descending = !this._descending
    else {
      this._sort = key
      this._descending = false
    }
  }

  _ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this._sort !== key) return 'none'
    return this._descending ? 'descending' : 'ascending'
  }

  /** Do something to the Team, saying what went wrong, and read the people again after */
  async _run(work: () => Promise<void>): Promise<void> {
    this._error = ''
    this._busy = true
    try {
      await work()
      await this.load()
    } catch (error) {
      this._error = errorMessage(error)
    } finally {
      this._busy = false
    }
  }

  async _confirm(heading: string, message: string, confirmLabel: string): Promise<boolean> {
    const modal = (this._editing ? this._editorConfirm.value : this._confirmModal.value) as AppModal
    modal.heading = heading
    modal.message = message
    modal.confirmLabel = confirmLabel
    await this.updateComplete
    await modal.updateComplete
    return modal.ask()
  }

  /** The roles someone of this role can give: those below their own */
  _grantable(): MemberRole[] {
    return MEMBER_ROLES.filter(each => outranks(this._mine, each))
  }

  _canEditRow(row: PersonRow): boolean {
    return row.kind !== 'invite' && (this._canEdit || row.isMe)
  }

  _edit(row: PersonRow): void {
    this._editing = row.key
    void this.updateComplete.then(() => this._editor.value?.show())
  }

  _closeEditor(): void {
    this._editing = null
    this._editor.value?.close()
  }

  _onEditorClosed = (event: Event): void => {
    // (not if it was opened again while it was closing: that is another person's)
    if (event.target === this._editor.value && !this._editor.value.open) this._editing = null
  }

  _onPeopleChanged = (): void => {
    void this.load()
  }

  async _setRole(row: PersonRow, role: MemberRole): Promise<void> {
    await this._run(() => teamApi.setRole(this._team.id, row.email, role))
  }

  async _remove(row: PersonRow): Promise<void> {
    const sure = await this._confirm(
      t('confirm-team-remove-heading', { email: row.email }),
      t('confirm-team-remove-message'),
      t('confirm-team-remove-button')
    )
    if (!sure) return
    await this._run(() => teamApi.removeMember(this._team.id, row.email))
  }

  /** Give a member who has no person record a name (their address, to rename), so their name and addresses can be edited */
  async _namePerson(row: PersonRow): Promise<void> {
    const member = row.member
    if (!member) return
    const space = this.space as Space
    await this._run(async () => {
      const db = await openSpace(space.id)
      try {
        const made = personForMember(await db.getAllPeople(), member)
        if (made?.changed.length) await db.savePeople(made.changed)
      } finally {
        db.db?.close()
      }
    })
  }

  async _revoke(row: PersonRow): Promise<void> {
    const invite = row.invite as InviteInfo
    await this._run(() => teamApi.revokeInvite(this._team.id, invite.id))
  }

  /**
   * Send an invite again: a new invite for the same address and role (the code is never kept, so the old link cannot be
   * sent again) replaces the old one, which stops working; the Worker emails the new one. If it was not emailed, its link
   * is copied, to send another way.
   */
  async _resend(row: PersonRow): Promise<void> {
    const invite = row.invite as InviteInfo
    const sure = await this._confirm(
      t('people-resend-heading', { email: invite.email }),
      t('people-resend-message'),
      t('people-resend-button')
    )
    if (!sure) return
    await this._run(async () => {
      const { code, emailed } = await teamApi.createInvite(this._team.id, invite.role, invite.email)
      await teamApi.revokeInvite(this._team.id, invite.id)
      const url = inviteLink(window.location.origin, this._team.id, code)
      if (emailed) {
        toast(t('people-resent', { email: invite.email }), { kind: 'info' })
      } else {
        await navigator.clipboard?.writeText(url).catch(() => {
          // (no clipboard here: the toast says the invite was not emailed, and the page offers Invite someone for a link to copy)
        })
        toast(t('people-resend-not-emailed', { email: invite.email }), { kind: 'error' })
      }
    })
  }

  _openInvite(email = ''): void {
    this._made = null
    this._inviting = true
    this._error = ''
    void this.updateComplete.then(() => {
      const input = this._inviteModal.value?.querySelector<HTMLInputElement>('input[type=email]')
      if (input) input.value = email
      this._inviteModal.value?.show()
    })
  }

  _onInviteClosed = (event: Event): void => {
    if (event.target === this._inviteModal.value) this._inviting = false
  }

  async _invite(event: Event): Promise<void> {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    const email = (form.elements.namedItem('email') as HTMLInputElement).value
    const role = (form.elements.namedItem('role') as HTMLSelectElement).value as MemberRole
    await this._run(async () => {
      const { code, emailed } = await teamApi.createInvite(this._team.id, role, email)
      this._made = {
        email: email.trim().toLowerCase(),
        role,
        url: inviteLink(window.location.origin, this._team.id, code),
        emailed: emailed === true,
      }
      form.reset()
    })
  }

  async _copyMade(): Promise<void> {
    const made = this._made as MadeInvite
    try {
      await navigator.clipboard.writeText(made.url)
      toast(t('people-link-copied'), { kind: 'info' })
    } catch {
      this.renderRoot.querySelector<HTMLInputElement>('input.link')?.select()
    }
  }

  _status(row: PersonRow): string {
    if (row.kind === 'visitor') return t('people-status-visitor')
    if (row.kind === 'member') return t('people-status-member')
    const invite = row.invite as InviteInfo
    const days = daysLeft(invite.expiresAt, this.now())
    return t(invite.emailedAt ? 'people-status-invited-emailed' : 'people-status-invited', {
      days,
      emailed: invite.emailedAt ? this._ago(invite.emailedAt) : '',
    })
  }

  /** "today", "yesterday" or "3 days ago" */
  _ago(time: string): string {
    const days = Math.floor((this.now().getTime() - Date.parse(time)) / 86_400_000)
    if (days <= 0) return t('people-today')
    return days === 1 ? t('people-yesterday') : t('people-days-ago', { days })
  }

  /** What the page says under the list: what Edit does, or that it is for looking at */
  _hint(): string {
    if (!this._isTeam)
      return t(this._canEdit ? 'people-hint-personal' : 'people-hint-read-personal')
    return t(this._canEdit ? 'people-hint-edit' : 'people-hint-read')
  }

  _renderRow(row: PersonRow) {
    return html`<tr>
      <td>
        <div class="name">${row.name}</div>
        ${row.isMe ? html`<span class="chip">${t('people-you')}</span>` : nothing}
        ${row.leads > 0 ? html`<span class="chip">${t('people-leads', { count: row.leads })}</span>` : nothing}
      </td>
      <td class="sub">${row.email}${row.more > 0 ? html` <span class="chip">+${row.more}</span>` : nothing}</td>
      ${
        this._isTeam
          ? html`<td>${row.role ? sentenceCase(roleLabel(row.role)) : ''}</td>
            <td class="sub">${this._status(row)}</td>`
          : nothing
      }
      <td><div class="actions">${this._renderActions(row)}</div></td>
    </tr>`
  }

  _renderActions(row: PersonRow) {
    if (row.kind === 'invite') {
      return html`
        <button class="btn" ?disabled=${this._busy} @click=${() => this._resend(row)}>${t('people-resend')}</button>
        <button class="btn" ?disabled=${this._busy} @click=${() => this._revoke(row)}>${t('people-revoke')}</button>
      `
    }
    return this._canEditRow(row)
      ? html`<button class="btn" aria-label=${t('people-edit-aria', { name: row.name })} @click=${() => this._edit(row)}>${t('people-edit')}</button>`
      : nothing
  }

  _renderEditor() {
    const row = this._rows().find(each => each.key === this._editing)
    if (!row) return nothing
    const manageable =
      row.kind === 'member' && this._canManage && !!row.role && outranks(this._mine, row.role)
    return html`
      ${
        row.kind === 'member'
          ? html`<div class="section">
            <strong>${t('people-team-role')}</strong>
            ${
              manageable
                ? html`<select
                    aria-label=${t('people-role-aria', { name: row.name })}
                    ?disabled=${this._busy}
                    @change=${(event: Event) =>
                      this._setRole(row, (event.target as HTMLSelectElement).value as MemberRole)}
                  >
                    ${this._grantable().map(
                      each =>
                        html`<option value=${each} ?selected=${each === row.role}>${roleLabel(each)}</option>`
                    )}
                  </select>
                  <button class="btn danger" ?disabled=${this._busy} @click=${() => this._remove(row)}>${t('people-remove')}</button>`
                : html`<span class="chip">${roleLabel(row.role as TeamRole)}</span>`
            }
            <p class="hint">${t('people-known-as', { emails: (row.member?.emails ?? [row.email]).join(', ') })}</p>
          </div>`
          : nothing
      }
      ${
        row.kind === 'visitor' && this._canManage
          ? html`<div class="section">
            <button class="btn" @click=${() => this._invitePerson(row)}>${t('people-invite-them')}</button>
          </div>`
          : nothing
      }
      ${
        row.person
          ? html`<space-people
              .spaceId=${(this.space as Space).id}
              .only=${row.person.id}
              @space-people:changed=${this._onPeopleChanged}
            ></space-people>`
          : html`<div class="section">
              <p class="hint">${t('people-no-name-yet')}</p>
              <button class="btn" ?disabled=${this._busy} @click=${() => this._namePerson(row)}>${t('people-name-them')}</button>
            </div>`
      }
      ${this._error ? html`<p class="error" role="alert">✗ ${this._error}</p>` : nothing}
      <app-modal ${ref(this._editorConfirm)} type="confirm" size="small"></app-modal>
    `
  }

  _invitePerson(row: PersonRow): void {
    this._closeEditor()
    this._openInvite(row.email)
  }

  _renderInvite() {
    const made = this._made
    return html`
      <form class="invite" @submit=${this._invite}>
        <input type="email" name="email" required placeholder=${t('people-invite-email')} aria-label=${t('people-invite-email')} />
        <select name="role" aria-label=${t('people-invite-role')}>
          ${this._grantable().map(
            each =>
              html`<option value=${each} ?selected=${each === 'writer'}>${roleLabel(each)}</option>`
          )}
        </select>
        <button class="btn primary" type="submit" ?disabled=${this._busy}>${t('people-invite-make')}</button>
      </form>
      <p class="hint">${t('people-invite-hint')}</p>
      ${this._error ? html`<p class="error" role="alert">✗ ${this._error}</p>` : nothing}
      ${
        made
          ? html`<div class="made" role="status">
            <strong>${t(made.emailed ? 'invite-emailed' : 'invite-not-emailed', { email: made.email })}</strong>
            <input class="link" readonly .value=${made.url} aria-label=${t('people-invite-link')} />
            <button class="btn" @click=${this._copyMade}>${t('people-copy-link')}</button>
            <invite-send .teamName=${(this.space as Space).name} .role=${made.role} .email=${made.email} .url=${made.url}></invite-send>
          </div>`
          : nothing
      }
    `
  }

  override render() {
    if (!this.space) return nothing
    const rows = this._shown()
    const total = this._rows().length
    const header = (
      key: SortKey,
      label: string
    ) => html`<th scope="col" aria-sort=${this._ariaSort(key)}>
      <button @click=${() => this._sortBy(key)}>${label}</button>
    </th>`
    const row = this._rows().find(each => each.key === this._editing)
    return html`
      <div class="panel">
        <h3>${t(this._isTeam ? 'people-heading' : 'people-heading-personal', { count: total })}</h3>
        <div class="bar">
          ${
            total > SEARCH_FROM
              ? html`<input
                  type="search"
                  placeholder=${t('people-search')}
                  aria-label=${t('people-search')}
                  .value=${this._query}
                  @input=${(event: Event) => (this._query = (event.target as HTMLInputElement).value)}
                />`
              : nothing
          }
          ${
            this._canManage
              ? html`<button class="btn primary" @click=${() => this._openInvite()}>${t('people-invite')}</button>`
              : nothing
          }
        </div>
        ${this._error && !this._editing && !this._inviting ? html`<p class="error" role="alert">✗ ${this._error}</p>` : nothing}
        ${
          !this._loaded
            ? html`<p class="hint">${t('status-checking')}</p>`
            : rows.length === 0
              ? html`<p class="hint">${t(this._isTeam || this._query ? 'people-none' : 'people-none-personal')}</p>`
              : html`<table>
                <thead>
                  <tr>
                    ${header('name', t('people-column-name'))}
                    <th scope="col">${t('people-column-email')}</th>
                    ${this._isTeam ? header('role', t('people-column-role')) : nothing}
                    ${this._isTeam ? header('status', t('people-column-status')) : nothing}
                    <th scope="col"><span class="sub">${t('people-column-actions')}</span></th>
                  </tr>
                </thead>
                <tbody>${rows.map(each => this._renderRow(each))}</tbody>
              </table>`
        }
        <p class="hint">${this._hint()}</p>
      </div>
      <app-modal
        ${ref(this._editor)}
        size="large"
        heading=${row?.name ?? ''}
        @app-modal:close=${this._onEditorClosed}
      >${this._editing ? this._renderEditor() : nothing}</app-modal>
      <app-modal
        ${ref(this._inviteModal)}
        size="medium"
        heading=${t('people-invite')}
        @app-modal:close=${this._onInviteClosed}
      >${this._inviting ? this._renderInvite() : nothing}</app-modal>
      <app-modal ${ref(this._confirmModal)} type="confirm" size="small"></app-modal>
    `
  }
}
customElements.define('people-list', PeopleList)

declare global {
  interface HTMLElementTagNameMap {
    'people-list': PeopleList
  }
}
