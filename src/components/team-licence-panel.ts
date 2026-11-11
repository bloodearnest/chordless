import { css, html, LitElement, nothing } from 'lit'
import type { LicenceChange } from '../js/ccli-licence.ts'
import type { Space } from '../js/data-types.ts'
import { mayEditLicence, readLicence, saveLicence } from '../js/space-licence.ts'
import { errorMessage } from '../js/utils/errors.ts'
import { buttonStyles, panelStyles } from './shared-styles.ts'

/**
 * A Team's CCLI licence number (docs/SPACES.md, "SongSelect's terms"). The Worker keeps it with
 * the team, for the team's records: CCLI may ask who a licence is used by. Anyone in the Team sees
 * it; one who can write sets it where there is none, and an admin changes or clears it, with the
 * log of changes shown to them. It is also filled in by the first SongSelect chart imported.
 */
export class TeamLicencePanel extends LitElement {
  static override properties = {
    space: { attribute: false },
    _loaded: { state: true },
    _current: { state: true },
    _typed: { state: true },
    _history: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _saved: { state: true },
  }

  declare space: Space | null
  declare _loaded: boolean
  /** The number as the Worker has it */
  declare _current: string | null
  declare _typed: string
  declare _history: LicenceChange[] | null
  declare _busy: boolean
  declare _error: string
  declare _saved: boolean

  static override styles = [
    panelStyles,
    buttonStyles,
    css`
      :host { display: block; }
      .row { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; margin: 0.5rem 0; }
      input { font: inherit; padding: 0.4rem; min-width: 12rem; }
      .error { color: var(--color-danger, #e74c3c); font-weight: 600; }
      .history { font-size: 0.9em; margin: 0.5rem 0 0; padding-left: 1.2rem; }
    `,
  ]

  constructor() {
    super()
    this.space = null
    this._loaded = false
    this._current = null
    this._typed = ''
    this._history = null
    this._busy = false
    this._error = ''
    this._saved = false
  }

  override async willUpdate(changed: Map<string, unknown>): Promise<void> {
    if (changed.has('space') && this.space) await this._load(this.space)
  }

  async _load(space: Space): Promise<void> {
    this._error = ''
    try {
      const { ccliLicence, history } = await readLicence(space)
      this._current = ccliLicence
      this._typed = ccliLicence ?? ''
      this._history = history ?? null
    } catch (error) {
      this._error = errorMessage(error)
    }
    this._loaded = true
  }

  _type(event: Event): void {
    this._typed = (event.target as HTMLInputElement).value
    this._saved = false
  }

  async _save(event?: Event): Promise<void> {
    event?.preventDefault()
    // (the form is only there with a space)
    const space = this.space as Space
    this._busy = true
    this._error = ''
    this._saved = false
    try {
      await saveLicence(space, this._typed)
      await this._load(space)
      this._saved = true
    } catch (error) {
      this._error = errorMessage(error)
    }
    this._busy = false
  }

  override render() {
    const space = this.space
    if (!space) return nothing
    const may = mayEditLicence(space, this._current)
    return html`
      <h3>CCLI licence number</h3>
      <p class="hint">
        Your church's Church Copyright Licence number. Chordless keeps it with the team, as a record
        of who is using it, and may be asked for it by CCLI. It is not checked.
      </p>
      <form class="row" @submit=${this._save}>
        <label for="licence">Licence number</label>
        <input
          id="licence"
          .value=${this._typed}
          @input=${this._type}
          ?disabled=${!may || this._busy || !this._loaded}
          inputmode="numeric"
          autocomplete="off"
        />
        ${
          may
            ? html`<button class="btn primary" id="save-licence" ?disabled=${this._busy || !this._loaded}>
              Save
            </button>`
            : html`<span class="hint">Only an admin can change it.</span>`
        }
        ${this._saved ? html`<span role="status">Saved</span>` : nothing}
      </form>
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
      ${
        this._history?.length
          ? html`<ul class="history" aria-label="Changes to the licence number">
            ${this._history.map(
              change =>
                html`<li>${new Date(change.at).toLocaleDateString()}: ${change.by} ${
                  change.to
                    ? change.from
                      ? `changed it from ${change.from} to ${change.to}`
                      : `set it to ${change.to}`
                    : `cleared it (was ${change.from})`
                }</li>`
            )}
          </ul>`
          : nothing
      }
    `
  }
}
customElements.define('team-licence-panel', TeamLicencePanel)

declare global {
  interface HTMLElementTagNameMap {
    'team-licence-panel': TeamLicencePanel
  }
}
