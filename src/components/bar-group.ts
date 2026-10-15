import { css, html, LitElement } from 'lit'
import { classMap } from 'lit/directives/class-map.js'
import { isBarMarker } from '../js/utils/chord-utils.ts'
import './chord-display.ts'

/** One bar of a chord line: its chords and the bar line that ends it */
export interface Measure {
  chords?: string[]
  bar?: string | null
}

/** A group of chord lines laid out by bar */
export interface BarGroupData {
  measuresPerLine: Measure[][]
  maxMeasures?: number
}

export class BarGroup extends LitElement {
  static override properties = {
    data: { type: Object, attribute: false },
    displayAsNashville: { type: Boolean, attribute: 'display-as-nashville' },
    /** Show accidentals as ♯ and ♭ */
    unicodeAccidentals: { type: Boolean, attribute: 'unicode-accidentals' },
    displayKey: { type: String, attribute: 'display-key' },
    capo: { type: Number },
    capoKey: { type: String, attribute: 'capo-key' },
  }

  declare data: BarGroupData | null
  declare displayAsNashville: boolean
  declare unicodeAccidentals: boolean
  declare displayKey: string
  declare capo: number
  declare capoKey: string

  static override styles = css`
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
      font-size: var(--font-chords);
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
      font-size: calc(var(--font-chords) * 0.75);
      line-height: 1;
      vertical-align: baseline;
      transform: translateY(-0.3em);
      margin-left: 0.05em;
    }
  `

  constructor() {
    super()
    this.data = null
    this.displayAsNashville = false
    this.unicodeAccidentals = false
    this.displayKey = ''
    this.capo = 0
    this.capoKey = ''
  }

  override render() {
    if (!this.data?.measuresPerLine?.length) {
      return html``
    }

    const maxColumns = Math.max(this.data.maxMeasures || 0, 1)

    return html`
      <div class="bar-group" style="grid-template-columns: repeat(${maxColumns}, auto);">
        ${this.data.measuresPerLine.map(
          (measures: Measure[], lineIndex: number) => html`
            <div class="chord-line bar-aligned" data-bar-line-index=${lineIndex}>
              ${Array.from({ length: maxColumns }).map((_, measureIndex) => {
                const measure = measures[measureIndex] || null
                const measureClasses = classMap({
                  measure: true,
                  'first-measure': measureIndex === 0,
                  'last-measure': measureIndex === maxColumns - 1,
                })
                return html`
                  <span class=${measureClasses}>
                    ${
                      measure
                        ? [
                            (measure.chords || []).map((chord: string) =>
                              this._renderChordOnlySegment(chord)
                            ),
                            measure.bar ? this._renderBarMarker(measure.bar) : '',
                          ]
                        : ''
                    }
                  </span>
                `
              })}
            </div>
          `
        )}
      </div>
    `
  }

  _renderChordOnlySegment(chordText: string) {
    if (!chordText) return html``
    return html` <span class="chord-segment chord-only"> ${this._renderChord(chordText)} </span> `
  }

  _renderBarMarker(barText: string) {
    return html`
      <span class="chord-segment chord-only bar-marker">
        <span class="chord bar">${barText}</span>
      </span>
    `
  }

  _renderChord(chordText: string) {
    const classes = classMap({
      chord: true,
      bar: isBarMarker(chordText),
    })
    return html`
      <span class=${classes}>
        <chord-display
          .chord=${chordText}
          .displayKey=${this.displayKey}
          .displayAsNashville=${this.displayAsNashville}
          .unicodeAccidentals=${this.unicodeAccidentals}
          .capo=${this.capo}
          .capoKey=${this.capoKey}
        ></chord-display>
      </span>
    `
  }
}

customElements.define('bar-group', BarGroup)

declare global {
  interface HTMLElementTagNameMap {
    'bar-group': BarGroup
  }
}
