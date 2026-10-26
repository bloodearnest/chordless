import type { PropertyValues } from 'lit'
import { css, html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { AppUpdateChangeEvent, appUpdate } from '../js/app-update.ts'
import { sleep } from '../js/utils/sleep.ts'
import './icon.ts'

/** The menu button was pressed; trigger is the button, to open the menu under */
export class HeaderMenuClickEvent extends Event {
  static readonly type = 'app-header:menu-click'
  readonly trigger: HTMLElement
  constructor(trigger: HTMLElement) {
    super(HeaderMenuClickEvent.type, { bubbles: true, composed: true })
    this.trigger = trigger
  }
}

/** The edit mode button was pressed */
export class EditModeToggleEvent extends Event {
  static readonly type = 'app-header:edit-mode-toggle'
  constructor() {
    super(EditModeToggleEvent.type, { bubbles: true, composed: true })
  }
}

/** The info button was pressed */
export class HeaderInfoClickEvent extends Event {
  static readonly type = 'app-header:info-click'
  constructor() {
    super(HeaderInfoClickEvent.type, { bubbles: true, composed: true })
  }
}

/**
 * AppHeader Component
 *
 * A flexible header component that adapts to different page contexts.
 *
 * Properties:
 * @property {String} title - The main title text to display
 * @property {Boolean} showEditToggle - Whether to show the edit mode toggle button
 * @property {Boolean} showInfoButton - Whether to show the info button
 * @property {Boolean} editMode - Current edit mode state (for styling the toggle button)
 * @property {Boolean} titleBelow - On phones, the title is a row of its own under the menu and icons
 * @property {Boolean} tucked - On phones, the header is slid out of the way (the page sets --tuck, its height)
 *
 * Slots:
 * @slot controls - Page-specific controls (the song's key, capo and tempo). On phones they are a
 *   second row under the title; on wider screens they share the one row, before the icons
 * @slot tools - Icon buttons at the end of the top row, before the edit and info buttons (e.g. share)
 * @slot actions - Buttons in the top row, after the title (e.g. the home page's create-setlist button)
 *
 * Events:
 * @fires EditModeToggleEvent - When the edit mode button is pressed
 * @fires HeaderInfoClickEvent - When the info button is pressed
 * @fires HeaderMenuClickEvent - When the menu button is pressed (trigger: the button)
 *
 * CSS Parts:
 * @csspart header - The main header element
 * @csspart nav-button - The navigation menu button
 * @csspart title - The title text element
 * @csspart edit-toggle - The edit mode toggle button
 * @csspart info-button - The info button
 */
export class AppHeader extends LitElement {
  static override properties = {
    heading: { type: String, attribute: 'heading' },
    showEditToggle: { type: Boolean, attribute: 'show-edit-toggle' },
    showInfoButton: { type: Boolean, attribute: 'show-info-button' },
    showLogo: { type: Boolean, attribute: 'show-logo' },
    editMode: { type: Boolean, reflect: true, attribute: 'edit-mode' },
    disableAnimation: { type: Boolean, attribute: 'disable-animation' },
    titleBelow: { type: Boolean, reflect: true, attribute: 'title-below' },
    tucked: { type: Boolean, reflect: true },
    _slottedControls: { state: true }, // whether anything is in the controls slot
    _updateReady: { state: true }, // whether a new version of the app is waiting
  }

  declare heading: string
  declare showEditToggle: boolean
  declare showInfoButton: boolean
  declare showLogo: boolean
  declare editMode: boolean
  declare disableAnimation: boolean
  declare titleBelow: boolean
  declare tucked: boolean
  declare _slottedControls: boolean
  declare _updateReady: boolean

  _title: Ref<HTMLElement>
  _previousTitle: string
  _animating: boolean
  /** Set by setTitleInstant for the one update it causes; not reactive, so it causes no other */
  _instant: boolean
  _displayTitle: string

  static override styles = css`
    :host {
      display: block;
      /* The space between things follows the text size (--font-base), not the browser's rem */
      --gap: calc(var(--font-base) * 0.4);
    }

    header {
      background-color: var(--header-bg, #3498db);
      color: var(--header-text, white);
      padding: calc(var(--gap) / 2) var(--gap);
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      gap: var(--gap);
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      min-width: 0;
      overflow: hidden;
      transition: height 0.3s ease-in-out;
    }

    /* Larger padding and gap on tablet/desktop */
    @media (min-width: 48rem) {
      header {
        padding: 0.5rem 1.5rem;
        gap: 1.5rem;
        flex-wrap: nowrap;
      }
    }

    /* Top row: menu, title, then the icons. Under it, on phones, the controls */
    .header-row-1 {
      display: flex;
      align-items: center;
      gap: var(--gap);
      flex: 1;
      min-width: 0;
    }

    .header-icons {
      display: flex;
      align-items: center;
      gap: var(--gap);
      flex-shrink: 0;
    }

    .header-row-2 {
      display: flex;
      align-items: center;
      gap: var(--gap);
    }

    .nav-menu-button {
      background: none;
      border: none;
      color: var(--header-text, white);
      cursor: pointer;
      padding: 0.5rem;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      transition:
        transform 0.2s,
        background-color 0.2s;
      border-radius: 4px;
      min-width: 44px;
      min-height: 44px;
    }

    /* A new version of the app is ready: a dot on the menu button's corner, which takes no room */
    .update-dot {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--update-dot, #f39c12);
      border: 2px solid var(--header-bg, #2c3e50);
      box-sizing: content-box;
    }

    .nav-menu-button:hover {
      background-color: rgba(255, 255, 255, 0.15);
      transform: scale(1.05);
    }

    .nav-menu-button:active {
      transform: scale(0.95);
    }

    .title {
      font-size: var(--font-ui);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: opacity 0.3s ease-in-out;
      display: flex;
      align-items: center;
      gap: var(--gap);
    }

    .title.fade-out {
      opacity: 0;
    }

    .logo {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
    }

    ::slotted(.header-controls-slot) {
      display: flex;
      align-items: center;
      gap: var(--gap);
      transition: opacity 0.3s ease-in-out;
      flex-wrap: nowrap;
      flex-shrink: 1;
      min-width: 0;
      overflow: hidden;
    }

    .header-row-1 .title {
      flex: 1;
      min-width: 0;
    }

    /* Phones: the controls take a row of their own, as little of it as they need */
    @media (max-width: 47.99rem) {
      header {
        padding: calc(var(--gap) / 2) var(--gap);
        gap: 0;
      }

      .header-row-1 {
        width: 100%;
      }

      /* Slid up out of the way: the page under it moves up as it goes, so the text stays put */
      :host {
        transition:
          margin-top 0.25s ease-in-out,
          visibility 0.25s;
      }

      :host([tucked]) {
        margin-top: calc(-1 * var(--tuck, 0px));
        visibility: hidden;
      }

      /* The menu and the icons, and under them the title, as a row of its own */
      :host([title-below]) .header-icons {
        margin-left: auto;
      }

      :host([title-below]) .header-row-1 {
        flex-wrap: wrap;
      }

      :host([title-below]) .header-row-1 .title {
        order: 1;
        flex: 0 0 100%;
        padding-left: var(--gap);
        box-sizing: border-box;
      }

      .header-row-2 {
        width: 100%;
        justify-content: flex-start;
        flex-wrap: wrap;
        padding-left: var(--gap);
      }
    }

    /* Tablet/desktop: one row, the controls before the icons */
    @media (min-width: 48rem) {
      .header-row-1 {
        display: contents;
      }

      .header-row-1 .title {
        flex: 0 1 auto;
      }

      .header-row-2 {
        order: 1;
        justify-content: flex-end;
        flex: 1;
        flex-wrap: nowrap;
        white-space: nowrap;
      }

      .header-icons {
        order: 2;
      }
    }

    /* Buttons that stay in the top row, at its end (slot="actions") */
    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--gap);
      margin-left: auto;
    }

    /* Nothing to show in a second row */
    .header-row-2[hidden] {
      display: none !important;
    }

    .icon-button {
      background: none;
      border: 2px solid var(--header-text, white);
      color: var(--header-text, white);
      width: 2.5rem;
      height: 2.5rem;
      min-width: 2.5rem;
      min-height: 2.5rem;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: var(--font-icon);
      font-weight: bold;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    /* The i alone, bolder, to match the weight of the circle round it */
    .info-button app-icon {
      --icon-stroke: 3.5;
    }

    .icon-button:hover {
      background-color: rgba(255, 255, 255, 0.2);
      transform: scale(1.05);
    }

    .edit-toggle.active {
      background-color: var(--button-bg, white);
      border-color: var(--button-bg, white);
      color: var(--header-bg, #3498db);
      box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.3);
    }

    .edit-toggle.active:hover {
      background-color: rgba(255, 255, 255, 0.9);
      border-color: rgba(255, 255, 255, 0.9);
      transform: scale(1.05);
    }
  `

  constructor() {
    super()
    this._title = createRef()
    this.heading = ''
    this.showEditToggle = false
    this.showInfoButton = false
    this.showLogo = false
    this.editMode = false
    this.disableAnimation = false
    this.titleBelow = false
    this.tucked = false
    this._slottedControls = false
    this._updateReady = appUpdate.ready
    this._previousTitle = ''
    this._animating = false
    this._instant = false
    this._displayTitle = '' // The title actually shown in the UI
  }

  override connectedCallback() {
    super.connectedCallback()
    window.addEventListener(AppUpdateChangeEvent.type, this._onUpdateChange)
    this._updateReady = appUpdate.ready
    // Initialize display title
    this._displayTitle = this.heading
    this._previousTitle = this.heading
  }

  override disconnectedCallback() {
    window.removeEventListener(AppUpdateChangeEvent.type, this._onUpdateChange)
    super.disconnectedCallback()
  }

  _onUpdateChange = (event: AppUpdateChangeEvent): void => {
    this._updateReady = event.ready
  }

  override willUpdate(changedProperties: PropertyValues<this>): void {
    // Without animation the new heading is shown by this very update
    if (
      changedProperties.has('heading') &&
      this.heading !== this._previousTitle &&
      (this.disableAnimation || this._instant)
    ) {
      this._displayTitle = this.heading
      this._previousTitle = this.heading
    }
  }

  override updated(changedProperties: PropertyValues<this>): void {
    super.updated(changedProperties)

    // Animate a title change (one already running shows the latest heading when done)
    if (
      changedProperties.has('heading') &&
      this.heading !== this._previousTitle &&
      !this._animating
    ) {
      this._animateTransition()
    }
  }

  async _animateTransition(): Promise<void> {
    this._animating = true

    // Fade out the old title (Lit keeps the same element across renders)
    const titleEl = this._title.value
    titleEl?.classList.add('fade-out')

    // Wait for fade-out to complete
    await sleep(300)

    // Update the displayed title
    this._displayTitle = this.heading
    this._previousTitle = this.heading
    this.requestUpdate()

    // Wait for re-render
    await this.updateComplete

    // Fade in the new one
    requestAnimationFrame(() => titleEl?.classList.remove('fade-out'))

    // Wait for fade-in to complete
    await sleep(300)

    this._animating = false

    // The heading may have changed again while fading: show the latest
    if (this._displayTitle !== this.heading) {
      this._animateTransition()
    }
  }

  // Public method to update without animation
  setTitleInstant(newTitle: string): void {
    this._instant = true
    this.heading = newTitle
    this.updateComplete.then(() => {
      this._instant = false
    })
  }

  _onControlsSlotChange(event: Event): void {
    this._slottedControls = (event.target as HTMLSlotElement).assignedElements().length > 0
  }

  override render() {
    return html`
      <header part="header">
        <!-- Row 1: menu, title and icons -->
        <div class="header-row-1">
          <button
            class="nav-menu-button"
            part="nav-button"
            @click=${this._handleNavMenuClick}
            aria-label=${this._updateReady ? 'Navigation menu, update ready' : 'Navigation menu'}
          >
            <app-icon name="menu" size="24"></app-icon>
            ${this._updateReady ? html`<span class="update-dot" aria-hidden="true"></span>` : ''}
          </button>
          <div class="title" part="title" ${ref(this._title)}>
            ${this.showLogo ? html`<img src="/icons/favicon-light.svg" alt="" class="logo" />` : ''}
            ${this._displayTitle}
          </div>
          <div class="header-actions"><slot name="actions"></slot></div>
          <div class="header-icons">
            <slot name="tools"></slot>
            ${
              this.showEditToggle
                ? html`
                  <button
                    class="icon-button edit-toggle ${this.editMode ? 'active' : ''}"
                    part="edit-toggle"
                    @click=${this._handleEditToggle}
                    aria-label="Toggle edit mode"
                  >
                    <app-icon name="edit"></app-icon>
                  </button>
                `
                : ''
            }
            ${
              this.showInfoButton
                ? html`
                  <button
                    class="icon-button info-button"
                    part="info-button"
                    @click=${this._handleInfoClick}
                    aria-label="Information"
                  >
                    <app-icon name="info-mark"></app-icon>
                  </button>
                `
                : ''
            }
          </div>
        </div>

        <!-- Row 2: the page's controls (on phones, under the top row) -->
        <div class="header-row-2" ?hidden=${!this._slottedControls}>
          <slot name="controls" @slotchange=${this._onControlsSlotChange}></slot>
        </div>
      </header>
    `
  }

  _handleNavMenuClick(event: Event): void {
    this.dispatchEvent(new HeaderMenuClickEvent(event.currentTarget as HTMLElement))
  }

  _handleEditToggle() {
    this.dispatchEvent(new EditModeToggleEvent())
  }

  _handleInfoClick() {
    this.dispatchEvent(new HeaderInfoClickEvent())
  }
}

// Define the custom element
customElements.define('app-header', AppHeader)

declare global {
  interface HTMLElementTagNameMap {
    'app-header': AppHeader
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [HeaderMenuClickEvent.type]: HeaderMenuClickEvent
    [EditModeToggleEvent.type]: EditModeToggleEvent
    [HeaderInfoClickEvent.type]: HeaderInfoClickEvent
  }
}
