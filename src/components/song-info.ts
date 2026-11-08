import { css, html, LitElement } from 'lit'
import { HIGHEST_OFFERED, LOWEST_OFFERED, rangeOfMetadata, rangeSpan } from '../js/chart-range.ts'
import type { SongWithContent } from '../js/data-types.ts'
import { formatBeats, type SongMelody } from '../js/melody-analysis.ts'
import { noteName } from '../js/pitch.ts'
import { formatSetlistDate, getWeeksAgo } from '../js/utils/date-utils.ts'
import { describeRange, type NoteRange, octaveNearGreen, rangeStatus } from '../js/voice-range.ts'
import { rangeBadge, rangeBadgeStyles } from './range-badge.ts'
import { buttonStyles } from './shared-styles.ts'

/**
 * The person set the song's melody range, or took it away (null). `key` is the key the range is
 * in: the chart's own. The dialog saves it.
 */
export class SongRangeChangeEvent extends Event {
  static readonly type = 'song-info:range-change'
  readonly songUuid: string
  readonly range: NoteRange | null
  readonly key: string
  constructor(songUuid: string, range: NoteRange | null, key: string) {
    super(SongRangeChangeEvent.type, { bubbles: true, composed: true })
    this.songUuid = songUuid
    this.range = range
    this.key = key
  }
}

/**
 * SongInfo Component
 *
 * Displays detailed information about a song including metadata and usage history.
 * It doesn't show the title: song-info-dialog shows that as its heading.
 *
 * Properties:
 * @property {Object} song - Song data object
 * @property {Array} appearances - Array of appearance records
 *
 * Events:
 */
/** A time the song was played in a setlist */
export interface Appearance {
  setlistId: string
  date: string
  playedInKey: string | null
  leader: string
  setlistName: string
}

export class SongInfo extends LitElement {
  static override properties = {
    song: { type: Object, attribute: false },
    appearances: { type: Array, attribute: false },
    loading: { type: Boolean },
    melody: { attribute: false },
    _editingRange: { state: true },
    _low: { state: true },
    _high: { state: true },
  }

  declare song: SongWithContent | null
  declare appearances: Appearance[]
  declare loading: boolean
  /** The range, and the beats on its ends, from the song's melody (the chart's own range wins) */
  declare melody: SongMelody | null
  /** The melody range's pickers are open, with these notes (MIDI numbers) */
  declare _editingRange: boolean
  declare _low: number
  declare _high: number

  static override styles = [
    buttonStyles,
    rangeBadgeStyles,
    css`
    :host {
      display: block;
      font-family: var(
        --font-family,
        -apple-system,
        BlinkMacSystemFont,
        'Segoe UI',
        Roboto,
        sans-serif
      );
    }

    .song-info-container {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    .modal-columns-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3rem;
    }

    @media (max-width: 768px) {
      .modal-columns-container {
        grid-template-columns: 1fr;
      }
    }

    .modal-left-column,
    .modal-right-column {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .modal-info-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .modal-info-label {
      font-size: var(--font-ui);
      color: var(--text-secondary, #5f6b6d);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }

    .modal-info-value {
      font-size: var(--font-ui-small);
      color: var(--text-color, #2c3e50);
      font-weight: 500;
    }

    .modal-appearances-title {
      font-size: var(--font-ui);
      color: var(--text-secondary, #5f6b6d);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .modal-appearances-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .modal-appearance-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.75rem;
      background-color: var(--bg-secondary, #f8f9fa);
      border-radius: 6px;
      border-left: 3px solid var(--color-primary, #2477ad);
    }

    .appearance-date {
      font-size: var(--font-ui);
      color: var(--text-color, #2c3e50);
      font-weight: 500;
    }

    .appearance-relative {
      font-size: var(--font-ui-small);
      color: var(--text-secondary, #5f6b6d);
    }

    .appearance-meta {
      font-size: var(--font-ui);
      color: var(--text-secondary, #5f6b6d);
      margin-top: 0.3rem;
    }

    .modal-ccli {
      margin-top: 2rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border-color, #ecf0f1);
    }

    .ccli-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--button-bg, #2477ad);
      text-decoration: none;
      font-size: var(--font-ui-small);
      transition: color 0.2s;
    }

    .ccli-link:hover {
      color: var(--color-info, #2980b9);
      text-decoration: underline;
    }

    .songselect-logo {
      height: 16px;
      width: auto;
      vertical-align: middle;
    }

    .ccli-trailer {
      margin-top: 1.5rem;
      padding: 1rem;
      background-color: var(--bg-secondary, #f8f9fa);
      border-radius: 6px;
      font-size: var(--font-ui);
      color: var(--text-secondary, #5f6b6d);
      white-space: pre-line;
      line-height: 1.6;
    }

    .loading {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary, #5f6b6d);
    }

    .empty {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary, #5f6b6d);
      font-style: italic;
    }

    .range-editor {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .range-picker {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: var(--font-ui-small);
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

    /* the range's lines: a badge and its words sit level with the text */
    .range-line {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .range-line .range-badge {
      width: 1.5rem;
      height: 1.5rem;
    }

  `,
  ]

