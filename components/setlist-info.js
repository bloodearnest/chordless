import { css, html, LitElement } from 'lit'

/**
 * SetlistInfo Component
 *
 * Displays detailed information about a setlist including metadata
 *
 * Properties:
 * @property {Object} setlist - Setlist data object
 * @property {string} leader - Leader name (computed separately)
 */
export class SetlistInfo extends LitElement {
  static properties = {
    setlist: { type: Object },
    leader: { type: String },
    loading: { type: Boolean },
  }

  static styles = css`
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

    h2 {
      margin-top: 0;
      color: var(--header-bg);
      font-size: 2rem;
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
      font-size: 1rem;
      font-weight: 600;
      color: #7f8c8d;
      text-transform: uppercase;
    }

    .modal-info-value {
      font-size: 1.3rem;
      color: var(--text-color);
    }

    .loading {
      text-align: center;
      padding: 2rem;
      color: #7f8c8d;
    }

    .empty {
      text-align: center;
      padding: 2rem;
      color: #7f8c8d;
      font-style: italic;
    }
  `

  constructor() {
    super()
    this.setlist = null
    this.leader = null
    this.loading = false
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading setlist information...</div>`
    }

    if (!this.setlist) {
      return html`<div class="empty">No setlist information available.</div>`
    }

    return html`
      <div class="setlist-info-container">${this.renderTitle()} ${this.renderInfoGrid()}</div>
    `
  }

  renderTitle() {
    const formattedDate = this.formatSetlistName(this.setlist.date)
    const titleText = this.setlist.name ? `${formattedDate} - ${this.setlist.name}` : formattedDate

    return html`<h2>${titleText}</h2>`
  }

  renderInfoGrid() {
    const songCount = this.setlist.songs ? this.setlist.songs.length : 0

    return html`
      <div class="modal-info-grid">
        ${this.renderInfoItem('Date', this.formatSetlistName(this.setlist.date))}
        ${this.setlist.time ? this.renderInfoItem('Time', this.setlist.time) : ''}
        ${this.setlist.type ? this.renderInfoItem('Type', this.setlist.type) : ''}
        ${this.setlist.name ? this.renderInfoItem('Name', this.setlist.name) : ''}
        ${this.leader ? this.renderInfoItem('Leader', this.leader) : ''}
        ${this.setlist.venue ? this.renderInfoItem('Venue', this.setlist.venue) : ''}
        ${this.renderInfoItem('Songs', `${songCount} song${songCount !== 1 ? 's' : ''}`)}
        ${
          this.setlist.createdDate
            ? this.renderInfoItem('Created', this.formatDateTime(this.setlist.createdDate))
            : ''
        }
        ${
          this.setlist.modifiedDate
            ? this.renderInfoItem('Last Modified', this.formatDateTime(this.setlist.modifiedDate))
            : ''
        }
      </div>
    `
  }

  renderInfoItem(label, value) {
    if (!value) return ''

    return html`
      <div class="modal-info-item">
        <div class="modal-info-label">${label}</div>
        <div class="modal-info-value">${value}</div>
      </div>
    `
  }

  formatSetlistName(dateStr) {
    // Format YYYY-MM-DD as readable date
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  formatDateTime(isoString) {
    const date = new Date(isoString)
    return date.toLocaleString()
  }
}

// Define the custom element
customElements.define('setlist-info', SetlistInfo)
