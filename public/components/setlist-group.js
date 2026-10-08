import { css, html, LitElement } from 'lit'

/**
 * SetlistGroup component
 *
 * Displays a collapsible list of setlists for a specific year.
 */
export class SetlistGroup extends LitElement {
  static properties = {
    year: { type: String },
    setlists: { type: Array },
    expanded: { type: Boolean, reflect: true },
  }

  constructor() {
    super()
    this.year = ''
    this.setlists = []
    this.expanded = false
  }

  static styles = css`
    :host {
      display: block;
    }

    .year-section {
      border: 2px solid var(--border-light, #ecf0f1);
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-secondary, #ffffff);
    }

    .year-header {
      width: 100%;
      padding: 1rem 2rem;
      background-color: var(--header-bg, #2c3e50);
      color: var(--header-text, #ecf0f1);
      border: none;
      font-size: var(--font-ui);
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      display: flex;
      align-items: center;
      transition: background-color 0.2s;
      min-height: 70px;
    }

    .year-header:hover {
      filter: brightness(1.1);
    }

    .year-header::after {
      content: '▼';
      margin-left: auto;
      transition: transform 0.3s;
    }

    :host([expanded]) .year-header::after {
      transform: rotate(-180deg);
    }

    .year-list {
      display: none;
      flex-direction: column;
    }

    :host([expanded]) .year-list {
      display: flex;
    }

    .setlist-button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.2rem 2rem;
      background-color: var(--bg-secondary, white);
      border: none;
      border-bottom: 1px solid var(--border-light, #ecf0f1);
      font-size: var(--font-ui);
      color: var(--text-color, #2c3e50);
      text-decoration: none;
      min-height: 70px;
      transition: background-color 0.2s;
    }

    .setlist-button:last-child {
      border-bottom: none;
    }

    .setlist-button:hover {
      background-color: var(--bg-tertiary, #f9f9f9);
    }

    .setlist-name {
      font-weight: 600;
      flex: 1;
    }

    .setlist-song-count {
      font-size: var(--font-ui-small);
      color: var(--text-secondary, #7f8c8d);
      white-space: nowrap;
    }
  `

  toggleExpand() {
    this.expanded = !this.expanded
  }

  renderSetlistRow(setlist) {
    const url = setlist.url || `/setlist/${setlist.id}`
    const name = setlist.displayName || setlist.name || ''
    const songCount =
      typeof setlist.songCount === 'number'
        ? setlist.songCount
        : setlist.songs
          ? setlist.songs.length
          : 0

    return html`
      <a class="setlist-button" href=${url}>
        <span class="setlist-name">${name}</span>
        <span class="setlist-song-count"> ${songCount} song${songCount === 1 ? '' : 's'} </span>
      </a>
    `
  }

  render() {
    return html`
      <div class="year-section">
        <button
          class="year-header"
          @click=${this.toggleExpand}
          aria-expanded=${this.expanded ? 'true' : 'false'}
        >
          ${this.year}
        </button>
        <div class="year-list">${this.setlists.map(setlist => this.renderSetlistRow(setlist))}</div>
      </div>
    `
  }
}

customElements.define('setlist-group', SetlistGroup)
