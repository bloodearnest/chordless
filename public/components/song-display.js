import { css, html, LitElement, nothing } from 'lit'
import './song-section.js'
import { getUseNashvilleNumbers } from '../js/preferences.js'
import { transposeKeyName } from '../js/transpose.js'

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
    useNashville: { type: Boolean, state: true },
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
    this.useNashville = getUseNashvilleNumbers()
    this.capo = 0
    this._onNashvilleChange = event => {
      this.useNashville = !!event.detail
      this.requestUpdate()
    }
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('nashville-preference-changed', this._onNashvilleChange)
  }

  disconnectedCallback() {
    window.removeEventListener('nashville-preference-changed', this._onNashvilleChange)
    super.disconnectedCallback()
  }

  render() {
    if (!this.parsed || !this.parsed.sections) {
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
        .displayAsNashville=${this.useNashville}
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
