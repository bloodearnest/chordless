import { css, html, LitElement } from 'lit'
import './icon.js'

/**
 * AppModal Component
 *
 * A reusable modal dialog component with support for different types:
 * - info: Display information with a close button
 * - confirm: Show confirmation dialog with cancel/confirm buttons
 * - custom: Fully custom content via slot
 *
 * Properties:
 * @property {Boolean} open - Whether the modal is open
 * @property {String} title - Modal title (optional)
 * @property {String} message - Modal message text (optional, for simple modals)
 * @property {String} type - Modal type: 'info', 'confirm', 'custom' (default: 'custom')
 * @property {String} size - Modal size: 'small', 'medium', 'large', 'fullscreen' (default: 'medium')
 * @property {String} confirmLabel - Label for confirm button (default: 'Confirm')
 * @property {String} cancelLabel - Label for cancel button (default: 'Cancel')
 * @property {Boolean} hideCloseButton - Hide the × close button (default: false)
 *
 * Slots:
 * @slot default - Main content area
 * @slot header - Custom header content (replaces title)
 * @slot actions - Custom action buttons (overrides confirm/cancel buttons)
 *
 * Events:
 * @fires close - When modal is closed (via overlay click, close button, or ESC)
 * @fires confirm - When confirm button is clicked (type='confirm')
 * @fires cancel - When cancel button is clicked (type='confirm')
 *
 * CSS Parts:
 * @csspart overlay - The overlay backdrop
 * @csspart content - The modal content container
 * @csspart header - The header section
 * @csspart title - The title element
 * @csspart body - The body content section
 * @csspart actions - The actions button container
 * @csspart close-button - The × close button
 * @slot header-actions - Extra buttons in the header, left of the close button
 *   (needs a heading). Set the has-header-actions attribute to leave room for them.
 * @csspart header-actions - Container for the header-actions slot
 * @csspart confirm-button - The confirm button
 * @csspart cancel-button - The cancel button
 */
