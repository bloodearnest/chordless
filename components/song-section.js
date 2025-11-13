import { LitElement, html, css, nothing } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

export class SongSection extends LitElement {
    static properties = {
        songIndex: { type: Number, attribute: 'song-index', reflect: true },
        sectionIndex: { type: Number, attribute: 'section-index', reflect: true },
        editMode: { type: Boolean, reflect: true },
        hideMode: { type: String },
        isCollapsed: { type: Boolean },
        isHidden: { type: Boolean },
        label: { type: String },
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
            border-color: #bdc3c7;
            background-color: #f9f9f9;
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
            color: #2980b9;
            font-weight: bold;
            font-size: 0.9em;
            min-height: 1.1em;
            line-height: 1.1em;
            padding-right: 0.25em;
            font-family: 'Source Sans Pro', 'Segoe UI', sans-serif;
        }

        .song-section-wrapper .chord.bar {
            color: #95a5a6;
            font-weight: normal;
        }

        .song-section-wrapper .chord.invalid {
            color: #bdc3c7;
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

        .song-section-wrapper .bar-group {
            margin-bottom: 0.5rem;
            display: grid;
            width: fit-content;
            gap: 0;
        }

        .song-section-wrapper .bar-group .chord-line {
            display: contents;
        }

        .song-section-wrapper .measure {
            display: flex;
            align-items: flex-start;
        }

        .song-section-wrapper .measure.first-measure .bar-marker {
            margin-left: 0;
        }

        .song-section-wrapper .measure.last-measure .bar-marker {
            margin-left: auto;
        }

        .song-section-wrapper .measure:not(.first-measure):not(.last-measure) .bar-marker {
            margin-left: auto;
        }

        .song-section-wrapper .chord-segment.chord-only.bar-marker .chord {
            color: #95a5a6;
        }

        .song-section-wrapper .chord.invalid {
            color: #e74c3c;
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

    // Custom getter/setter for lines to ensure content blocks are built
    get lines() {
        return this._lines;
    }

    set lines(value) {
        console.log('[SongSection] lines setter called:', value?.length, 'lines');
        const oldValue = this._lines;
        this._lines = value;
        if (value && value.length > 0) {
            this._contentBlocks = this._buildContentBlocks(value);
        }
        this.requestUpdate('lines', oldValue);
    }
    
    connectedCallback() {
        super.connectedCallback();
        if ((!this.label || !this.label.trim()) && this.dataset?.label) {
            this.label = this.dataset.label;
        }
        // Hydrate lines from global store (needed due to custom element upgrade timing)
        this._hydrateLinesFromDataset();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        // Clean up global store entry to prevent memory leaks
        const key = this.dataset?.linesKey;
        if (key) {
            const store = typeof window !== 'undefined' ? window.__songSectionDataStore : null;
            if (store && store.has(key)) {
                store.delete(key);
            }
        }
    }

    _hydrateLinesFromDataset() {
        if (this._lines && this._lines.length > 0) {
            return; // Already has lines
        }
        const key = this.dataset?.linesKey;
        const store = typeof window !== 'undefined' ? window.__songSectionDataStore : null;
        if (key && store && store.has(key)) {
            const source = store.get(key);
            this.lines = this._cloneLines(source); // Use setter to trigger content block building
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
        return html`
            <div class=${classMap(classes)} data-song-index=${this.songIndex} data-section-index=${this.sectionIndex}>
                ${label ? this._renderLabeledSection(label) : this._renderPlainSection()}
            </div>`;
    }

    // willUpdate not needed - lines setter handles content block building

    _renderLabeledSection(label) {
        const detailsOpen = this._shouldDetailsBeOpen();
        return html`
            <details class="song-section" ?open=${detailsOpen}>
                <summary class="section-label" @click=${this._onSummaryClick}>
                    <div class="section-header">
                        <span class="section-title">${label}</span>
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
        return html`
            <button class=${classes} data-action=${action} @click=${this._onControlClick}>
                <span class="control-icon">${icon}</span>
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
                return this._renderBarGroup(block.data, index);
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
            bar: this._isBar(chordText),
            invalid: !!isInvalid
        });
        return html`<span class=${classes}>${chordText}</span>`;
    }

    _renderBarGroup(data) {
        if (!data || !data.measuresPerLine?.length) {
            return nothing;
        }

        const maxColumns = Math.max(data.maxMeasures || 0, 1);

        return html`
            <div class="bar-group" style="grid-template-columns: repeat(${maxColumns}, auto);">
                ${data.measuresPerLine.map((measures, lineIndex) => html`
                    <div class="chord-line bar-aligned" data-bar-line-index=${lineIndex}>
                        ${Array.from({ length: maxColumns }).map((_, measureIndex) => {
                            const measure = measures[measureIndex] || null;
                            const measureClasses = classMap({
                                measure: true,
                                'first-measure': measureIndex === 0,
                                'last-measure': measureIndex === maxColumns - 1
                            });
                            return html`
                                <span class=${measureClasses}>
                                    ${measure ? [
                                        (measure.chords || []).map(chord => this._renderChordOnlySegment(chord)),
                                        measure.bar ? this._renderBarMarker(measure.bar) : nothing
                                    ] : nothing}
                                </span>
                            `;
                        })}
                    </div>
                `)}
            </div>
        `;
    }

    _renderChordOnlySegment(chordText) {
        if (!chordText) return nothing;
        return html`
            <span class="chord-segment chord-only">
                ${this._renderChord(chordText)}
            </span>
        `;
    }

    _renderBarMarker(barText) {
        if (!barText) return nothing;
        return html`
            <span class="chord-segment chord-only bar-marker">
                <span class="chord bar">${barText}</span>
            </span>
        `;
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
                        isBar: this._isBar(segment.chord)
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

    _isBarLineLine(line) {
        if (!line?.segments || line.segments.length === 0) return false;
        let hasBar = false;
        for (const segment of line.segments) {
            const hasLyrics = segment.lyrics && segment.lyrics.trim().length > 0;
            if (hasLyrics) return false;
            if (segment.chord && this._isBar(segment.chord)) {
                hasBar = true;
            }
        }
        return hasBar;
    }

    _isBar(chord) {
        return chord === '|' || chord === '||' || chord === '||:' || chord === ':||';
    }

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
