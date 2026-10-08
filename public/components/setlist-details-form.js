import { css, html, LitElement } from 'lit'
import { live } from 'lit/directives/live.js'
import { determineSetlistType } from '../js/db.js'

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
 * @param {object} setlist - with owner (name) and ownerId (email)
 * @param {Array<{id: string, name: string}>} people
 * @returns {{options: Array<{value: string, person: {id: string, name: string}}>, selected: string}}
 */
export function leaderChoices(setlist = {}, people = []) {
  const options = people.map(person => ({ value: `id:${person.id}`, person }))
  const owner = setlist.owner?.trim() || ''
  const ownerId = setlist.ownerId || ''
  const same = (a, b) => a.toLowerCase() === b.toLowerCase()

  if (!owner && !ownerId) return { options, selected: NO_LEADER }

  const match = ownerId
    ? options.find(o => same(o.person.id, ownerId))
    : options.find(o => same(o.person.name, owner))
  if (match) return { options, selected: match.value }

  // Not one of the people: keep them as a choice rather than lose them
  const extra = ownerId
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
 * @fires save - detail: {date, time, type, name, owner, ownerId}. The leader's
 *   name is `owner` and their id (Google account email) is `ownerId`, which is
 *   empty for a leader typed in with "Other…".
 * @fires cancel - Cancel was pressed
 */
export class SetlistDetailsForm extends LitElement {
  static properties = {
    setlist: { attribute: false },
    submitLabel: { type: String, attribute: 'submit-label' },
    autoType: { type: Boolean, attribute: 'auto-type' },
    people: { attribute: false },
    _otherLeader: { state: true },
  }

  static styles = css`
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
      color: var(--text-secondary, #95a5a6);
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
      background-color: var(--button-bg, #3498db);
      color: var(--button-text, white);
    }
  `

  constructor() {
    super()
    this.setlist = {}
    this.submitLabel = 'Save'
    this.autoType = false
    this.people = []
    this._otherLeader = false
    this._leaders = leaderChoices()
  }

  _guessType() {
    if (!this.autoType) return
    const date = this.renderRoot.getElementById('date').value
    const name = this.renderRoot.getElementById('name').value
    if (date) {
      this.renderRoot.getElementById('type').value = determineSetlistType(date, name)
    }
  }

  willUpdate(changed) {
    if (changed.has('setlist') || changed.has('people')) {
      this._leaders = leaderChoices(this.setlist, this.people)
      this._otherLeader = false
    }
  }

  updated(changed) {
    // Set selects after render (a .value binding runs before their options
    // exist), and only for a new setlist, so the user's choices aren't undone
    if (changed.has('setlist') || changed.has('people')) {
      this.renderRoot.getElementById('type').value = this.setlist?.type || SETLIST_TYPES[0]
      this.renderRoot.getElementById('leader').value = this._leaders.selected
    }
  }

  _leaderChanged(event) {
    this._otherLeader = event.target.value === OTHER_LEADER
  }

  /** The chosen leader as { owner, ownerId } */
  _leader(data) {
    const value = data.get('leader')
    if (value === OTHER_LEADER) {
      return { owner: data.get('leaderOther')?.trim() || '', ownerId: '' }
    }
    const person = this._leaders.options.find(o => o.value === value)?.person
    return { owner: person?.name || '', ownerId: person?.id || '' }
  }

  _submit(event) {
    event.preventDefault()
    const data = new FormData(event.target)
    this.dispatchEvent(
      new CustomEvent('save', {
        bubbles: true,
        composed: true,
        detail: {
          date: data.get('date'),
          time: data.get('time'),
          type: data.get('type'),
          name: data.get('name')?.trim() || '',
          ...this._leader(data),
        },
      })
    )
  }

  _cancel() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
  }

  render() {
    const s = this.setlist || {}
    const types =
      SETLIST_TYPES.includes(s.type) || !s.type ? SETLIST_TYPES : [...SETLIST_TYPES, s.type]
    return html`
      <form @submit=${this._submit}>
        <div class="form-field">
          <label for="date">Date</label>
          <input
            type="date"
            id="date"
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
          <select id="type" name="type" required>
            ${types.map(type => html`<option value=${type}>${type}</option>`)}
          </select>
        </div>
        <div class="form-field">
          <label for="name">Name (optional)</label>
          <input
            type="text"
            id="name"
            name="name"
            .value=${live(s.name || '')}
            @input=${this._guessType}
            placeholder="e.g. Youth Service, Christmas Special"
          />
        </div>
        <div class="form-field">
          <label for="leader">Leader (optional)</label>
          <select id="leader" name="leader" @change=${this._leaderChanged}>
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
