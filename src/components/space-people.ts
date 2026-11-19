import { css, html, LitElement, nothing } from 'lit'
import { live } from 'lit/directives/live.js'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Person, Space } from '../js/data-types.ts'
import { openSpace } from '../js/db.ts'
import {
  emailProblem,
  isLive,
  leaderCounts,
  renamed,
  resolvePerson,
  withEmail,
} from '../js/leaders.ts'
import {
  chosenMeId,
  deletePerson,
  getSignedInUser,
  livePeople,
  mergePersonInto,
} from '../js/people.ts'
import { getSpaceById } from '../js/space.ts'
import { personContentHash } from '../js/sync/person-hash.ts'
import { teamApi } from '../js/team-client.ts'
import { atLeast, type TeamRole } from '../js/team-roles.ts'
import { roleLabel } from '../js/team-spaces.ts'
import { t } from '../js/text.ts'
import { toast } from '../js/toast.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'

/**
 * The people who lead a space's setlists (docs/IDENTITIES.md, "People page"), in the modal opened
 * by a space's "Leaders" button (docs/ACCOUNT.md). It works on any space on this device, not only
 * the one in use. Each person has a name and addresses to change, and can be merged into another
 * (the way to clear up two spellings of one person) or deleted if they lead nothing. In a Team,
 * only worship leaders and above change people.
 */
/** A person was changed here (named, given or lost an address, merged or deleted): whoever shows the list may read it again */
export class SpacePeopleChangedEvent extends Event {
  static readonly type = 'space-people:changed'
  constructor() {
    super(SpacePeopleChangedEvent.type, { bubbles: true, composed: true })
  }
}

export class SpacePeople extends LitElement {
  static override properties = {
    spaceId: { type: String },
    only: { type: String },
    _space: { state: true },
    _people: { state: true },
    _counts: { state: true },
    _meId: { state: true },
    _email: { state: true },
    _loaded: { state: true },
  }

  /** The space whose people are shown */
  declare spaceId: string
  /** Show only this person (by id), without the introduction: the editor of the Team's list of people */
  declare only: string
  declare _space: Space | null
  declare _people: Person[]
  /** How many setlists each person leads, by id */
  declare _counts: Map<string, number>
  /** Who is the one using the app, if known */
  declare _meId: string | null
  /** The signed-in account's address, if signed in */
  declare _email: string | null
  declare _loaded: boolean

