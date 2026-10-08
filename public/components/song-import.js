import { css, html, LitElement } from 'lit'
import { createSetlist, determineSetlistType, getCurrentDB, getNextSunday } from '../js/db.js'
import { getOrganisationPeople } from '../js/people.js'
import { createSong, findExistingSong } from '../js/song-utils.js'
import { formatSetlistDate, toLocalDateString } from '../js/utils/date-utils.js'
import './app-modal.js'
import './setlist-details-form.js'

const SONGSELECT_ORIGIN = 'https://songselect.ccli.com'

/**
 * SongImport Component
 *
 * The page the SongSelect bookmarklet opens. It tells the bookmarklet it's
 * ready, receives the song, saves it to the library (or finds the copy already
 * there), then offers: add it to a setlist, add it to a new setlist, or just
 * keep it in the library. Each choice ends by going to the setlist or library.
 *
 * Usage:
 *   <song-import></song-import>
 *
 * Events:
 * @fires imported - detail: {url} where the page is about to go. Cancelable:
 *   preventDefault() stops the navigation (for tests).
 */
export class SongImport extends LitElement {
  static properties = {
    _state: { state: true }, // 'waiting' | 'choices' | 'error'
    _error: { state: true },
    _song: { state: true },
    _isDuplicate: { state: true },
    _duplicateChoice: { state: true }, // null | 'update' | 'use-existing'
    _setlists: { state: true },
    _people: { state: true },
    _newSetlist: { state: true },
  }

  static styles = css`
    /* The page's own reset (* { margin: 0; padding: 0 }) beats :host, so the
       spacing goes on .page */
    :host {
      display: block;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      color: var(--text-color);
    }

    .page {
      max-width: 600px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }

    .status {
      text-align: center;
      color: var(--text-secondary, #7f8c8d);
    }

    .status.error {
      color: var(--color-danger, #e74c3c);
    }

    h2 {
      margin: 0 0 1.5rem;
      font-size: var(--font-ui);
    }

    .duplicate {
      background: #fff3cd;
      color: #1a1a1a;
      border: 2px solid #ffc107;
      border-radius: 8px;
      padding: 1.5rem;
    }

    .duplicate strong {
      display: block;
      margin-bottom: 0.75rem;
    }

    .duplicate p {
      margin: 0 0 1rem;
    }

    .duplicate-actions {
      display: flex;
      gap: 0.75rem;
    }

    .duplicate-actions button {
      flex: 1;
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 6px;
      font-size: var(--font-ui-small);
      font-weight: 600;
      cursor: pointer;
    }

    .update {
      background-color: var(--button-bg, #3498db);
      color: var(--button-text, white);
    }

    .use-existing {
      background-color: var(--bg-tertiary, #ecf0f1);
      color: var(--text-color);
    }

    .choices {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .choice {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      padding: 1.5rem;
      background: var(--bg-color, white);
      color: var(--text-color);
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 12px;
      font: inherit;
      text-align: left;
      width: 100%;
      box-sizing: border-box;
    }

    button.choice {
      cursor: pointer;
      transition:
        border-color 0.2s,
        background-color 0.2s;
    }

    button.choice:hover {
      background: var(--bg-secondary, #f8f9fa);
      border-color: var(--button-bg);
    }

    .icon,
    .title,
    .subtitle {
      display: block;
    }

    .icon {
      font-size: var(--font-ui);
      flex-shrink: 0;
    }

    .content {
      flex: 1;
      min-width: 0;
    }

    .title {
      font-size: var(--font-ui-small);
      font-weight: 600;
      margin-bottom: 0.25rem;
    }

    .subtitle {
      font-size: var(--font-ui-small);
      color: var(--text-secondary, #7f8c8d);
    }

    .setlist-picker {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    select {
      flex: 1;
      min-width: 0;
      padding: 0.5rem 0.75rem;
      font-size: var(--font-ui-small);
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 6px;
      background-color: var(--bg-secondary, #f8f9fa);
      color: var(--text-color);
    }

    select:focus {
      outline: none;
      border-color: var(--button-bg);
    }

    .add {
      padding: 0.5rem 1.25rem;
      border: none;
      border-radius: 6px;
      font-size: var(--font-ui-small);
      font-weight: 600;
      background-color: var(--button-bg, #3498db);
      color: var(--button-text, white);
      cursor: pointer;
    }

    .add:hover {
      background-color: var(--button-hover, #2980b9);
    }
  `

  constructor() {
    super()
    this._state = 'waiting'
    this._error = ''
    this._song = null
    this._isDuplicate = false
    this._duplicateChoice = null
    this._setlists = []
    this._people = []
    this._newSetlist = null
    this._onMessage = this._onMessage.bind(this)
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('message', this._onMessage)
    this._signalReady()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('message', this._onMessage)
  }

  _onMessage(event) {
    if (event.origin !== SONGSELECT_ORIGIN) return
    if (event.data?.type === 'CHORDLESS_IMPORT') {
      console.log('[Import] Received import message from:', event.origin)
      this.receive(event.data.data)
    }
  }

  /** Tell the bookmarklet's page (our opener) that we can take the song */
  _signalReady() {
    if (!window.opener) return
    try {
      window.opener.postMessage({ type: 'CHORDLESS_READY' }, SONGSELECT_ORIGIN)
    } catch (error) {
      console.log('[Import] Could not signal opener:', error)
    }
  }

