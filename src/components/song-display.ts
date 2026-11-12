import { css, html, LitElement, nothing } from 'lit'
import './song-section.ts'
import { ContextConsumer } from '@lit/context'
import { attachAnnotations, type ChartAnnotations } from '../js/annotations/shown.ts'
import type { ChartSection, ParsedChart } from '../js/data-types.ts'
import { displayPreferencesContext } from '../js/display-preferences.ts'
import type { SongCues } from '../js/score-section.ts'
import { isEditMode } from '../js/setlist/edit-mode-ui.ts'
import { transposeKeyName } from '../js/transpose.ts'
import { annotationStyles, renderAnnotations } from './chart-annotation.ts'
import { AnnotationRequestEvent } from './song-section.ts'

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
    /** The song's annotations, placed on its sections (docs/ANNOTATIONS.md) */
    annotations: { attribute: false },
    /** The notes of the song's lead sheet that its sections show (docs/LEAD_SHEETS.md, "In the chart") */
    cues: { attribute: false },
  }

  declare parsed: ParsedChart | null
  declare songIndex: number
  declare capo: number
  declare annotations: ChartAnnotations | null
  declare cues: SongCues | null

  _display: ContextConsumer<typeof displayPreferencesContext, SongDisplay>

  static override styles = [
    annotationStyles,
    css`
      :host {
        display: block;
      }

      .song-annotations {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0 0.8em;
        margin: 0 0.5rem 0.25rem;
      }

      .song-annotations .annotation {
        -webkit-user-select: none;
        user-select: none;
      }

      .song-annotations.editing .annotation {
        cursor: pointer;
      }

      .add-song-annotation {
        border: 1px dashed var(--annotation-private-color);
        border-radius: 6px;
        background: none;
        color: var(--annotation-private-color);
        font-family: var(--font-family-annotation);
        font-size: var(--font-annotation);
        padding: 0 0.5em;
        cursor: pointer;
      }
    `,
  ]

  constructor() {
    super()
    this.parsed = null
    this.songIndex = 0
    this.capo = 0
    this.annotations = null
    this.cues = null
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

    const song = this.annotations?.song ?? []
    const editing = isEditMode()
    return html`${
      song.length || editing
        ? html`<div class=${editing ? 'song-annotations editing' : 'song-annotations'} @click=${this._onSongAnnotationClick}>
              ${song.map(annotation => renderAnnotations([annotation], annotation.orphan))}
              ${
                editing
                  ? html`<button class="add-song-annotation" @click=${this._onAddSongAnnotation}>
                      + Annotation on the whole song
                    </button>`
                  : nothing
              }
            </div>`
        : nothing
    }${sections}`
  }

  /** Edit mode: an annotation of the song's is tapped to change it */
  _onSongAnnotationClick(event: Event): void {
    if (!isEditMode()) return
    const annotation = (event.target as HTMLElement).closest<HTMLElement>('[data-annotation-id]')
    if (!annotation) return
    this.dispatchEvent(
      new AnnotationRequestEvent(
        { songIndex: this.songIndex, sectionIndex: 0 },
        { place: 'song', annotationId: annotation.dataset.annotationId },
        annotation
      )
    )
  }

  _onAddSongAnnotation(event: Event): void {
    this.dispatchEvent(
      new AnnotationRequestEvent(
        { songIndex: this.songIndex, sectionIndex: 0 },
        { place: 'song' },
        event.currentTarget as HTMLElement
      )
    )
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
        .lines=${attachAnnotations(section.lines, this.annotations?.sections[index]?.lines ?? [])}
        .titleAnnotations=${this.annotations?.sections[index]?.title ?? []}
        .label=${section.label || ''}
        .note=${section.note || ''}
        .songIndex=${this.songIndex}
        .sectionIndex=${index}
        .displayAsNashville=${nashville}
        .unicodeAccidentals=${unicodeAccidentals}
        .displayKey=${displayKey}
        .capo=${capoValue}
        .capoKey=${capoKey}
        .melody=${this.cues?.measures[index] ? this.cues.melody : null}
        .melodyKey=${this.cues?.key ?? ''}
        .melodyMeasures=${this.cues?.measures[index] ?? null}
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
