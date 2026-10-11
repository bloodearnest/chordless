import type { PropertyValues } from 'lit'
import { css, html, LitElement } from 'lit'
import { live } from 'lit/directives/live.js'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Person, Setlist } from '../js/data-types.ts'
import { determineSetlistType } from '../js/db.ts'

/** What the form collects (and a setlist keeps) */
export interface SetlistDetails {
  date: string
  time: string
  type: string
  name: string
  owner: string
  ownerId: string
}

/** One leader to choose: the select's value for them, and who they are */
export interface LeaderChoice {
  value: string
  person: Person
}

/** The form was submitted; details is {date, time, type, name, owner, ownerId} */
export class SetlistDetailsSaveEvent extends Event {
  static readonly type = 'setlist-details-form:save'
  readonly details: SetlistDetails
  constructor(details: SetlistDetails) {
    super(SetlistDetailsSaveEvent.type, { bubbles: true, composed: true })
    this.details = details
  }
}

/** Cancel was pressed */
export class SetlistDetailsCancelEvent extends Event {
  static readonly type = 'setlist-details-form:cancel'
  constructor() {
    super(SetlistDetailsCancelEvent.type, { bubbles: true, composed: true })
  }
}

export const SETLIST_TYPES = ['Church Service', 'Prayer Meeting', 'Event', 'Other']

const NO_LEADER = ''
const OTHER_LEADER = 'other'

/**
 * The leader choices for a setlist: the organisation's people, plus its current
 * leader if they aren't one of them.
 *
 * A leader recorded by name only (before leaders had ids) is matched to a
 * person with that name, so saving the form adds their id.
 *
 * @param setlist - with owner (name) and ownerId (email)
 */
export function leaderChoices(
  setlist: { owner?: string; ownerId?: string } = {},
  people: Person[] = []
): { options: LeaderChoice[]; selected: string } {
  const options: LeaderChoice[] = people.map(person => ({ value: `id:${person.id}`, person }))
  const owner = setlist.owner?.trim() || ''
  const ownerId = setlist.ownerId || ''
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

  if (!owner && !ownerId) return { options, selected: NO_LEADER }

  const match = ownerId
    ? options.find(o => same(o.person.id, ownerId))
    : options.find(o => same(o.person.name, owner))
  if (match) return { options, selected: match.value }

  // Not one of the people: keep them as a choice rather than lose them
  const extra: LeaderChoice = ownerId
    ? { value: `id:${ownerId}`, person: { id: ownerId, name: owner || ownerId } }
    : { value: `name:${owner}`, person: { id: '', name: owner } }
  return { options: [...options, extra], selected: extra.value }
}

/**
 * SetlistDetailsForm Component
 *
 * The form for a setlist's details: date, time, type, name and leader. Used
 * both to create a setlist and to edit one, so the two can't drift apart.
 *
 * Properties:
 * @property {Object} setlist - Initial values ({date, time, type, name, owner, ownerId})
 * @property {Array} people - Who can be chosen as leader: [{id, name}] (see people.js)
 * @property {string} submitLabel - Label for the submit button
 * @property {boolean} autoType - Guess the type from the date and name as they
 *   change (for new setlists)
 *
 * Events:
 * @fires SetlistDetailsSaveEvent - details: {date, time, type, name, owner, ownerId}. The leader's
 *   name is `owner` and their id (Google account email) is `ownerId`, which is
 *   empty for a leader typed in with "Other…".
 * @fires SetlistDetailsCancelEvent - Cancel was pressed
 */
export class SetlistDetailsForm extends LitElement {
  static override properties = {
    setlist: { attribute: false },
    submitLabel: { type: String, attribute: 'submit-label' },
    autoType: { type: Boolean, attribute: 'auto-type' },
    people: { attribute: false },
    _otherLeader: { state: true },
  }

  declare setlist: Partial<Setlist>
  declare submitLabel: string
  declare autoType: boolean
  declare people: Person[]
  declare _otherLeader: boolean

  _dateField: Ref<HTMLInputElement>
  _nameField: Ref<HTMLInputElement>
  _typeField: Ref<HTMLSelectElement>
  _leaderField: Ref<HTMLSelectElement>
  _leaders: { options: LeaderChoice[]; selected: string }

  static override styles = css`
    :host {
      display: block;
    }

    .form-field {
      margin-bottom: 1.5rem;
    }

    label {
      display: block;
      margin-bottom: 0.5rem;
      color: var(--text-color);
      font-weight: 600;
      font-size: var(--font-ui);
    }

    input,
    select {
      box-sizing: border-box;
      width: 100%;
      padding: 0.75rem;
      border: 2px solid var(--border-light, #e0e0e0);
      border-radius: 6px;
      font-size: var(--font-ui);
      font-family: inherit;
      background-color: var(--bg-tertiary, white);
      color: var(--text-color);
      transition: border-color 0.2s ease;
    }


    input:focus,
    select:focus {
      outline: none;
      border-color: var(--button-bg);
    }

    .other-leader {
      margin-top: 0.5rem;
    }

    input::placeholder {
      color: var(--text-secondary, #5f6b6d);
    }

    .actions {
      display: flex;
      gap: 1rem;
      margin-top: 2rem;
      justify-content: flex-end;
    }

    button {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 6px;
      font-size: var(--font-ui-small);
      font-weight: 600;
      cursor: pointer;
      min-width: 100px;
    }

    .cancel {
      background-color: var(--bg-tertiary, #ecf0f1);
      color: var(--text-color);
    }

    .submit {
      background-color: var(--button-bg, #2477ad);
      color: var(--button-text, white);
    }
  `

