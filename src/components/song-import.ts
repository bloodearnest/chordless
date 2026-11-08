import { css, html, LitElement } from 'lit'
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
import {
  type ChartComparison,
  compareCharts,
  keyOfChart,
  originOfChart,
  sourceToImprove,
} from '../js/library-repair.ts'
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
import type { ChartLabel } from './chart-diff.ts'
import type {
  SetlistDetailsIdentifyEvent,
  SetlistDetailsSaveEvent,
} from './setlist-details-form.ts'
import './setlist-details-form.ts'
import { type MelodyRead, readOfMelody } from '../js/lead-sheet.ts'
import type { Melody } from '../js/melody.ts'
import { writeMusicXml } from '../js/melody-musicxml.ts'
import { melodyRecord } from '../js/melody-record.ts'
import { goTo, loadPage } from '../js/navigation.ts'
import { describeSignature, noteName, signatureMatchesKey } from '../js/pitch.ts'
import { describeOrigin, SONGSELECT } from '../js/song-source.ts'
import { ensureCurrentSpace, setCurrentSpace } from '../js/space.ts'
import { visibleSpaces } from '../js/space-tabs.ts'
import { buttonStyles, spinnerStyles } from './shared-styles.ts'

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

/**
 * What came of a lead sheet: its melody's range was put in the chart, it had no melody, it could
 * not be read, or it was in another key than the chart (so its notes would not be the chart's)
 */
type LeadSheetOutcome = 'read' | 'no-melody' | 'unreadable' | 'other-key'

/** Up to this many songs imported at once are listed; more are folded behind a count of what came of them */
const MANY_SONGS = 8

/** A lead sheet is about 130 KB: anything much bigger is not one */
const MAX_LEAD_SHEET = 8 * 1024 * 1024

/**
 * What to do with a chart of a song the library has: import it as the original (the library's
 * chart becomes a variant), import it as a variant (the library's stays the original), update
 * the library's chart with it, or not import it
 */
type DuplicateChoice = 'as-original' | 'as-variant' | 'update' | 'use-existing'

/** A song that was imported, and what to do if it was already in the library */
interface ImportItem {
  song: SongRecord
  chordproText: string
  isDuplicate: boolean
  choice: DuplicateChoice | null
  /** The library's chart, for a duplicate */
  existingText?: string
  /** How the chart compares with the one the library has, for a duplicate */
  comparison?: ChartComparison
  /** What is picked, not yet done: set when it is read, to the suggestion */
  pick?: DuplicateChoice | null
  /** The name of the chart that becomes a variant: the library's if imported as the original, else the imported one */
  label?: string
  /** The same chart as the library's, which only said it was a file: its source is now SongSelect */
  sourceSet?: boolean
  /** The same song as the library's: it was updated with no question asked */
  auto?: boolean
  /** Its range was set by the person, not read from a lead sheet */
  rangeSetByHand?: boolean
  /** What came of the lead sheet that came with it, if one did */
  leadSheet?: LeadSheetOutcome
  /** What was read from it, to show how */
  melody?: MelodyRead
  /** Its whole melody, in the chart's key, to be kept with the song the chart goes to (docs/MELODY.md) */
  notes?: { melody: Melody; key: string }
  /** Whether it was saved just now (a new song's); undefined while it waits on a choice about a song the library has */
  melodySaved?: boolean
  /** Where the chart came from, and who is importing it */
  source?: string
  importUser?: string
  /** The key to play it in when added to a setlist (a shared chart's), else the song's own */
  key?: string | null
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

