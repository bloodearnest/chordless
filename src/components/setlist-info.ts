import { css, html, LitElement } from 'lit'
import type { Setlist } from '../js/data-types.ts'

/**
 * SetlistInfo Component
 *
 * Displays detailed information about a setlist. It doesn't show the date and
 * name: setlist-info-dialog shows those as its heading (setlistTitle in date-utils).
 *
 * Properties:
 * @property {Object} setlist - Setlist data object
 * @property {string} [leader] - Leader name. Defaults to the leader of a setlist received by link.
 */
export class SetlistInfo extends LitElement {
  static override properties = {
    setlist: { type: Object, attribute: false },
    leader: { type: String },
    loading: { type: Boolean },
  }

  declare setlist: (Setlist & { venue?: string }) | null
  declare leader: string | null
  declare loading: boolean

  static override styles = css`
    :host {
      display: block;
      font-family: var(
        --font-family,
        -apple-system,
        BlinkMacSystemFont,
        'Segoe UI',
        Roboto,
        sans-serif
      );
    }

    .setlist-info-container {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }


    .modal-info-grid {
      display: grid;
      gap: 1.5rem;
    }

    .modal-info-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .modal-info-label {
      font-size: var(--font-ui);
      font-weight: 600;
      color: var(--text-secondary, #5f6b6d);
      text-transform: uppercase;
    }

    .modal-info-value {
      font-size: var(--font-ui);
      color: var(--text-color);
    }

    .loading {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary, #5f6b6d);
    }

    .empty {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary, #5f6b6d);
      font-style: italic;
    }
  `

  constructor() {
    super()
    this.setlist = null
    this.leader = null
    this.loading = false
  }

  override render() {
    if (this.loading) {
      return html`<div class="loading">Loading setlist information...</div>`
    }

    if (!this.setlist) {
      return html`<div class="empty">No setlist information available.</div>`
    }

    // The date and name are the dialog's heading, so not repeated here
    const songCount = this.setlist.songs ? this.setlist.songs.length : 0
    const leader = this.leader || this.setlist.received?.leaderName?.trim()

    return html`
      <div class="setlist-info-container">
        <div class="modal-info-grid">
          ${this.setlist.time ? this._renderInfoItem('Time', this.setlist.time) : ''}
          ${this.setlist.type ? this._renderInfoItem('Type', this.setlist.type) : ''}
          ${leader ? this._renderInfoItem('Leader', leader) : ''}
          ${this.setlist.venue ? this._renderInfoItem('Venue', this.setlist.venue) : ''}
          ${this._renderInfoItem('Songs', `${songCount} song${songCount !== 1 ? 's' : ''}`)}
          ${
            this.setlist.createdDate
              ? this._renderInfoItem('Created', this._formatDateTime(this.setlist.createdDate))
              : ''
          }
          ${
            this.setlist.modifiedDate
              ? this._renderInfoItem(
                  'Last Modified',
                  this._formatDateTime(this.setlist.modifiedDate)
                )
              : ''
          }
        </div>
      </div>
    `
  }

  _renderInfoItem(label: string, value: string) {
    if (!value) return ''

    return html`
      <div class="modal-info-item">
        <div class="modal-info-label">${label}</div>
        <div class="modal-info-value">${value}</div>
      </div>
    `
  }

  _formatDateTime(isoString: string) {
    const date = new Date(isoString)
    return date.toLocaleString()
  }
}

// Define the custom element
customElements.define('setlist-info', SetlistInfo)

declare global {
  interface HTMLElementTagNameMap {
    'setlist-info': SetlistInfo
  }
}
