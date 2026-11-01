import { css, html, LitElement, nothing } from 'lit'
import './song-section.ts'
import { ContextConsumer } from '@lit/context'
import type { ChartSection, ParsedChart } from '../js/data-types.ts'
import { displayPreferencesContext } from '../js/display-preferences.ts'
import { attachNotes, type ChartNotes } from '../js/notes/shown.ts'
import { transposeKeyName } from '../js/transpose.ts'
import { noteStyles, renderNotes } from './chart-note.ts'

/** How chords are shown before the page has said */
const NO_DISPLAY_PREFERENCES = { nashville: false, unicodeAccidentals: false }

/**
 * Song Display Component
 * Renders a parsed song's sections
 *
 * @element song-display
 * @property {Object} parsed - Parsed song data from ChordProParser
 * @property {number} songIndex - Index of this song in the setlist
 */
export class SongDisplay extends LitElement {
  static override properties = {
    /** @type {Object} Parsed song data with metadata and sections */
    parsed: { type: Object, attribute: false },
    /** @type {number} Song index in setlist */
    songIndex: { type: Number, attribute: 'song-index' },
    /** @type {number} Current capo value */
    capo: { type: Number },
    /** The song's notes, placed on its sections (docs/NOTES.md) */
    notes: { attribute: false },
  }

  declare parsed: ParsedChart | null
  declare songIndex: number
  declare capo: number
  declare notes: ChartNotes | null

  _display: ContextConsumer<typeof displayPreferencesContext, SongDisplay>

  static override styles = [
    noteStyles,
    css`
      :host {
        display: block;
      }

      .song-notes {
        display: flex;
        flex-wrap: wrap;
        gap: 0 0.8em;
        margin: 0 0.5rem 0.25rem;
      }
    `,
  ]

  constructor() {
    super()
    this.parsed = null
    this.songIndex = 0
    this.capo = 0
    this.notes = null
    // How chords are shown (Nashville numbers, unicode accidentals), passed
    // down to the sections; re-renders when a preference changes
    this._display = new ContextConsumer(this, {
      context: displayPreferencesContext,
      subscribe: true,
    })
  }

  override render() {
    if (!this.parsed?.sections) {
      return nothing
    }

    const sections = this.parsed.sections.map((section, index) =>
      this._renderSection(section, index)
    )

    const song = this.notes?.song ?? []
    return html`${
      song.length
        ? html`<div class="song-notes">${song.map(note => renderNotes([note], note.orphan))}</div>`
        : nothing
    }${sections}`
  }

  _renderSection(section: ChartSection, index: number) {
    /* v8 ignore next -- the page provides these as soon as display-preferences loads */
    const { nashville, unicodeAccidentals } = this._display.value ?? NO_DISPLAY_PREFERENCES
    const displayKey = this.parsed?.metadata?.key || ''
    const capoValue = Number.isFinite(this.capo)
      ? Math.min(Math.max(Math.round(this.capo), 0), 11)
      : 0
    const capoKey = capoValue > 0 && displayKey ? transposeKeyName(displayKey, -capoValue) : ''
    return html`
      <song-section
        .lines=${attachNotes(section.lines, this.notes?.sections[index]?.lines ?? [])}
        .titleNotes=${this.notes?.sections[index]?.title ?? []}
        .label=${section.label || ''}
        .note=${section.note || ''}
        .songIndex=${this.songIndex}
        .sectionIndex=${index}
        .displayAsNashville=${nashville}
        .unicodeAccidentals=${unicodeAccidentals}
        .displayKey=${displayKey}
        .capo=${capoValue}
        .capoKey=${capoKey}
        song-index=${this.songIndex}
        section-index=${index}
        data-label=${section.label || ''}
      >
      </song-section>
    `
  }
}

customElements.define('song-display', SongDisplay)

declare global {
  interface HTMLElementTagNameMap {
    'song-display': SongDisplay
  }
}
