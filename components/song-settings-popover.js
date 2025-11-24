import { css, html, LitElement } from 'lit'

/**
 * SongSettingsPopover Component
 *
 * A dropdown popover containing song editing controls.
 * Uses slots to contain the existing key-selector, capo-selector,
 * font-size controls, and reset button.
 *
 * Similar pattern to nav-menu - dropdown menu style, not a modal.
 */
export class SongSettingsPopover extends LitElement {
  static properties = {
    popoverId: { type: String, attribute: 'popover-id' },
  }

  static styles = css`
    :host {
      display: contents;
    }

    .settings-popover {
      border: none;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 1rem;
      background: var(--bg-secondary, white);
      min-width: 300px;
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

    .settings-popover::backdrop {
      background-color: transparent;
    }

    .settings-content {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .settings-row {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    ::slotted(*) {
      width: 100%;
    }
  `

  constructor() {
    super()
    this.popoverId = 'song-settings-popover'
    this.triggerButton = null
  }

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
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('click', this._handleClickOutside)
  }

  _handleClickOutside(e) {
    const popover = this.popover
    if (!popover) return

    // Close if clicked outside
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

  render() {
    return html`
      <div id="${this.popoverId}" class="settings-popover" popover="manual">
        <div class="settings-content" id="settings-content-container">
          <!-- Controls will be moved here via JavaScript when popover opens -->
        </div>
      </div>
    `
  }
}

customElements.define('song-settings-popover', SongSettingsPopover)
