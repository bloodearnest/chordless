import { css, html, LitElement, nothing } from 'lit'
import { classMap } from 'lit/directives/class-map.js'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import type { ChartLine, ChartSegment, HideMode } from '../js/data-types.ts'
import { groupSegmentsIntoUnits } from '../js/utils/chart-line-units.ts'
import { isBarMarker } from '../js/utils/chord-utils.ts'
import {
  formatHiddenLyricsText,
  normalizeSegmentsForHiddenChords,
  segmentHasVisibleLyrics,
} from '../js/utils/lyrics-normalizer.ts'
import type { BarGroupData, Measure } from './bar-group.ts'
import './bar-group.ts'
import './chord-display.ts'

/** A Show option or the collapse button was pressed: action is show-all, show-lyrics, show-chords, show-none or collapse */
export class SectionActionEvent extends Event {
  static readonly type = 'song-section:action'
  readonly songIndex: number
  readonly sectionIndex: number
  readonly action: string
  constructor(songIndex: number, sectionIndex: number, action: string) {
    super(SectionActionEvent.type, { bubbles: true, composed: true })
    this.songIndex = songIndex
    this.sectionIndex = sectionIndex
    this.action = action
  }
}

/** The section's heading was clicked */
export class SectionToggleEvent extends Event {
  static readonly type = 'song-section:toggle'
  readonly songIndex: number
  readonly sectionIndex: number
  constructor(songIndex: number, sectionIndex: number) {
    super(SectionToggleEvent.type, { bubbles: true, composed: true })
    this.songIndex = songIndex
    this.sectionIndex = sectionIndex
  }
}

/** What a section renders: a line of lyrics and chords, or a run of bar-only lines laid out together */
type ContentBlock = { type: 'bar-group'; data: BarGroupData } | { type: 'line'; line: ChartLine }

/** A segment as rendered; hiding chords marks which join the word before them */
type RenderedSegment = ChartSegment & { __joinWithPrev?: boolean }

/**
 * A custom element for rendering a section of a song with chords and lyrics.
 * Supports collapsing, hiding chords/lyrics, and special bar notation rendering.
 *
 * @element song-section
 * @fires SectionActionEvent - When a Show option or the collapse button is pressed
 * @fires SectionToggleEvent - When the section heading is clicked
 */
export class SongSection extends LitElement {
  static override properties = {
    /** @type {number} Index of the song this section belongs to */
    songIndex: { type: Number, attribute: 'song-index', reflect: true },
    /** @type {number} Index of this section within the song */
    sectionIndex: { type: Number, attribute: 'section-index', reflect: true },
    /** @type {boolean} Whether edit mode is active */
    editMode: { type: Boolean, reflect: true, attribute: 'edit-mode' },
    /** @type {string} Hide mode: 'none', 'collapse', 'chords', or 'lyrics' */
    hideMode: { type: String, attribute: 'hide-mode' },
    /** @type {boolean} Whether the section is collapsed */
    isCollapsed: { type: Boolean, attribute: false },
    /** @type {boolean} Whether the section is hidden */
    isHidden: { type: Boolean, attribute: false },
    /** @type {string} Section label (e.g., "Verse 1", "Chorus") */
    label: { type: String, attribute: 'label' },
    /** @type {string} Text shown after the label, e.g. "(first time a cappella)" */
    note: { type: String, attribute: 'note' },
    /** @type {Array<{segments: Array<{chord: string, lyrics: string}>}>} Parsed chord/lyric lines */
    lines: { attribute: false },
    /** @type {boolean} Display chords as Nashville numbers */
    displayAsNashville: { type: Boolean, attribute: 'display-as-nashville' },
    /** Show accidentals as ♯ and ♭ */
    unicodeAccidentals: { type: Boolean, attribute: 'unicode-accidentals' },
    /** @type {string} Key used for Nashville conversion */
    displayKey: { type: String, attribute: 'display-key' },
    /** @type {number} Capo value for display-only transposition */
    capo: { type: Number },
    /** @type {string} Target key after applying capo */
    capoKey: { type: String, attribute: 'capo-key' },
  }

