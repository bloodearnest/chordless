import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import {
  type ChurchDetails,
  type ChurchInfo,
  type ChurchMember,
  type ChurchTeam,
  ChurchTeamsChangedEvent,
  churchClient,
} from '../js/church-client.ts'
import { countryChoices, countryName, guessCountry } from '../js/countries.ts'
import { isAuthenticated } from '../js/google-auth.ts'
import { teamApi } from '../js/team-client.ts'
import type { MemberRole } from '../js/team-roles.ts'
import { t } from '../js/text.ts'
import { toast } from '../js/toast.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'

const roleText: Record<MemberRole, string> = {
  reader: 'church-console-reader',
  writer: 'church-console-writer',
  admin: 'church-console-admin',
}

/** Church administration is separate from the live setlist. */
export class ChurchConsole extends LitElement {
  static override properties = {
    _churches: { state: true },
    _selected: { state: true },
    _teams: { state: true },
    _driveTeams: { state: true },
    _members: { state: true },
    _loading: { state: true },
    _signedIn: { state: true },
    _busy: { state: true },
    _invite: { state: true },
    _joined: { state: true },
  }
  declare _churches: ChurchInfo[]
  declare _selected: string
  declare _teams: ChurchTeam[]
  /** Teams of this person's that are still on Google Drive, which they may move into the church */
  declare _driveTeams: { spaceId: string; name: string; role: string }[]
  declare _members: ChurchMember[]
  declare _loading: boolean
  declare _signedIn: boolean
  declare _busy: boolean
  declare _invite: string
  declare _joined: boolean
  _confirm: Ref<AppModal> = createRef()
  api = churchClient
  /** The teams the person is in that are still on Google Drive (a test gives its own) */
  driveTeams: () => Promise<{ spaceId: string; name: string; role: string }[]> = () =>
    teamApi.list()
  authenticated = isAuthenticated
  copyText = (text: string) => navigator.clipboard.writeText(text)
  static override styles = [
    panelStyles,
    buttonStyles,
    css`
    :host { display: block; max-width: 800px; margin: 0 auto; padding: 1rem; }
    .stack, form { display: flex; flex-direction: column; gap: .75rem; }
    .row { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
    label { display: flex; flex-direction: column; gap: .25rem; }
    input, select { font: inherit; padding: .5rem; max-width: 100%; }
    p { line-height: 1.5; }
  `,
  ]
  constructor() {
    super()
    this._churches = []
    this._selected = ''
    this._teams = []
    this._driveTeams = []
    this._members = []
    this._loading = true
    this._signedIn = false
    this._busy = false
    this._invite = ''
    this._joined = false
  }
  override connectedCallback() {
    super.connectedCallback()
    void this.load()
  }
  get selected(): ChurchInfo | undefined {
    return this._churches.find(church => church.id === this._selected)
  }
  async load() {
    this._loading = true
    try {
      this._signedIn = await this.authenticated()
      if (this._signedIn) await this.refresh()
    } catch (error) {
      this.fail(error)
    } finally {
      this._loading = false
    }
  }
  fail(error: unknown) {
    toast(t('church-console-failed'), { kind: 'error', details: errorMessage(error) })
  }
  async refresh() {
    this._churches = await this.api.list()
    if (!this._churches.some(church => church.id === this._selected))
      this._selected = this._churches[0]?.id ?? ''
    await this.loadSelected()
  }
  async loadSelected() {
    if (!this._selected) {
      this._teams = []
      this._driveTeams = []
      this._members = []
      return
    }
    const id = this._selected
    const [teams, members] = await Promise.all([this.api.teams(id), this.api.members(id)])
    // (only an owner or admin of a Drive team may move it; a Worker that cannot say leaves the list empty)
    const drive = (await this.driveTeams().catch(() => [])).filter(
      each => each.role === 'owner' || each.role === 'admin'
    )
    if (this._selected === id) {
      this._teams = teams
      this._driveTeams = drive
      this._members = members
    }
  }
  async run(work: () => Promise<void>) {
    if (this._busy) return
    this._busy = true
    try {
      await work()
      await this.refresh()
      window.dispatchEvent(new ChurchTeamsChangedEvent())
    } catch (error) {
      this.fail(error)
    } finally {
      this._busy = false
    }
  }
  async confirm(message: string): Promise<boolean> {
    const modal = this._confirm.value as AppModal
    modal.heading = t('church-console-confirm-heading')
    modal.message = message
    modal.confirmLabel = t('church-console-confirm')
    await modal.updateComplete
    return modal.ask()
  }
  details(form: HTMLFormElement, old?: ChurchInfo): ChurchDetails {
    const values = new FormData(form)
    return {
      name: String(values.get('name') ?? ''),
      country: String(values.get('country') ?? ''),
      city: String(values.get('city') ?? ''),
      postcode: String(values.get('postcode') ?? '') || null,
      ccliLicence: String(values.get('ccliLicence') ?? '') || null,
      licences: old?.licences ?? {},
    }
  }
  create(event: Event) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const details = this.details(form)
    void this.run(async () => {
      if (details.ccliLicence) {
        const matches = await this.api.matches(details.ccliLicence)
        if (
          matches.length &&
          !(await this.confirm(
            t('church-console-matches', {
              names: matches
                .map(
                  match =>
                    `${match.name} (${match.city}, ${countryName(match.country, navigator.language)})`
                )
                .join(', '),
            })
          ))
        )
          return
      }
      const made = await this.api.create(details)
      this._selected = made.id
      form.reset()
    })
  }
  save(event: Event, church: ChurchInfo) {
    event.preventDefault()
    const details = this.details(event.currentTarget as HTMLFormElement, church)
    void this.run(async () => {
      await this.api.update(church.id, details)
    })
  }
  addTeam(event: Event, church: ChurchInfo) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const name = String(new FormData(form).get('team') ?? '')
    void this.run(async () => {
      await this.api.addTeam(church.id, name)
      form.reset()
    })
  }
  async archive(church: ChurchInfo, team: ChurchTeam) {
    if (!(await this.confirm(t('church-console-confirm-archive', { name: team.name })))) return
    await this.run(() => this.api.archiveTeam(church.id, team.id))
  }
  async deleteTeam(church: ChurchInfo, team: ChurchTeam) {
    if (!(await this.confirm(t('church-console-confirm-delete', { name: team.name })))) return
    await this.run(() => this.api.deleteTeam(church.id, team.id))
  }
  /** Move a team that is on Google Drive into the church, after asking: its members join the church, and each device follows */
  async adopt(church: ChurchInfo, team: { spaceId: string; name: string }) {
    if (
      !(await this.confirm(
        t('church-console-confirm-adopt', { team: team.name, church: church.name })
      ))
    )
      return
    await this.run(async () => {
      await this.api.adopt(church.id, team.spaceId)
      toast(t('church-console-adopted', { team: team.name }))
    })
  }
  /** Every country, by name in the person's language, with the chosen one (or, for a new church, the one their browser suggests) selected */
  countryOptions(chosen: string) {
    return html`<option value="" ?selected=${!chosen} disabled>${t('church-console-country-choose')}</option>${countryChoices(
      navigator.language
    ).map(
      country =>
        html`<option value=${country.code} ?selected=${country.code === chosen}>${country.name}</option>`
    )}`
  }
  async removeMember(church: ChurchInfo, member: ChurchMember) {
    if (
      !(await this.confirm(t('church-console-confirm-remove', { name: member.name ?? member.id })))
    )
      return
    await this.run(() => this.api.removeMember(church.id, member.id))
  }
  async changeRole(church: ChurchInfo, member: ChurchMember, event: Event) {
    const select = event.currentTarget as HTMLSelectElement
    const role = select.value as MemberRole
    select.value = member.role
    if (!(await this.confirm(t('church-console-confirm-role')))) return
    await this.run(() => this.api.setRole(church.id, member.id, role))
  }
  invite(event: Event, church: ChurchInfo) {
    event.preventDefault()
    const values = new FormData(event.currentTarget as HTMLFormElement)
    const team = String(values.get('team') ?? '')
    const email = String(values.get('email') ?? '')
    const role = String(values.get('role') ?? '') as MemberRole
    void this.run(async () => {
      const made = await this.api.invite(church.id, team, email, role)
      const url = new URL('/account/churches', location.origin)
      url.hash = new URLSearchParams({ team, code: made.code }).toString()
      this._invite = url.toString()
    })
  }
  async copyInvite() {
    try {
      await this.copyText(this._invite)
      toast(t('church-console-invite-copied'))
    } catch (error) {
      this.fail(error)
    }
  }
  join() {
    const query = new URLSearchParams(new URL(location.href).hash.slice(1))
    const team = query.get('team')
    const code = query.get('code')
    if (!team || !code) return
    void this.run(async () => {
      const joined = await this.api.join(team, code)
      this._selected = joined.churchId
      this._joined = true
      history.replaceState(history.state, '', `${location.pathname}${location.search}`)
    })
  }
  fields(church?: ChurchInfo) {
    return html`<label>${t('church-console-name')}<input name="name" required .value=${church?.name ?? ''}></label>
      <label>${t('church-console-country')}<select name="country" required>${this.countryOptions(church?.country ?? guessCountry(navigator.languages) ?? '')}</select></label>
      <label>${t('church-console-city')}<input name="city" required .value=${church?.city ?? ''}></label>
      <label>${t('church-console-postcode')}<input name="postcode" .value=${church?.postcode ?? ''}></label>
      <label>${t('church-console-licence')}<input name="ccliLicence" .value=${church?.ccliLicence ?? ''}></label>`
  }
  roles(selected: MemberRole) {
    return (['reader', 'writer', 'admin'] as const).map(
      role =>
        html`<option value=${role} ?selected=${role === selected}>${t(roleText[role])}</option>`
    )
  }
  override render() {
    const church = this.selected
    const admin = church?.role === 'admin'
    const query = new URLSearchParams(new URL(location.href).hash.slice(1))
    if (this._loading) return html`<p>${t('church-console-loading')}</p>`
    if (!this._signedIn)
      return html`<p>${t('church-console-signin')}</p><a href="/account">${t('menu-account')}</a>`
    return html`<div class="stack">
      ${query.has('team') && query.has('code') && !this._joined ? html`<section class="panel"><h2>${t('church-console-join')}</h2><button class="btn" ?disabled=${this._busy} @click=${this.join}>${t('church-console-join-button')}</button></section>` : nothing}
      ${this._joined ? html`<p role="status">${t('church-console-joined')}</p>` : nothing}
      <p>${t('church-console-setup')}</p>
      <details class="panel"><summary>${t('church-console-new')}</summary><form @submit=${this.create}>${this.fields()}<button class="btn" ?disabled=${this._busy}>${t('church-console-create')}</button></form></details>
      ${
        this._churches.length
          ? html`<label>${t('church-console-select')}<select .value=${this._selected} @change=${(
              event: Event
            ) => {
              this._selected = (event.currentTarget as HTMLSelectElement).value
              void this.loadSelected().catch(error => this.fail(error))
            }}>${this._churches.map(item => html`<option value=${item.id} ?selected=${item.id === this._selected}>${item.name}</option>`)}</select></label>`
          : nothing
      }
      ${
        church
          ? html`<section class="panel"><h2>${church.name}</h2>${admin && !church.ccliLicence ? html`<p>${t('church-console-licence-missing')}</p>` : nothing}
        ${admin ? html`<form @submit=${(event: Event) => this.save(event, church)}>${this.fields(church)}<button class="btn" ?disabled=${this._busy}>${t('church-console-save')}</button></form>` : html`<p>${church.city}, ${church.country}</p>${church.ccliLicence ? html`<p>${t('church-console-licence')}: ${church.ccliLicence}</p>` : nothing}`}</section>
        <section class="panel"><h2>${t('church-console-teams')}</h2>${this._teams.map(team => html`<div class="row"><span>${team.name}</span>${!team.archivedAt ? html`<label><input type="checkbox" .checked=${Boolean(team.followed)} @change=${(event: Event) => void this.run(() => this.api.follow(church.id, team.id, (event.currentTarget as HTMLInputElement).checked))}>${t('church-console-follow')}</label>` : nothing}${admin ? html`<button class="btn" ?disabled=${this._busy} @click=${() => (team.archivedAt ? this.run(() => this.api.restoreTeam(church.id, team.id)) : this.archive(church, team))}>${t(team.archivedAt ? 'church-console-restore' : 'church-console-archive')}</button>` : nothing}${admin && team.archivedAt ? html`<button class="btn" ?disabled=${this._busy} @click=${() => this.deleteTeam(church, team)}>${t('church-console-delete')}</button>` : nothing}</div>`)}
        ${admin ? html`<form @submit=${(event: Event) => this.addTeam(event, church)}><label>${t('church-console-team-name')}<input name="team" required></label><button class="btn" ?disabled=${this._busy}>${t('church-console-team-add')}</button></form>` : nothing}</section>
        <section class="panel"><h2>${t('church-console-members')}</h2>${this._members.map(member => html`<div class="row"><span>${member.name ?? member.id}</span>${admin ? html`<select aria-label=${t('church-console-role')} @change=${(event: Event) => this.changeRole(church, member, event)}>${this.roles(member.role)}</select><button class="btn" @click=${() => this.removeMember(church, member)}>${t('church-console-remove')}</button>` : html`<span>${t(roleText[member.role])}</span>`}</div>`)}</section>
        ${admin && this._driveTeams.length ? html`<section class="panel" id="drive-teams"><h2>${t('church-console-drive-teams')}</h2><p>${t('church-console-drive-text')}</p>${this._driveTeams.map(drive => html`<div class="row"><span>${drive.name}</span><button class="btn" ?disabled=${this._busy} @click=${() => this.adopt(church, drive)}>${t('church-console-adopt', { church: church.name })}</button></div>`)}</section>` : nothing}
        ${admin && this._teams.some(team => !team.archivedAt) ? html`<section class="panel"><h2>${t('church-console-invite')}</h2><form @submit=${(event: Event) => this.invite(event, church)}><label>${t('church-console-email')}<input name="email" type="email" required></label><label>${t('church-console-role')}<select name="role">${this.roles('reader')}</select></label><label>${t('church-console-invite-team')}<select name="team">${this._teams.filter(team => !team.archivedAt).map(team => html`<option value=${team.id}>${team.name}</option>`)}</select></label><button class="btn" ?disabled=${this._busy}>${t('church-console-invite-create')}</button></form>${this._invite ? html`<input readonly .value=${this._invite}><button class="btn" @click=${this.copyInvite}>${t('church-console-invite-copy')}</button>` : nothing}</section>` : nothing}`
          : nothing
      }
      </div><app-modal ${ref(this._confirm)} type="confirm" size="small"></app-modal>`
  }
}
customElements.define('church-console', ChurchConsole)
declare global {
  interface HTMLElementTagNameMap {
    'church-console': ChurchConsole
  }
}
