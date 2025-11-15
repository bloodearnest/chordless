import { LitElement, html, css, nothing } from 'lit';
import './song-section.js';

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
  };

  static styles = css`
    :host {
      display: block;
    }
  `;

  constructor() {
    super();
    this.parsed = null;
    this.songIndex = 0;
  }

  render() {
    if (!this.parsed || !this.parsed.sections) {
      return nothing;
    }

    const sections = this.parsed.sections.map((section, index) =>
      this._renderSection(section, index)
    );

    return html`${sections}`;
  }

  _renderSection(section, index) {
    return html`
      <song-section
        .lines=${section.lines}
        .label=${section.label || ''}
        .songIndex=${this.songIndex}
        .sectionIndex=${index}
        song-index=${this.songIndex}
        section-index=${index}
        data-label=${section.label || ''}
      >
      </song-section>
    `;
  }
}

customElements.define('song-display', SongDisplay);
