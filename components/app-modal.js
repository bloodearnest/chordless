import { css, html, LitElement } from 'lit'

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

    .modal-close {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: none;
      border: none;
      font-size: var(--font-ui);
      line-height: 1;
      color: var(--text-secondary, #95a5a6);
      cursor: pointer;
      padding: 0.5rem;
      width: 3.5rem;
      height: 3.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    }

    .modal-close:hover {
      background-color: var(--bg-tertiary, #ecf0f1);
      color: var(--text-color, #2c3e50);
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
      <div class="modal-content" part="content">
        ${this._renderHeader()}

        <div class="modal-body" part="body">
          ${this.message ? html`<p class="modal-message">${this.message}</p>` : ''}
          <slot></slot>
        </div>

        ${this._renderActions()}
      </div>
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
                <button class="modal-close" part="close-button" @click=${this.close}>
                  &times;
                </button>
              `
              : ''
          }
        </div>
      `
    }

    if (this.heading || !this.hideCloseButton) {
      return html`
        <div class="modal-header" part="header">
          ${this.heading ? html`<h2 class="modal-title" part="title">${this.heading}</h2>` : ''}
          ${
            !this.hideCloseButton
              ? html`
                <button class="modal-close" part="close-button" @click=${this.close}>
                  &times;
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

  toggle() {
    this.open = !this.open
  }
}

// Define the custom element
customElements.define('app-modal', AppModal)