  declare songIndex: number
  declare sectionIndex: number
  declare editMode: boolean
  declare hideMode: HideMode
  declare isCollapsed: boolean
  declare isHidden: boolean
  declare label: string
  declare note: string
  declare displayAsNashville: boolean
  declare unicodeAccidentals: boolean
  declare displayKey: string
  declare capo: number
  declare capoKey: string

  _wrapper: Ref<HTMLElement>
  _lines: ChartLine[] | undefined
  _contentBlocks: ContentBlock[]
  _hasAnyChords: boolean
  _hasAnyLyrics: boolean

  static override styles = css`
    .song-section-wrapper {
      padding: 0;
      margin: 0 0 0.1rem 0;
      border: 2px solid transparent;
      border-radius: 8px;
      transition:
        border-color 0.25s ease-in-out,
        background-color 0.25s ease-in-out;
    }

    @media (min-width: 48rem) {
      .song-section-wrapper {
        padding: 0rem 0.5rem;
        margin: 0.25rem 0.5rem;
      }
    }

    :host([edit-mode]) .song-section-wrapper {
      border-style: dotted;
      border-color: var(--border-color, #bdc3c7);
      background-color: var(--bg-secondary, #f9f9f9);
    }

    .song-section-wrapper .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      min-height: 2rem;
      width: 100%;
    }

    .song-section-wrapper .section-title-wrapper {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 0;
    }

    .song-section-wrapper details.song-section summary.section-label {
      cursor: pointer;
      user-select: none;
      margin: 0;
      outline: none;
      -webkit-tap-highlight-color: transparent;
      tap-highlight-color: transparent;
      line-height: 1.6rem;
      padding: 0.2rem 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
    }

    .song-section-wrapper details.song-section summary.section-label::-webkit-details-marker,
    .song-section-wrapper details.song-section summary.section-label:focus,
    .song-section-wrapper details.song-section summary.section-label:focus-visible,
    .song-section-wrapper details.song-section summary.section-label:active {
      outline: none;
      background: none;
    }

    .song-section-wrapper .section-title {
      font-size: var(--font-lyrics);
      color: var(--text-secondary, #5f6b6d);
      font-weight: bold;
      font-style: italic;
      white-space: nowrap;
      margin: 0;
      padding: 0;
    }

    .song-section-wrapper .section-note {
      font-size: var(--font-lyrics);
      color: var(--text-secondary, #5f6b6d);
      font-style: italic;
      white-space: nowrap;
    }

    .song-section-wrapper .section-collapse-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--text-secondary, #5f6b6d);
      font-size: var(--font-ui);
      line-height: 1;
      cursor: pointer;
      width: 1.75rem;
      height: 1.75rem;
      padding: 0.05rem 0.25rem;
      opacity: 0;
      transition:
        opacity 0.25s ease-in-out,
        color 0.2s,
        transform 0.2s;
    }

    :host([edit-mode]) .song-section-wrapper .section-collapse-toggle {
      opacity: 1;
    }

    :host(:not([edit-mode])) .song-section-wrapper .section-collapse-toggle {
      pointer-events: none;
    }

    .song-section-wrapper .section-collapse-toggle:hover {
      color: var(--text-color, #34495e);
    }

    .song-section-wrapper .section-collapse-toggle:focus-visible {
      outline: 2px solid var(--focus-ring, #3498db);
      outline-offset: 2px;
      border-radius: 4px;
    }

    .song-section-wrapper .section-collapse-toggle .collapse-icon {
      display: inline-block;
      transition: transform 0.2s ease-in-out;
    }

    .song-section-wrapper.section-collapsed .section-collapse-toggle .collapse-icon {
      transform: rotate(-90deg);
    }

    .song-section-wrapper .section-content {
      margin-top: 0;
    }

    .song-section-wrapper .section-controls {
      display: flex;
      flex-direction: row;
      gap: 0.2rem;
      align-items: center;
      margin-left: auto;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease-in-out;
    }

    :host([edit-mode]) .song-section-wrapper .section-controls {
      opacity: 1;
      pointer-events: auto;
    }

    .song-section-wrapper.section-collapsed .section-content,
    .song-section-wrapper.section-hidden .section-content {
      display: none;
    }

    .song-section-wrapper.section-hidden {
      display: none;
    }

    :host([edit-mode]) .song-section-wrapper.section-hidden {
      display: block;
    }

    :host([edit-mode]) .song-section-wrapper.section-hidden .section-title {
      text-decoration: line-through;
      opacity: 0.6;
    }

    .song-section-wrapper .section-controls .hide-label {
      font-size: var(--font-ui-small);
      font-weight: 600;
      color: var(--text-secondary, #5f6b6d);
    }

    .song-section-wrapper .hide-pill {
      display: flex;
      border: 1.5px solid var(--border-color, #7f8c8d);
      border-radius: 0.5rem;
      overflow: hidden;
      background: var(--bg-tertiary, rgba(255, 255, 255, 0.9));
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      -webkit-backdrop-filter: blur(4px);
      backdrop-filter: blur(4px);
    }

    /* Equal widths on larger screens */
    @media (min-width: 48rem) {
      .song-section-wrapper .hide-pill {
        display: grid;
        grid-template-columns: repeat(var(--pill-option-count, 4), minmax(4rem, 1fr));
      }
    }

    .song-section-wrapper .hide-pill button {
      border: none;
      background: var(--bg-secondary, rgba(255, 255, 255, 0.95));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: calc(var(--font-ui-small) * 0.8);
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-secondary, #5f6b6d);
      padding: 0.3rem 0.1rem;
      cursor: pointer;
      transition:
        background-color 0.2s,
        color 0.2s;
    }

    /* Minimal padding on larger screens with grid layout */
    @media (min-width: 48rem) {
      .song-section-wrapper .hide-pill button {
        padding: 0.3rem 0.1rem;
      }
    }

    .song-section-wrapper .hide-pill button + button {
      border-left: 1px solid var(--border-light, rgba(189, 195, 199, 0.6));
    }

    .song-section-wrapper .hide-pill button:focus-visible {
      outline: 2px solid var(--focus-ring, #3498db);
      outline-offset: -2px;
    }

    .song-section-wrapper .hide-pill button.active {
      background-color: var(--button-bg);
      color: var(--button-text, #fff);
    }

    .song-section-wrapper .hide-pill button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      background-color: var(--bg-tertiary, rgba(255, 255, 255, 0.5));
      color: var(--text-muted, #bdc3c7);
    }

    .song-section-wrapper.chords-hidden .chord {
      display: none;
    }

    .song-section-wrapper.lyrics-hidden .lyrics {
      display: none;
    }

    .song-section-wrapper .section-control-btn .control-label {
      font-weight: 600;
      font-size: var(--font-ui-small);
    }

    .song-section-wrapper .section-content {
      margin-top: 0;
      max-width: 100%;
      overflow-wrap: break-word;
      word-wrap: break-word;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .song-section-wrapper .chord-line {
      display: flex;
      margin-bottom: 0.2rem;
      line-height: 1.5em;
      flex-wrap: wrap;
    }

    /* A word and the chords over it: the line breaks between units, never inside one */
    .song-section-wrapper .chord-unit {
      display: inline-flex;
    }

    .song-section-wrapper .chord-segment {
      display: inline-flex;
      flex-direction: column;
      white-space: pre-wrap;
    }

    .song-section-wrapper .chord-segment.chord-only {
      padding-right: 0.5em;
    }

    .song-section-wrapper.chords-hidden .chord-segment.chord-only {
      display: none;
    }

    .song-section-wrapper .chord {
      color: var(--chord-color, #2980b9);
      font-weight: bold;
      font-size: var(--font-chords);
      line-height: 1.1em;
      padding-right: 0.25em;
      font-family: 'Source Sans Pro', 'Segoe UI', sans-serif;
      display: inline-block;
      white-space: nowrap;
    }

    /* A chord over words that go on under the next chord's room takes no width of its own */
    .song-section-wrapper .chord-segment.chord-spills .chord {
      width: 0;
      padding-right: 0;
      overflow: visible;
    }

    .song-section-wrapper .chord.bar {
      color: var(--text-tertiary, #95a5a6);
      font-weight: normal;
    }

    .song-section-wrapper .chord.invalid {
      color: var(--text-muted, #bdc3c7);
      opacity: 0.5;
      font-style: italic;
    }

    .song-section-wrapper .chord-empty {
      visibility: hidden;
    }

    .song-section-wrapper .lyrics {
      font-size: var(--font-lyrics);
      line-height: 1.4em;
      padding: 0;
      margin: 0;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .song-section-wrapper .chord.invalid {
      color: var(--color-danger, #e74c3c);
    }

    .song-section-wrapper .chord sup.chord-extension {
      display: inline-block;
      font-size: calc(var(--font-chords) * 0.75);
      line-height: 1;
      vertical-align: baseline;
      transform: translateY(-0.3em);
      margin-left: 0.05em;
    }
  `

