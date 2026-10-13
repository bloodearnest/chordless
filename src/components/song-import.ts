import { css, html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { Person, Setlist, SongRecord } from '../js/data-types.ts'
import type { ChordlessDB } from '../js/db.ts'
import { createSetlist, determineSetlistType, getCurrentDB, getNextSunday } from '../js/db.ts'
import { IncomingSongsEvent, takeIncoming } from '../js/incoming-songs.ts'
import { ChordProParser } from '../js/parser.ts'
import { getCurrentPerson, getOrganisationPeople } from '../js/people.ts'
import type { Shared } from '../js/shared-incoming.ts'
import { createSong, findExistingSong, overwriteSong } from '../js/song-utils.ts'
import { formatSetlistDate, toLocalDateString } from '../js/utils/date-utils.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import type { SetlistDetailsSaveEvent } from './setlist-details-form.ts'
import './setlist-details-form.ts'
import { goTo } from '../js/navigation.ts'
import { buttonStyles } from './shared-styles.ts'

/** The import is done, and the page is about to go to url. Cancelable: preventDefault() stops the navigation (for tests) */
export class SongImportedEvent extends Event {
  static readonly type = 'song-import:imported'
  readonly url: string
  constructor(url: string) {
    super(SongImportedEvent.type, { bubbles: true, composed: true, cancelable: true })
    this.url = url
  }
}

const SONGSELECT_ORIGIN = 'https://songselect.ccli.com'

const parser = new ChordProParser()

const NOT_TEXT = /^(image|audio|video|font)\/|^application\/(pdf|zip)/

/** A song arriving to be imported (from a file, pasted text or the bookmarklet) */
export interface IncomingSong {
  name?: string
  chordproText?: string
  metadata?: { title?: string; ccliNumber?: string | null }
  source?: string
  /** Why it cannot be imported, if it cannot */
  skip?: string
}

/** A song that was imported, and what to do if it was already in the library */
interface ImportItem {
  song: SongRecord
  chordproText: string
  isDuplicate: boolean
  choice: 'update' | 'use-existing' | null
}

/** "Amazing Grace.cho" -> "Amazing Grace" */
function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

/**
 * SongImport Component
 *
 * Imports songs from ChordPro files the user picks, ChordPro text they paste,
 * or the SongSelect bookmarklet (this is the page it opens: it tells the
 * bookmarklet it's ready and receives the song). Each song is saved to the
 * library, unless a copy is already there, when the user chooses whether to
 * update it. Then it offers: add the songs to a setlist, add them to a new
 * setlist, or just keep them in the library. Each choice ends by going to the
 * setlist or library.
 *
 * Usage:
 *   <song-import></song-import>
 *
 * Events:
 * @fires SongImportedEvent - url, where the page is about to go. Cancelable:
 *   preventDefault() stops the navigation (for tests).
 */
export class SongImport extends LitElement {
  static override properties = {
    _state: { state: true }, // 'pick' | 'choices'
    _error: { state: true },
    // [{song, chordproText, isDuplicate, choice: null | 'update' | 'use-existing'}]
    _imports: { state: true },
    _skipped: { state: true }, // ['name: reason'], files that weren't songs
    _setlists: { state: true },
    _people: { state: true },
    _newSetlist: { state: true },
  }

  declare _state: 'pick' | 'choices'
  declare _error: string
  declare _imports: ImportItem[]
  declare _skipped: string[]
  declare _setlists: Setlist[]
  declare _people: Person[]
  declare _newSetlist: Partial<Setlist> | null

  _paste: Ref<HTMLTextAreaElement>
  _setlistSelect: Ref<HTMLSelectElement>
  _newSetlistModalRef: Ref<AppModal>
  _db: ChordlessDB | null = null

  static override styles = [
    buttonStyles,
    css`
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
      color: var(--text-secondary, #5f6b6d);
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

    .duplicate-actions .btn {
      flex: 1;
      font-size: var(--font-ui-small);
    }

    .choices {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .choice {
      position: relative;
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

    button.choice,
    label.choice,
    a.choice {
      cursor: pointer;
      transition:
        border-color 0.2s,
        background-color 0.2s;
    }

    a.choice {
      text-decoration: none;
    }

    label.choice:focus-within {
      outline: 2px solid var(--button-bg);
    }

    /* The whole label opens the picker; the input itself stays reachable by
       keyboard and screen readers */
    label.choice input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
    }

    textarea {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin: 0.5rem 0;
      padding: 0.5rem 0.75rem;
      font-family: monospace;
      font-size: var(--font-ui-small);
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 6px;
      background-color: var(--bg-secondary, #f8f9fa);
      color: var(--text-color);
      resize: vertical;
    }

    textarea:focus {
      outline: none;
      border-color: var(--button-bg);
    }

    .songs {
      margin: 0 0 1.5rem;
      padding-left: 1.5rem;
    }

    .songs li {
      margin-bottom: 0.25rem;
    }

    .songs .subtitle {
      display: inline;
    }

    .status.error + .duplicate,
    .status.error + .choices {
      margin-top: 1rem;
    }

    .duplicate ul {
      list-style: none;
      margin: 0 0 1rem;
      padding: 0;
    }

    .duplicate li {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid #ffc107;
    }

    .duplicate li > span:first-child {
      flex: 1;
      min-width: 0;
    }

    .duplicate li button {
      padding: 0.4rem 0.75rem;
    }

    button.choice:hover,
    label.choice:hover,
    a.choice:hover {
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
      color: var(--text-secondary, #5f6b6d);
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
      font-size: var(--font-ui-small);
    }
  `,
  ]

  constructor() {
    super()
    this._paste = createRef()
    this._setlistSelect = createRef()
    this._newSetlistModalRef = createRef()
    this._state = 'pick'
    this._error = ''
    this._imports = []
    this._skipped = []
    this._setlists = []
    this._people = []
    this._newSetlist = null
    this._onMessage = this._onMessage.bind(this)
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('message', this._onMessage)
    window.addEventListener(IncomingSongsEvent.type, this._onIncoming)
    this._signalReady()
    // Files the system opened with Chordless, or something another app shared to it
    void this._takeIncoming()
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    window.removeEventListener('message', this._onMessage)
    window.removeEventListener(IncomingSongsEvent.type, this._onIncoming)
  }

  _onIncoming = (): void => {
    void this._takeIncoming()
  }

  async _takeIncoming(): Promise<void> {
    const incoming = await takeIncoming()
    if (!incoming) return
    const songs = await this._songsFromFiles(incoming.files)
    if (incoming.text.trim()) {
      songs.push({ name: 'Shared text', chordproText: incoming.text, source: 'share' })
    }
    await this.receiveAll(songs)
    this._reportUnusual(incoming)
  }

  /** Temporary probe: say what a share held beyond ChordPro files and text, to see what WhatsApp sends */
  _reportUnusual(incoming: Shared): void {
    if (
      !incoming.title &&
      !incoming.url &&
      incoming.files.every(f => !f.type.startsWith('application/'))
    )
      return
    const files = incoming.files.map(f => `${f.name} (${f.type || 'no type'}, ${f.size} bytes)`)
    this._showError(
      [
        `Received ${incoming.files.length} file(s): ${files.join('; ') || 'none'}`,
        `title: ${incoming.title || '-'}`,
        `url: ${incoming.url || '-'}`,
        `text: ${incoming.text.slice(0, 500) || '-'}`,
      ].join(' | ')
    )
  }

  _onMessage(event: MessageEvent): void {
    if (event.origin !== SONGSELECT_ORIGIN) return
    if (event.data?.type === 'CHORDLESS_IMPORT') {
      console.log('[Import] Received import message from:', event.origin)
      this.receive(event.data.data)
    } else if (event.data?.type === 'CHORDLESS_IMPORT_FAILED') {
      this._showError(`Import from SongSelect failed: ${event.data.data?.message}`)
    }
  }

  /** Tell the bookmarklet's page (our opener) that we can take the song */
  _signalReady(): void {
    if (!window.opener) return
    try {
      window.opener.postMessage({ type: 'CHORDLESS_READY' }, SONGSELECT_ORIGIN)
    } catch (error) {
      console.log('[Import] Could not signal opener:', error)
    }
  }

  /**
   * Import a song from the bookmarklet: {chordproText, metadata: {title,
   * ccliNumber}, source}
   */
  receive(song: IncomingSong): Promise<void> {
    return this.receiveAll([song])
  }

  /** Import songs from ChordPro files */
  async importFiles(files: File[]): Promise<void> {
    await this.receiveAll(await this._songsFromFiles(files))
  }

  /** The songs in ChordPro files (one that is not text is listed as skipped) */
  async _songsFromFiles(files: File[]): Promise<IncomingSong[]> {
    const songs: IncomingSong[] = []
    for (const file of files) {
      // ChordPro has no registered type, so .cho files come as '' or
      // application/octet-stream: rule out what's plainly not text instead
      const chordproText = NOT_TEXT.test(file.type) ? '' : await file.text()
      if (!chordproText || chordproText.includes('\0')) {
        songs.push({ name: file.name, skip: 'not a text file' })
        continue
      }
      songs.push({
        name: file.name,
        chordproText,
        metadata: { title: titleFromFileName(file.name) },
        source: 'file',
      })
    }
    return songs
  }

  async _onFilesChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const files = [...(input.files ?? [])]
    input.value = '' // so choosing the same files again still imports
    if (files.length) await this.importFiles(files)
  }

  _importPasted(): void {
    const chordproText = this._paste.value?.value ?? ''
    this.receiveAll([{ name: 'Pasted text', chordproText, source: 'paste' }])
  }

  /**
   * Import songs: [{chordproText, metadata: {title, ccliNumber}, source, name}].
   * Saves each to the library, unless a copy is already there, and shows the
   * choices. A song with `skip` (a reason) is listed as not imported.
   */
  async receiveAll(songs: IncomingSong[]): Promise<void> {
    console.log('[Import] Importing', songs.length, 'song(s)')
    this._error = ''
    try {
      const db = await getCurrentDB()
      this._db = db
      const imports: ImportItem[] = []
      const skipped: string[] = []
      for (const { chordproText = '', metadata = {}, source, name, skip } of songs) {
        if (skip || !chordproText.trim()) {
          skipped.push(`${name}: ${skip || 'empty'}`)
          continue
        }
        // As createSong does: the chart's own title and CCLI number win
        const parsed = parser.parse(chordproText).metadata
        const ccliNumber = parsed.ccliSongNumber || parsed.ccli || metadata.ccliNumber || null
        const title = parsed.title || metadata.title || 'Untitled'

        const existing = await findExistingSong(ccliNumber, title, db)
        const song =
          existing || (await createSong(chordproText, { ccliNumber, title, importSource: source }))
        imports.push({ song, chordproText, isDuplicate: Boolean(existing), choice: null })
      }
      this._skipped = skipped
      if (!imports.length) {
        this._showError(`No songs to import. ${skipped.join(', ')}`)
        return
      }
      this._imports = imports

      const setlists = await db.getAllSetlists()
      this._setlists = setlists.sort((a, b) => b.date.localeCompare(a.date))
      this._state = 'choices'
    } catch (error) {
      console.error('[Import] Failed to process song:', error)
      this._showError(`Failed to process song: ${errorMessage(error)}`)
    }
  }

  _showError(message: string): void {
    this._error = message
    this._state = 'pick'
  }

  /** Go to url, unless an imported listener prevents it */
  _finish(url: string): void {
    const event = new SongImportedEvent(url)
    if (this.dispatchEvent(event)) goTo(url)
  }

  async _addToSetlist(setlistId: string): Promise<void> {
    try {
      const db = this._database()
      const setlist = await db.getSetlist(setlistId)
      if (!setlist) throw new Error('Setlist not found')
      for (const { song } of this._imports) {
        setlist.songs.push({
          order: setlist.songs.length,
          songId: song.id,
          songUuid: song.uuid,
          key: null,
          tempo: null,
          notes: '',
        })
      }
      setlist.modifiedDate = new Date().toISOString()
      await db.saveSetlist(setlist)
      console.log('[Import] Added', this._imports.length, 'song(s) to setlist:', setlistId)
      this._finish(`/setlist/${setlistId}`)
    } catch (error) {
      console.error('[Import] Error:', error)
      this._showError(`Failed to save song: ${errorMessage(error)}`)
    }
  }

  _addToChosenSetlist(): void {
    const select = this._setlistSelect.value
    if (select) this._addToSetlist(select.value)
  }

  _libraryOnly(): void {
    // The songs were saved to the library when they arrived
    const [first, ...rest] = this._imports
    this._finish(rest.length ? '/songs' : `/songs/${first.song.uuid}`)
  }

  /** Open the new setlist form with defaults: next Sunday morning, led by you */
  async _openNewSetlist(): Promise<void> {
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
    this._newSetlistModal()?.show()
  }

  async _createSetlist(event: SetlistDetailsSaveEvent): Promise<void> {
    event.stopPropagation()
    const setlist = createSetlist({
      ...event.details,
      createdBy: (await getCurrentPerson())?.id,
    })
    try {
      await this._database().saveSetlist(setlist)
      console.log('[Import] Created new setlist:', setlist.id)
    } catch (error) {
      console.error('[Import] Error creating setlist:', error)
      this._newSetlistModal()?.close()
      this._showError(`Failed to create setlist: ${errorMessage(error)}`)
      return
    }
    this._newSetlistModal()?.close()
    await this._addToSetlist(setlist.id)
  }

  _newSetlistModal(): AppModal | undefined {
    return this._newSetlistModalRef.value
  }

  /** The library's database, once something has been imported */
  _database(): ChordlessDB {
    if (!this._db) throw new Error('Nothing has been imported yet')
    return this._db
  }

  override render() {
    return html`<div class="page">${this._renderState()}</div>`
  }

  _renderState() {
    if (this._state === 'pick') return this._renderPick()
    const several = this._imports.length > 1
    const unresolved = this._imports.filter(item => item.isDuplicate && !item.choice)
    return html`
      <h2>✅ ${several ? `${this._imports.length} songs` : this._imports[0].song.title}</h2>
      ${several ? this._renderSongList() : ''}
      ${
        this._skipped.length
          ? html`<p class="status error">Not imported: ${this._skipped.join(', ')}</p>`
          : ''
      }
      ${unresolved.length ? this._renderDuplicates(unresolved) : this._renderChoices()}
      <app-modal ${ref(this._newSetlistModalRef)} heading="Create New Setlist">
        ${
          this._newSetlist
            ? html`
              <setlist-details-form
                .setlist=${this._newSetlist}
                .people=${this._people}
                submit-label=${several ? 'Create & Add Songs' : 'Create & Add Song'}
                auto-type
                @setlist-details-form:save=${this._createSetlist}
                @setlist-details-form:cancel=${() => this._newSetlistModal()?.close()}
              ></setlist-details-form>
            `
            : ''
        }
      </app-modal>
    `
  }

  _renderPick() {
    return html`
      ${this._error ? html`<p class="status error" role="alert">❌ ${this._error}</p>` : ''}
      ${window.opener ? html`<p class="status">Waiting for song data from bookmarklet...</p>` : ''}
      <div class="choices">
        <label class="choice files">
          <span class="icon">📂</span>
          <span class="content">
            <span class="title">Import ChordPro Files</span>
            <span class="subtitle">Choose one or more files</span>
          </span>
          <input type="file" multiple @change=${this._onFilesChosen} />
        </label>
        <div class="choice paste">
          <div class="icon">📝</div>
          <div class="content">
            <label class="title" for="paste">Paste ChordPro</label>
            <textarea id="paste" ${ref(this._paste)} rows="6" placeholder="{title: Amazing Grace}"></textarea>
            <button class="btn primary add" @click=${this._importPasted}>Import</button>
          </div>
        </div>
        <a class="choice" href="/bookmarklet">
          <span class="icon">🔖</span>
          <span class="content">
            <span class="title">Import from SongSelect</span>
            <span class="subtitle">Bookmarklet, best on desktop</span>
          </span>
        </a>
        <a class="choice" href="/import-setlist">
          <span class="icon">✉️</span>
          <span class="content">
            <span class="title">Import a Setlist from an Email</span>
            <span class="subtitle">Forward a leader's email to Chordless</span>
          </span>
        </a>
      </div>
    `
  }

  _renderSongList() {
    const status: Record<string, string> = {
      update: 'updated',
      'use-existing': 'already in library',
    }
    return html`
      <ol class="songs">
        ${this._imports.map(
          ({ song, isDuplicate, choice }) =>
            html`<li>${song.title} <span class="subtitle">${isDuplicate ? (choice && status[choice]) || 'already in library' : 'new'}</span></li>`
        )}
      </ol>
    `
  }

  /** Keep the library's copy of a song we already have */
  _useExisting(item: ImportItem): void {
    this._setChoice(item, 'use-existing')
  }

  /** Replace the library's copy of the song with the imported one */
  async _update(item: ImportItem): Promise<void> {
    try {
      const song = await overwriteSong(item.song.uuid, item.chordproText, this._database())
      console.log('[Import] Updated existing song:', song.title)
      this._setChoice(item, 'update', song)
    } catch (error) {
      console.error('[Import] Failed to update song:', error)
      this._showError(`Failed to update song: ${errorMessage(error)}`)
    }
  }

  async _updateAll(items: ImportItem[]): Promise<void> {
    // Each update replaces only its own entry, so the others are still current
    for (const item of items) await this._update(item)
  }

  _setChoice(
    item: ImportItem,
    choice: 'update' | 'use-existing',
    song: SongRecord = item.song
  ): void {
    this._imports = this._imports.map(i => (i === item ? { ...i, choice, song } : i))
  }

  _renderDuplicates(unresolved: ImportItem[]) {
    if (unresolved.length === 1 && this._imports.length === 1) {
      const [item] = unresolved
      return html`
        <div class="duplicate">
          <strong>⚠️ This song already exists in your library</strong>
          <p>Do you want to update the song with the new version, or use the existing one?</p>
          <div class="duplicate-actions">
            <button class="btn primary update" @click=${() => this._update(item)}>Update Song</button>
            <button class="btn use-existing" @click=${() => this._useExisting(item)}>Use Existing</button>
          </div>
        </div>
      `
    }
    return html`
      <div class="duplicate">
        <strong>
          ⚠️ ${unresolved.length} of these songs ${unresolved.length > 1 ? 'are' : 'is'} already in
          your library
        </strong>
        <p>Update them with the new versions, or use the existing ones?</p>
        <ul>
          ${unresolved.map(
            item => html`
              <li>
                <span>${item.song.title}</span>
                <span class="duplicate-actions">
                  <button class="btn primary update" @click=${() => this._update(item)}>Update</button>
                  <button class="btn use-existing" @click=${() => this._useExisting(item)}>
                    Use Existing
                  </button>
                </span>
              </li>
            `
          )}
        </ul>
        <div class="duplicate-actions">
          <button class="btn primary update update-all" @click=${() => this._updateAll(unresolved)}>
            Update All
          </button>
          <button
            class="btn use-existing use-existing-all"
            @click=${() =>
              unresolved.forEach(item => {
                this._useExisting(item)
              })}
          >
            Use All Existing
          </button>
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
                    <select id="setlist" ${ref(this._setlistSelect)}>
                      ${this._setlists.map(setlist => {
                        const date = formatSetlistDate(setlist.date, 'short')
                        return html`<option value=${setlist.id}>
                          ${setlist.name ? `${date} - ${setlist.name}` : date}
                        </option>`
                      })}
                    </select>
                    <button class="btn primary add" @click=${this._addToChosenSetlist}>Add</button>
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
            <span class="subtitle">
              Start a fresh setlist with ${this._imports.length > 1 ? 'these songs' : 'this song'}
            </span>
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

declare global {
  interface HTMLElementTagNameMap {
    'song-import': SongImport
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [SongImportedEvent.type]: SongImportedEvent
  }
}
