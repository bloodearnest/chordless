import { css, html, LitElement } from 'lit'

/**
 * MusicalMetadataDisplay component
 *
 * Displays musical metadata (key, capo, BPM, time signature) for a song.
 * In normal mode: read-only display
 * In edit mode: becomes a clickable button that triggers the song settings popover
 *
 * Properties:
 * @property {string} keyValue - Current key (e.g., "C", "G")
 * @property {number} capoValue - Current capo position (0 means no capo)
 * @property {number} bpm - Beats per minute
 * @property {string} timeSignature - Time signature (e.g., "4/4")
 * @property {boolean} editMode - Whether in edit mode
 *
 * Events:
 * @fires settings-click - When clicked in edit mode
 */
export class MusicalMetadataDisplay extends LitElement {
  static properties = {
    keyValue: { type: String, attribute: 'key-value' },
    capoValue: { type: Number, attribute: 'capo-value' },
    bpm: { type: Number },
    timeSignature: { type: String, attribute: 'time-signature' },
    editMode: { type: Boolean, attribute: 'edit-mode', reflect: true },
  }

  static styles = css`
    :host {
      display: inline-flex;
    }

    .metadata-container {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--font-ui-small);
      white-space: nowrap;
      background: transparent;
      border: 2px solid transparent;
      border-radius: 6px;
      padding: 0.2rem 0.45rem;
      transition: all 0.2s;
      cursor: default;
    }

    /* In edit mode, make it look like a button */
    :host([edit-mode]) .metadata-container {
      background-color: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.3);
      cursor: pointer;
    }

    :host([edit-mode]) .metadata-container:hover {
      background-color: rgba(255, 255, 255, 0.3);
      border-color: rgba(255, 255, 255, 0.5);
    }

    :host([edit-mode]) .metadata-container:focus {
      outline: none;
      background-color: rgba(255, 255, 255, 0.3);
      border-color: var(--header-text, #fff);
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }

    .meta-label {
      opacity: 0.8;
      font-size: var(--font-ui-small);
      color: var(--header-text, #fff);
    }

    .meta-value {
      color: var(--header-text, #fff);
      font-size: var(--font-ui-small);
    }
  `

  constructor() {
    super()
    this.keyValue = ''
    this.capoValue = 0
    this.bpm = null
    this.timeSignature = ''
    this.editMode = false
  }

  _handleClick() {
    if (this.editMode) {
      this.dispatchEvent(
        new CustomEvent('settings-click', {
          bubbles: true,
          composed: true,
        })
      )
    }
  }

  _handleKeyDown(e) {
    if (this.editMode && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      this._handleClick()
    }
  }

  render() {
    return html`
      <div
        class="metadata-container"
        @click=${this._handleClick}
        @keydown=${this._handleKeyDown}
        tabindex="${this.editMode ? '0' : '-1'}"
        role="${this.editMode ? 'button' : 'group'}"
        aria-label="${this.editMode ? 'Open song settings' : 'Song information'}"
      >
        ${
          this.keyValue
            ? html`
              <div class="meta-item">
                <span class="meta-label">Key:</span>
                <span class="meta-value">${this.keyValue}</span>
              </div>
            `
            : ''
        }
        ${
          this.capoValue > 0
            ? html`
              <div class="meta-item">
                <span class="meta-label">Capo:</span>
                <span class="meta-value">${this.capoValue}</span>
              </div>
            `
            : ''
        }
        ${
          this.bpm
            ? html`
              <div class="meta-item">
                <span class="meta-label">BPM:</span>
                <span class="meta-value">${this.bpm}</span>
              </div>
            `
            : ''
        }
        ${
          this.timeSignature
            ? html`
              <div class="meta-item">
                <span class="meta-label">Time:</span>
                <span class="meta-value">${this.timeSignature}</span>
              </div>
            `
            : ''
        }
      </div>
    `
  }
}

customElements.define('musical-metadata-display', MusicalMetadataDisplay)