  constructor() {
    super()
    this._wrapper = createRef()
    this.songIndex = 0
    this.sectionIndex = 0
    this.editMode = false
    this.hideMode = 'none'
    this.isCollapsed = false
    this.isHidden = false
    this.label = ''
    this.note = ''
    this._lines = undefined // Private storage for lines
    this._contentBlocks = []
    this._hasAnyChords = false
    this._hasAnyLyrics = false
    this._onControlClick = this._onControlClick.bind(this)
    this._onSummaryClick = this._onSummaryClick.bind(this)
    this.displayAsNashville = false
    this.unicodeAccidentals = false
    this.displayKey = ''
    this.capo = 0
    this.capoKey = ''
  }

  /**
   * Get the lines data for this section
   */
  get lines(): ChartLine[] | undefined {
    return this._lines
  }

  /**
   * Set the lines data and rebuild content blocks
   */
  set lines(value: ChartLine[] | undefined) {
    const oldValue = this._lines
    this._lines = value
    if (value && value.length > 0) {
      this._contentBlocks = this._buildContentBlocks(value)
      this._analyzeContent(value)
    }
    this.requestUpdate('lines', oldValue)
  }

  /**
   * Analyze the content to determine what controls should be available
   * @param lines - Lines to analyze
   * @private
   */
  _analyzeContent(lines: ChartLine[]): void {
    this._hasAnyChords = false
    this._hasAnyLyrics = false

    for (const line of lines) {
      const segments = line?.segments || []
      for (const segment of segments) {
        if (segment.chord?.trim()) {
          this._hasAnyChords = true
        }
        if (this._segmentHasLyrics(segment)) {
          this._hasAnyLyrics = true
        }
        // Early exit if we've found both
        if (this._hasAnyChords && this._hasAnyLyrics) {
          return
        }
      }
    }
  }

