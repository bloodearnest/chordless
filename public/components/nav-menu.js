import { ContextConsumer } from '@lit/context'
import { css, html, LitElement } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import './app-modal.js'
import './app-preferences.js'
import './icon.js'
import { routeContext } from '../js/route-context.js'
import { HeaderMenuClickEvent } from './app-header.js'

/** The back item was chosen */
export class MenuBackClickEvent extends Event {
  static type = 'nav-menu:back-click'
  constructor() {
    super(MenuBackClickEvent.type, { bubbles: true, composed: true })
  }
}

/** The setlist overview item was chosen */
export class MenuOverviewClickEvent extends Event {
  static type = 'nav-menu:overview-click'
  constructor() {
    super(MenuOverviewClickEvent.type, { bubbles: true, composed: true })
  }
}

/** A song in the setlist was chosen; index is its place in the setlist */
export class MenuSongClickEvent extends Event {
  static type = 'nav-menu:song-click'
  constructor(index) {
    super(MenuSongClickEvent.type, { bubbles: true, composed: true })
    this.index = index
  }
}

/**
 * NavMenu Component
 *
 * A navigation menu popover used across the application.
 * Contains links to main sections (Setlists, Songs, Preferences, Bookmarklet)
 * and optionally a back button.
 *
 * It opens from its trigger: the button named by its `for` attribute (a button
 * id, as with <label for>), or the menu button of an <app-header>, which fires
 * nav-menu-click.
 *
 *   <button id="nav-menu-button">…</button>
 *   <nav-menu for="nav-menu-button"></nav-menu>
 *
 * Properties:
 * @property {String} for - id of the button that opens the menu
 * @property {Boolean} showBackButton - Whether to show the back button
 * @property {String} backLabel - Label for the back button (default: "Back")
 * @property {String} popoverId - ID for the popover element (default: "nav-menu-popover")
 *
 * Events:
 * @fires MenuBackClickEvent - When the back item is chosen
 * @fires MenuOverviewClickEvent - When the setlist overview item is chosen
 * @fires MenuSongClickEvent - When a song in the setlist is chosen (index)
 *
 * CSS Parts:
 * @csspart popover - The popover container
 * @csspart nav - The nav element
 * @csspart nav-item - Each navigation item
 * @csspart back-button - The back button
 */
export class NavMenu extends LitElement {
  static properties = {
    triggerId: { type: String, attribute: 'for' },
    showBackButton: { type: Boolean, attribute: 'show-back-button' },
    backLabel: { type: String, attribute: 'back-label' },
    popoverId: { type: String, attribute: 'popover-id' },
    songs: { type: Array, attribute: false },
    showOverviewLink: { type: Boolean, attribute: 'show-overview-link' },
    setlistTitle: { type: String, attribute: 'setlist-title' },
    // Preferences are only rendered once first opened: they load pad sets from Drive
    _preferencesOpened: { state: true },
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
      color: var(--color-primary, #2477ad);
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
      color: var(--text-secondary, #5f6b6d);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .song-item {
      font-size: var(--font-ui);
    }
  `

  constructor() {
    super()
    this._popover = createRef()
    this._preferencesModal = createRef()
    this.showBackButton = false
    this.backLabel = 'Back'
    this.popoverId = 'nav-menu-popover'
    this.triggerButton = null
    this.songs = []
    this.showOverviewLink = false
    this.setlistTitle = 'Setlist'
    // The menu outlives the views: close it when the route changes
    new ContextConsumer(this, {
      context: routeContext,
      subscribe: true,
      callback: () => this.closePopover(),
    })
  }

  /**
   * Get the popover element
   * @returns {HTMLElement|null} The popover element
   */
  get popover() {
    return this._popover.value
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

    // Open from the trigger button, or from an app-header's menu button
    this._onRootClick = this._onRootClick.bind(this)
    this._onNavMenuClick = this._onNavMenuClick.bind(this)
    this._root = this.getRootNode()
    this._root.addEventListener('click', this._onRootClick)
    this._root.addEventListener(HeaderMenuClickEvent.type, this._onNavMenuClick)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('click', this._handleClickOutside)
    this._root?.removeEventListener('click', this._onRootClick)
    this._root?.removeEventListener(HeaderMenuClickEvent.type, this._onNavMenuClick)
  }

  _onRootClick(e) {
    if (!this.triggerId) return
    const trigger = e.composedPath().find(el => el.id === this.triggerId)
    if (trigger) this.toggle(trigger)
  }

  _onNavMenuClick(e) {
    this.toggle(e.trigger || e.target)
  }

  /** Open or close the menu, positioned under the trigger button */
  toggle(trigger) {
    this.triggerButton = trigger
    this.togglePopover()
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
      <div
        id="${this.popoverId}"
        ${ref(this._popover)}
        class="nav-menu-popover"
        part="popover"
        popover="manual"
      >
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
                          <app-icon name="grid" size="20" class="nav-icon"></app-icon>
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
                        <app-icon name="music" size="20" class="nav-icon"></app-icon>
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
                  <app-icon name="arrow-left" size="20" class="nav-icon"></app-icon>
                  <span>${this.backLabel}</span>
                </button>
              `
              : ''
          }

          <a href="/" class="nav-menu-item" part="nav-item">
            <app-icon name="calendar" size="20" class="nav-icon"></app-icon>
            <span>Setlists</span>
          </a>

          <a href="/songs" class="nav-menu-item" part="nav-item">
            <app-icon name="music" size="20" class="nav-icon"></app-icon>
            <span>Song Library</span>
          </a>

          <button class="nav-menu-item" part="nav-item" @click=${this._handlePreferencesClick}>
            <app-icon name="settings" size="20" class="nav-icon"></app-icon>
            <span>Preferences</span>
          </button>

          <a href="/import-song" class="nav-menu-item" part="nav-item">
            <app-icon name="upload" size="20" class="nav-icon"></app-icon>
            <span>Import Songs</span>
          </a>

          <a href="/bookmarklet" class="nav-menu-item" part="nav-item">
            <app-icon name="bookmark" size="20" class="nav-icon"></app-icon>
            <span>SongSelect Import</span>
          </a>

          <a href="/storage" class="nav-menu-item" part="nav-item">
            <app-icon name="layers" size="20" class="nav-icon"></app-icon>
            <span>Storage</span>
          </a>
        </nav>
      </div>

      <app-modal ${ref(this._preferencesModal)} size="fullscreen" heading="Preferences">
        ${this._preferencesOpened ? html`<app-preferences></app-preferences>` : ''}
      </app-modal>
    `
  }

  _handleBackClick() {
    this.dispatchEvent(new MenuBackClickEvent())

    // Close the popover after back is clicked
    this.closePopover()
  }

  _handleOverviewClick() {
    this.dispatchEvent(new MenuOverviewClickEvent())

    // Close the popover after overview is clicked
    this.closePopover()
  }

  _handleSongClick(index) {
    this.dispatchEvent(new MenuSongClickEvent(index))

    // Close the popover after song is clicked
    this.closePopover()
  }

  _handlePreferencesClick() {
    this.closePopover()
    this._preferencesOpened = true
    // Wait for next frame to ensure popover is closed before showing modal
    requestAnimationFrame(() => {
      const modal = this._preferencesModal.value
      if (modal) {
        modal.show()
      }
    })
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
