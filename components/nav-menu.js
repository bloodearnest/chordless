import { css, html, LitElement } from 'lit'
import './app-modal.js'
import './app-preferences.js'

/**
 * NavMenu Component
 *
 * A navigation menu popover used across the application.
 * Contains links to main sections (Setlists, Songs, Preferences, Bookmarklet)
 * and optionally a back button.
 *
 * Properties:
 * @property {Boolean} showBackButton - Whether to show the back button
 * @property {String} backLabel - Label for the back button (default: "Back")
 * @property {String} popoverId - ID for the popover element (default: "nav-menu-popover")
 *
 * Events:
 * @fires back-click - When back button is clicked
 *
 * CSS Parts:
 * @csspart popover - The popover container
 * @csspart nav - The nav element
 * @csspart nav-item - Each navigation item
 * @csspart back-button - The back button
 */
export class NavMenu extends LitElement {
  static properties = {
    showBackButton: { type: Boolean, attribute: 'show-back-button' },
    backLabel: { type: String, attribute: 'back-label' },
    popoverId: { type: String, attribute: 'popover-id' },
    songs: { type: Array, attribute: false },
    showOverviewLink: { type: Boolean, attribute: 'show-overview-link' },
    setlistTitle: { type: String, attribute: 'setlist-title' },
  }

  static styles = css`
    :host {
      display: contents;
    }

    * {
      box-sizing: border-box;
    }

    .nav-menu-popover {
      border: none;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 0;
      background: var(--bg-secondary, white);
      min-width: 250px;
      max-width: 90vw;
      max-height: 80vh;
      margin: 0;
      position: fixed;
      inset: unset;
      overflow-y: auto;
      /* Start positioned off-screen to prevent flash */
      top: -9999px;
      left: -9999px;
    }

    .nav-menu-popover::backdrop {
      background-color: transparent;
    }

    .nav-menu {
      display: flex;
      flex-direction: column;
      padding: 0.5rem 0;
      width: 100%;
    }

    .nav-menu-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.5rem;
      text-decoration: none;
      color: var(--text-color, #2c3e50);
      background: transparent;
      border: none;
      font-size: var(--font-ui);
      font-family: inherit;
      cursor: pointer;
      transition: background-color 0.2s;
      width: 100%;
      text-align: left;
      box-sizing: border-box;
    }

    .nav-menu-item:hover {
      background-color: var(--bg-tertiary, #ecf0f1);
    }

    .nav-menu-item:active {
      background-color: var(--hover-bg, rgba(0, 0, 0, 0.1));
    }

    .nav-icon {
      flex-shrink: 0;
      color: var(--color-primary, #3498db);
    }

    .setlist-section {
      margin-bottom: 0.5rem;
      padding-bottom: 0.5rem;
      position: relative;
    }

    .setlist-section::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--border-light, #ecf0f1);
    }

    .section-title {
      padding: 0.5rem 1.5rem;
      font-size: var(--font-ui);
      font-weight: 600;
      color: var(--text-secondary, #7f8c8d);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .song-item {
      font-size: var(--font-ui);
    }
  `

  constructor() {
    super()
    this.showBackButton = false
    this.backLabel = 'Back'
    this.popoverId = 'nav-menu-popover'
    this.triggerButton = null
    this.songs = []
    this.showOverviewLink = false
    this.setlistTitle = 'Setlist'
  }

  /**
   * Get the popover element
   * @returns {HTMLElement|null} The popover element
   */
  get popover() {
    return this.shadowRoot?.querySelector(`#${this.popoverId}`)
  }

  connectedCallback() {
    super.connectedCallback()
    // Set up positioning after the component is rendered
    this.updateComplete.then(() => {
      if (this.popover) {
        this.popover.addEventListener('toggle', e => {
          if (e.newState === 'open') {
            // Position the popover before it becomes visible
            this._positionPopover()
            // Add click-outside listener when open
            setTimeout(() => {
              document.addEventListener('click', this._handleClickOutside)
            }, 0)
          } else {
            // Remove listener when closed
            document.removeEventListener('click', this._handleClickOutside)
          }
        })
      }
    })

    // Bind the click outside handler
    this._handleClickOutside = this._handleClickOutside.bind(this)

    // Listen for app-settings events
    this.addEventListener('import-requested', this._handleImportRequested)
    this.addEventListener('clear-database-requested', this._handleClearDatabaseRequested)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('click', this._handleClickOutside)
  }

  _handleClickOutside(e) {
    const popover = this.popover
    if (!popover) return

    // Close if clicked outside (browser handles auto-close)
    const clickedInside = e.composedPath().includes(popover)
    const clickedTrigger = this.triggerButton && e.composedPath().includes(this.triggerButton)

    if (!clickedInside && !clickedTrigger) {
      this.closePopover()
    }
  }

  // Set the trigger button element for positioning
  setTriggerButton(button) {
    this.triggerButton = button
  }

  // Position the popover relative to the trigger button
  _positionPopover() {
    const popover = this.popover
    if (!popover || !this.triggerButton) return

    const buttonRect = this.triggerButton.getBoundingClientRect()
    popover.style.top = `${buttonRect.bottom + 4}px`
    popover.style.left = `${buttonRect.left}px`
  }

