import type { PropertyValues } from 'lit'
import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import './icon.ts'
import { buttonStyles } from './shared-styles.ts'

/** The confirm button was pressed (type confirm); the modal then closes */
export class ModalConfirmEvent extends Event {
  static readonly type = 'app-modal:confirm'
  constructor() {
    super(ModalConfirmEvent.type, { bubbles: true, composed: true })
  }
}

/** The cancel button was pressed (type confirm); the modal then closes */
export class ModalCancelEvent extends Event {
  static readonly type = 'app-modal:cancel'
  constructor() {
    super(ModalCancelEvent.type, { bubbles: true, composed: true })
  }
}

/** The modal closed, however it was closed */
export class ModalCloseEvent extends Event {
  static readonly type = 'app-modal:close'
  constructor() {
    super(ModalCloseEvent.type, { bubbles: true, composed: true })
  }
}

/**
 * AppModal Component
 *
 * A reusable modal dialog, built on a native <dialog> opened with showModal():
 * it sits in the top layer (above the page and any popover), traps focus,
 * makes the page behind it inert, and closes on Esc. Types:
 * - info: Display information with a close button
 * - confirm: Show confirmation dialog with cancel/confirm buttons
 * - custom: Fully custom content via slot
 *
 * Properties:
 * @property {Boolean} open - Whether the modal is open
 * @property {String} heading - Modal title (optional)
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
 * @fires ModalCloseEvent - When the modal closes (backdrop click, close button, Esc, or close())
 * @fires ModalConfirmEvent - When the confirm button is pressed (type='confirm')
 * @fires ModalCancelEvent - When the cancel button is pressed (type='confirm')
 *
 * CSS Parts:
 * @csspart content - The <dialog>; its backdrop is ::part(content)::backdrop
 * @csspart header - The header section
 * @csspart title - The title element
 * @csspart body - The body content section
 * @csspart actions - The actions button container
 * @csspart close-button - The × close button
 * @slot header-actions - Extra buttons in the header, left of the close button
 *   (needs a heading).
 * @csspart header-actions - Container for the header-actions slot
 * @csspart confirm-button - The confirm button
 * @csspart cancel-button - The cancel button
 */
export class AppModal extends LitElement {
  static override properties = {
    open: { type: Boolean, reflect: true },
    heading: { type: String, attribute: 'heading' },
    message: { type: String },
    type: { type: String },
    size: { type: String, reflect: true },
    confirmLabel: { type: String, attribute: 'confirm-label' },
    cancelLabel: { type: String, attribute: 'cancel-label' },
    hideCloseButton: { type: Boolean, attribute: 'hide-close-button' },
  }

  declare open: boolean
  declare heading: string
  declare message: string
  declare type: string
  declare size: string
  declare confirmLabel: string
  declare cancelLabel: string
  declare hideCloseButton: boolean

  _dialogRef: Ref<HTMLDialogElement>

  static override styles = [
    buttonStyles,
    css`
    /* The <dialog> shows in the top layer, above the page and any popover */
    :host {
      display: contents;
    }

    .modal-content {
      background: var(--modal-bg, white);
      color: var(--text-color, #1a1a1a);
      border: 1px solid var(--modal-border, transparent);
      border-radius: 8px;
      padding: 0;
      max-width: min(90%, calc(var(--app-width) - 2rem));
      max-height: 90dvh;
      box-shadow: var(--modal-shadow, 0 4px 20px rgba(0, 0, 0, 0.3));
      overflow: hidden;
    }

    .modal-content[open] {
      display: flex;
      flex-direction: column;
    }

    .modal-content::backdrop {
      background-color: var(--modal-backdrop, rgba(0, 0, 0, 0.5));
    }

    /* Size variants */
    :host([size='small']) .modal-content {
      max-width: 400px;
    }

    :host([size='medium']) .modal-content {
      max-width: 600px;
    }

    :host([size='large']) .modal-content {
      max-width: min(900px, 90%, calc(var(--app-width) - 2rem));
    }

    :host([size='fullscreen']) .modal-content {
      max-width: min(95vw, calc(var(--app-width) - 2rem));
      max-height: 95dvh;
      width: min(95vw, calc(var(--app-width) - 2rem));
      height: 95dvh;
    }

    /* Themed like the page header: title and buttons in one centred row */
    .modal-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem 1.5rem 1rem 2rem;
      background-color: var(--header-bg, #2c3e50);
      color: var(--header-text, white);
    }

    .modal-title {
      flex: 1;
      font-size: var(--font-ui);
      font-weight: 600;
      color: inherit;
      margin: 0;
    }

    /* Extra header buttons (slot="header-actions"), just left of the close button */
    .header-actions {
      display: flex;
      gap: 0.75rem;
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
      color: var(--text-secondary, #5f6b6d);
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

    .modal-close:hover {
      color: var(--text-color, #2c3e50);
      background-color: var(--bg-tertiary, #ecf0f1);
      transform: scale(1.05);
    }

    /* On the header band, buttons sit in the row and use the header's colours */
    .modal-header .modal-close,
    ::slotted(button[slot='header-actions']) {
      position: static;
      flex-shrink: 0;
      color: var(--header-text, white);
    }

    .modal-header .modal-close:hover,
    ::slotted(button[slot='header-actions']:hover) {
      color: var(--header-text, white);
      background-color: rgba(255, 255, 255, 0.2);
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

    /* flex-basis auto, not the 0 of "flex: 1": the dialog's height is auto, and Safari then
       sizes it as if the body had no content (a header and a sliver of padding) */
    .modal-body {
      padding: 2rem;
      flex: 1 1 auto;
      min-height: 0;
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

    /* Shared .btn, a little larger */
    .modal-btn {
      padding: 1rem 2rem;
    }

    /* Hide elements based on configuration */
    :host([hide-close-button]) .modal-close {
      display: none;
    }
  `,
  ]

