import { html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { HIGHEST_OFFERED, LOWEST_OFFERED, rangeOfChart, withRange } from '../js/chart-range.ts'
import type { Person, Setlist, SongRecord, Space } from '../js/data-types.ts'
import type { ChordlessDB } from '../js/db.ts'
import {
  createSetlist,
  determineSetlistType,
  getNextSunday,
  normalizeTitle,
  openSpace,
} from '../js/db.ts'
import { parseChartText, songOfChart } from '../js/email-setlist.ts'
import { type LibrarySong, matchLibrary } from '../js/import-plan.ts'
import { libraryForMatching } from '../js/import-setlist.ts'
import { IncomingSongsEvent, takeIncoming } from '../js/incoming-songs.ts'
import { compareCharts, keyOfChart, originOfChart, sourceToImprove } from '../js/library-repair.ts'
import { type SongDetails, songDetailsToChordpro } from '../js/lyrics-chordpro.ts'
import { ChordProParser } from '../js/parser.ts'
import { getSignedInUser, getSpacePeople, identifyMe, settleLeader } from '../js/people.ts'
import {
  createSong,
  findExistingSong,
  importAsOriginal,
  importAsVariant,
  replaceSong,
  setSongRange,
} from '../js/song-utils.ts'
import { songSelectLink } from '../js/songselect-link.ts'
import { toast } from '../js/toast.ts'
import { formatSetlistDate, toLocalDateString } from '../js/utils/date-utils.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import './chart-diff.ts'
import './songselect-help.ts'
import {
  type DuplicateActions,
  type DuplicateChoice,
  type ImportItem,
  isUnresolved,
  renderDuplicates,
  statusOf,
  suggested,
  updatesWithoutAsking,
} from './import-duplicates.ts'
import type {
  SetlistDetailsIdentifyEvent,
  SetlistDetailsSaveEvent,
} from './setlist-details-form.ts'
import './setlist-details-form.ts'
import {
  chartWithLeadSheet,
  type KeptMelody,
  keepMelody,
  type LeadSheetRead,
  type MelodyRead,
} from '../js/lead-sheet.ts'
import { goTo, loadPage } from '../js/navigation.ts'
import { describeSignature, noteName } from '../js/pitch.ts'
import type { Score } from '../js/score.ts'
import { SONGSELECT } from '../js/song-source.ts'
import { ensureCurrentSpace, setCurrentSpace } from '../js/space.ts'
import { visibleSpaces } from '../js/space-tabs.ts'
import { songImportStyles } from './song-import-styles.ts'

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

/** A shared PDF chart whose song the library lacks, or is not sure of */
interface UnmatchedChart {
  title: string
  key: string | null
  /** SongSelect's page for the song, to import it with the bookmarklet */
  link: string
  /** Songs it might be: the person says */
  candidates: LibrarySong[]
}

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

/** A song arriving to be imported (from a file, pasted text or the bookmarklet) */
export interface IncomingSong {
  name?: string
  chordproText?: string
  /** SongSelect's details for a song it has no ChordPro for: its lyrics are made into a minimal chart (lyrics-chordpro.ts) */
  songDetails?: SongDetails
  metadata?: { title?: string; ccliNumber?: string | null }
  source?: string
  /** Why it cannot be imported, if it cannot */
  skip?: string
  /** The song's SongSelect lead sheet (a PDF), in the chart's key: read for the melody's range, and not kept */
  leadSheet?: ArrayBuffer
}

/** Up to this many songs imported at once are listed; more are folded behind a count of what came of them */
const MANY_SONGS = 8

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
    _progress: { state: true }, // what an import is doing
    _busy: { state: true }, // files with a PDF are being read
    _applying: { state: true }, // 'Importing 3 of 140…' while the choices are carried out
    _manual: { state: true }, // chose to import another way, with the bookmarklet's tab open
    // [{song, chordproText, isDuplicate, choice: null | 'update' | 'use-existing'}]
    _imports: { state: true },
    _skipped: { state: true }, // ['name: reason'], files that weren't songs
    _unmatched: { state: true }, // shared PDFs the library has no song for
    _setlists: { state: true },
    _people: { state: true },
    _meId: { state: true },
    _askWho: { state: true },
    _spaces: { state: true }, // the spaces an import can go to
    _spaceId: { state: true }, // the one it goes to
    _newSetlist: { state: true },
    _low: { state: true }, // the notes the range pickers are on
    _high: { state: true },
  }

  declare _state: 'pick' | 'choices'
  declare _error: string
  declare _progress: string
  declare _low: number
  declare _high: number
  declare _busy: boolean
  declare _applying: string
  declare _manual: boolean
  declare _imports: ImportItem[]
  declare _skipped: string[]
  declare _unmatched: UnmatchedChart[]
  declare _setlists: Setlist[]
  declare _people: Person[]
  declare _meId: string | null
  declare _askWho: boolean
  declare _spaces: Space[]
  declare _spaceId: string
  /** The space the app is in, which may not be the one importing into */
  _currentSpaceId = ''
  /** What was last read, to read again if the space it goes to is changed */
  _incoming: IncomingSong[] = []
  /** The songs this import made new in the space (taken back if it is changed) */
  _created: SongRecord[] = []
  /** Whether a choice about a duplicate has been carried out: the space can no longer be changed */
  _applied = false
  declare _newSetlist: Partial<Setlist> | null

  _paste: Ref<HTMLTextAreaElement>
  _setlistSelect: Ref<HTMLSelectElement>
  _newSetlistModalRef: Ref<AppModal>
  _db: ChordlessDB | null = null

  static override styles = songImportStyles

  /** Loads the PDF reader, which is large and wanted only for a shared PDF (a test gives its own) */
  loadPdfReader: () => Promise<{ readPdfText(pdf: ArrayBuffer): Promise<string> }> = () =>
    import('../js/pdf-text.ts')

  /** Loads the reader of a lead sheet's whole melody: notes, words, chords and structure (a test gives its own) */
  loadMelodyPdfReader: () => Promise<{
    readScorePdf(pdf: ArrayBuffer): Promise<Score | null>
  }> = () => import('../js/score-pdfjs.ts')

  constructor() {
    super()
    this._paste = createRef()
    this._setlistSelect = createRef()
    this._newSetlistModalRef = createRef()
    this._state = 'pick'
    this._error = ''
    this._progress = 'Waiting for SongSelect…'
    this._busy = false
    // (a song with no range starts at a comfortable octave: D4 to D5)
    this._low = 62
    this._high = 74
    this._applying = ''
    this._manual = false
    this._imports = []
    this._skipped = []
    this._unmatched = []
    this._setlists = []
    this._people = []
    this._meId = null
    this._askWho = false
    this._spaces = []
    this._spaceId = ''
    this._newSetlist = null
    this._onMessage = this._onMessage.bind(this)
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener('message', this._onMessage)
    window.addEventListener(IncomingSongsEvent.type, this._onIncoming)
    this._signalReady()
    void this._loadSpaces()
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

  /** The spaces to import into, and the one the app is in, which it goes to unless told otherwise */
  async _loadSpaces(): Promise<void> {
    this._currentSpaceId = (await ensureCurrentSpace()).id
    this._spaceId ||= this._currentSpaceId
    this._spaces = await visibleSpaces(this._currentSpaceId)
  }

  /** The database of the space being imported into */
  async _targetDB(): Promise<ChordlessDB> {
    if (!this._spaceId) this._spaceId = (await ensureCurrentSpace()).id
    return openSpace(this._spaceId)
  }

  /**
   * Import into another space. Songs already read are taken back from the space they were put in
   * and read again in the new one, so long as nothing has been decided about them.
   */
  async _chooseSpace(spaceId: string): Promise<void> {
    if (spaceId === this._spaceId) return
    const incoming = this._incoming
    if (this._state === 'choices') {
      for (const song of this._created) {
        await this._database().deleteSong(song.uuid, { remember: false })
      }
    }
    this._created = []
    this._spaceId = spaceId
    if (this._state === 'choices') await this.receiveAll(incoming)
  }

  async _takeIncoming(): Promise<void> {
    const incoming = await takeIncoming()
    if (!incoming) return
    const pdfs = incoming.files.filter(isPdf)
    this._startReading(pdfs)
    try {
      const songs = await this._songsFromFiles(incoming.files.filter(file => !isPdf(file)))
      if (incoming.text.trim()) {
        songs.push({ name: 'Shared text', chordproText: incoming.text, source: 'share' })
      }
      // (a PDF of a song that came with it is its lead sheet; the others are charts to match)
      const charts = await this._pairLeadSheets(songs, pdfs)
      if (songs.length) await this.receiveAll(songs)
      if (charts.length) await this._matchCharts(charts)
    } finally {
      this._busy = false
    }
  }

  /** Say so while PDFs are read: it takes a moment */
  _startReading(pdfs: File[]): void {
    this._busy = pdfs.length > 0
    this._progress = 'Reading the PDF…'
  }

  /**
   * Pair each PDF with the ChordPro it is the lead sheet of, among those chosen with it: the song
   * with its CCLI number (printed at the foot of the sheet), or else with its title. The sheet is
   * then read for the song's melody range, as a bookmarklet's is. Returns the PDFs that go with
   * none of them.
   */
  async _pairLeadSheets(songs: IncomingSong[], pdfs: File[]): Promise<File[]> {
    if (!pdfs.length || !songs.some(song => song.chordproText)) return pdfs
    let readPdf = async (_pdf: ArrayBuffer) => ''
    try {
      readPdf = (await this.loadPdfReader()).readPdfText
    } catch (error) {
      console.warn('[Import] Could not load the PDF reader, using filenames:', error)
    }
    const unpaired: File[] = []
    for (const pdf of pdfs) {
      const bytes = await pdf.arrayBuffer()
      // (the reader may take the buffer it is given)
      const chart = parseChartText(await readPdf(bytes.slice(0)), pdf.name)
      const titles = [chart.title, chart.textTitle]
        .filter(Boolean)
        .map(title => normalizeTitle(title as string))
      const about = (song: IncomingSong) => {
        // (it is only asked of songs that have a chart)
        const meta = parser.parse(song.chordproText as string).metadata
        return { ccli: meta.ccliSongNumber || meta.ccli, title: meta.title ?? '' }
      }
      const open = songs.filter(song => song.chordproText && !song.leadSheet)
      const match =
        open.find(song => chart.ccli && about(song).ccli === chart.ccli) ??
        open.find(song => titles.includes(normalizeTitle(about(song).title)))
      if (match) match.leadSheet = bytes
      else unpaired.push(pdf)
    }
    return unpaired
  }

  /**
   * Find the library's songs for PDF charts (a leader's, shared from a chat): read as an
   * emailed chart is, and matched the same way. The PDF is never imported (see import-plan.ts):
   * the library has the SongSelect chart or nothing, and a song it lacks is linked to SongSelect.
   */
  async _matchCharts(pdfs: File[]): Promise<void> {
    try {
      const db = await this._targetDB()
      this._db = db
      const library = await libraryForMatching(db)
      let readPdf = async (_pdf: ArrayBuffer) => ''
      try {
        readPdf = (await this.loadPdfReader()).readPdfText
      } catch (error) {
        console.warn('[Import] Could not load the PDF reader, using filenames:', error)
      }
      const found: { uuid: string; key: string | null }[] = []
      const unmatched: UnmatchedChart[] = []
      for (const pdf of pdfs) {
        const chart = parseChartText(await readPdf(await pdf.arrayBuffer()), pdf.name)
        const song = songOfChart(chart)
        const match = matchLibrary(song, library)
        if (match.kind === 'ccli' || match.kind === 'title')
          found.push({ uuid: match.song.uuid, key: song.key })
        else {
          const candidates = match.kind === 'possible' ? match.candidates : []
          unmatched.push({
            title: song.title,
            key: song.key,
            link: songSelectLink(song),
            candidates,
          })
        }
      }
      this._unmatched = [...this._unmatched, ...unmatched]
      await this._addLibrarySongs(found)
    } catch (error) {
      console.error('[Import] Failed to read a chart:', error)
      this._showError(`Failed to read the chart: ${errorMessage(error)}`)
    }
  }

  /** Offer songs already in the library, as if just imported: to sing, or to add to a setlist */
  async _addLibrarySongs(songs: { uuid: string; key: string | null }[]): Promise<void> {
    const db = this._database()
    const records = await db.getAllSongs()
    const added: ImportItem[] = []
    for (const { uuid, key } of songs) {
      const song = records.find(record => record.uuid === uuid)
      if (!song || [...this._imports, ...added].some(item => item.song.uuid === uuid)) continue
      added.push({ song, chordproText: '', isDuplicate: false, choice: null, key })
    }
    if (!this._imports.length && !added.length) return
    this._imports = [...this._imports, ...added]
    this._setlists = (await db.getAllSetlists()).sort((a, b) => b.date.localeCompare(a.date))
    this._state = 'choices'
  }

  async _useCandidate(chart: UnmatchedChart, candidate: LibrarySong): Promise<void> {
    this._unmatched = this._unmatched.filter(each => each !== chart)
    await this._addLibrarySongs([{ uuid: candidate.uuid, key: chart.key }])
  }

  _renderUnmatched() {
    return this._unmatched.map(
      chart => html`
        <div class="status unmatched">
          <p>Not in your library: <strong>${chart.title}</strong></p>
          ${chart.candidates.map(
            candidate =>
              html`<button class="btn" @click=${() => this._useCandidate(chart, candidate)}>Use ${candidate.title}</button>`
          )}
          <p><a href=${chart.link} target="_blank" rel="noopener">Find it on SongSelect ↗</a></p>
        </div>
      `
    )
  }

  _onMessage(event: MessageEvent): void {
    if (event.origin !== SONGSELECT_ORIGIN) return
    if (event.data?.type === 'CHORDLESS_IMPORT') {
      this._progress = 'Reading the song…'
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
    } catch {
      // The opener has gone, or isn't the page we were told of: it has nothing to be told
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
    const pdfs = files.filter(isPdf)
    this._startReading(pdfs)
    try {
      const songs = await this._songsFromFiles(files.filter(file => !isPdf(file)))
      // a PDF is a song's lead sheet if the song is chosen with it: a PDF of none is not imported
      for (const pdf of await this._pairLeadSheets(songs, pdfs)) {
        songs.push({
          name: pdf.name,
          skip: 'a PDF, but no ChordPro chosen with it is of this song',
        })
      }
      await this.receiveAll(songs)
    } finally {
      this._busy = false
    }
  }

  /** The songs in ChordPro files (one that is not text is listed as skipped) */
  async _songsFromFiles(files: File[]): Promise<IncomingSong[]> {
    const songs: IncomingSong[] = []
    for (const file of files) {
      // (a JSON file is data, such as the backfill's manifest in the folder it saves to, and never a chart)
      if (/\.json$/i.test(file.name) || file.type === 'application/json') {
        songs.push({ name: file.name, skip: 'a JSON file, not a ChordPro chart' })
        continue
      }
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
    const files = [...(input.files as FileList)]
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
    this._error = ''
    this._incoming = songs
    this._created = []
    try {
      const db = await this._targetDB()
      this._db = db
      const imports: ImportItem[] = []
      const skipped: string[] = []
      const importUser = (await getSignedInUser())?.name
      for (const {
        chordproText: chartText = '',
        songDetails,
        metadata = {},
        source,
        name,
        skip,
        leadSheet,
      } of songs) {
        const incomingText = chartText || (songDetails && songDetailsToChordpro(songDetails)) || ''
        if (skip || !incomingText.trim()) {
          skipped.push(`${name}: ${skip || 'empty'}`)
          continue
        }
        const { chordproText, outcome, melody, notes } = await this._chartWithRange(
          incomingText,
          leadSheet
        )
        // As createSong does: the chart's own title and CCLI number win
        const parsed = parser.parse(chordproText).metadata
        const ccliNumber = parsed.ccliSongNumber || parsed.ccli || metadata.ccliNumber || null
        const title = parsed.title || metadata.title || 'Untitled'

        // (a download from SongSelect is SongSelect's, though it came as a file or as text)
        const origin = originOfChart(source, chordproText)
        const existing = await findExistingSong(ccliNumber, title, db)
        const song =
          existing ||
          (await createSong(
            chordproText,
            { ccliNumber, title, importSource: origin, importUser },
            db
          ))
        let melodySaved: boolean | undefined
        if (!existing) {
          this._created.push(song)
          melodySaved = notes ? await this._keepMelody(song, notes) : undefined
        }
        const item: ImportItem = {
          song,
          chordproText,
          isDuplicate: Boolean(existing),
          choice: null,
          leadSheet: outcome,
          melody,
          notes,
          melodySaved,
          source: origin,
          importUser,
        }
        if (existing) {
          const existingText = (await db.getChordPro(existing.chordproFileId))?.content ?? ''
          item.existingText = existingText
          item.comparison = compareCharts(existingText, chordproText)
          if (item.comparison.verdict === 'identical') {
            // (the lead sheet may have changed, though the chart has not: the melody is not the
            // chart, and is kept with the library's song)
            item.melodySaved = notes ? await this._keepMelody(existing, notes) : undefined
            // (the same chart again: nothing to ask)
            item.choice = 'use-existing'
            // and if it is now known to be SongSelect's, the library's record of where it is from
            // (which said a file, or nothing) catches up
            if (origin === SONGSELECT && sourceToImprove(existing.importSource)) {
              await db.updateSong(existing.uuid, stored => {
                stored.importSource = SONGSELECT
                stored.metadataChangedAt = new Date().toISOString()
              })
              item.sourceSet = true
            }
          } else item.pick = suggested(item)
        }
        imports.push(item)
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

      // The same song as the library's is updated, with no question: there is nothing to decide
      const same = imports.filter(item => updatesWithoutAsking(item))
      for (const item of same) {
        item.pick = 'update'
        item.auto = true
      }
      await this._applyPicks(same)
    } catch (error) {
      console.error('[Import] Failed to process song:', error)
      this._showError(`Failed to process song: ${errorMessage(error)}`)
    }
  }

  /** The chart with its melody's range in it, from the song's lead sheet, and the melody to keep (lead-sheet.ts) */
  _chartWithRange(chordproText: string, leadSheet: unknown): Promise<LeadSheetRead> {
    return chartWithLeadSheet(chordproText, leadSheet, async pdf => {
      this._progress = 'Reading the lead sheet…'
      return (await this.loadMelodyPdfReader()).readScorePdf(pdf)
    })
  }

  /** Keep the melody with the song (replacing the one it had), to be synced beside the chart */
  _keepMelody(song: SongRecord, notes?: KeptMelody): Promise<boolean> {
    return notes ? keepMelody(this._database(), song.uuid, notes) : Promise.resolve(false)
  }

  /** A song already in the library, and the same chart: nothing is asked, so it says so */
  _renderAlreadyThere(item: ImportItem) {
    if (item.auto && item.choice === 'update') {
      return html`<p class="already">This song was already in your library, as the same song. It has been updated.</p>`
    }
    return item.isDuplicate && item.comparison?.verdict === 'identical'
      ? html`<p class="already">An identical version of this song is already in your library, nothing to import.${item.sourceSet ? ' Its source is now recorded as SongSelect.' : ''}</p>`
      : ''
  }

  /** What the page says of the song's melody range: the one in the chart, or why there is none */
  _renderRange(item: ImportItem) {
    const key = keyOfChart(item.chordproText)
    const range = rangeOfChart(item.chordproText)
    const { melody } = item
    let text = ''
    if (range && key) {
      const notes = `${noteName(range.low, key)}–${noteName(range.high, key)}`
      const from = item.rangeSetByHand
        ? ', set by you'
        : item.leadSheet === 'read'
          ? ', from the lead sheet'
          : ''
      text = `Melody range ${notes} in ${key}${from}.`
    } else if (item.leadSheet === 'other-key' && melody) {
      text = `The lead sheet is in another key than the chart (${describeSignature(melody.keySignature)}; the chart is in ${key}), so its range was not used.`
    } else if (item.leadSheet === 'no-melody') {
      text = 'The lead sheet had no melody to read, so there is no range.'
    } else if (item.leadSheet === 'unreadable') {
      text = 'The lead sheet could not be read, so there is no range.'
    } else if (item.source === 'songselect') {
      text = 'No lead sheet came with this song, so there is no range.'
    }
    const settable = !range && key && this._canSetRange(item)
    const kept = this._melodyKept(item)
    return html`${text ? html`<p class="range">${text}</p>` : ''}${kept ? html`<p class="range">${kept}</p>` : ''}${text && melody && key ? this._renderHowRead(melody, key) : ''}${settable ? this._renderRangePickers(item, key) : ''}`
  }

  /** What the page says of the lead sheet's whole melody: kept with the song, or why it is not (docs/MELODY.md) */
  _melodyKept(item: ImportItem): string {
    if (item.melodySaved === false) {
      return 'The lead sheet could not be saved, so the song has only its range.'
    }
    if (item.notes) {
      return 'The lead sheet is kept with the song.'
    }
    // (a range read from the lead sheet always comes with its notes)
    return ''
  }

  /** Whether the page is about this one song, which is in the library as it is to stay, and has no range */
  _canSetRange(item: ImportItem): boolean {
    return this._imports.length === 1 && !isUnresolved(item) && item.choice !== 'use-existing'
  }

  /** Two pickers of notes (named as the key names them), for a song with no lead sheet to read them from */
  _renderRangePickers(item: ImportItem, key: string) {
    const first = Math.min(LOWEST_OFFERED, this._low, this._high)
    const last = Math.max(HIGHEST_OFFERED, this._low, this._high)
    const notes = Array.from({ length: last - first + 1 }, (_, index) => first + index)
    const picker = (label: string, value: number, set: (midi: number) => void) => html`
      <label class="range-picker">
        ${label}
        <select @change=${(event: Event) => set(Number((event.target as HTMLSelectElement).value))}>
          ${notes.map(
            midi =>
              html`<option value=${midi} ?selected=${midi === value}>${noteName(midi, key)}</option>`
          )}
        </select>
      </label>
    `
    const wrong = this._low > this._high
    return html`
      <details class="range-set">
        <summary>Set the range yourself</summary>
        <div class="range-editor">
          ${picker('Lowest note', this._low, midi => (this._low = midi))}
          ${picker('Highest note', this._high, midi => (this._high = midi))}
          <button
            class="btn"
            type="button"
            ?disabled=${wrong}
            @click=${() => this._setRange(item, key)}
          >
            Save the range
          </button>
        </div>
        <div>In ${key}, as written: men sing it an octave down.</div>
        ${wrong ? html`<div class="range-error" role="alert">The lowest note is above the highest.</div>` : ''}
      </details>
    `
  }

  /** Put the range the person set in the song's chart */
  async _setRange(item: ImportItem, key: string): Promise<void> {
    const range = { low: this._low, high: this._high }
    try {
      await setSongRange(item.song.uuid, range, this._database())
    } catch (error) {
      console.error('[Import] Could not save the range:', error)
      toast("Couldn't save the melody range.", {
        kind: 'error',
        details: errorMessage(error),
        action: { label: 'Try again', run: () => void this._setRange(item, key) },
      })
      return
    }
    // (it is only offered when the page is about this one song)
    this._imports = [
      { ...item, chordproText: withRange(item.chordproText, range, key), rangeSetByHand: true },
    ]
  }

  /** What was read from a lead sheet, and where its lowest and highest notes are, to check it by */
  _renderHowRead(melody: MelodyRead, key: string) {
    const many = (count: number, thing: string, plural = `${thing}s`) =>
      `${count} ${count === 1 ? thing : plural}`
    const leftOut = [
      melody.instrumental && many(melody.instrumental, 'small instrumental note'),
      melody.unsung && `${many(melody.unsung, 'note')} with no lyric`,
    ].filter(Boolean)
    return html`
      <details class="range-how">
        <summary>How the lead sheet was read</summary>
        <ul>
          <li>
            ${many(melody.bars, 'bar')}: ${many(melody.notes, 'sung note')} read${leftOut.length ? `, and left out ${leftOut.join(' and ')}` : ''}.
          </li>
          <li>Key signature: ${describeSignature(melody.keySignature)}. The chart is in ${key}.</li>
          <li>Lowest note ${noteName(melody.low, key)}: bar ${melody.lowAt}.</li>
          <li>Highest note ${noteName(melody.high, key)}: bar ${melody.highAt}.</li>
        </ul>
      </details>
    `
  }

  _showError(message: string): void {
    this._error = message
    this._state = 'pick'
  }

  /** Go to url, unless an imported listener prevents it */
  async _finish(url: string): Promise<void> {
    // Into another space: the app goes there, to show what was imported
    const another = this._spaceId !== this._currentSpaceId
    if (another) await setCurrentSpace(this._spaceId)
    const event = new SongImportedEvent(url)
    if (!this.dispatchEvent(event)) return
    /* v8 ignore next -- loading a page would end the test run (navigation.ts) */
    if (another) loadPage(url)
    else goTo(url)
  }

  async _addToSetlist(setlistId: string): Promise<void> {
    try {
      const db = this._database()
      const saved = await db.updateSetlist(setlistId, setlist => {
        for (const { song, key } of this._imports) {
          setlist.songs.push({
            order: setlist.songs.length,
            songId: song.id,
            songUuid: song.uuid,
            key: key ?? null,
            tempo: null,
            notes: '',
          })
        }
        setlist.modifiedDate = new Date().toISOString()
      })
      if (!saved) throw new Error('Setlist not found')
      await this._finish(`/setlist/${setlistId}`)
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
    void this._finish(rest.length ? '/songs' : `/songs/${first.song.uuid}`)
  }

  /** Open the new setlist form with defaults: next Sunday morning, led by you */
  async _openNewSetlist(): Promise<void> {
    const { people, me, askWho } = await getSpacePeople(this._database())
    const date = toLocalDateString(getNextSunday())
    this._people = people
    this._meId = me?.id ?? null
    this._askWho = askWho
    this._newSetlist = {
      date,
      time: '10:30',
      type: determineSetlistType(date, ''),
      name: '',
      leaderId: me?.id || '',
    }
    await this.updateComplete
    this._newSetlistModal()?.show()
  }

  /** The person said which of the people they are: it is kept, and they become the default leader if none is chosen */
  async _identify(event: SetlistDetailsIdentifyEvent): Promise<void> {
    event.stopPropagation()
    await identifyMe(this._database(), event.personId)
    const { people, me, askWho } = await getSpacePeople(this._database())
    this._people = people
    this._meId = me?.id ?? null
    this._askWho = askWho
    if (me && this._newSetlist && !this._newSetlist.leaderId) {
      this._newSetlist = { ...this._newSetlist, leaderId: me.id }
    }
  }

  async _createSetlist(event: SetlistDetailsSaveEvent): Promise<void> {
    event.stopPropagation()
    const setlist = createSetlist({
      ...(await settleLeader(this._database(), event.details)),
      createdBy: (await getSignedInUser())?.email,
    })
    try {
      // biome-ignore lint/plugin: a new setlist, with no stored one to write over
      await this._database().saveSetlist(setlist)
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
    // (the comparison of two charts wants the whole width)
    const comparing = this._imports.some(item => isUnresolved(item))
    return html`<div class="page ${comparing ? 'wide' : ''}">${this._renderSpacePicker()}${this._renderUnmatched()}${this._renderState()}</div>`
  }

  _renderState() {
    if (this._state === 'pick') return this._renderPick()
    const several = this._imports.length > 1
    const unresolved = this._imports.filter(item => isUnresolved(item))
    return html`
      <h2>✅ ${several ? `${this._imports.length} songs` : this._imports[0].song.title}</h2>
      ${this._applying ? html`<p class="status" role="status">${this._applying}</p>` : ''}
      ${several ? this._renderSongList() : unresolved.length ? '' : this._renderAlreadyThere(this._imports[0])}
      ${several ? '' : unresolved.length ? '' : this._renderRange(this._imports[0])}
      ${
        this._skipped.length
          ? html`<p class="status error">Not imported: ${this._skipped.join(', ')}</p>`
          : ''
      }
      ${unresolved.length ? renderDuplicates(unresolved, this._imports.length, this._duplicateActions) : this._renderChoices()}
      <app-modal ${ref(this._newSetlistModalRef)} heading="Create New Setlist">
        ${
          this._newSetlist
            ? html`
              <setlist-details-form
                .setlist=${this._newSetlist}
                .people=${this._people}
                .meId=${this._meId}
                .askWho=${this._askWho}
                submit-label=${several ? 'Create & Add Songs' : 'Create & Add Song'}
                auto-type
                @setlist-details-form:identify=${this._identify}
                @setlist-details-form:save=${this._createSetlist}
                @setlist-details-form:cancel=${() => this._newSetlistModal()?.close()}
              ></setlist-details-form>
            `
            : ''
        }
      </app-modal>
    `
  }

  /** Which space the songs go into (when there is a choice) */
  _renderSpacePicker() {
    if (this._spaces.length < 2) return ''
    return html`
      <label class="space-picker">
        Import into
        <select
          class="space"
          .value=${this._spaceId}
          ?disabled=${this._applied}
          @change=${(event: Event) => this._chooseSpace((event.target as HTMLSelectElement).value)}
        >
          ${this._spaces.map(
            space => html`
              <option value=${space.id} ?selected=${space.id === this._spaceId}>
                ${space.name}${space.team ? ' (Team)' : ''}
              </option>
            `
          )}
        </select>
      </label>
    `
  }

  /**
   * The tab the bookmarklet opened: it is waiting for a song to arrive, and reading it (a lead
   * sheet takes a moment), so it says so, and not the ways to import by hand, which would only
   * be in the way. A failure shows them, and so does asking
   */
  _renderBookmarkletWait() {
    return html`
      <div class="bookmarklet-wait" role="status" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <p>${this._progress}</p>
        <button class="btn manual" @click=${() => (this._manual = true)}>
          Import a file or paste instead
        </button>
      </div>
    `
  }

  _renderPick() {
    if (window.opener && !this._manual && !this._error) return this._renderBookmarkletWait()
    return html`
      ${
        this._busy
          ? html`<p class="status working" role="status"><span class="spinner" aria-hidden="true"></span> ${this._progress}</p>`
          : ''
      }
      ${this._error ? html`<p class="status error" role="alert">❌ ${this._error}</p>` : ''}
      <div class="choices">
        <label class="choice files">
          <span class="icon">📂</span>
          <span class="content">
            <span class="title">Import ChordPro Files</span>
            <span class="subtitle">ChordPro files, each with its lead sheet PDF if you have one</span>
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
        <a class="choice" href="/import-setlist">
          <span class="icon">✉️</span>
          <span class="content">
            <span class="title">Import a Setlist from an Email</span>
            <span class="subtitle">Forward a leader's email to Chordless</span>
          </span>
        </a>
      </div>
      <details class="songselect">
        <summary>Import from SongSelect (CCLI) with a bookmarklet</summary>
        <songselect-help></songselect-help>
      </details>
    `
  }

  /** What came of a song, in words, for the list of songs (and for the count of them) */
  _renderSongList() {
    const list = html`
      <ol class="songs">
        ${this._imports.map(
          item =>
            html`<li>${item.song.title} <span class="subtitle">${statusOf(item)}</span>${this._renderRange(item)}</li>`
        )}
      </ol>
    `
    if (this._imports.length <= MANY_SONGS) return list
    // A long list is folded behind a count of what came of the songs: the choices that follow it
    // (the setlist to add them to) would be many screens down, past a list of 140 songs
    const counts = new Map<string, number>()
    for (const item of this._imports) {
      const status = statusOf(item)
      counts.set(status, (counts.get(status) ?? 0) + 1)
    }
    const summary = [...counts].map(([status, count]) => `${count} ${status}`).join('; ')
    return html`
      <p class="songs-summary">${summary}</p>
      <details class="songs-detail">
        <summary>Show the ${this._imports.length} songs</summary>
        ${list}
      </details>
    `
  }

  /**
   * Make one choice for the duplicates that are not decided yet, as a long list of them has no
   * time for each
   */
  _pickAll(pick: DuplicateChoice): void {
    this._imports = this._imports.map(item => (isUnresolved(item) ? { ...item, pick } : item))
  }

  /** What the choices about songs the library has do on this page */
  _duplicateActions: DuplicateActions = {
    pick: (item, pick) => this._pick(item, pick),
    pickAll: pick => this._pickAll(pick),
    apply: items => void this._applyPicks(items),
    range: item => this._renderRange(item),
  }

  /** Pick what to do with one duplicate (done when "Import" is pressed) */
  _pick(item: ImportItem, pick: DuplicateChoice): void {
    this._imports = this._imports.map(i => (i === item ? { ...i, pick } : i))
  }

  /** Do what is picked for each duplicate, and go on to where to put the songs */
  async _applyPicks(items: ImportItem[]): Promise<void> {
    try {
      await this._carryOutPicks(items)
    } finally {
      this._applying = ''
    }
  }

  async _carryOutPicks(items: ImportItem[]): Promise<void> {
    const todo = items.filter((item): item is ImportItem & { pick: DuplicateChoice } =>
      Boolean(item.pick)
    )
    for (const [index, item] of todo.entries()) {
      // (a long list takes a while: it says how far it has got)
      if (todo.length > 1) this._applying = `Importing ${index + 1} of ${todo.length}…`
      const incoming = { importSource: item.source ?? '', importUser: item.importUser }
      const label = item.label?.trim() || undefined
      const db = this._database()
      try {
        let song = item.song
        if (item.pick === 'update')
          song = await replaceSong(item.song.uuid, item.chordproText, incoming, db)
        else if (item.pick === 'as-original') {
          song = (await importAsOriginal(item.song.uuid, item.chordproText, incoming, label, db))
            .added
        } else if (item.pick === 'as-variant') {
          // (the library's chart stays the song the setlists see; the new variant is its own)
          song = await importAsVariant(item.song.uuid, item.chordproText, incoming, label, db)
        }
        // (the melody is kept with the song whichever chart is taken: a lead sheet may have changed)
        await this._keepMelody(song, item.notes)
        this._applied = true
        this._setChoice(item, item.pick, song)
      } catch (error) {
        console.error('[Import] Failed to import a duplicate:', error)
        this._showError(`Failed to import the song: ${errorMessage(error)}`)
        return
      }
    }
  }

  _setChoice(item: ImportItem, choice: DuplicateChoice, song: SongRecord = item.song): void {
    this._imports = this._imports.map(i => (i === item ? { ...i, choice, song } : i))
  }

  _renderChoices() {
    // (songs are saved when they arrive, and the button only goes to them: with every song already
    // in the library as it is, there is nothing to save, but there is still a way on: to the library)
    const nothingToKeep = this._imports.every(item => item.comparison?.verdict === 'identical')
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
          <span class="icon">${nothingToKeep ? '📚' : '💾'}</span>
          <span class="content">
            <span class="title">${nothingToKeep ? 'Go to the Library' : 'Save to Library Only'}</span>
            <span class="subtitle">
              ${
                nothingToKeep
                  ? `Nothing to save: ${this._imports.length > 1 ? 'they are all' : 'it is'} in the library`
                  : "Don't add to any setlist"
              }
            </span>
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