  constructor() {
    super()
    this._dateField = createRef()
    this._nameField = createRef()
    this._typeField = createRef()
    this._leaderField = createRef()
    this.setlist = {}
    this.submitLabel = 'Save'
    this.autoType = false
    this.people = []
    this._otherLeader = false
    this._leaders = leaderChoices()
  }

  _guessType(): void {
    if (!this.autoType) return
    const date = this._dateField.value?.value
    const name = this._nameField.value?.value
    const typeField = this._typeField.value
    if (date && typeField) {
      typeField.value = determineSetlistType(date, name)
    }
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('setlist') || changed.has('people')) {
      this._leaders = leaderChoices(this.setlist, this.people)
      this._otherLeader = false
    }
  }

  override updated(changed: PropertyValues<this>): void {
    // Set selects after render (a .value binding runs before their options
    // exist), and only for a new setlist, so the user's choices aren't undone
    if (changed.has('setlist') || changed.has('people')) {
      const typeField = this._typeField.value
      const leaderField = this._leaderField.value
      if (typeField) typeField.value = this.setlist?.type || SETLIST_TYPES[0]
      if (leaderField) leaderField.value = this._leaders.selected
    }
  }

  _leaderChanged(event: Event): void {
    this._otherLeader = (event.target as HTMLSelectElement).value === OTHER_LEADER
  }

  /** The chosen leader as { owner, ownerId } */
  _leader(data: FormData): { owner: string; ownerId: string } {
    const value = data.get('leader')
    if (value === OTHER_LEADER) {
      const other = data.get('leaderOther')
      return { owner: (typeof other === 'string' && other.trim()) || '', ownerId: '' }
    }
    const person = this._leaders.options.find(o => o.value === value)?.person
    return { owner: person?.name || '', ownerId: person?.id || '' }
  }

  _submit(event: Event): void {
    event.preventDefault()
    const data = new FormData(event.target as HTMLFormElement)
    const field = (name: string): string => {
      const value = data.get(name)
      return typeof value === 'string' ? value : ''
    }
    this.dispatchEvent(
      new SetlistDetailsSaveEvent({
        date: field('date'),
        time: field('time'),
        type: field('type'),
        name: field('name').trim(),
        ...this._leader(data),
      })
    )
  }

  _cancel(): void {
    this.dispatchEvent(new SetlistDetailsCancelEvent())
  }

  override render() {
    const s: Partial<Setlist> = this.setlist || {}
    const types =
      !s.type || SETLIST_TYPES.includes(s.type) ? SETLIST_TYPES : [...SETLIST_TYPES, s.type]
    return html`
      <form @submit=${this._submit}>
        <div class="form-field">
          <label for="date">Date</label>
          <input
            type="date"
            id="date"
            ${ref(this._dateField)}
            name="date"
            .value=${live(s.date || '')}
            @change=${this._guessType}
            required
          />
        </div>
        <div class="form-field">
          <label for="time">Time</label>
          <input type="time" id="time" name="time" .value=${live(s.time || '10:30')} required />
        </div>
        <div class="form-field">
          <label for="type">Type</label>
          <select id="type" name="type" required ${ref(this._typeField)}>
            ${types.map(type => html`<option value=${type}>${type}</option>`)}
          </select>
        </div>
        <div class="form-field">
          <label for="name">Name (optional)</label>
          <input
            type="text"
            id="name"
            ${ref(this._nameField)}
            name="name"
            .value=${live(s.name || '')}
            @input=${this._guessType}
            placeholder="e.g. Youth Service, Christmas Special"
          />
        </div>
        <div class="form-field">
          <label for="leader">Leader (optional)</label>
          <select id="leader" name="leader" ${ref(this._leaderField)} @change=${this._leaderChanged}>
            <option value="">No leader</option>
            ${this._leaders.options.map(
              o => html`<option value=${o.value}>${o.person.name}</option>`
            )}
            <option value=${OTHER_LEADER}>Other…</option>
          </select>
          ${
            this._otherLeader
              ? html`
                <input
                  type="text"
                  id="leader-other"
                  name="leaderOther"
                  class="other-leader"
                  aria-label="Leader's name"
                  placeholder="Leader's name"
                  required
                />
              `
              : ''
          }
        </div>
        <div class="actions">
          <button type="button" class="cancel" @click=${this._cancel}>Cancel</button>
          <button type="submit" class="submit">${this.submitLabel}</button>
        </div>
      </form>
    `
  }
}

customElements.define('setlist-details-form', SetlistDetailsForm)

declare global {
  interface HTMLElementTagNameMap {
    'setlist-details-form': SetlistDetailsForm
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [SetlistDetailsSaveEvent.type]: SetlistDetailsSaveEvent
    [SetlistDetailsCancelEvent.type]: SetlistDetailsCancelEvent
  }
}