  constructor() {
    super()
    this._dialogRef = createRef()
    this.open = false
    this.heading = ''
    this.message = ''
    this.type = 'custom'
    this.size = 'medium'
    this.confirmLabel = 'Confirm'
    this.cancelLabel = 'Cancel'
    this.hideCloseButton = false
  }

  override updated(changed: PropertyValues<this>): void {
    if (!changed.has('open')) return
    const dialog = this._dialog()
    if (!dialog) return
    if (this.open && !dialog.open) dialog.showModal()
    if (!this.open && dialog.open) dialog.close()
  }

  _dialog(): HTMLDialogElement | undefined {
    return this._dialogRef.value
  }

  override render() {
    return html`
      <dialog
        ${ref(this._dialogRef)}
        class="modal-content ${this._hasHeader() ? '' : 'headerless'}"
        part="content"
        aria-labelledby=${this.heading ? 'modal-title' : nothing}
        @click=${this._handleBackdropClick}
        @close=${this._handleDialogClose}
      >
        ${this._hasHeader() ? this._renderHeader() : this._renderCloseButton(true)}

        <div class="modal-body" part="body">
          ${this.message ? html`<p class="modal-message">${this.message}</p>` : ''}
          <slot></slot>
        </div>

        ${this._renderActions()}
      </dialog>
    `
  }

  _hasHeader(): boolean {
    return Boolean(this.heading || this.querySelector('[slot="header"]'))
  }

  _renderCloseButton(floating = false) {
    if (this.hideCloseButton) return ''
    return html`
      <button
        class="modal-close ${floating ? 'floating' : ''}"
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
          ${this._renderCloseButton()}
        </div>
      `
    }

    // (Only called when there is a header or a heading)
    return html`
      <div class="modal-header" part="header">
        <h2 class="modal-title" id="modal-title" part="title">${this.heading}</h2>
        <div class="header-actions" part="header-actions">
          <slot name="header-actions"></slot>
        </div>
        ${this._renderCloseButton()}
      </div>
    `
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
            class="btn modal-btn modal-btn-cancel"
            part="cancel-button"
            @click=${this._handleCancel}
          >
            ${this.cancelLabel}
          </button>
          <button
            class="btn primary modal-btn modal-btn-confirm"
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

  /** A click on the dialog itself, outside its content, is on the backdrop */
  _handleBackdropClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    if (!inside) this.close()
  }

  /** The dialog closed itself (Esc), rather than through close() */
  _handleDialogClose() {
    if (this.open) this.close()
  }

  _handleConfirm() {
    this.dispatchEvent(new ModalConfirmEvent())
    this.close()
  }

  _handleCancel() {
    this.dispatchEvent(new ModalCancelEvent())
    this.close()
  }

  // Public API
  close(): void {
    this.open = false
    this.dispatchEvent(new ModalCloseEvent())
  }

  show(): void {
    this.open = true
  }

  /**
   * Show the modal and wait for an answer (type='confirm').
   * @returns true if confirmed, false if cancelled or closed
   */
  ask(): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let confirmed = false
      const onConfirm = () => {
        confirmed = true
      }
      // Confirm and cancel both close the modal, so close settles every outcome
      const onClose = () => {
        this.removeEventListener(ModalConfirmEvent.type, onConfirm)
        this.removeEventListener(ModalCloseEvent.type, onClose)
        resolve(confirmed)
      }
      this.addEventListener(ModalConfirmEvent.type, onConfirm)
      this.addEventListener(ModalCloseEvent.type, onClose)
      this.show()
    })
  }

  toggle(): void {
    this.open = !this.open
  }
}

// Define the custom element
customElements.define('app-modal', AppModal)

declare global {
  interface HTMLElementTagNameMap {
    'app-modal': AppModal
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [ModalConfirmEvent.type]: ModalConfirmEvent
    [ModalCancelEvent.type]: ModalCancelEvent
    [ModalCloseEvent.type]: ModalCloseEvent
  }
}