  /**
   * Import a song: {chordproText, metadata: {title, ccliNumber}, source}.
   * Saves it to the library, unless a copy is already there, and shows the
   * choices.
   */
  async receive({ chordproText, metadata = {}, source }) {
    console.log('[Import] Processing import from', source, metadata.title)
    try {
      this._db = await getCurrentDB()
      const ccliNumber = metadata.ccliNumber || null
      const title = metadata.title || 'Untitled'

      const existing = await findExistingSong(ccliNumber, title, this._db)
      this._song =
        existing ||
        (await createSong(chordproText, {
          ccliNumber,
          title,
          source,
          sourceUrl: null,
          versionLabel: 'Original (SongSelect)',
        }))
      this._isDuplicate = Boolean(existing)
      this._duplicateChoice = null

      const setlists = await this._db.getAllSetlists()
      this._setlists = setlists.sort((a, b) => b.date.localeCompare(a.date))
      this._state = 'choices'
    } catch (error) {
      console.error('[Import] Failed to process song:', error)
      this._showError(`Failed to process song: ${error.message}`)
    }
  }

  _showError(message) {
    this._error = message
    this._state = 'error'
  }

  /** Go to url, unless an imported listener prevents it */
  _finish(url) {
    const event = new CustomEvent('imported', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: { url },
    })
    if (this.dispatchEvent(event)) window.location.href = url
  }

  async _addToSetlist(setlistId) {
    try {
      const setlist = await this._db.getSetlist(setlistId)
      if (!setlist) throw new Error('Setlist not found')
      setlist.songs.push({
        order: setlist.songs.length,
        songId: this._song.id,
        songUuid: this._song.uuid,
        key: null,
        tempo: null,
        notes: '',
      })
      setlist.modifiedDate = new Date().toISOString()
      await this._db.saveSetlist(setlist)
      console.log('[Import] Added song to setlist:', setlistId)
      this._finish(`/setlist/${setlistId}`)
    } catch (error) {
      console.error('[Import] Error:', error)
      this._showError(`Failed to save song: ${error.message}`)
    }
  }

  _addToChosenSetlist() {
    const select = this.renderRoot.querySelector('select')
    this._addToSetlist(select.value)
  }

  _libraryOnly() {
    // The song was saved to the library when it arrived
    this._finish(`/songs#${this._song.uuid}`)
  }

  /** Open the new setlist form with defaults: next Sunday morning, led by you */
  async _openNewSetlist() {
    const { people, me } = await getOrganisationPeople()
    const date = toLocalDateString(getNextSunday())
    this._people = people
    this._newSetlist = {
      date,
      time: '10:30',
      type: determineSetlistType(date, ''),
      name: '',
      owner: me?.name || '',
      ownerId: me?.id || '',
    }
    await this.updateComplete
    this._newSetlistModal().show()
  }

  async _createSetlist(event) {
    event.stopPropagation()
    const setlist = createSetlist(event.detail)
    try {
      await this._db.saveSetlist(setlist)
      console.log('[Import] Created new setlist:', setlist.id)
    } catch (error) {
      console.error('[Import] Error creating setlist:', error)
      this._newSetlistModal().close()
      this._showError(`Failed to create setlist: ${error.message}`)
      return
    }
    this._newSetlistModal().close()
    await this._addToSetlist(setlist.id)
  }

  _newSetlistModal() {
    return this.renderRoot.querySelector('app-modal')
  }

  render() {
    return html`<div class="page">${this._renderState()}</div>`
  }

  _renderState() {
    if (this._state === 'waiting') {
      return html`<p class="status">Waiting for song data from bookmarklet...</p>`
    }
    if (this._state === 'error') {
      return html`<p class="status error" role="alert">❌ ${this._error}</p>`
    }
    return html`
      <h2>✅ ${this._song.title}</h2>
      ${this._isDuplicate && !this._duplicateChoice ? this._renderDuplicate() : this._renderChoices()}
      <app-modal heading="Create New Setlist">
        ${
          this._newSetlist
            ? html`
              <setlist-details-form
                .setlist=${this._newSetlist}
                .people=${this._people}
                submit-label="Create & Add Song"
                auto-type
                @save=${this._createSetlist}
                @cancel=${() => this._newSetlistModal().close()}
              ></setlist-details-form>
            `
            : ''
        }
      </app-modal>
    `
  }

  _renderDuplicate() {
    const choose = choice => () => {
      this._duplicateChoice = choice
    }
    return html`
      <div class="duplicate">
        <strong>⚠️ This song already exists in your library</strong>
        <p>Do you want to update the song with the new version, or use the existing one?</p>
        <div class="duplicate-actions">
          <button class="update" @click=${choose('update')}>Update Song</button>
          <button class="use-existing" @click=${choose('use-existing')}>Use Existing</button>
        </div>
      </div>
    `
  }

  _renderChoices() {
    return html`
      <div class="choices">
        ${
          this._setlists.length
            ? html`
              <div class="choice add-to-setlist">
                <div class="icon">📋</div>
                <div class="content">
                  <label class="title" for="setlist">Add to Setlist</label>
                  <div class="setlist-picker">
                    <select id="setlist">
                      ${this._setlists.map(setlist => {
                        const date = formatSetlistDate(setlist.date, 'short')
                        return html`<option value=${setlist.id}>
                          ${setlist.name ? `${date} - ${setlist.name}` : date}
                        </option>`
                      })}
                    </select>
                    <button class="add" @click=${this._addToChosenSetlist}>Add</button>
                  </div>
                </div>
              </div>
            `
            : ''
        }
        <button class="choice new-setlist" @click=${this._openNewSetlist}>
          <span class="icon">➕</span>
          <span class="content">
            <span class="title">Create New Setlist</span>
            <span class="subtitle">Start a fresh setlist with this song</span>
          </span>
        </button>
        <button class="choice library-only" @click=${this._libraryOnly}>
          <span class="icon">💾</span>
          <span class="content">
            <span class="title">Save to Library Only</span>
            <span class="subtitle">Don't add to any setlist</span>
          </span>
        </button>
      </div>
    `
  }
}

customElements.define('song-import', SongImport)
