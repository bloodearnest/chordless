import { LitElement, html, css, nothing } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { isBarMarker } from '../js/utils/chord-utils.js';
import './bar-group.js';

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
        editMode: { type: Boolean, reflect: true },
        /** @type {string} Hide mode: 'none', 'collapse', 'chords', or 'lyrics' */
        hideMode: { type: String },
        /** @type {boolean} Whether the section is collapsed */
        isCollapsed: { type: Boolean },
        /** @type {boolean} Whether the section is hidden */
        isHidden: { type: Boolean },
        /** @type {string} Section label (e.g., "Verse 1", "Chorus") */
        label: { type: String },
        /** @type {Array<{segments: Array<{chord: string, lyrics: string}>}>} Parsed chord/lyric lines */
        lines: { attribute: false }
    };

    static styles = css`
        .song-section-wrapper {
            padding: 0;
            margin: 0 0 0.1rem 0;
            border: 2px solid transparent;
            border-radius: 8px;
            transition: border-color 0.25s ease-in-out, background-color 0.25s ease-in-out;
        }

        @media (min-width: 48rem) {
            .song-section-wrapper {
                padding: 0.75rem 0.75rem 0.125rem 0.75rem;
                margin: 0.75rem;
                margin-top: 0.125rem;
                margin-bottom: 0.25rem;
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

        .song-section-wrapper details.song-section summary.section-label {
            cursor: pointer;
            list-style: none;
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

        .song-section-wrapper .section-content {
            margin-top: 0;
        }

        .song-section-wrapper .section-controls {
            display: flex;
            flex-direction: row;
            gap: 0.3rem;
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

        .song-section-wrapper .section-control-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.2rem;
            padding: 0.2rem 0.3rem;
            background-color: rgba(255, 255, 255, 0.95);
            border: 1.5px solid #7f8c8d;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.2s, transform 0.2s, border-color 0.2s, box-shadow 0.2s;
            font-size: 0.85rem;
            color: #7f8c8d;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(4px);
            min-height: 1.8rem;
        }

        .song-section-wrapper .section-control-btn:hover {
            background-color: rgba(127, 140, 141, 0.1);
            transform: scale(1.02);
        }

        .song-section-wrapper .section-control-btn:focus-visible {
            outline: 2px solid #3498db;
            outline-offset: 2px;
        }

        .song-section-wrapper .section-control-btn.active {
            background-color: var(--button-bg);
            border-color: var(--button-bg);
            color: white;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 0 0 2px rgba(52, 152, 219, 0.3);
        }

        .song-section-wrapper.chords-hidden .chord {
            display: none;
        }

        .song-section-wrapper.lyrics-hidden .lyrics {
            display: none;
        }

        .song-section-wrapper .section-control-btn .control-label {
            font-weight: 600;
            font-size: 0.75rem;
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
            padding-right: 0.25em;
        }

        .song-section-wrapper .chord-segment.chord-only {
            padding-right: 0.5em;
        }

        .song-section-wrapper .chord {
            color: var(--chord-color, #2980b9);
            font-weight: bold;
            font-size: 0.9em;
            min-height: 1.1em;
            line-height: 1.1em;
            padding-right: 0.25em;
            font-family: 'Source Sans Pro', 'Segoe UI', sans-serif;
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
    `;

    constructor() {
        super();
        this.songIndex = 0;
        this.sectionIndex = 0;
        this.editMode = false;
        this.hideMode = 'none';
        this.isCollapsed = false;
        this.isHidden = false;
        this.label = '';
        this._lines = undefined; // Private storage for lines
        this._contentBlocks = [];
        this._onControlClick = this._onControlClick.bind(this);
        this._onSummaryClick = this._onSummaryClick.bind(this);
    }

    /**
     * Get the lines data for this section
     * @returns {Array<{segments: Array<{chord: string, lyrics: string}>}>}
     */
    get lines() {
        return this._lines;
    }

    /**
     * Set the lines data and rebuild content blocks
     * @param {Array<{segments: Array<{chord: string, lyrics: string}>}>} value
     */
    set lines(value) {
        console.log('[SongSection] lines setter called:', value?.length, 'lines');
        const oldValue = this._lines;
        this._lines = value;
        if (value && value.length > 0) {
            this._contentBlocks = this._buildContentBlocks(value);
        }
        this.requestUpdate('lines', oldValue);
    }

    /** @inheritdoc */
    connectedCallback() {
        super.connectedCallback();
        if ((!this.label || !this.label.trim()) && this.dataset?.label) {
            this.label = this.dataset.label;
        }
    }
    
    cloneNode(deep = true) {
        const clone = super.cloneNode(deep);
        if (clone instanceof SongSection) {
            clone.lines = this._cloneLines(this.lines);
            clone.label = this.label;
        }
        return clone;
    }

    render() {
        const classes = {
            'song-section-wrapper': true,
            'section-hidden': !!this.isHidden,
            'section-collapsed': this.hideMode === 'collapse',
            'chords-hidden': this.hideMode === 'chords',
            'lyrics-hidden': this.hideMode === 'lyrics'
        };
        const label = (this.label || '').trim();
        const sectionLabel = label || `Section ${this.sectionIndex + 1}`;

        return html`
            <div class=${classMap(classes)}
                 role="region"
                 aria-label=${sectionLabel}
                 ?aria-hidden=${this.isHidden && !this.editMode}
                 data-song-index=${this.songIndex}
                 data-section-index=${this.sectionIndex}>
                ${label ? this._renderLabeledSection(label) : this._renderPlainSection()}
            </div>`;
    }

    // willUpdate not needed - lines setter handles content block building

    _renderLabeledSection(label) {
        const detailsOpen = this._shouldDetailsBeOpen();
        return html`
            <details class="song-section"
                     ?open=${detailsOpen}
                     aria-expanded=${detailsOpen ? 'true' : 'false'}>
                <summary class="section-label" @click=${this._onSummaryClick}>
                    <div class="section-header">
                        <h3 class="section-title">${label}</h3>
                        ${this._renderControls()}
                    </div>
                </summary>
                <div class="section-content">
                    ${this._renderContent()}
                </div>
            </details>
        `;
    }

    _renderPlainSection() {
        return html`
            <div class="song-section">
                <div class="section-content">
                    ${this._renderContent()}
                </div>
            </div>
        `;
    }

    _renderControls() {
        return html`
            <div class="section-controls">
                ${this._renderControlButton('collapse', '▼', 'Collapse Section', this.hideMode === 'collapse')}
                ${this._renderControlButton('chords', '♯', 'Hide Chords', this.hideMode === 'chords')}
                ${this._renderControlButton('lyrics', 'A', 'Hide Lyrics', this.hideMode === 'lyrics')}
                ${this._renderControlButton('hide', '✕', 'Hide Entire Section', !!this.isHidden)}
            </div>
        `;
    }

    _renderControlButton(action, icon, label, active) {
        const classes = classMap({
            'section-control-btn': true,
            active: !!active
        });
        const sectionLabel = (this.label || '').trim() || `Section ${this.sectionIndex + 1}`;
        const ariaLabel = `${label} in ${sectionLabel}`;

        return html`
            <button class=${classes}
                    data-action=${action}
                    aria-label=${ariaLabel}
                    aria-pressed=${active ? 'true' : 'false'}
                    @click=${this._onControlClick}>
                <span class="control-icon" aria-hidden="true">${icon}</span>
                <span class="control-label">${label}</span>
            </button>
        `;
    }

    _renderContent() {
        if (!this._contentBlocks || this._contentBlocks.length === 0) {
            return nothing;
        }

        return this._contentBlocks.map((block, index) => {
            if (block.type === 'bar-group') {
                return html`<bar-group .data=${block.data}></bar-group>`;
            }
            return this._renderLine(block.line, index);
        });
    }

    _renderLine(line, index) {
        const segments = line?.segments || [];
        if (segments.length === 0) {
            return nothing;
        }

        return html`
            <div class="chord-line" data-line-index=${index}>
                ${segments.map(segment => this._renderSegment(segment))}
            </div>
        `;
    }

    _renderSegment(segment) {
        const hasLyrics = !!(segment.lyrics && segment.lyrics.trim().length > 0);
        const chordText = segment.chord || '';
        const classes = classMap({
            'chord-segment': true,
            'chord-only': !hasLyrics
        });

        return html`
            <span class=${classes}>
                ${chordText
                    ? this._renderChord(chordText, segment.valid === false)
                    : html`<span class="chord chord-empty">&nbsp;</span>`}
                ${hasLyrics ? html`<span class="lyrics">${segment.lyrics}</span>` : nothing}
            </span>
        `;
    }

    _renderChord(chordText, isInvalid = false) {
        const classes = classMap({
            chord: true,
            bar: isBarMarker(chordText),
            invalid: !!isInvalid
        });
        return html`<span class=${classes}>${chordText}</span>`;
    }

    _onControlClick(event) {
        event.stopPropagation();
        event.preventDefault();
        const action = event.currentTarget.dataset.action;
        if (!action) return;
        this.dispatchEvent(new CustomEvent('section-action', {
            detail: { songIndex: this.songIndex, sectionIndex: this.sectionIndex, action },
            bubbles: true,
            composed: true
        }));
    }

    _onSummaryClick(event) {
        event.preventDefault();
        this.dispatchEvent(new CustomEvent('section-toggle', {
            detail: { songIndex: this.songIndex, sectionIndex: this.sectionIndex },
            bubbles: true,
            composed: true
        }));
    }

    _shouldDetailsBeOpen() {
        if (this.editMode) return true;
        return !(this.isCollapsed || this.hideMode === 'collapse');
    }

    getDetailsElement() {
        return this._getWrapper()?.querySelector('details.song-section') || null;
    }

    _getWrapper() {
        return this.renderRoot?.querySelector('.song-section-wrapper') || null;
    }

    /**
     * Build content blocks from lines, grouping consecutive bar-only lines together
     * @param {Array<{segments: Array}>} lines - Raw line data
     * @returns {Array<{type: string, line?: Object, data?: Object}>} Content blocks for rendering
     * @private
     */
    _buildContentBlocks(lines) {
        if (!Array.isArray(lines) || lines.length === 0) {
            return [];
        }

        const blocks = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            if (this._isBarLineLine(line)) {
                const barLines = this._collectBarGroup(lines, i);
                blocks.push({
                    type: 'bar-group',
                    data: this._buildBarGroupData(barLines)
                });
                i += barLines.length;
            } else {
                blocks.push({ type: 'line', line });
                i++;
            }
        }

        return blocks;
    }

    /**
     * Collect consecutive bar-only lines into a group
     * @param {Array} lines - All lines
     * @param {number} startIndex - Index to start collecting from
     * @returns {Array} Group of consecutive bar lines
     * @private
     */
    _collectBarGroup(lines, startIndex) {
        const group = [];
        for (let i = startIndex; i < lines.length; i++) {
            const candidate = lines[i];
            if (this._isBarLineLine(candidate)) {
                group.push(candidate);
            } else {
                break;
            }
        }
        return group;
    }

    /**
     * Build structured data for rendering a bar group with aligned measures
     * @param {Array} lines - Bar-only lines
     * @returns {{measuresPerLine: Array, maxMeasures: number}} Structured bar group data
     * @private
     */
    _buildBarGroupData(lines) {
        if (!lines.length) {
            return { measuresPerLine: [], maxMeasures: 0 };
        }

        const measuresPerLine = lines.map(line => {
            const items = [];
            line.segments?.forEach(segment => {
                if (segment.chord) {
                    items.push({
                        chord: segment.chord,
                        isBar: isBarMarker(segment.chord)
                    });
                }
            });

            const measures = [];
            let currentMeasure = [];

            items.forEach(item => {
                if (item.isBar) {
                    measures.push({
                        chords: currentMeasure,
                        bar: item.chord
                    });
                    currentMeasure = [];
                } else {
                    currentMeasure.push(item.chord);
                }
            });

            if (currentMeasure.length > 0 || measures.length === 0) {
                measures.push({
                    chords: currentMeasure,
                    bar: null
                });
            }

            return measures;
        });

        const maxMeasures = measuresPerLine.reduce((max, measures) => Math.max(max, measures.length), 0) || 1;
        return { measuresPerLine, maxMeasures };
    }

    /**
     * Check if a line contains only chords and bar markers (no lyrics)
     * @param {Object} line - Line to check
     * @returns {boolean} True if line is bar-only
     * @private
     */
    _isBarLineLine(line) {
        if (!line?.segments || line.segments.length === 0) return false;
        let hasBar = false;
        for (const segment of line.segments) {
            const hasLyrics = segment.lyrics && segment.lyrics.trim().length > 0;
            if (hasLyrics) return false;
            if (segment.chord && isBarMarker(segment.chord)) {
                hasBar = true;
            }
        }
        return hasBar;
    }

    /**
     * Deep clone lines data
     * @param {Array} lines - Lines to clone
     * @returns {Array} Cloned lines
     * @private
     */
    _cloneLines(lines) {
        if (!Array.isArray(lines)) {
            return [];
        }
        return lines.map(line => ({
            segments: (line.segments || []).map(segment => ({ ...segment }))
        }));
    }

}

customElements.define('song-section', SongSection);
