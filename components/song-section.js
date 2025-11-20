import { css, html, LitElement, nothing } from 'lit'
import { classMap } from 'lit/directives/class-map.js'
import { isBarMarker } from '../js/utils/chord-utils.js'
import {
  formatHiddenLyricsText,
  normalizeSegmentsForHiddenChords,
  segmentHasVisibleLyrics,
} from '../js/utils/lyrics-normalizer.js'
import './bar-group.js'
import './chord-display.js'

/**
 * A custom element for rendering a section of a song with chords and lyrics.
 * Supports collapsing, hiding chords/lyrics, and special bar notation rendering.
 *
 * @element song-section
 * @fires {CustomEvent} section-action - Fired when a control button is clicked
 * @fires {CustomEvent} section-toggle - Fired when section is collapsed/expanded
 */
export class SongSection extends LitElement {
  static properties = {
    /** @type {number} Index of the song this section belongs to */
    songIndex: { type: Number, attribute: 'song-index', reflect: true },
    /** @type {number} Index of this section within the song */
    sectionIndex: { type: Number, attribute: 'section-index', reflect: true },
    /** @type {boolean} Whether edit mode is active */
    editMode: { type: Boolean, reflect: true, attribute: 'editmode' },
    /** @type {string} Hide mode: 'none', 'collapse', 'chords', or 'lyrics' */
    hideMode: { type: String, attribute: 'hide-mode' },
    /** @type {boolean} Whether the section is collapsed */
    isCollapsed: { type: Boolean, attribute: false },
    /** @type {boolean} Whether the section is hidden */
    isHidden: { type: Boolean, attribute: false },
    /** @type {string} Section label (e.g., "Verse 1", "Chorus") */
    label: { type: String, attribute: 'label' },
    /** @type {Array<{segments: Array<{chord: string, lyrics: string}>}>} Parsed chord/lyric lines */
    lines: { attribute: false },
    /** @type {boolean} Display chords as Nashville numbers */
    displayAsNashville: { type: Boolean, attribute: 'display-as-nashville' },
    /** @type {string} Key used for Nashville conversion */
    displayKey: { type: String, attribute: 'display-key' },
    /** @type {number} Capo value for display-only transposition */
    capo: { type: Number },
    /** @type {string} Target key after applying capo */
    capoKey: { type: String, attribute: 'capo-key' },
  }

  static styles = css`
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

    :host([editmode]) .song-section-wrapper,
    :host([libraryeditmode]) .song-section-wrapper {
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
      font-size: 1.6rem;
      color: #7f8c8d;
      font-weight: bold;
      font-style: italic;
      white-space: nowrap;
      margin: 0;
      padding: 0;
    }

    .song-section-wrapper .section-collapse-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: #7f8c8d;
      font-size: 1.4rem;
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

    :host([editmode]) .song-section-wrapper .section-collapse-toggle {
      opacity: 1;
    }

    :host(:not([editmode])) .song-section-wrapper .section-collapse-toggle {
      pointer-events: none;
    }

    .song-section-wrapper .section-collapse-toggle:hover {
      color: #34495e;
    }

    .song-section-wrapper .section-collapse-toggle:focus-visible {
      outline: 2px solid #3498db;
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
      gap: 0.6rem;
      align-items: center;
      margin-left: auto;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease-in-out;
    }

    :host([editmode]) .song-section-wrapper .section-controls,
    :host([libraryeditmode]) .song-section-wrapper .section-controls {
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

    :host([editmode]) .song-section-wrapper.section-hidden,
    :host([libraryeditmode]) .song-section-wrapper.section-hidden {
      display: block;
    }

    :host([editmode]) .song-section-wrapper.section-hidden .section-title,
    :host([libraryeditmode]) .song-section-wrapper.section-hidden .section-title {
      text-decoration: line-through;
      opacity: 0.6;
    }

    .song-section-wrapper .section-controls .hide-label {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-secondary, #7f8c8d);
    }

    .song-section-wrapper .hide-pill {
      display: grid;
      grid-template-columns: repeat(var(--pill-option-count, 4), minmax(4rem, 1fr));
      border: 1.5px solid var(--border-color, #7f8c8d);
      border-radius: 0.5rem;
      overflow: hidden;
      background: var(--bg-tertiary, rgba(255, 255, 255, 0.9));
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      backdrop-filter: blur(4px);
    }

    .song-section-wrapper .hide-pill button {
      border: none;
      background: var(--bg-secondary, rgba(255, 255, 255, 0.95));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-secondary, #7f8c8d);
      padding: 0.3rem 0rem;
      cursor: pointer;
      transition:
        background-color 0.2s,
        color 0.2s;
      min-width: 4.75rem;
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
      font-size: 0.8rem;
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

    .song-section-wrapper .chord-segment {
      display: inline-flex;
      flex-direction: column;
      white-space: pre;
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
      font-size: 0.9em;
      line-height: 1.1em;
      padding-right: 0.25em;
      font-family: 'Source Sans Pro', 'Segoe UI', sans-serif;
      display: inline-block;
      white-space: nowrap;
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
      font-size: 0.75em;
      line-height: 1;
      vertical-align: baseline;
      transform: translateY(-0.3em);
      margin-left: 0.05em;
    }
  `

