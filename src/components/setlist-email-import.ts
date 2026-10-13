import { css, html, LitElement, nothing } from 'lit'
import type { Person, Setlist, SongWithContent } from '../js/data-types.ts'
import { type ChordlessDB, determineSetlistType, getCurrentDB } from '../js/db.ts'
import { decodeImport } from '../js/email-link.ts'
import { readEmail } from '../js/email-mime.ts'
import {
  type ImportedSetlist,
  type ImportedSong,
  importFromEmail,
  nearestSunday,
} from '../js/email-setlist.ts'
import { type LibrarySong, matchLibrary, type SongMatch } from '../js/import-plan.ts'
import {
  copyFromElsewhere,
  createImportedSetlist,
  type LyricsCache,
  libraryForMatching,
  type ReviewedSong,
} from '../js/import-setlist.ts'
import { IncomingLinkEvent, takeLink } from '../js/incoming-link.ts'
import { goTo } from '../js/navigation.ts'
import { getSongsElsewhere } from '../js/other-songs.ts'
import { getOrganisationPeople } from '../js/people.ts'
import { isCcliNumber, songSelectLink } from '../js/songselect-link.ts'
import { formatSetlistDate } from '../js/utils/date-utils.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { SetlistDetailsSaveEvent } from './setlist-details-form.ts'
import './setlist-details-form.ts'
import { buttonStyles } from './shared-styles.ts'

/** The setlist is made, and the page is about to go to url. Cancelable: preventDefault() stops the navigation (for tests) */
export class SetlistEmailImportedEvent extends Event {
  static readonly type = 'setlist-email-import:imported'
  readonly url: string
  constructor(url: string) {
    super(SetlistEmailImportedEvent.type, { bubbles: true, composed: true, cancelable: true })
    this.url = url
  }
}

/** The reviewed email is kept here, so a reload or a trip to SongSelect does not lose it */
const KEPT = 'chordless:email-import'

/** What the person decided about a row, as kept */
interface Decisions {
  include: boolean
  pick: string
  key: string
  notes: string
}

/** A song of the email, and what the person has decided about it */
interface Row {
  song: ImportedSong
  match: SongMatch
  include: boolean
  /** A candidate's uuid, or 'new' for a placeholder (for a song the library may have) */
  pick: string
  key: string
  notes: string
}

/** The PDF reader is large: it is loaded only when a PDF is in the email */
const readPdf = async (pdf: ArrayBuffer) => (await import('../js/pdf-text.ts')).readPdfText(pdf)

/**
 * SetlistEmailImport Component
 *
 * Makes a setlist from a leader's email. The person picks the email as a file (an .eml); the
 * songs are read from the email's text and its PDFs, and the PDFs are then put aside: no chart
 * is imported from them. Each song is matched to the library. One it lacks has to be imported
 * first, from SongSelect with the bookmarklet: it gets a link to the song's page (or a search for
 * its title, if the email gave no clear CCLI number), and the page looks again when the person
 * comes back. The setlist can't be made until every song in it is in the library, so a song can
 * be left out instead. The date, leader and the rest are checked in the setlist form.
 *
 * Events:
 * @fires SetlistEmailImportedEvent - url, where the page is about to go. Cancelable.
 */
export class SetlistEmailImport extends LitElement {
  static override properties = {
    _state: { state: true }, // 'pick' | 'reading' | 'review' | 'saving'
    _error: { state: true },
    _email: { state: true },
    _rows: { state: true },
    _unlisted: { state: true },
    _setlist: { state: true },
    _people: { state: true },
    _sameDate: { state: true },
  }

  declare _state: 'pick' | 'reading' | 'review' | 'saving'
  declare _error: string
  declare _email: ImportedSetlist | null
  declare _rows: Row[]
  declare _unlisted: Row[]
  declare _setlist: Partial<Setlist>
  declare _people: Person[]
  declare _sameDate: Setlist[]

  _db: ChordlessDB | null = null
  _library: LibrarySong[] = []
  /** The songs of the other databases, which a setlist may use (copied in when it is made) */
  _elsewhere: SongWithContent[] = []
  _lyrics: LyricsCache = new Map()
  _onReturn = () => {
    if (document.visibilityState === 'visible') void this._refresh()
  }