  constructor() {
    super()
    this.song = null
    this.melody = null
    this.appearances = []
    this.loading = false
    this._editingRange = false
    this._low = 62
    this._high = 74
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // (another song, or the song saved: the pickers shut)
    if (changed.has('song')) this._editingRange = false
  }

  override render() {
    if (this.loading) {
      return html`<div class="loading">Loading song information...</div>`
    }

    if (!this.song) {
      return html`<div class="empty">No song data available.</div>`
    }

    const stats = this.calculateAppearanceStats()
    const recentAppearances = this.getRecentAppearances()

    return html`
      <div class="song-info-container">
        <div class="modal-columns-container">
          <!-- Left column: Metadata -->
          <div class="modal-left-column">
            ${
              this.song.artist
                ? html`
                  <div class="modal-info-item">
                    <div class="modal-info-label">Artist</div>
                    <div class="modal-info-value">${this.song.artist}</div>
                  </div>
                `
                : ''
            }
            ${
              this.song.metadata?.key
                ? html`
                  <div class="modal-info-item">
                    <div class="modal-info-label">Original Key / Tempo</div>
                    <div class="modal-info-value">
                      Key:
                      ${this.song.metadata.key}${
                        this.song.metadata.tempo ? ` • ${this.song.metadata.tempo} BPM` : ''
                      }
                    </div>
                  </div>
                `
                : ''
            }
            ${this._renderRange()}
            ${
              this.song.metadata?.timeSignature
                ? html`
                  <div class="modal-info-item">
                    <div class="modal-info-label">Time Signature</div>
                    <div class="modal-info-value">${this.song.metadata.timeSignature}</div>
                  </div>
                `
                : ''
            }
            ${
              this.song.metadata?.copyright && !this._copyrightIsInTrailer()
                ? html`
                  <div class="modal-info-item">
                    <div class="modal-info-label">Copyright</div>
                    <div class="modal-info-value">${this.song.metadata.copyright}</div>
                  </div>
                `
                : ''
            }
            ${
              stats.totalAppearances > 0
                ? html`
                  <div class="modal-info-item">
                    <div class="modal-info-label">Times Played (Total)</div>
                    <div class="modal-info-value">${stats.totalAppearances}</div>
                  </div>
                `
                : ''
            }
          </div>

          <!-- Right column: Recent appearances -->
          <div class="modal-right-column">
            ${
              recentAppearances.length > 0
                ? html`
                  <div class="modal-appearances-title">Recent Plays</div>
                  <div class="modal-appearances-list">
                    ${recentAppearances.map(
                      appearance => html`
                        <div class="modal-appearance-item">
                          <span class="appearance-date">${appearance.formattedDate}</span>
                          <span class="appearance-relative">${appearance.weeksAgo}</span>
                          ${this._renderAppearanceMeta(appearance)}
                        </div>
                      `
                    )}
                  </div>
                `
                : ''
            }
          </div>
        </div>

        <!-- CCLI section -->
        ${this._renderCCLI()}
      </div>
    `
  }

