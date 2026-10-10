import { css, html, LitElement, nothing } from 'lit'
import './song-section.js'
import { ContextConsumer } from '@lit/context'
import { displayPreferencesContext } from '../js/display-preferences.ts'
import { transposeKeyName } from '../js/transpose.ts'

/**
 * Song Display Component
 * Renders a parsed song's sections
 *
 * @element song-display
 * @property {Object} parsed - Parsed song data from ChordProParser
 * @property {number} songIndex - Index of this song in the setlist
 */
export class SongDisplay extends LitElement {
  static properties = {
    /** @type {Object} Parsed song data with metadata and sections */
    parsed: { type: Object, attribute: false },
    /** @type {number} Song index in setlist */
    songIndex: { type: Number, attribute: 'song-index' },
    /** @type {number} Current capo value */
    capo: { type: Number },
  }

  static styles = css`
    :host {
      display: block;
    }
  `

  constructor() {
    super()
    this.parsed = null
    this.songIndex = 0
    this.capo = 0
    // How chords are shown (Nashville numbers, unicode accidentals), passed
    // down to the sections; re-renders when a preference changes
    this._display = new ContextConsumer(this, {
      context: displayPreferencesContext,
      subscribe: true,
    })
  }

  render() {
    if (!this.parsed?.sections) {
      return nothing
    }

    const sections = this.parsed.sections.map((section, index) =>
      this._renderSection(section, index)
    )

    return html`${sections}`
  }

  _renderSection(section, index) {
    const displayKey = this.parsed?.metadata?.key || ''
    const capoValue = Number.isFinite(this.capo)
      ? Math.min(Math.max(Math.round(this.capo), 0), 11)
      : 0
    const capoKey = capoValue > 0 && displayKey ? transposeKeyName(displayKey, -capoValue) : ''
    return html`
      <song-section
        .lines=${section.lines}
        .label=${section.label || ''}
        .songIndex=${this.songIndex}
        .sectionIndex=${index}
        .displayAsNashville=${this._display.value?.nashville ?? false}
        .unicodeAccidentals=${this._display.value?.unicodeAccidentals ?? false}
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