  /**
   * Get the recommended hideMode based on content analysis
   * @returns Recommended hideMode: 'lyrics' (show chords only), 'chords' (show lyrics only), or 'none' (show all)
   */
  getRecommendedHideMode(): 'lyrics' | 'chords' | 'none' {
    if (!this._hasAnyLyrics && this._hasAnyChords) {
      // Only chords, show chords only
      return 'lyrics'
    } else if (!this._hasAnyChords && this._hasAnyLyrics) {
      // Only lyrics, show lyrics only
      return 'chords'
    }
    // Has both or neither, show all
    return 'none'
  }

  /** @inheritdoc */
  override connectedCallback() {
    super.connectedCallback()
    if (!this.label?.trim() && this.dataset?.label) {
      this.label = this.dataset.label
    }
  }

  override cloneNode(deep = true): Node {
    const clone = super.cloneNode(deep)
    if (clone instanceof SongSection) {
      clone.lines = this._cloneLines(this.lines)
      clone.label = this.label
      clone.note = this.note
    }
    return clone
  }

  override render() {
    const classes = {
      'song-section-wrapper': true,
      'section-hidden': !!this.isHidden,
      'section-collapsed': this.hideMode === 'collapse',
      'chords-hidden': this.hideMode === 'chords',
      'lyrics-hidden': this.hideMode === 'lyrics',
      'edit-mode-active': !!this.editMode,
    }
    const label = (this.label || '').trim()
    const sectionLabel = label || `Section ${this.sectionIndex + 1}`

    return html` <div
      ${ref(this._wrapper)}
      class=${classMap(classes)}
      role="region"
      aria-label=${sectionLabel}
      data-song-index=${this.songIndex}
      data-section-index=${this.sectionIndex}
    >
      ${label ? this._renderLabeledSection(label) : this._renderPlainSection()}
    </div>`
  }