  constructor() {
    super()
    this.songIndex = 0
    this.sectionIndex = 0
    this.editMode = false
    this.hideMode = 'none'
    this.isCollapsed = false
    this.isHidden = false
    this.label = ''
    this._lines = undefined // Private storage for lines
    this._contentBlocks = []
    this._hasAnyChords = false
    this._hasAnyLyrics = false
    this._onControlClick = this._onControlClick.bind(this)
    this._onSummaryClick = this._onSummaryClick.bind(this)
    this.displayAsNashville = false
    this.displayKey = ''
    this.capo = 0
    this.capoKey = ''
  }

  /**
   * Get the lines data for this section
   * @returns {Array<{segments: Array<{chord: string, lyrics: string}>}>}
   */
  get lines() {
    return this._lines
  }

  /**
   * Set the lines data and rebuild content blocks
   * @param {Array<{segments: Array<{chord: string, lyrics: string}>}>} value
   */
  set lines(value) {
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
   * @param {Array} lines - Lines to analyze
   * @private
   */
  _analyzeContent(lines) {
    this._hasAnyChords = false
    this._hasAnyLyrics = false

    for (const line of lines) {
      const segments = line?.segments || []
      for (const segment of segments) {
        if (segment.chord && segment.chord.trim()) {
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
   * @returns {string} Recommended hideMode: 'lyrics' (show chords only), 'chords' (show lyrics only), or 'none' (show all)
   */
  getRecommendedHideMode() {
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
  connectedCallback() {
    super.connectedCallback()
    if ((!this.label || !this.label.trim()) && this.dataset?.label) {
      this.label = this.dataset.label
    }
  }

  cloneNode(deep = true) {
    const clone = super.cloneNode(deep)
    if (clone instanceof SongSection) {
      clone.lines = this._cloneLines(this.lines)
      clone.label = this.label
    }
    return clone
  }

  render() {
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
      class=${classMap(classes)}
      role="region"
      aria-label=${sectionLabel}
      ?aria-hidden=${this.isHidden && !this.editMode}
      data-song-index=${this.songIndex}
      data-section-index=${this.sectionIndex}
    >
      ${label ? this._renderLabeledSection(label) : this._renderPlainSection()}
    </div>`
  }

  // willUpdate not needed - lines setter handles content block building

  _renderLabeledSection(label) {
    const detailsOpen = this._shouldDetailsBeOpen()
    return html`
      <details
        class="song-section"
        ?open=${detailsOpen}
        aria-expanded=${detailsOpen ? 'true' : 'false'}
      >
        <summary class="section-label" @click=${this._onSummaryClick}>
          <div class="section-header">
            <div class="section-title-wrapper">
              <h3 class="section-title">${label}</h3>
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
      this.style.setProperty('--pill-option-count', 4)
    }
    return html`
      <div class="section-controls" role="radiogroup" aria-label="Show content options">
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

  _renderControlButton(action, label, active, disabled = false) {
    const sectionLabel = (this.label || '').trim() || `Section ${this.sectionIndex + 1}`
    const ariaLabel = `Show ${label} in ${sectionLabel}`
    return html`
      <button
        class=${classMap({ active: !!active })}
        data-action=${action}
        aria-label=${ariaLabel}
        aria-pressed=${active ? 'true' : 'false'}
        role="radio"
        aria-checked=${active ? 'true' : 'false'}
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
          .displayKey=${this.displayKey}
          .capo=${this.capo}
          .capoKey=${this.capoKey}
        ></bar-group>`
      }
      return this._renderLine(block.line, index)
    })
  }

  _renderLine(line, index) {
    const segments = line?.segments || []
    if (segments.length === 0) {
      return nothing
    }

    const normalizedSegments = this._normalizeSegmentLyrics(segments)

    // Check if this line has ANY chords
    const lineHasChords = normalizedSegments.some(seg => seg.chord && seg.chord.trim())

    let hasPreviousLyrics = false

    return html`
      <div class="chord-line" data-line-index=${index}>
        ${normalizedSegments.map(segment => {
          const joinWithPrev = !!segment.__joinWithPrev
          const rendered = this._renderSegment(
            segment,
            hasPreviousLyrics,
            joinWithPrev,
            lineHasChords
          )
          if (this._segmentHasLyrics(segment)) {
            hasPreviousLyrics = true
          }
          return rendered
        })}
      </div>
    `
  }

  _renderSegment(segment, previousHadLyrics = false, joinWithPrev = false, lineHasChords = true) {
    const hasLyrics = this._segmentHasLyrics(segment)
    const chordText = segment.chord || ''
    const classes = classMap({
      'chord-segment': true,
      'chord-only': !hasLyrics,
    })

    const lyricsText = hasLyrics
      ? this._formatLyricsText(segment.lyrics || '', previousHadLyrics, joinWithPrev)
      : ''

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
        ${hasLyrics ? html`<span class="lyrics">${lyricsText}</span>` : nothing}
      </span>
    `
  }

  _renderChord(chordText, isInvalid = false) {
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
          .invalid=${!!isInvalid}
          .capo=${this.capo}
          .capoKey=${this.capoKey}
        ></chord-display>
      </span>
    `
  }

  _onControlClick(event) {
    event.stopPropagation()
    event.preventDefault()
    const action = event.currentTarget.dataset.action
    if (!action) return
    this.dispatchEvent(
      new CustomEvent('section-action', {
        detail: { songIndex: this.songIndex, sectionIndex: this.sectionIndex, action },
        bubbles: true,
        composed: true,
      })
    )
  }

  _onSummaryClick(event) {
    event.preventDefault()
    this.dispatchEvent(
      new CustomEvent('section-toggle', {
        detail: { songIndex: this.songIndex, sectionIndex: this.sectionIndex },
        bubbles: true,
        composed: true,
      })
    )
  }

  _shouldDetailsBeOpen() {
    if (this.editMode) return true
    return !(this.isCollapsed || this.hideMode === 'collapse')
  }

  getDetailsElement() {
    return this._getWrapper()?.querySelector('details.song-section') || null
  }

  _getWrapper() {
    return this.renderRoot?.querySelector('.song-section-wrapper') || null
  }

  /**
   * Build content blocks from lines, grouping consecutive bar-only lines together
   * @param {Array<{segments: Array}>} lines - Raw line data
   * @returns {Array<{type: string, line?: Object, data?: Object}>} Content blocks for rendering
   * @private
   */
  _buildContentBlocks(lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
      return []
    }

    const blocks = []
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
   * @param {Array} lines - All lines
   * @param {number} startIndex - Index to start collecting from
   * @returns {Array} Group of consecutive bar lines
   * @private
   */
  _collectBarGroup(lines, startIndex) {
    const group = []
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
   * @param {Array} lines - Bar-only lines
   * @returns {{measuresPerLine: Array, maxMeasures: number}} Structured bar group data
   * @private
   */
  _buildBarGroupData(lines) {
    if (!lines.length) {
      return { measuresPerLine: [], maxMeasures: 0 }
    }

    const measuresPerLine = lines.map(line => {
      const items = []
      line.segments?.forEach(segment => {
        if (segment.chord) {
          items.push({
            chord: segment.chord,
            isBar: isBarMarker(segment.chord),
          })
        }
      })

      const measures = []
      let currentMeasure = []

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

    const maxMeasures =
      measuresPerLine.reduce((max, measures) => Math.max(max, measures.length), 0) || 1
    return { measuresPerLine, maxMeasures }
  }

  /**
   * Check if a line contains only chords and bar markers (no lyrics)
   * @param {Object} line - Line to check
   * @returns {boolean} True if line is bar-only
   * @private
   */
  _isBarLineLine(line) {
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
   * @param {Array} lines - Lines to clone
   * @returns {Array} Cloned lines
   * @private
   */
  _cloneLines(lines) {
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
   * @param {string} text
   * @returns {string}
   */
  _formatLyricsText(text, previousHadLyrics = false, joinWithPrev = false) {
    if (!text) {
      return ''
    }
    if (this.hideMode !== 'chords') {
      return text
    }
    return formatHiddenLyricsText(text, previousHadLyrics, joinWithPrev)
  }

  _segmentHasLyrics(segment) {
    return segmentHasVisibleLyrics(segment)
  }

  _normalizeSegmentLyrics(segments) {
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
