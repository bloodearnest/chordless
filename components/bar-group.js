import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { isBarMarker } from '../js/utils/chord-utils.js';
import { splitChordDisplaySegments } from '../js/utils/lyrics-normalizer.js';

export class BarGroup extends LitElement {
  static properties = {
    data: { type: Object, attribute: false },
  };

  static styles = css`
    .bar-group {
      margin-bottom: 0.5rem;
      display: grid;
      width: fit-content;
      gap: 0;
    }

    .bar-group .chord-line {
      display: contents;
    }

    .measure {
      display: flex;
      align-items: flex-start;
    }

    .measure.first-measure .bar-marker {
      margin-left: 0;
    }

    .measure.last-measure .bar-marker {
      margin-left: auto;
    }

    .measure:not(.first-measure):not(.last-measure) .bar-marker {
      margin-left: auto;
    }

    .chord-segment {
      display: inline-flex;
      flex-direction: column;
      white-space: pre;
      padding-right: 0.25em;
    }

    .chord-segment.chord-only {
      padding-right: 0.5em;
    }

    .chord-segment.chord-only.bar-marker .chord {
      color: var(--text-tertiary, #95a5a6);
    }

    .chord {
      color: var(--chord-color, #2980b9);
      font-weight: bold;
      font-size: 0.9em;
      line-height: 1.1em;
      padding-right: 0.25em;
      font-family: 'Source Sans Pro', 'Segoe UI', sans-serif;
      display: inline-block;
      white-space: nowrap;
    }

    .chord.bar {
      color: var(--text-tertiary, #95a5a6);
      font-weight: normal;
    }

    .chord sup.chord-extension {
      display: inline-block;
      font-size: 0.75em;
      line-height: 1;
      vertical-align: baseline;
      transform: translateY(-0.3em);
      margin-left: 0.05em;
    }
  `;

  constructor() {
    super();
    this.data = null;
  }

  render() {
    if (!this.data || !this.data.measuresPerLine?.length) {
      return html``;
    }

    const maxColumns = Math.max(this.data.maxMeasures || 0, 1);

    return html`
      <div class="bar-group" style="grid-template-columns: repeat(${maxColumns}, auto);">
        ${this.data.measuresPerLine.map(
          (measures, lineIndex) => html`
            <div class="chord-line bar-aligned" data-bar-line-index=${lineIndex}>
              ${Array.from({ length: maxColumns }).map((_, measureIndex) => {
                const measure = measures[measureIndex] || null;
                const measureClasses = classMap({
                  measure: true,
                  'first-measure': measureIndex === 0,
                  'last-measure': measureIndex === maxColumns - 1,
                });
                return html`
                  <span class=${measureClasses}>
                    ${measure
                      ? [
                          (measure.chords || []).map(chord => this._renderChordOnlySegment(chord)),
                          measure.bar ? this._renderBarMarker(measure.bar) : '',
                        ]
                      : ''}
                  </span>
                `;
              })}
            </div>
          `
        )}
      </div>
    `;
  }

  _renderChordOnlySegment(chordText) {
    if (!chordText) return html``;
    return html` <span class="chord-segment chord-only"> ${this._renderChord(chordText)} </span> `;
  }

  _renderBarMarker(barText) {
    if (!barText) return html``;
    return html`
      <span class="chord-segment chord-only bar-marker">
        <span class="chord bar">${barText}</span>
      </span>
    `;
  }

  _renderChord(chordText) {
    const classes = classMap({
      chord: true,
      bar: isBarMarker(chordText),
    });
    const segments = splitChordDisplaySegments(chordText);
    return html`
      <span class=${classes}>
        ${segments.length
          ? segments.map(segment =>
              segment.type === 'extension'
                ? html`<sup class="chord-extension">${segment.value}</sup>`
                : segment.value
            )
          : chordText}
      </span>
    `;
  }
}

customElements.define('bar-group', BarGroup);