  // willUpdate not needed - lines setter handles content block building

  _renderLabeledSection(label: string) {
    const detailsOpen = this._shouldDetailsBeOpen()
    return html`
      <details class="song-section" ?open=${detailsOpen}>
        <summary class="section-label" @click=${this._onSummaryClick}>
          <div class="section-header">
            <div class="section-title-wrapper">
              <h3 class="section-title">${label}</h3>
              ${this.note ? html`<span class="section-note">${this.note}</span>` : ''}
              ${this._renderCollapseToggle()}
            </div>
            ${this._renderControls()}
          </div>
        </summary>
        <div class="section-content">${this._renderContent()}</div>
      </details>
    `
  }

  _renderPlainSection() {
    return html`
      <div class="song-section">
        <div class="section-content">${this._renderContent()}</div>
      </div>
    `
  }

  _renderControls() {
    const showAllActive = !this.isHidden && (!this.hideMode || this.hideMode === 'none')
    const showLyricsActive = !this.isHidden && this.hideMode === 'chords'
    const showChordsActive = !this.isHidden && this.hideMode === 'lyrics'
    const showNoneActive = this.isHidden || this.hideMode === 'hide'

    // Disable controls based on content
    const canShowLyrics = this._hasAnyLyrics
    const canShowChords = this._hasAnyChords
    const canShowAll = canShowLyrics && canShowChords

    if (this.style) {
      this.style.setProperty('--pill-option-count', '4')
    }
    return html`
      <div class="section-controls" role="group" aria-label="Show content options">
        <span class="hide-label">Show:</span>
        <div class="hide-pill">
          ${this._renderControlButton('show-all', 'All', showAllActive, !canShowAll)}
          ${this._renderControlButton('show-lyrics', 'Lyrics', showLyricsActive, !canShowLyrics)}
          ${this._renderControlButton('show-chords', 'Chords', showChordsActive, !canShowChords)}
          ${this._renderControlButton('show-none', 'None', showNoneActive)}
        </div>
      </div>
    `
  }

  _renderControlButton(action: string, label: string, active: boolean, disabled = false) {
    // (the controls are only in a section with a label)
    const sectionLabel = this.label.trim()
    const ariaLabel = `Show ${label} in ${sectionLabel}`
    return html`
      <button
        class=${classMap({ active: !!active })}
        data-action=${action}
        aria-label=${ariaLabel}
        aria-pressed=${active ? 'true' : 'false'}
        ?disabled=${disabled}
        @click=${this._onControlClick}
      >
        ${label}
      </button>
    `
  }

  _renderCollapseToggle() {
    const isCollapsed = this.hideMode === 'collapse' || this.isCollapsed
    const ariaLabel = isCollapsed ? 'Expand section' : 'Collapse section'
    const classes = classMap({
      'section-collapse-toggle': true,
      active: isCollapsed,
    })
    return html`
      <button
        class=${classes}
        data-action="collapse"
        aria-label=${ariaLabel}
        aria-pressed=${isCollapsed ? 'true' : 'false'}
        @click=${this._onControlClick}
      >
        <span class="collapse-icon" aria-hidden="true">▾</span>
      </button>
    `
  }

  _renderContent() {
    if (!this._contentBlocks || this._contentBlocks.length === 0) {
      return nothing
    }

    return this._contentBlocks.map((block, index) => {
      if (block.type === 'bar-group') {
        if (this.hideMode === 'chords') {
          return nothing
        }
        return html`<bar-group
          .data=${block.data}
          .displayAsNashville=${this.displayAsNashville}
          .unicodeAccidentals=${this.unicodeAccidentals}
          .displayKey=${this.displayKey}
          .capo=${this.capo}
          .capoKey=${this.capoKey}
        ></bar-group>`
      }
      return this._renderLine(block.line, index)
    })
  }