  static override styles = [
    buttonStyles,
    css`
    :host {
      display: block;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      color: var(--text-color);
    }
    .page { max-width: 700px; margin: 0 auto; padding: 2rem 1rem; }
    h2 { margin: 0 0 1rem; font-size: var(--font-ui); }
    h3 { margin: 1.5rem 0 0.5rem; font-size: var(--font-ui-small); }
    .status { color: var(--text-secondary, #5f6b6d); }
    .status.error { color: var(--color-danger, #e74c3c); }
    .notice {
      background: #fff3cd;
      color: #1a1a1a;
      border: 2px solid #ffc107;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin: 0 0 1rem;
    }
    ol.songs, ul.songs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
    .song {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.25rem 0.75rem;
      padding: 0.75rem;
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 10px;
    }
    .song > input[type='checkbox'] { align-self: start; margin-top: 0.4rem; }
    .song.off { opacity: 0.55; }
    .song .title { font-weight: 600; }
    .song .listed { color: var(--text-secondary, #5f6b6d); font-size: 0.85em; }
    .song .fields { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.25rem; }
    .song .fields input[type='text'] { font: inherit; padding: 0.2rem 0.4rem; }
    .song .key { width: 4.5rem; }
    .song .note { flex: 1; min-width: 10rem; }
    .match.ok { color: var(--color-success, #27ae60); }
    .match.none { color: var(--text-secondary, #5f6b6d); }
    .candidates { display: flex; flex-direction: column; gap: 0.15rem; margin: 0.25rem 0; }
    .hint { color: var(--text-secondary, #5f6b6d); font-size: 0.9em; }
    input[type='file'] { display: block; margin: 1rem 0; }
    button.small {
      padding: 0.1rem 0.6rem;
      border: 1px solid var(--border-light, #ccc);
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 0.85em;
      cursor: pointer;
    }
    .create { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 1.5rem; }
    `,
  ]

  constructor() {
    super()
    this._state = 'pick'
    this._error = ''
    this._email = null
    this._rows = []
    this._unlisted = []
    this._setlist = {}
    this._people = []
    this._sameDate = []
  }