export class AppModal extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    heading: { type: String, attribute: 'heading' },
    message: { type: String },
    type: { type: String },
    size: { type: String, reflect: true },
    confirmLabel: { type: String, attribute: 'confirm-label' },
    cancelLabel: { type: String, attribute: 'cancel-label' },
    hideCloseButton: { type: Boolean, attribute: 'hide-close-button' },
  }

  static styles = css`
    :host {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 9999;
    }

    :host([open]) {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      cursor: pointer;
    }

    .modal-content {
      position: relative;
      background: var(--bg-color, white);
      border-radius: 8px;
      max-width: 90%;
      max-height: 90vh;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      cursor: default;
      z-index: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Size variants */
    :host([size='small']) .modal-content {
      max-width: 400px;
    }

    :host([size='medium']) .modal-content {
      max-width: 600px;
    }

    :host([size='large']) .modal-content {
      max-width: 900px;
    }

    :host([size='fullscreen']) .modal-content {
      max-width: 95vw;
      max-height: 95vh;
      width: 95vw;
      height: 95vh;
    }

    .modal-header {
      position: relative;
      padding: 2rem 2rem 1rem 2rem;
      border-bottom: 1px solid var(--border-light, #ecf0f1);
    }

    .modal-title {
      font-size: var(--font-ui);
      font-weight: 600;
      color: var(--text-color, #2c3e50);
      margin: 0;
      padding-right: 3rem;
    }

    /* Extra header buttons (slot="header-actions"), just left of the close button */
    .header-actions {
      position: absolute;
      top: 1.5rem;
      right: 4.75rem;
      display: flex;
      gap: 0.75rem;
    }

    :host([has-header-actions]) .modal-title {
      padding-right: 8rem;
    }

    /* Circled icon buttons, matching the page header's (close, and any buttons
       slotted into header-actions such as an edit pencil) */
    .modal-close,
    ::slotted(button[slot='header-actions']) {
      position: absolute;
      top: 1.5rem;
      right: 1.5rem;
      background: none;
      border: 2px solid currentColor;
      color: var(--text-secondary, #7f8c8d);
      width: 2.5rem;
      height: 2.5rem;
      padding: 0;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: var(--font-icon, 1.25rem);
      transition: all 0.2s;
    }

    ::slotted(button[slot='header-actions']) {
      position: static;
    }

    .modal-close:hover,
    ::slotted(button[slot='header-actions']:hover) {
      color: var(--text-color, #2c3e50);
      background-color: var(--bg-tertiary, #ecf0f1);
      transform: scale(1.05);
    }

    /* No heading: no header bar, the close button sits in the content's corner */
    .modal-close.floating {
      top: 1rem;
      right: 1rem;
      z-index: 1;
    }

    .modal-content.headerless .modal-body {
      padding-top: 4.5rem;
    }

    .modal-body {
      padding: 2rem;
      flex: 1;
      overflow: auto;
    }

    .modal-message {
      font-size: var(--font-ui);
      color: var(--text-color, #34495e);
      line-height: 1.6;
      margin: 0;
    }

    .modal-actions {
      display: flex;
      gap: 1rem;
      justify-content: flex-end;
      padding: 1.5rem 2rem 2rem 2rem;
      border-top: 1px solid var(--border-light, #ecf0f1);
    }

    .modal-btn {
      padding: 1rem 2rem;
      font-size: var(--font-ui);
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    }

    .modal-btn-cancel {
      background-color: var(--bg-tertiary, #ecf0f1);
      color: var(--text-color, #2c3e50);
    }

    .modal-btn-cancel:hover {
      filter: brightness(1.2);
    }

    .modal-btn-confirm {
      background-color: var(--button-bg, #3498db);
      color: var(--button-text, white);
    }

    .modal-btn-confirm:hover {
      background-color: var(--button-hover, #2980b9);
    }

    .modal-btn-confirm.danger {
      background-color: var(--color-danger, #e74c3c);
    }

    .modal-btn-confirm.danger:hover {
      filter: brightness(0.9);
    }

    /* Hide elements based on configuration */
    :host([hide-close-button]) .modal-close {
      display: none;
    }
  `

  constructor() {
    super()
    this.open = false
    this.heading = ''
    this.message = ''
    this.type = 'custom'
    this.size = 'medium'
    this.confirmLabel = 'Confirm'
    this.cancelLabel = 'Cancel'
    this.hideCloseButton = false
  }

  connectedCallback() {
    super.connectedCallback()
    // Listen for ESC key to close modal
    this._handleEscape = e => {
      if (e.key === 'Escape' && this.open) {
        this.close()
      }
    }
    document.addEventListener('keydown', this._handleEscape)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('keydown', this._handleEscape)
  }

  render() {
    return html`
      <div class="modal-overlay" part="overlay" @click=${this._handleOverlayClick}></div>
      <div class="modal-content ${this._hasHeader() ? '' : 'headerless'}" part="content">
        ${this._hasHeader() ? this._renderHeader() : this._renderFloatingClose()}

        <div class="modal-body" part="body">
          ${this.message ? html`<p class="modal-message">${this.message}</p>` : ''}
          <slot></slot>
        </div>

        ${this._renderActions()}
      </div>
    `
  }

  _hasHeader() {
    return Boolean(this.heading || this.querySelector('[slot="header"]'))
  }

  _renderFloatingClose() {
    if (this.hideCloseButton) return ''
    return html`
      <button
        class="modal-close floating"
        part="close-button"
        aria-label="Close"
        @click=${this.close}
      >
                  <app-icon name="close"></app-icon>
                </button>
    `
  }

  _renderHeader() {
    // Check if there's a slotted header content
    const hasSlottedHeader = this.querySelector('[slot="header"]')

    if (hasSlottedHeader) {
      return html`
        <div class="modal-header" part="header">
          <slot name="header"></slot>
          ${
            !this.hideCloseButton
              ? html`
                <button class="modal-close" part="close-button" aria-label="Close" @click=${this.close}>
                  <app-icon name="close"></app-icon>
                </button>
              `
              : ''
          }
        </div>
      `
    }

    if (this.heading) {
      return html`
        <div class="modal-header" part="header">
          ${this.heading ? html`<h2 class="modal-title" part="title">${this.heading}</h2>` : ''}
          <div class="header-actions" part="header-actions">
            <slot name="header-actions"></slot>
          </div>
          ${
            !this.hideCloseButton
              ? html`
                <button class="modal-close" part="close-button" aria-label="Close" @click=${this.close}>
                  <app-icon name="close"></app-icon>
                </button>
              `
              : ''
          }
        </div>
      `
    }

    return ''
  }

  _renderActions() {
    // Check if there's a slotted actions content
    const hasSlottedActions = this.querySelector('[slot="actions"]')

    if (hasSlottedActions) {
      return html`
        <div class="modal-actions" part="actions">
          <slot name="actions"></slot>
        </div>
      `
    }

    if (this.type === 'confirm') {
      return html`
        <div class="modal-actions" part="actions">
          <button
            class="modal-btn modal-btn-cancel"
            part="cancel-button"
            @click=${this._handleCancel}
          >
            ${this.cancelLabel}
          </button>
          <button
            class="modal-btn modal-btn-confirm"
            part="confirm-button"
            @click=${this._handleConfirm}
          >
            ${this.confirmLabel}
          </button>
        </div>
      `
    }

    return ''
  }

  _handleOverlayClick(e) {
    // Only close if clicking directly on overlay, not on modal content
    if (e.target === e.currentTarget) {
      this.close()
    }
  }

  _handleConfirm() {
    this.dispatchEvent(
      new CustomEvent('confirm', {
        bubbles: true,
        composed: true,
      })
    )
    this.close()
  }

  _handleCancel() {
    this.dispatchEvent(
      new CustomEvent('cancel', {
        bubbles: true,
        composed: true,
      })
    )
    this.close()
  }

  // Public API
  close() {
    this.open = false
    this.dispatchEvent(
      new CustomEvent('close', {
        bubbles: true,
        composed: true,
      })
    )
  }

  show() {
    this.open = true
  }

  /**
   * Show the modal and wait for an answer (type='confirm').
   * @returns {Promise<boolean>} true if confirmed, false if cancelled or closed
   */
  ask() {
    return new Promise(resolve => {
      let confirmed = false
      const onConfirm = () => {
        confirmed = true
      }
      // Confirm and cancel both close the modal, so close settles every outcome
      const onClose = () => {
        this.removeEventListener('confirm', onConfirm)
        this.removeEventListener('close', onClose)
        resolve(confirmed)
      }
      this.addEventListener('confirm', onConfirm)
      this.addEventListener('close', onClose)
      this.show()
    })
  }

  toggle() {
    this.open = !this.open
  }
}

// Define the custom element
customElements.define('app-modal', AppModal)