  render() {
    return html`
      <div id="${this.popoverId}" class="nav-menu-popover" part="popover" popover="manual">
        <nav class="nav-menu" part="nav">
          ${
            this.showOverviewLink || this.songs?.length > 0
              ? html`
                <div class="setlist-section">
                  <div class="section-title">${this.setlistTitle}</div>
                  ${
                    this.showOverviewLink
                      ? html`
                        <button
                          class="nav-menu-item"
                          part="nav-item overview-item"
                          @click=${this._handleOverviewClick}
                        >
                          <svg
                            class="nav-icon"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <rect x="3" y="3" width="7" height="7"></rect>
                            <rect x="14" y="3" width="7" height="7"></rect>
                            <rect x="14" y="14" width="7" height="7"></rect>
                            <rect x="3" y="14" width="7" height="7"></rect>
                          </svg>
                          <span>Overview</span>
                        </button>
                      `
                      : ''
                  }
                  ${this.songs?.map(
                    (song, index) => html`
                      <button
                        class="nav-menu-item song-item"
                        part="nav-item song-item"
                        @click=${() => this._handleSongClick(index)}
                      >
                        <svg
                          class="nav-icon"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path d="M9 18V5l12-2v13"></path>
                          <circle cx="6" cy="18" r="3"></circle>
                          <circle cx="18" cy="16" r="3"></circle>
                        </svg>
                        <span>${song.title}</span>
                      </button>
                    `
                  )}
                </div>
              `
              : ''
          }
          ${
            this.showBackButton
              ? html`
                <button
                  class="nav-menu-item"
                  part="nav-item back-button"
                  @click=${this._handleBackClick}
                  style="margin-bottom: 0.5rem; padding-bottom: 1rem; border-bottom: 1px solid #ecf0f1;"
                >
                  <svg
                    class="nav-icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                  </svg>
                  <span>${this.backLabel}</span>
                </button>
              `
              : ''
          }

          <a href="/" class="nav-menu-item" part="nav-item">
            <svg
              class="nav-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>Setlists</span>
          </a>

          <a href="/songs" class="nav-menu-item" part="nav-item">
            <svg
              class="nav-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
            <span>Song Library</span>
          </a>

          <button class="nav-menu-item" part="nav-item" @click=${this._handlePreferencesClick}>
            <svg
              class="nav-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              ></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Preferences</span>
          </button>

          <a href="/bookmarklet" class="nav-menu-item" part="nav-item">
            <svg
              class="nav-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>SongSelect Import</span>
          </a>

          <a href="/storage" class="nav-menu-item" part="nav-item">
            <svg
              class="nav-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
            </svg>
            <span>Storage</span>
          </a>
        </nav>
      </div>

      <app-modal id="nav-preferences-modal" size="fullscreen">
        <div slot="header">
          <h2 style="margin: 0; font-size: var(--font-ui);">Preferences</h2>
        </div>
        <app-preferences></app-preferences>
      </app-modal>
    `
  }

  _handleBackClick() {
    this.dispatchEvent(
      new CustomEvent('back-click', {
        bubbles: true,
        composed: true,
      })
    )

    // Close the popover after back is clicked
    this.closePopover()
  }

  _handleOverviewClick() {
    this.dispatchEvent(
      new CustomEvent('overview-click', {
        bubbles: true,
        composed: true,
      })
    )

    // Close the popover after overview is clicked
    this.closePopover()
  }

  _handleSongClick(index) {
    this.dispatchEvent(
      new CustomEvent('song-click', {
        bubbles: true,
        composed: true,
        detail: { index },
      })
    )

    // Close the popover after song is clicked
    this.closePopover()
  }

  _handlePreferencesClick() {
    this.closePopover()
    // Wait for next frame to ensure popover is closed before showing modal
    requestAnimationFrame(() => {
      const modal = this.shadowRoot?.querySelector('#nav-preferences-modal')
      if (modal) {
        modal.show()
      }
    })
  }

  async _handleClearDatabaseRequested() {
    const confirmed = confirm(
      '⚠️ Are you sure you want to clear ALL data?\n\nThis will delete:\n- All setlists\n- All songs\n- All localStorage data\n\nThis action cannot be undone!'
    )

    if (!confirmed) return

    try {
      const { getCurrentDB } = await import('../js/db.js')
      const db = await getCurrentDB()
      await db.clearAll()

      localStorage.clear()
      sessionStorage.clear()

      alert('✅ Database cleared successfully!\n\nThe page will now reload.')
      window.location.reload()
    } catch (error) {
      console.error('Failed to clear database:', error)
      alert('❌ Failed to clear database: ' + error.message)
    }
  }

  async _handleImportRequested() {
    // If we're already on the preferences page, don't navigate
    // Let the event bubble to setlist-app which will handle the import
    if (window.location.pathname === '/preferences') {
      return
    }

    // Navigate to preferences page which handles the actual import
    window.location.href = '/preferences'
  }

  // Public API for controlling the popover
  showPopover() {
    const popover = this.popover
    // Position before showing to avoid visual jump
    this._positionPopover()
    popover?.showPopover()
  }

  closePopover() {
    const popover = this.popover
    popover?.hidePopover()
  }

  togglePopover() {
    const popover = this.popover
    popover?.togglePopover()
  }

  isOpen() {
    const popover = this.popover
    return popover?.matches(':popover-open') || false
  }
}

// Define the custom element
customElements.define('nav-menu', NavMenu)