  _renderLine(line: ChartLine | undefined, index: number) {
    const segments = line?.segments || []
    if (segments.length === 0) {
      return nothing
    }

    const normalizedSegments = this._normalizeSegmentLyrics(segments)

    // Check if this line has ANY chords
    const lineHasChords = normalizedSegments.some(seg => seg.chord?.trim())

    // What each segment shows (lyrics that are only hyphens or spaces show none)
    let hasPreviousLyrics = false
    const shown: ChartSegment[] = normalizedSegments.map(segment => {
      const hasLyrics = this._segmentHasLyrics(segment)
      const lyrics = hasLyrics
        ? this._formatLyricsText(segment.lyrics, hasPreviousLyrics, !!segment.__joinWithPrev)
        : ''
      if (hasLyrics) hasPreviousLyrics = true
      return { ...segment, lyrics }
    })

    // The line wraps between units: words, with the chords over them, never inside a word
    const units = lineHasChords
      ? groupSegmentsIntoUnits(shown, { reserveChords: this.hideMode !== 'chords' })
      : shown.map(segment => [segment])

    return html`
      <div class="chord-line" data-line-index=${index}>
        ${units.map(
          unit =>
            html`<span class="chord-unit">${unit.map((piece, at) =>
              // (a chord spills over the chordless words after it, which the unit has made room for)
              this._renderSegment(
                piece,
                lineHasChords,
                !!piece.chord && unit[at + 1] !== undefined && !unit[at + 1].chord
              )
            )}</span>`
        )}
      </div>
    `
  }

  _renderSegment(segment: ChartSegment, lineHasChords = true, chordSpills = false) {
    const hasLyrics = segment.lyrics.length > 0
    const chordText = segment.chord || ''
    const classes = classMap({
      'chord-segment': true,
      'chord-only': !hasLyrics,
      'chord-spills': chordSpills && hasLyrics,
    })

    // If the line has no chords at all, don't render chord placeholders
    const shouldRenderChordSpace = lineHasChords

    return html`
      <span class=${classes}>
        ${
          shouldRenderChordSpace
            ? chordText
              ? this._renderChord(chordText, segment.valid === false)
              : html`<span class="chord chord-empty">&nbsp;</span>`
            : nothing
        }
        ${hasLyrics ? html`<span class="lyrics">${segment.lyrics}</span>` : nothing}
      </span>
    `
  }

  _renderChord(chordText: string, isInvalid = false) {
    const classes = classMap({
      chord: true,
      bar: isBarMarker(chordText),
      invalid: !!isInvalid,
    })
    return html`
      <span class=${classes}>
        <chord-display
          .chord=${chordText}
          .displayKey=${this.displayKey}
          .displayAsNashville=${this.displayAsNashville}
          .unicodeAccidentals=${this.unicodeAccidentals}
          .invalid=${!!isInvalid}
          .capo=${this.capo}
          .capoKey=${this.capoKey}
        ></chord-display>
      </span>
    `
  }

  _onControlClick(event: Event): void {
    event.stopPropagation()
    event.preventDefault()
    const action = (event.currentTarget as HTMLElement).dataset.action as string
    this.dispatchEvent(new SectionActionEvent(this.songIndex, this.sectionIndex, action))
  }

  _onSummaryClick(event: Event): void {
    event.preventDefault()
    this.dispatchEvent(new SectionToggleEvent(this.songIndex, this.sectionIndex))
  }

  _shouldDetailsBeOpen(): boolean {
    if (this.editMode) return true
    return !(this.isCollapsed || this.hideMode === 'collapse')
  }

  getDetailsElement(): HTMLDetailsElement | null {
    return this._getWrapper()?.querySelector<HTMLDetailsElement>('details.song-section') || null
  }

  _getWrapper(): HTMLElement | null {
    return this._wrapper.value || null
  }

  /**
   * Build content blocks from lines, grouping consecutive bar-only lines together
   * @param lines - Raw line data
   * @returns Content blocks for rendering
   * @private
   */
  _buildContentBlocks(lines: ChartLine[]): ContentBlock[] {
    if (!Array.isArray(lines) || lines.length === 0) {
      return []
    }

    const blocks: ContentBlock[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]
      if (this._isBarLineLine(line)) {
        const barLines = this._collectBarGroup(lines, i)
        blocks.push({
          type: 'bar-group',
          data: this._buildBarGroupData(barLines),
        })
        i += barLines.length
      } else {
        blocks.push({ type: 'line', line })
        i++
      }
    }

