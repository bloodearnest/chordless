import { css, html, LitElement } from 'lit'
import { live } from 'lit/directives/live.js'
import { determineSetlistType } from '../js/db.js'

export const SETLIST_TYPES = ['Church Service', 'Prayer Meeting', 'Event', 'Other']

/**
 * SetlistDetailsForm Component
 *
 * The form for a setlist's details: date, time, type, name and leader. Used
 * both to create a setlist and to edit one, so the two can't drift apart.
 *
 * Properties:
 * @property {Object} setlist - Initial values ({date, time, type, name, owner})
 * @property {string} submitLabel - Label for the submit button
 * @property {boolean} autoType - Guess the type from the date and name as they
 *   change (for new setlists)
 *
 * Events:
 * @fires save - detail: {date, time, type, name, owner}. The leader is stored
 *   as `owner`, trimmed.
 * @fires cancel - Cancel was pressed
 */
export class SetlistDetailsForm extends LitElement {
  static properties = {
    setlist: { attribute: false },
    submitLabel: { type: String, attribute: 'submit-label' },
    autoType: { type: Boolean, attribute: 'auto-type' },
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
  }

  _guessType() {
    if (!this.autoType) return
    const date = this.renderRoot.getElementById('date').value
    const name = this.renderRoot.getElementById('name').value
    if (date) {
      this.renderRoot.getElementById('type').value = determineSetlistType(date, name)
    }
  }

  /** Put the fields back to the `setlist` values, discarding anything typed */
  reset() {
    this.requestUpdate()
  }

  updated() {
    // Set after render: a .value binding on <select> runs before its options exist
    this.renderRoot.getElementById('type').value = this.setlist?.type || SETLIST_TYPES[0]
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
          owner: data.get('leader')?.trim() || '',
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
          <input
            type="text"
            id="leader"
            name="leader"
            .value=${live(s.owner || '')}
            placeholder="e.g. John Smith"
          />
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
