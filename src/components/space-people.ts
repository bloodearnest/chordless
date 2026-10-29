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
import { atLeast } from '../js/team-roles.ts'
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
export class SpacePeople extends LitElement {
  static override properties = {
    spaceId: { type: String },
    _space: { state: true },
    _people: { state: true },
    _counts: { state: true },
    _meId: { state: true },
    _loaded: { state: true },
  }

  /** The space whose people are shown */
  declare spaceId: string
  declare _space: Space | null
  declare _people: Person[]
  /** How many setlists each person leads, by id */
  declare _counts: Map<string, number>
  /** Who is the one using the app, if known */
  declare _meId: string | null
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
      .person {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
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
    this._space = null
    this._people = []
    this._counts = new Map()
    this._meId = null
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
    what: string,
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
      console.error(`[People] Could not ${what}:`, error)
      toast(`Couldn't ${what}.`, { kind: 'error', details: errorMessage(error) })
    }
    await this.load()
  }

  _rename(person: Person, event: Event): void {
    const input = event.target as HTMLInputElement
    const changed = renamed(person, input.value)
    // (an empty name is not one: put the old one back)
    if (changed === person) {
      input.value = person.name
      return
    }
    void this._change('rename them', db => db.savePeople([changed]))
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
    void this._change('add the address', db => db.savePeople([withEmail(person, address, true)]))
  }

  _removeEmail(person: Person, address: string): void {
    void this._change('remove the address', db =>
      db.savePeople([withEmail(person, address, false)])
    )
  }

  async _merge(person: Person, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement
    const into = this._people.find(each => each.id === select.value)
    select.value = ''
    if (!into) return
    const modal = this._confirm.value as AppModal
    modal.heading = 'Merge?'
    modal.confirmLabel = 'Merge'
    modal.message =
      `Merge ${person.name} into ${into.name}? The setlists ${person.name} leads are ${into.name}'s, ` +
      `and ${into.name} gains their email addresses.` +
      ` ${person.name} is no longer listed.`
    if (!(await modal.ask())) return
    await this._change('merge them', db => mergePersonInto(db, person.id, into.id))
  }

  async _delete(person: Person): Promise<void> {
    const modal = this._confirm.value as AppModal
    modal.heading = 'Delete?'
    modal.confirmLabel = 'Delete'
    modal.message = `Delete ${person.name}? They lead no setlists. They are removed from the Leader menu.`
    if (!(await modal.ask())) return
    await this._change('delete them', db => deletePerson(db, person.id))
  }

  _renderPerson(person: Person) {
    const count = this._counts.get(person.id) ?? 0
    const isMe = person.id === this._meId
    const others = this._people.filter(each => each.id !== person.id)
    const editable = this._canEdit
    return html`
      <li class="person">
        <div class="row">
          <input
            class="name"
            aria-label="Name"
            .value=${live(person.name)}
            ?disabled=${!editable}
            @change=${(event: Event) => this._rename(person, event)}
          />
          ${isMe ? html`<span class="chip">you</span>` : nothing}
          <span class="chip">${count === 0 ? 'leads none' : `leads ${count}`}</span>
        </div>
        <ul class="emails" aria-label="Email addresses of ${person.name}">
          ${person.emails.map(
            address => html`<li class="email">
              ${address}
              ${
                editable
                  ? html`<button
                    type="button"
                    aria-label="Remove ${address}"
                    @click=${() => this._removeEmail(person, address)}
                  >×</button>`
                  : nothing
              }
            </li>`
          )}
        </ul>
        ${
          editable
            ? html`
              <form class="add" @submit=${(event: Event) => this._addEmail(person, event)}>
                <input
                  type="text"
                  name="email"
                  inputmode="email"
                  autocomplete="off"
                  aria-label="Add an email address to ${person.name}"
                  placeholder="Add an email address"
                  @input=${(event: Event) => (event.target as HTMLInputElement).setCustomValidity('')}
                />
                <button class="btn" type="submit">Add</button>
              </form>
              <div class="actions">
                ${
                  others.length > 0
                    ? html`<select
                      aria-label="Merge ${person.name} into"
                      @change=${(event: Event) => this._merge(person, event)}
                    >
                      <option value="">Merge into…</option>
                      ${others.map(each => html`<option value=${each.id}>${each.name}</option>`)}
                    </select>`
                    : nothing
                }
                <button
                  class="btn"
                  type="button"
                  ?disabled=${count > 0 || isMe}
                  title=${isMe ? 'This is you' : count > 0 ? 'They lead setlists' : ''}
                  @click=${() => this._delete(person)}
                >Delete</button>
              </div>
            `
            : nothing
        }
      </li>
    `
  }

  override render() {
    if (!this._loaded) return html`<div class="content"><p class="hint">Reading…</p></div>`
    if (!this._space) {
      return html`<div class="content"><p class="hint">This space is not on this device.</p></div>`
    }
    return html`
      <div class="content">
        <p class="hint">
          The people who lead this space's setlists. Two spellings of one person are put right by
          merging one into the other.
          ${this._canEdit ? nothing : ' Only worship leaders can change them.'}
        </p>
        ${
          this._people.length === 0
            ? html`<p class="hint">Nobody leads a setlist here yet.</p>`
            : html`<ul class="people" aria-label="People">${this._people.map(each => this._renderPerson(each))}</ul>`
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