  /**
   * The melody's range (docs/RANGE.md): the lowest and highest note in the chart's key, how it
   * fits voices as written, and how wide it is. It is the song's, so it is the same whatever key
   * it is played in: the key picker is where a key's fit is looked at. Written pitch: men sing it
   * an octave down.
   *
   * It can be set here, for a song with no lead sheet or to correct what one gave. It is not
   * behind edit mode: it changes the song's chart, not the setlist, and a person is able to.
   */
  _renderRange() {
    const range = this.melody?.range ?? rangeOfMetadata(this.song?.parsed?.metadata)
    const chartKey = this.song?.parsed?.metadata?.key
    // the key the notes are in: the chart's, or for a chart with no key the record's (which it is given)
    const key = chartKey || this.song?.key || this.song?.originalKey || ''
    if (this._editingRange && key) return this._renderRangeEditor(range, key)
    if (!range) {
      return key
        ? html`
          <div class="modal-info-item">
            <div class="modal-info-label">Melody Range</div>
            <div class="modal-info-value range-line">
              <span>None yet</span>
              <button class="btn" type="button" @click=${() => this._editRange(range)}>Add a range</button>
            </div>
          </div>
        `
        : ''
    }
    const span = rangeSpan(range, key)
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
    // (the range is kept as it was read, and used in the octave nearest the green, as the key picker does)
    const used = octaveNearGreen(range)
    const note = describeRange(rangeStatus(used))
    const octaves = (used.low - range.low) / 12
    return html`
      <div class="modal-info-item">
        <div class="modal-info-label">Melody Range</div>
        <div class="modal-info-value range-line">
          <span>${noteName(range.low, key)}–${noteName(range.high, key)}${chartKey ? ` in ${chartKey}` : ''}</span>
          ${chartKey ? html`${rangeBadge(note)}<span>${note.words || 'in range'}${octaves ? `, ${Math.abs(octaves) === 1 ? 'an octave' : `${Math.abs(octaves)} octaves`} ${octaves < 0 ? 'lower' : 'higher'}` : ''}</span>` : ''}
          ${key ? html`<button class="btn" type="button" @click=${() => this._editRange(range)}>Edit</button>` : ''}
        </div>
        <div class="modal-info-value">
          ${plural(span.notes, 'note')} wide (${plural(span.semitones, 'semitone')})
        </div>
        ${this._renderExtremes(key)}
      </div>
    `
  }

  /** How long the song sits on its highest and lowest notes, in beats (quarter notes) over the whole song as played */
  _renderExtremes(key: string) {
    const extremes = this.melody?.extremes
    if (!extremes || !key) return ''
    const line = (word: string, midi: number, beats: number) =>
      `${word} ${noteName(midi, this.melody?.rangeKey || key)}: ${formatBeats(beats)} ${beats === 1 ? 'beat' : 'beats'}`
    return html`
      <div class="modal-info-value">
        ${line('Highest', extremes.high, extremes.highBeats)}; ${line('lowest', extremes.low, extremes.lowBeats)}
      </div>
    `
  }

  _editRange(range: NoteRange | null): void {
    // (a song with none starts at a comfortable octave: D4 to D5)
    this._low = range?.low ?? 62
    this._high = range?.high ?? 74
    this._editingRange = true
  }