  static override styles = [
    buttonStyles,
    spinnerStyles,
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

    .space-picker {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      font-size: var(--font-ui-small);
    }

    .space-picker select {
      flex: 1;
      padding: 0.4rem 0.6rem;
      font: inherit;
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 6px;
      background-color: var(--bg-secondary, #f8f9fa);
      color: var(--text-color);
    }

    .page.wide {
      max-width: none;
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

    /* The question of what to do with a duplicate: the theme's surface, with an info-coloured
       edge (a decision, not a warning), so it reads in light and dark */
    .duplicate {
      background: var(--bg-secondary);
      color: var(--text-color);
      border: 1px solid var(--border-color);
      border-left: 5px solid var(--color-info);
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
      margin: 0.75rem 0;
    }

    .picks {
      margin: 0.5rem 0;
      padding: 0;
      border: none;
    }

    .picks legend {
      padding: 0;
      font-size: var(--font-ui-small);
      color: var(--text-secondary);
    }

    .pick {
      display: flex;
      gap: 0.6rem;
      align-items: flex-start;
      padding: 0.5rem 0.6rem;
      margin-top: 0.4rem;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      cursor: pointer;
    }

    .pick:has(input:checked) {
      border-color: var(--color-info);
      background: color-mix(in srgb, var(--color-info) 12%, transparent);
    }

    .pick input {
      margin-top: 0.25rem;
    }

    .pick .help {
      display: block;
      font-size: var(--font-ui-small);
      color: var(--text-secondary);
    }

    .duplicate-actions .btn {
      flex: 1;
      font-size: var(--font-ui-small);
    }

    details.songselect {
      margin-top: 1.5rem;
    }

    details.songselect summary {
      cursor: pointer;
      font-size: var(--font-ui);
      color: var(--text-color);
    }

    details.songselect songselect-help {
      margin-top: 1rem;
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

    /* what came of an import that had nothing to do: the result, so as big as the title */
    .already {
      margin: -0.75rem 0 1.25rem;
      font-size: var(--font-ui);
      font-weight: 700;
    }

    .songs-summary {
      margin: 0 0 0.5rem;
    }

    .songs-detail {
      margin-bottom: 1.5rem;
    }

    .songs-detail summary {
      cursor: pointer;
    }

    .bulk-picks {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin: 0.75rem 0;
    }

    .bookmarklet-wait {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 3rem 1rem;
      text-align: center;
    }

    .bookmarklet-wait .spinner {
      width: 2rem;
      height: 2rem;
    }

    .range {
      margin: 0.25rem 0;
      font-size: var(--font-ui-small);
      color: var(--text-secondary);
    }

    .range-set {
      margin: 0.25rem 0 0.5rem;
      font-size: var(--font-ui-small);
    }

    .range-set summary {
      cursor: pointer;
      color: var(--text-secondary);
    }

    .range-set .range-editor {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 1rem;
      margin: 0.5rem 0;
    }

    .range-picker {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .range-picker select {
      min-height: 2.5rem;
      padding: 0 0.5rem;
      font: inherit;
      font-size: var(--font-ui);
    }

    /* (the danger colour, mixed toward the text colour: it reads on the light page and on the dark) */
    .range-error {
      color: color-mix(in srgb, var(--color-danger, #e74c3c) 65%, var(--text-color, #1a1a1a));
    }

    .range-how {
      margin: 0.25rem 0 0.5rem;
      font-size: var(--font-ui-small);
      color: var(--text-secondary);
    }

    .range-how ul {
      margin: 0.25rem 0;
      padding-left: 1.25rem;
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
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border-color);
    }

    .label-field {
      display: block;
      margin: 0.5rem 0;
      font-size: var(--font-ui-small);
    }

    .label-field input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 0.25rem;
      padding: 0.4rem 0.6rem;
      font: inherit;
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 6px;
      background-color: var(--bg-secondary, #f8f9fa);
      color: var(--text-color);
    }

    .verdict {
      margin: 0.25rem 0;
    }

    .duplicate details {
      margin: 0.5rem 0;
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

  /** Loads the PDF reader, which is large and wanted only for a shared PDF (a test gives its own) */
  loadPdfReader: () => Promise<{ readPdfText(pdf: ArrayBuffer): Promise<string> }> = () =>
    import('../js/pdf-text.ts')

  /** Loads the reader of a lead sheet's whole melody: notes, words, chords and structure (a test gives its own) */
  loadMelodyPdfReader: () => Promise<{
    readMelodyPdf(pdf: ArrayBuffer): Promise<Melody | null>
  }> = () => import('../js/melody-pdfjs.ts')

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
          } else item.pick = this._suggested(item)
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
      const same = imports.filter(item => this._updatesWithoutAsking(item))
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

  /**
   * The chart with its melody's range in it, read from the song's lead sheet (docs/RANGE.md). The
   * lead sheet is never kept, and one that cannot be read leaves the chart as it came: the song
   * is imported without a range, and can be given one.
   */
  async _chartWithRange(
    chordproText: string,
    leadSheet: unknown
  ): Promise<{
    chordproText: string
    outcome?: LeadSheetOutcome
    melody?: MelodyRead
    notes?: { melody: Melody; key: string }
  }> {
    const key = keyOfChart(chordproText)
    if (!(leadSheet instanceof ArrayBuffer) || leadSheet.byteLength > MAX_LEAD_SHEET) {
      return { chordproText }
    }
    // (one with no key has nothing to put the notes in)
    if (!key) return { chordproText }
    this._progress = 'Reading the lead sheet…'
    let melody: Melody | null
    try {
      melody = await (await this.loadMelodyPdfReader()).readMelodyPdf(leadSheet.slice(0))
    } catch (error) {
      console.warn('[Import] Could not read the melody of the lead sheet:', error)
      return rangeOfChart(chordproText) ? { chordproText } : { chordproText, outcome: 'unreadable' }
    }
    // (its notes are only the chart's if it is in the chart's key)
    const inKey = melody !== null && signatureMatchesKey(melody.measures[0]?.fifths ?? 0, key)
    const notes = melody && inKey ? { melody, key } : undefined
    // (a chart with a range of its own keeps it)
    if (rangeOfChart(chordproText)) return { chordproText, notes }
    const read = melody && readOfMelody(melody)
    if (!read) return { chordproText, outcome: 'no-melody' }
    if (!inKey) return { chordproText, outcome: 'other-key', melody: read }
    return {
      chordproText: withRange(chordproText, read, key),
      outcome: 'read',
      melody: read,
      notes,
    }
  }

  /** Keep the melody with the song (replacing the one it had), to be synced beside the chart */
  async _keepMelody(song: SongRecord, notes?: { melody: Melody; key: string }): Promise<boolean> {
    if (!notes) return false
    const db = this._database()
    try {
      const previous = await db.getMelody(song.uuid)
      await db.saveMelody(melodyRecord(song.uuid, writeMusicXml(notes.melody), notes.key, previous))
      return true
    } catch (error) {
      console.warn('[Import] Could not keep the melody:', error)
      return false
    }
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
      return "The lead sheet's melody could not be saved, so the song has only its range."
    }
    if (item.notes) {
      return item.isDuplicate && (item.choice ?? item.pick) === 'use-existing'
        ? "The library's chart stays, so the lead sheet's melody is not kept."
        : "The lead sheet's melody is kept with the song."
    }
    // (a range read from the lead sheet always comes with its notes)
    return ''
  }

  /** Whether the page is about this one song, which is in the library as it is to stay, and has no range */
  _canSetRange(item: ImportItem): boolean {
    return this._imports.length === 1 && !this._isUnresolved(item) && item.choice !== 'use-existing'
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
    const comparing = this._imports.some(item => this._isUnresolved(item))
    return html`<div class="page ${comparing ? 'wide' : ''}">${this._renderSpacePicker()}${this._renderUnmatched()}${this._renderState()}</div>`
  }

  _renderState() {
    if (this._state === 'pick') return this._renderPick()
    const several = this._imports.length > 1
    const unresolved = this._imports.filter(item => this._isUnresolved(item))
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
      ${unresolved.length ? this._renderDuplicates(unresolved) : this._renderChoices()}
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
  _statusOf(item: ImportItem): string {
    const status: Record<string, string> = {
      update: 'updated',
      'as-original': 'imported as the original',
      'as-variant': 'imported as a variant',
      'use-existing': 'not imported',
    }
    if (!item.isDuplicate) return 'new'
    if (item.auto && item.choice === 'update') return 'updated: the same song as in your library'
    if (item.comparison?.verdict === 'identical') {
      return `identical version already in library${item.sourceSet ? ', now recorded as from SongSelect' : ''}`
    }
    return (item.choice && status[item.choice]) || 'already in library'
  }

  _renderSongList() {
    const list = html`
      <ol class="songs">
        ${this._imports.map(
          item =>
            html`<li>${item.song.title} <span class="subtitle">${this._statusOf(item)}</span>${this._renderRange(item)}</li>`
        )}
      </ol>
    `
    if (this._imports.length <= MANY_SONGS) return list
    // A long list is folded behind a count of what came of the songs: the choices that follow it
    // (the setlist to add them to) would be many screens down, past a list of 140 songs
    const counts = new Map<string, number>()
    for (const item of this._imports) {
      const status = this._statusOf(item)
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
    this._imports = this._imports.map(item => (this._isUnresolved(item) ? { ...item, pick } : item))
  }

  /** A song the library has, with a choice to be made for it (not one that is being updated with no question) */
  _isUnresolved(item: ImportItem): boolean {
    return item.isDuplicate && !item.choice && !item.auto
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
        // (the melody goes with the chart that was taken: not when the library's own stays)
        if (item.pick !== 'use-existing') await this._keepMelody(song, item.notes)
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

  /** Which choice to lead with, from how the charts differ; none when the words differ */
  _suggested(item: ImportItem): DuplicateChoice | null {
    switch (item.comparison?.verdict) {
      case 'different-chords':
        return 'as-variant'
      case 'same-chart':
      case 'other-key':
        // (the same song, which is updated with no question unless the library's chart is the
        // better authority: so what is asked about is whether to replace it)
        return 'use-existing'
      default:
        return null
    }
  }

  /** `alone`: the page is about this one song, so the comparison says its range (a list of songs does) */
  /**
   * Whether a song the library has is updated with no question: it is the same song (the same
   * words and chords, whatever else differs, even the key), and the chart coming is no less the
   * authority than the library's: a chart from SongSelect is not replaced by one that is not
   */
  _updatesWithoutAsking(item: ImportItem): boolean {
    const verdict = item.comparison?.verdict
    const sameSong = verdict === 'same-chart' || verdict === 'other-key'
    const lesser = item.song.importSource === SONGSELECT && item.source !== SONGSELECT
    return sameSong && !lesser
  }

  _renderDuplicate(item: ImportItem, index: number, alone: boolean) {
    const { comparison } = item
    /* v8 ignore next -- every duplicate is given its comparison when it is read */
    const verdict = comparison?.verdict ?? 'different-words'
    const sentence = {
      identical: 'The same song.',
      'same-chart': 'The same words and chords, with other details.',
      'other-key': 'The same song in another key.',
      'different-chords': 'The same words, with different chords.',
      'different-words': 'Different words: another version or arrangement.',
    }[verdict]
    // (the library's chart, and the imported one)
    const charts: [string, string] = [item.existingText as string, item.chordproText]
    const labels: [ChartLabel, ChartLabel] = [
      { heading: 'In your library', detail: describeOrigin(item.song) },
      {
        heading: 'Importing',
        detail: describeOrigin({
          importUser: item.importUser,
          importDate: new Date().toISOString(),
          importSource: item.source,
        }),
      },
    ]
    const options: { value: DuplicateChoice; title: string; help: string }[] = [
      {
        value: 'as-original',
        title: 'Import as original song version',
        help: 'The imported song becomes the original. Your current song is kept as a variant.',
      },
      {
        value: 'as-variant',
        title: 'Import as variant of original',
        help: 'Your current song stays the original. The imported song is kept as a variant.',
      },
      {
        value: 'update',
        title: 'Update current song',
        help: 'Replace your current song with the imported one, in its key. Setlists keep using it, and keep the keys they have it in.',
      },
      {
        value: 'use-existing',
        title: 'Do not import',
        help: 'Keep your current song as it is.',
      },
    ]
    const naming = item.pick === 'as-original' || item.pick === 'as-variant'
    return html`
      <p class="verdict">${sentence}</p>
      ${alone ? this._renderRange(item) : ''}
      <fieldset class="picks">
        <legend>What to do with it</legend>
        ${options.map(
          ({ value, title, help }) => html`
            <label class="pick">
              <input
                type="radio"
                class="pick-${value}"
                name="pick-${index}"
                .checked=${item.pick === value}
                @change=${() => this._pick(item, value)}
              />
              <span><strong>${title}</strong><span class="help">${help}</span></span>
            </label>
          `
        )}
      </fieldset>
      ${
        naming
          ? html`
            <label class="label-field">
              ${item.pick === 'as-original' ? 'Variant name for your current song' : 'Variant name for the imported song'}
              <input
                class="variant-label"
                type="text"
                .value=${item.label ?? 'Alternate chords'}
                @input=${(event: Event) => {
                  item.label = (event.target as HTMLInputElement).value
                }}
              />
            </label>
          `
          : ''
      }
      <div class="duplicate-actions">
        <button
          class="btn primary apply"
          ?disabled=${!item.pick}
          @click=${() => this._applyPicks([item])}
        >
          Import
        </button>
      </div>
      <details ?open=${verdict === 'different-chords' || verdict === 'different-words'}>
        <summary>Compare</summary>
        <chart-diff
          .charts=${charts}
          .keys=${comparison?.keys}
          .labels=${labels}
        ></chart-diff>
      </details>
    `
  }

  _renderDuplicates(unresolved: ImportItem[]) {
    const single = unresolved.length === 1 && this._imports.length === 1
    return html`
      <div class="duplicate">
        <strong>
          ${
            single
              ? 'This song already exists in your library'
              : `${unresolved.length} of these songs ${unresolved.length > 1 ? 'are' : 'is'} already in your library`
          }
        </strong>
        ${
          single
            ? ''
            : html`
              ${
                unresolved.length > 1
                  ? html`
                    <div class="bulk-picks" role="group" aria-label="The same choice for all of them">
                      <span>For all of them:</span>
                      <button class="btn bulk-update-all" type="button" @click=${() => this._pickAll('update')}>
                        Update all ${unresolved.length}
                      </button>
                      <button class="btn bulk-skip" type="button" @click=${() => this._pickAll('use-existing')}>
                        Do not import any
                      </button>
                    </div>
                  `
                  : ''
              }
              <div class="duplicate-actions">
                <button
                  class="btn apply-all"
                  ?disabled=${unresolved.some(item => !item.pick)}
                  @click=${() => this._applyPicks(unresolved)}
                >
                  Import all with these choices
                </button>
              </div>
            `
        }
        <ul>
          ${unresolved.map(
            (item, index) => html`
              <li>
                ${single ? '' : html`<strong>${item.song.title}</strong>`}
                ${this._renderDuplicate(item, index, single)}
              </li>
            `
          )}
        </ul>
      </div>
    `
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