  override connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('visibilitychange', this._onReturn)
    window.addEventListener('focus', this._onReturn)
    window.addEventListener('hashchange', this._onHash)
    window.addEventListener(IncomingLinkEvent.type, this._onLink)
    void this._restore()
  }

  override disconnectedCallback(): void {
    document.removeEventListener('visibilitychange', this._onReturn)
    window.removeEventListener('focus', this._onReturn)
    window.removeEventListener('hashchange', this._onHash)
    window.removeEventListener(IncomingLinkEvent.type, this._onLink)
    super.disconnectedCallback()
  }

  /** A link the installed app was launched with while this page is open */
  _onLink = (): void => {
    const fragment = takeLink()
    if (fragment) void this._openLink(fragment)
  }

  /** A link opened in a tab that is already on this page */
  _onHash = (): void => {
    // biome-ignore lint/plugin: the setlist is the link's fragment (not a route)
    const fragment = location.hash
    if (fragment.length > 1) void this._openLink(fragment)
  }

  /** The email reviewed before a reload or a trip to SongSelect, if the person left one */
  async _restore(): Promise<void> {
    // The installed app is given the link's fragment (launch.ts); a tab keeps it in the address
    // biome-ignore lint/plugin: the setlist is the link's fragment (not a route)
    const fragment = takeLink() ?? location.hash
    if (fragment.length > 1 && (await this._openLink(fragment))) return
    try {
      const text = sessionStorage.getItem(KEPT)
      // Not the file picker, flashing up, while a review that was kept comes back
      if (text) this._state = 'reading'
      const kept = JSON.parse(text ?? 'null') as {
        email: ImportedSetlist
        rows: Decisions[]
        unlisted: Decisions[]
      } | null
      if (kept?.email) await this._review(kept.email, kept.rows, kept.unlisted)
      else if (this._state === 'reading') this._state = 'pick'
    } catch (error) {
      console.warn('[EmailImport] Could not restore the email:', error)
      this._forget()
      this._state = 'pick'
    }
  }

  /**
   * The setlist in a link from the email Worker (/import-setlist#...). The fragment is taken off
   * the address once read, so a reload goes back to the review in progress, with its changes.
   */
  async _openLink(fragment: string): Promise<boolean> {
    this._state = 'reading'
    try {
      const email = await decodeImport(fragment)
      history.replaceState(history.state, '', location.pathname + location.search)
      await this._review(email)
      return true
    } catch (error) {
      console.error('[EmailImport] Could not read the link:', error)
      history.replaceState(history.state, '', location.pathname + location.search)
      this._error = `Could not read that link: ${errorMessage(error)}`
      this._state = 'pick'
      return true
    }
  }

  _keep(): void {
    if (!this._email) return
    const decisions = ({ include, pick, key, notes }: Row): Decisions => ({
      include,
      pick,
      key,
      notes,
    })
    try {
      sessionStorage.setItem(
        KEPT,
        JSON.stringify({
          email: this._email,
          rows: this._rows.map(decisions),
          unlisted: this._unlisted.map(decisions),
        })
      )
    } catch {
      // Storage may be full or off: the review just won't survive a reload
    }
  }

  _forget(): void {
    try {
      sessionStorage.removeItem(KEPT)
    } catch {
      // nothing kept to forget
    }
  }

  /** Start again with another email */
  _startAgain(): void {
    this._forget()
    this._email = null
    this._state = 'pick'
  }

  /** Read the email in a file the person picked */
  async importFile(file: File): Promise<void> {
    this._error = ''
    this._state = 'reading'
    try {
      const email = importFromEmail(await readEmail(await file.arrayBuffer(), readPdf))
      if (!email.songs.length && !email.unlisted.length) {
        throw new Error('No songs were found in that email.')
      }
      await this._review(email)
    } catch (error) {
      console.error('[EmailImport] Could not read the email:', error)
      this._error = `Could not read that email: ${errorMessage(error)}`
      this._state = 'pick'
    }
  }

  /** Show an email for review, with what the person had decided about it, if they had */
  async _review(email: ImportedSetlist, rows?: Decisions[], unlisted?: Decisions[]): Promise<void> {
    const db = await getCurrentDB()
    this._db = db
    this._elsewhere = await this._songsElsewhere(db)
    this._library = await libraryForMatching(db, this._lyrics, this._elsewhere)
    this._email = email
    const make = (songs: ImportedSong[], include: boolean, kept?: Decisions[]) =>
      songs.map((song, i) => {
        const row = this._rowFor(song, include)
        const was = kept?.[i]
        if (was) Object.assign(row, was, { pick: this._pickFor(row.match, was.pick) })
        return row
      })
    this._rows = make(email.songs, true, rows)
    this._unlisted = make(email.unlisted, false, unlisted)
    const { people, me } = await getOrganisationPeople()
    this._people = people
    const date = email.date || nearestSunday()
    this._setlist = {
      date,
      time: '10:30',
      type: determineSetlistType(date, email.name),
      name: email.name,
      owner: email.leader.name || me?.name || '',
      ownerId: email.leader.email || me?.id || '',
    }
    this._sameDate = (await db.getAllSetlists()).filter(have => have.date === date)
    this._state = 'review'
    this._keep()
  }

  async _songsElsewhere(db: ChordlessDB): Promise<SongWithContent[]> {
    try {
      return await getSongsElsewhere(db.dbName)
    } catch (error) {
      // The library is enough to go on without them
      console.warn('[EmailImport] Could not read the other databases:', error)
      return []
    }
  }

  /** Look at the library again, as songs may have been imported from SongSelect meanwhile */
  async _refresh(): Promise<void> {
    if (this._state !== 'review' || !this._db) return
    try {
      this._elsewhere = await this._songsElsewhere(this._db)
      this._library = await libraryForMatching(this._db, this._lyrics, this._elsewhere)
    } catch (error) {
      console.warn('[EmailImport] Could not look at the library again:', error)
      return
    }
    for (const row of [...this._rows, ...this._unlisted]) {
      const was = row.match.kind
      row.match = matchLibrary(row.song, this._library)
      row.pick = this._pickFor(row.match, was === 'possible' ? row.pick : undefined)
    }
    this._rows = [...this._rows]
    this._unlisted = [...this._unlisted]
    this._keep()
  }

  /** Which candidate is picked: the person's choice if it still stands, else the best */
  _pickFor(match: SongMatch, wanted?: string): string {
    if (match.kind !== 'possible') return 'new'
    if (wanted === 'new' || match.candidates.some(c => c.uuid === wanted)) return wanted as string
    // A song found by a line of its words is the person's to confirm: nothing is picked for them
    return match.via === 'lyrics' ? 'new' : match.candidates[0].uuid
  }

  _rowFor(song: ImportedSong, include: boolean): Row {
    const match = matchLibrary(song, this._library)
    return {
      song,
      match,
      include,
      pick: this._pickFor(match),
      key: song.key ?? '',
      notes: song.notes,
    }
  }

  async _onFileChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) await this.importFile(file)
  }

  _change(row: Row, changes: Partial<Row>): void {
    Object.assign(row, changes)
    this.requestUpdate()
    this._keep()
  }

  /** Does the song have to be imported from SongSelect before it can be in the setlist? */
  _needsImport(row: Row): boolean {
    return row.match.kind === 'none' || (row.match.kind === 'possible' && row.pick === 'new')
  }

  /** The songs to import first: wanted in the setlist, and not in the library */
  _missing(): Row[] {
    return [...this._rows, ...this._unlisted].filter(row => row.include && this._needsImport(row))
  }

  /** What the person has settled on for a row that is in the library */
  _reviewed(row: Row): ReviewedSong {
    const { match } = row
    const library =
      match.kind === 'ccli' || match.kind === 'title'
        ? match.song
        : match.kind === 'possible'
          ? (match.candidates.find(c => c.uuid === row.pick) ?? match.candidates[0])
          : null
    if (!library) throw new Error(`${row.song.title} is not in the library`)
    return { song: row.song, key: row.key.trim() || null, notes: row.notes.trim(), library }
  }

  async _create(event: SetlistDetailsSaveEvent): Promise<void> {
    event.stopPropagation()
    if (!this._db) return
    if (this._missing().length) return
    this._state = 'saving'
    try {
      const chosen = [...this._rows, ...this._unlisted]
        .filter(row => row.include)
        .map(row => this._reviewed(row))
      const reviewed = await copyFromElsewhere(this._db, chosen, this._elsewhere)
      const setlist = await createImportedSetlist(this._db, event.details, reviewed)
      console.log('[EmailImport] Created setlist', setlist.id, 'with', chosen.length, 'songs')
      this._forget()
      const url = `/setlist/${setlist.id}`
      if (this.dispatchEvent(new SetlistEmailImportedEvent(url))) goTo(url)
    } catch (error) {
      console.error('[EmailImport] Could not create the setlist:', error)
      this._error = `Could not create the setlist: ${errorMessage(error)}`
      this._state = 'review'
    }
  }

  override render() {
    return html`<div class="page">${this._state === 'review' || this._state === 'saving' ? this._renderReview() : this._renderPick()}</div>`
  }

  _renderPick() {
    return html`
      <h2>Import a setlist from an email</h2>
      <p>
        Choose an email a worship leader sent with the songs attached, saved as an
        <code>.eml</code> file (in Gmail: open the email, ⋮ then Download message). The
        songs, keys, date and leader are read from it. The attached charts are not
        imported: for a song the library does not have, you get a placeholder and a link to get the
        SongSelect chart.
      </p>
      ${this._error ? html`<p class="status error" role="alert">❌ ${this._error}</p>` : nothing}
      ${this._state === 'reading' ? html`<p class="status" role="status">Reading the email…</p>` : nothing}
      <input
        type="file"
        id="email-file"
        accept=".eml,message/rfc822"
        aria-label="Choose an email"
        ?disabled=${this._state === 'reading'}
        @change=${this._onFileChosen}
      />
    `
  }

  _renderReview() {
    const email = this._email as ImportedSetlist
    const missing = this._missing()
    const included = [...this._rows, ...this._unlisted].filter(row => row.include).length
    return html`
      <h2>${email.name || 'Setlist from an email'}</h2>
      <p><button class="small" @click=${this._startAgain}>Choose a different email</button></p>
      ${this._error ? html`<p class="status error" role="alert">❌ ${this._error}</p>` : nothing}
      ${email.dateWarning ? html`<p class="notice" role="note">${email.dateWarning}. Check the date below.</p>` : nothing}
      ${email.date ? nothing : html`<p class="notice" role="note">The email gave no date: check the one below (the nearest Sunday).</p>`}
      ${this._sameDate.length ? this._renderSameDate() : nothing}
      <h3>Setlist</h3>
      <setlist-details-form
        .setlist=${this._setlist}
        .people=${this._people}
        hide-actions
        auto-type
        @setlist-details-form:save=${this._create}
      ></setlist-details-form>
      <h3>Songs</h3>
      ${email.orderFromList ? nothing : html`<p class="notice" role="note">The email had no list of songs, so they are in the order the charts were attached. Check the order.</p>`}
      <ol class="songs" aria-label="Songs">${this._rows.map((row, i) => this._renderRow(row, i + 1))}</ol>
      ${this._unlisted.length ? this._renderUnlisted() : nothing}
      ${
        missing.length
          ? html`<p class="notice" role="status">
            ${missing.length} ${missing.length === 1 ? 'song is' : 'songs are'} not in your library yet.
            Open ${missing.length === 1 ? 'it' : 'each'} on SongSelect and import it with the
            <a href="/bookmarklet" target="_blank" rel="noopener">bookmarklet</a> (when asked where to put it, keep it in the
            library), then come back here: this page looks again when you return. Or leave
            ${missing.length === 1 ? 'it' : 'a song'} out.
          </p>`
          : nothing
      }
      <div class="create">
        <button class="btn" @click=${() => goTo('/import-song')}>Cancel</button>
        <button
          class="btn primary"
          ?disabled=${missing.length > 0 || included === 0 || this._state === 'saving'}
          @click=${() => this.shadowRoot?.querySelector('setlist-details-form')?.submit()}
        >${this._state === 'saving' ? 'Creating…' : 'Create setlist'}</button>
      </div>
    `
  }

  _renderSameDate() {
    return html`
      <p class="notice" role="note">
        You already have ${this._sameDate.length === 1 ? 'a setlist' : 'setlists'} for
        ${formatSetlistDate(this._sameDate[0].date)}:
        ${this._sameDate.map(
          (have, i) =>
            html`${i ? ', ' : ''}<a href="/setlist/${have.id}" target="_blank" rel="noopener">${have.name || have.type}</a>`
        )}.
        Creating this makes another.
      </p>
    `
  }

  _renderRow(row: Row, number: number) {
    const { song } = row
    return html`
      <li class="song ${row.include ? '' : 'off'}">
        <input
          type="checkbox"
          aria-label="Include ${song.title}"
          .checked=${row.include}
          @change=${(e: Event) => this._change(row, { include: (e.target as HTMLInputElement).checked })}
        />
        <div>
          <span class="title">${number}. ${song.title}</span>
          ${song.listed && song.listed !== song.title ? html`<div class="listed">listed as “${song.listed}”</div>` : nothing}
          ${song.pairedBy ? html`<div class="listed">The email attached “${song.title}” in the same key, and no other song was left: taken to be this one.</div>` : nothing}
          ${this._renderMatch(row)}
          <div class="fields">
            <label>Key
              <input type="text" class="key" .value=${row.key} @input=${(e: Event) => this._change(row, { key: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="note">Note
              <input type="text" .value=${row.notes} @input=${(e: Event) => this._change(row, { notes: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
        </div>
      </li>
    `
  }

  _renderMatch(row: Row) {
    const { match, song } = row
    if (match.kind === 'ccli' || match.kind === 'title') {
      const there = match.song.source
      return html`<div class="match ok">${there ? html`✓ In “${there.label}”: it is copied into your library when you create the setlist` : html`✓ In your library`}${match.song.title === song.title ? '' : html`: ${match.song.title}`}</div>`
    }
    if (match.kind === 'possible') {
      const name = `pick-${song.title}-${song.ccli ?? ''}`
      return html`
        <div class="match">${match.via === 'lyrics' ? 'No song has that title, but its words are in these:' : 'Is it one of these?'}</div>
        <div class="candidates" role="radiogroup" aria-label="Which song is ${song.title}">
          ${match.candidates.map(
            candidate =>
              html`<label><input type="radio" name=${name} .checked=${row.pick === candidate.uuid} @change=${() => this._change(row, { pick: candidate.uuid })} /> ${candidate.title}</label>`
          )}
          <label><input type="radio" name=${name} .checked=${row.pick === 'new'} @change=${() => this._change(row, { pick: 'new' })} /> None of these</label>
        </div>
        ${row.pick === 'new' ? this._renderImport(row) : nothing}
      `
    }
    return this._renderImport(row)
  }

  /** For a song that has to be imported: where to get it, or leaving it out */
  _renderImport(row: Row) {
    if (!row.include) return html`<div class="match none">Not in your library.</div>`
    const { song } = row
    return html`
      <div class="match none">
        Not in your library.
        <a href=${songSelectLink(song)} target="_blank" rel="noopener">${isCcliNumber(song.ccli) ? 'Open it on SongSelect ↗' : 'Search SongSelect for it ↗'}</a>
        <button class="small" @click=${() => this._change(row, { include: false })}>Leave it out</button>
      </div>
    `
  }

  _renderUnlisted() {
    return html`
      <h3>Charts attached but not in the list</h3>
      <ul class="songs" aria-label="Songs attached but not listed">
        ${this._unlisted.map(
          row => html`
            <li class="song">
              <input type="checkbox" aria-label="Add ${row.song.title}" .checked=${row.include}
                @change=${(e: Event) => this._change(row, { include: (e.target as HTMLInputElement).checked })} />
              <div>
                <span class="title">${row.song.title}</span>
                ${this._renderMatch(row)}
              </div>
            </li>
          `
        )}
      </ul>
    `
  }
}
customElements.define('setlist-email-import', SetlistEmailImport)

declare global {
  interface HTMLElementTagNameMap {
    'setlist-email-import': SetlistEmailImport
  }
  interface GlobalEventHandlersEventMap {
    [SetlistEmailImportedEvent.type]: SetlistEmailImportedEvent
  }
}