  _confirm: Ref<AppModal> = createRef()

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
        gap: 1rem;
        max-width: 800px;
        margin: 0 auto;
      }
      .hint {
        font-size: var(--font-ui-small);
        opacity: 0.75;
        margin: 0;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .people {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .part {
        padding: 0.5rem 0;
        border-top: 1px solid var(--panel-border, var(--tint, #ccc));
      }
      .part:first-child {
        border-top: 0;
        padding-top: 0;
      }
      h4 {
        margin: 0 0 0.35rem;
        font-size: var(--font-ui-small);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.75;
      }
      .person {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 0.75rem;
        border: 1px solid var(--panel-border, var(--tint, #ccc));
        border-radius: 8px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      input,
      select {
        box-sizing: border-box;
        padding: 0.5rem;
        border: 2px solid var(--border-light, #e0e0e0);
        border-radius: 6px;
        font-size: var(--font-ui);
        font-family: inherit;
        background-color: var(--bg-tertiary, white);
        color: var(--text-color);
      }
      .name {
        flex: 1;
        min-width: 10rem;
        font-weight: 600;
      }
      .chip {
        font-size: var(--font-ui-small);
        padding: 0.15rem 0.6rem;
        border: 1px solid var(--panel-border, var(--tint, #ccc));
        border-radius: 999px;
        opacity: 0.85;
      }
      .emails {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .email {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        font-size: var(--font-ui-small);
        padding: 0.1rem 0.25rem 0.1rem 0.6rem;
        border-radius: 999px;
        background: var(--bg-tertiary, #eee);
      }
      .email button {
        border: 0;
        background: none;
        cursor: pointer;
        color: inherit;
        font-size: var(--font-ui);
        padding: 0 0.4rem;
      }
      form.add {
        display: flex;
        gap: 0.5rem;
      }
      form.add input {
        flex: 1;
        min-width: 0;
      }
      .actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .error {
        color: var(--color-danger, #e74c3c);
      }
    `,
  ]

  constructor() {
    super()
    this.spaceId = ''
    this.only = ''
    this._space = null
    this._people = []
    this._counts = new Map()
    this._meId = null
    this._email = null
    this._loaded = false
  }

  override connectedCallback(): void {
    super.connectedCallback()
    void this.load()
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('spaceId') && changed.get('spaceId') !== undefined) void this.load()
  }

  /** Whether this person may change the people: anyone in a Personal space, worship leaders and above in a Team */
  get _canEdit(): boolean {
    const team = this._space?.team
    return !team || atLeast(team.role, 'writer')
  }

  /**
   * Whether this person is the one using the app in a Team: a team member who cannot change the
   * people may still name themselves (the Worker checks it is them)
   */
  _isSelfInTeam(person: Person): boolean {
    return Boolean(this._space?.team && this._email && person.emails.includes(this._email))
  }

  /** What the person is in the Team ("Worship leader"), by the address the Team knows them by */
  _roleOf(person: Person): string | null {
    if (!this._space?.team) return null
    const member = (this._space?.members ?? []).find(
      each => each.role && person.emails.includes(each.email.toLowerCase())
    )
    return member?.role ? roleLabel(member.role as TeamRole) : null
  }

  /** Read the space's people, and how many setlists each leads */
  async load(): Promise<void> {
    this._space = (await getSpaceById(this.spaceId)) ?? null
    if (!this._space) {
      // (not on this device, e.g. deleted meanwhile: no database is made for it)
      this._people = []
      this._loaded = true
      return
    }
    const db = await openSpace(this.spaceId)
    try {
      const [people, setlists, user] = await Promise.all([
        db.getAllPeople(),
        db.getAllSetlists(),
        getSignedInUser(),
      ])
      this._people = livePeople(people)
      this._email = user?.email ?? null
      this._counts = leaderCounts(people, setlists)
      this._meId =
        resolvePerson(people, chosenMeId(this.spaceId))?.id ??
        people.find(each => isLive(each) && user && each.emails.includes(user.email))?.id ??
        null
    } finally {
      db.db?.close()
    }
    this._loaded = true
  }

  /** Change the people in the space's database, then read them again; a failure is said in a toast */
  async _change(
    failure: string,
    work: (db: Awaited<ReturnType<typeof openSpace>>) => Promise<unknown>
  ) {
    try {
      const db = await openSpace(this.spaceId)
      try {
        await work(db)
      } finally {
        db.db?.close()
      }
    } catch (error) {
      console.error(`[People] ${failure}:`, error)
      toast(t(failure), { kind: 'error', details: errorMessage(error) })
    }
    await this.load()
    this.dispatchEvent(new SpacePeopleChangedEvent())
  }

  _rename(person: Person, event: Event): void {
    const input = event.target as HTMLInputElement
    const changed = renamed(person, input.value)
    // (an empty name is not one: put the old one back)
    if (changed === person) {
      input.value = person.name
      return
    }
    const team = this._space?.team
    if (team && !this._canEdit) {
      void this._nameSelf(team.id, person, changed.name)
      return
    }
    void this._change('toast-people-rename-failed', db => db.savePeople([changed]))
  }

  /**
   * A team member names themselves: the Worker changes the person's file, as they may not, and
   * what it answers with is kept here as already sent, so nothing is left to send
   */
  async _nameSelf(teamId: string, person: Person, name: string): Promise<void> {
    await this._change('toast-people-name-self-failed', async db => {
      const { file, person: stored } = await teamApi.nameSelf(teamId, person.id, name)
      await db.savePeople([
        {
          ...stored,
          fileRef: file.ref,
          fileModified: file.modified,
          fileRev: file.rev,
          lastSyncedAt: new Date().toISOString(),
          syncedContentHash: personContentHash(stored),
        },
      ])
    })
  }

  _addEmail(person: Person, event: Event): void {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    const input = form.elements.namedItem('email') as HTMLInputElement
    const problem = emailProblem(this._people, person, input.value)
    input.setCustomValidity(problem ?? '')
    if (problem) {
      input.reportValidity()
      return
    }
    const address = input.value
    input.value = ''
    void this._change('toast-people-add-address-failed', db =>
      db.savePeople([withEmail(person, address, true)])
    )
  }

  _removeEmail(person: Person, address: string): void {
    void this._change('toast-people-remove-address-failed', db =>
      db.savePeople([withEmail(person, address, false)])
    )
  }

  async _merge(person: Person, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement
    const into = this._people.find(each => each.id === select.value)
    select.value = ''
    if (!into) return
    const modal = this._confirm.value as AppModal
    modal.heading = t('confirm-person-merge-heading')
    modal.confirmLabel = t('confirm-person-merge-button')
    modal.message = t('confirm-person-merge-message', { person: person.name, into: into.name })
    if (!(await modal.ask())) return
    await this._change('toast-people-merge-failed', db => mergePersonInto(db, person.id, into.id))
  }

  async _delete(person: Person): Promise<void> {
    const modal = this._confirm.value as AppModal
    modal.heading = t('confirm-person-delete-heading')
    modal.confirmLabel = t('confirm-person-delete-button')
    modal.message = t('confirm-person-delete-message', { person: person.name })
    if (!(await modal.ask())) return
    await this._change('toast-people-delete-failed', db => deletePerson(db, person.id))
  }

  _renderPerson(person: Person) {
    const count = this._counts.get(person.id) ?? 0
    const isMe = person.id === this._meId
    const others = this._people.filter(each => each.id !== person.id)
    const editable = this._canEdit
    const role = this._roleOf(person)
    return html`
      <li class="person">
        <section class="part">
          <h4>${t('person-name-heading')}</h4>
          <div class="row">
            <input
              class="name"
              aria-label=${t('person-name-aria')}
              .value=${live(person.name)}
              ?disabled=${!editable && !this._isSelfInTeam(person)}
              @change=${(event: Event) => this._rename(person, event)}
            />
            ${isMe ? html`<span class="chip">${t('people-you')}</span>` : nothing}
            ${role ? html`<span class="chip role">${role}</span>` : nothing}
          </div>
        </section>
        <section class="part">
          <h4>${t('person-emails-heading')}</h4>
          <ul class="emails" aria-label=${t('person-emails-aria', { name: person.name })}>
            ${person.emails.map(
              address => html`<li class="email">
                ${address}
                ${
                  editable
                    ? html`<button
                      type="button"
                      aria-label=${t('person-email-remove-aria', { address })}
                      @click=${() => this._removeEmail(person, address)}
                    >×</button>`
                    : nothing
                }
              </li>`
            )}
          </ul>
          ${
            editable
              ? html`<form class="add" @submit=${(event: Event) => this._addEmail(person, event)}>
                <input
                  type="text"
                  name="email"
                  inputmode="email"
                  autocomplete="off"
                  aria-label=${t('person-email-add-aria', { name: person.name })}
                  placeholder=${t('person-email-add-placeholder')}
                  @input=${(event: Event) => (event.target as HTMLInputElement).setCustomValidity('')}
                />
                <button class="btn" type="submit">${t('person-email-add')}</button>
              </form>`
              : nothing
          }
        </section>
        ${
          editable && others.length > 0
            ? html`<section class="part">
              <h4>${t('person-merge-heading')}</h4>
              <p class="hint">${t('person-merge-hint')}</p>
              <select
                aria-label=${t('person-merge-aria', { name: person.name })}
                @change=${(event: Event) => this._merge(person, event)}
              >
                <option value="">${t('person-merge-choose')}</option>
                ${others.map(each => html`<option value=${each.id}>${each.name}</option>`)}
              </select>
            </section>`
            : nothing
        }
        ${
          editable
            ? html`<section class="part">
              <h4>${t('person-delete-heading')}</h4>
              <button
                class="btn danger"
                type="button"
                ?disabled=${count > 0 || isMe}
                @click=${() => this._delete(person)}
              >${t('person-delete')}</button>
              ${
                isMe || count > 0
                  ? html`<p class="hint">${t(isMe ? 'person-delete-you' : 'person-delete-leads')}</p>`
                  : nothing
              }
            </section>`
            : nothing
        }
      </li>
    `
  }

  override render() {
    if (!this._loaded)
      return html`<div class="content"><p class="hint">${t('people-reading')}</p></div>`
    if (!this._space) {
      return html`<div class="content"><p class="hint">${t('people-not-here')}</p></div>`
    }
    if (this.only) {
      const person = this._people.find(each => each.id === this.only)
      return html`
        <ul class="people" aria-label=${t('people-person-label')}>${person ? this._renderPerson(person) : nothing}</ul>
        <app-modal ${ref(this._confirm)} type="confirm" size="small"></app-modal>
      `
    }
    return html`
      <div class="content">
        <p class="hint">
          ${t('people-leaders-text')}
          ${this._canEdit ? nothing : t('people-leaders-read-only')}
        </p>
        ${
          this._people.length === 0
            ? html`<p class="hint">${t('people-nobody')}</p>`
            : html`<ul class="people" aria-label=${t('people-people-label')}>${this._people.map(each => this._renderPerson(each))}</ul>`
        }
      </div>
      <app-modal ${ref(this._confirm)} type="confirm" size="small"></app-modal>
    `
  }
}
customElements.define('space-people', SpacePeople)

declare global {
  interface HTMLElementTagNameMap {
    'space-people': SpacePeople
  }
}
