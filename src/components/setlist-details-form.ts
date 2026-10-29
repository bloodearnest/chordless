import type { PropertyValues } from 'lit'
import { css, html, LitElement } from 'lit'
import { live } from 'lit/directives/live.js'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Person, Setlist } from '../js/data-types.ts'
import { determineSetlistType, SETLIST_TYPES } from '../js/db.ts'
import { resolvePerson } from '../js/leaders.ts'

/** What the form collects (and a setlist keeps) */
export interface SetlistDetails {
  date: string
  time: string
  type: string
  name: string
  /** The chosen person's id; empty for no leader */
  leaderId: string
  /** A leader typed in with "Other…": a person to find or make (see settleLeader in people.ts) */
  newLeader?: string
}

/** One leader to choose: the select's value for them, and who they are */
export interface LeaderChoice {
  value: string
  person: Person
}

/** The form was submitted; details is {date, time, type, name, leaderId, newLeader} */
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

const SETLIST_TYPE_NAMES = Object.values(SETLIST_TYPES)

const NO_LEADER = ''
const OTHER_LEADER = 'other'

/**
 * The leader choices for a setlist: the space's people, with its leader selected. A leader
 * who is not one of the people (not synced here yet) shows as no leader.
 */
export function leaderChoices(
  setlist: { leaderId?: string | null } = {},
  people: Person[] = []
): { options: LeaderChoice[]; selected: string } {
  const options: LeaderChoice[] = people.map(person => ({ value: person.id, person }))
  const leader = resolvePerson(people, setlist.leaderId)
  return { options, selected: leader?.id ?? NO_LEADER }
}

/**
 * SetlistDetailsForm Component
 *
 * The form for a setlist's details: date, time, type, name and leader. Used
 * both to create a setlist and to edit one, so the two can't drift apart.
 *
 * Properties:
 * @property {Object} setlist - Initial values ({date, time, type, name, leaderId})
 * @property {Array} people - Who can be chosen as leader (see people.ts)
 * @property {string} submitLabel - Label for the submit button
 * @property {boolean} hideActions - Leave out the Cancel and submit buttons: the page has its own,
 *   and calls submit() to save
 * @property {boolean} autoType - Guess the type from the date and name as they
 *   change (for new setlists)
 *
 * Events:
 * @fires SetlistDetailsSaveEvent - details: {date, time, type, name, leaderId, newLeader}. The leader
 *   is a person's id, or empty; for a leader typed in with "Other…" it is empty and `newLeader`
 *   is the name typed.
 * @fires SetlistDetailsCancelEvent - Cancel was pressed
 */
export class SetlistDetailsForm extends LitElement {
  static override properties = {
    setlist: { attribute: false },
    submitLabel: { type: String, attribute: 'submit-label' },
    hideActions: { type: Boolean, attribute: 'hide-actions' },
    autoType: { type: Boolean, attribute: 'auto-type' },
    people: { attribute: false },
    _otherLeader: { state: true },
  }

  declare setlist: Partial<Setlist>
  declare submitLabel: string
  declare hideActions: boolean
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
    const typeField = this._typeField.value
    if (date && typeField) {
      typeField.value = determineSetlistType(date, this._nameField.value?.value)
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
      if (typeField) typeField.value = this.setlist.type || SETLIST_TYPE_NAMES[0]
      if (leaderField) leaderField.value = this._leaders.selected
    }
  }

  _leaderChanged(event: Event): void {
    this._otherLeader = (event.target as HTMLSelectElement).value === OTHER_LEADER
  }

  /** The chosen leader: a person's id, or the name typed in with "Other…" */
  _leader(data: FormData): { leaderId: string; newLeader?: string } {
    const value = data.get('leader')
    if (value === OTHER_LEADER) {
      // (a typed-in name, when "Other…" is chosen; the field is there then)
      return { leaderId: '', newLeader: (data.get('leaderOther') as string).trim() }
    }
    return { leaderId: (value as string) || '' }
  }

  /** Save, as the submit button does: the browser checks the fields first, and says what is wrong */
  submit(): void {
    this.shadowRoot?.querySelector('form')?.requestSubmit()
  }

  _submit(event: Event): void {
    event.preventDefault()
    const data = new FormData(event.target as HTMLFormElement)
    // (every field of the form is text)
    const field = (name: string) => data.get(name) as string
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
    const s: Partial<Setlist> = this.setlist
    const types =
      !s.type || SETLIST_TYPE_NAMES.includes(s.type)
        ? SETLIST_TYPE_NAMES
        : [...SETLIST_TYPE_NAMES, s.type]
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
        ${
          this.hideActions
            ? ''
            : html`<div class="actions">
              <button type="button" class="cancel" @click=${this._cancel}>Cancel</button>
              <button type="submit" class="submit">${this.submitLabel}</button>
            </div>`
        }
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