    return blocks
  }

  /**
   * Collect consecutive bar-only lines into a group
   * @param lines - All lines
   * @param startIndex - Index to start collecting from
   * @returns Group of consecutive bar lines
   * @private
   */
  _collectBarGroup(lines: ChartLine[], startIndex: number): ChartLine[] {
    const group: ChartLine[] = []
    for (let i = startIndex; i < lines.length; i++) {
      const candidate = lines[i]
      if (this._isBarLineLine(candidate)) {
        group.push(candidate)
      } else {
        break
      }
    }
    return group
  }

  /**
   * Build structured data for rendering a bar group with aligned measures
   * @param lines - Bar-only lines
   * @returns Structured bar group data
   * @private
   */
  _buildBarGroupData(lines: ChartLine[]): BarGroupData {
    if (!lines.length) {
      return { measuresPerLine: [], maxMeasures: 0 }
    }

    const measuresPerLine = lines.map(line => {
      const items: { chord: string; isBar: boolean }[] = []
      line.segments?.forEach(segment => {
        if (segment.chord) {
          items.push({
            chord: segment.chord,
            isBar: isBarMarker(segment.chord),
          })
        }
      })

      const measures: Measure[] = []
      let currentMeasure: string[] = []

      items.forEach(item => {
        if (item.isBar) {
          measures.push({
            chords: currentMeasure,
            bar: item.chord,
          })
          currentMeasure = []
        } else {
          currentMeasure.push(item.chord)
        }
      })

      if (currentMeasure.length > 0 || measures.length === 0) {
        measures.push({
          chords: currentMeasure,
          bar: null,
        })
      }

      return measures
    })

    const maxMeasures = Math.max(1, ...measuresPerLine.map(measures => measures.length))
    return { measuresPerLine, maxMeasures }
  }

  /**
   * Check if a line contains only chords and bar markers (no lyrics)
   * @param line - Line to check
   * @returns True if line is bar-only
   * @private
   */
  _isBarLineLine(line: ChartLine | undefined): boolean {
    if (!line?.segments || line.segments.length === 0) return false
    let hasBar = false
    for (const segment of line.segments) {
      const hasLyrics = segment.lyrics && segment.lyrics.trim().length > 0
      if (hasLyrics) return false
      if (segment.chord && isBarMarker(segment.chord)) {
        hasBar = true
      }
    }
    return hasBar
  }

  /**
   * Deep clone lines data
   * @param lines - Lines to clone
   * @returns Cloned lines
   * @private
   */
  _cloneLines(lines: ChartLine[] | undefined): ChartLine[] {
    if (!Array.isArray(lines)) {
      return []
    }
    return lines.map(line => ({
      segments: (line.segments || []).map(segment => ({ ...segment })),
    }))
  }

  /**
   * When chords are hidden, collapse filler hyphen markers (e.g. " - ")
   * so lyrics read naturally.
   */
  _formatLyricsText(text: string, previousHadLyrics = false, joinWithPrev = false): string {
    if (!text) {
      return ''
    }
    if (this.hideMode !== 'chords') {
      return text
    }
    return formatHiddenLyricsText(text, previousHadLyrics, joinWithPrev)
  }

  _segmentHasLyrics(segment: ChartSegment): boolean {
    return segmentHasVisibleLyrics(segment)
  }

  _normalizeSegmentLyrics(segments: ChartSegment[]): RenderedSegment[] {
    if (!Array.isArray(segments) || segments.length === 0) {
      return []
    }
    if (this.hideMode !== 'chords') {
      return segments
    }
    return normalizeSegmentsForHiddenChords(segments)
  }
}

customElements.define('song-section', SongSection)

declare global {
  interface HTMLElementTagNameMap {
    'song-section': SongSection
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [SectionActionEvent.type]: SectionActionEvent
    [SectionToggleEvent.type]: SectionToggleEvent
  }
}