  /** Two pickers of notes (named as the key names them), to set the range, change it or take it away */
  _renderRangeEditor(range: NoteRange | null, key: string) {
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
      <div class="modal-info-item">
        <div class="modal-info-label">Melody Range</div>
        <div class="range-editor">
          ${picker('Lowest note', this._low, midi => (this._low = midi))}
          ${picker('Highest note', this._high, midi => (this._high = midi))}
        </div>
        <div class="modal-info-value">In ${key}, as written: men sing it an octave down.</div>
        ${wrong ? html`<div class="range-error" role="alert">The lowest note is above the highest.</div>` : ''}
        <div class="range-line">
          <button
            class="btn primary"
            type="button"
            ?disabled=${wrong}
            @click=${() => this._saveRange({ low: this._low, high: this._high }, key)}
          >
            Save
          </button>
          <button class="btn" type="button" @click=${() => (this._editingRange = false)}>Cancel</button>
          ${
            range
              ? html`<button class="btn" type="button" @click=${() => this._saveRange(null, key)}>Remove</button>`
              : ''
          }
        </div>
      </div>
    `
  }

  _saveRange(range: NoteRange | null, key: string): void {
    this._editingRange = false
    if (this.song) this.dispatchEvent(new SongRangeChangeEvent(this.song.uuid, range, key))
  }

  _renderAppearanceMeta(appearance: { leader?: string; playedInKey?: string | null }) {
    const metaParts: string[] = []
    if (appearance.leader) {
      metaParts.push(appearance.leader)
    }
    const keyPlayed = appearance.playedInKey || this.song?.metadata?.key
    if (keyPlayed) {
      metaParts.push(`Key: ${keyPlayed}`)
    }

    if (metaParts.length > 0) {
      return html`<span class="appearance-meta">${metaParts.join(' • ')}</span>`
    }
    return ''
  }

  /** Whether the CCLI trailer already says the copyright, so the Copyright line would repeat it */
  _copyrightIsInTrailer(): boolean {
    const plain = (text: string) =>
      text
        .replace(/©|\(c\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
    const copyright = plain(this.song?.metadata?.copyright ?? '')
    return Boolean(copyright) && plain(this.song?.metadata?.ccliTrailer ?? '').includes(copyright)
  }

  _renderCCLI() {
    const metadata = this.song?.metadata
    const ccliNumber = metadata?.ccli || metadata?.ccliSongNumber || this.song?.ccliNumber
    const ccliTrailer = metadata?.ccliTrailer

    if (!ccliNumber && !ccliTrailer) {
      return ''
    }

    return html`
      <div class="modal-ccli">
        ${
          ccliNumber
            ? html`
              <div class="modal-info-item">
                <div class="modal-info-label">CCLI Number</div>
                <div class="modal-info-value">
                  ${ccliNumber}
                  <a
                    href="https://songselect.ccli.com/songs/${ccliNumber}"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="ccli-link"
                  >
                    <img
                      src="https://songselect.ccli.com/favicon.ico"
                      alt="SongSelect"
                      class="songselect-logo"
                    />
                    View on SongSelect
                  </a>
                </div>
              </div>
            `
            : ''
        }
        ${ccliTrailer ? html` <div class="ccli-trailer">${ccliTrailer}</div> ` : ''}
      </div>
    `
  }

  calculateAppearanceStats() {
    if (!this.appearances || this.appearances.length === 0) {
      return {
        totalAppearances: 0,
        last12MonthsAppearances: 0,
        lastPlayedDate: null,
      }
    }

    const totalAppearances = this.appearances.length

    // Calculate date 12 months ago
    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

    // Filter appearances in last 12 months
    const last12MonthsAppearances = this.appearances.filter(appearance => {
      const appearanceDate = new Date(appearance.date)
      return appearanceDate >= twelveMonthsAgo
    }).length

    // Find most recent appearance date
    const sortedAppearances = [...this.appearances].sort((a, b) => b.date.localeCompare(a.date))
    const lastPlayedDate = sortedAppearances[0].date

    return {
      totalAppearances,
      last12MonthsAppearances,
      lastPlayedDate,
    }
  }

  getRecentAppearances() {
    if (!this.appearances || this.appearances.length === 0) {
      return []
    }

    // Sort by date (most recent first) and take the last 6 appearances
    return this.appearances
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6)
      .map(appearance => ({
        date: appearance.date,
        formattedDate: this._formatDate(appearance.date),
        weeksAgo: getWeeksAgo(appearance.date),
        playedInKey: appearance.playedInKey,
        leader: appearance.leader,
      }))
  }

  _formatDate(dateStr: string): string {
    return formatSetlistDate(dateStr, 'long')
  }
}

// Define the custom element
customElements.define('song-info', SongInfo)

declare global {
  interface HTMLElementTagNameMap {
    'song-info': SongInfo
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [SongRangeChangeEvent.type]: SongRangeChangeEvent
  }
}
