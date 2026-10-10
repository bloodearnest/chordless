import type { ReactiveController, ReactiveControllerHost } from 'lit'
import { createRef } from 'lit/directives/ref.js'

/**
 * A <dialog> used as a popup beside its trigger: a menu, a settings panel, a list
 * of options. Shown as a modal dialog, so it is in the top layer (above everything,
 * whatever clips or stacks the page), takes focus and gives it back, closes on Esc,
 * and has a ::backdrop; the page behind it is inert. Dialogs stack, so a popup can
 * open another (a picker inside the settings) or a confirmation.
 *
 * Clicking the backdrop closes it. That is done here rather than left to the
 * browser's light dismiss for popovers, which does nothing for a tap outside on
 * iOS and iPadOS before 18.3.
 *
 * A reactive controller: it re-renders its host when it opens and closes.
 *
 *   #popup = new DialogPopup(this, { position: dialog => … })
 *
 *   render() {
 *     return html`
 *       <dialog ${ref(this.#popup.ref)} aria-label="Menu"
 *         @click=${this.#popup.onClick} @close=${this.#popup.onClose}>…</dialog>`
 *   }
 *
 * Style the dialog to reset the browser's own (margin, inset, border, padding,
 * colours); position it with fixed top and left, set by `position`.
 */
export class DialogPopup implements ReactiveController {
  /** Put it on the <dialog>: ${ref(popup.ref)} */
  ref = createRef<HTMLDialogElement>()

  #host: ReactiveControllerHost
  #position: ((dialog: HTMLDialogElement) => void) | undefined

  /**
   * @param options.position places the dialog, called as it opens (it can then be measured)
   */
  constructor(
    host: ReactiveControllerHost,
    { position }: { position?: (dialog: HTMLDialogElement) => void } = {}
  ) {
    this.#host = host
    this.#position = position
    host.addController(this)
  }

  /** The <dialog>, once rendered */
  get element(): HTMLDialogElement | undefined {
    return this.ref.value
  }

  get isOpen(): boolean {
    return this.element?.open ?? false
  }

  show() {
    const dialog = this.element
    if (!dialog?.isConnected || dialog.open) return
    dialog.showModal()
    // It is open now, so it has a size to place by, and nothing was painted before this
    this.#position?.(dialog)
    this.#host.requestUpdate()
  }

  close() {
    if (this.isOpen) this.element?.close()
  }

  toggle() {
    if (this.isOpen) this.close()
    else this.show()
  }

  /** @click on the dialog: a click on the backdrop closes it */
  onClick = (event: MouseEvent) => {
    const dialog = this.element
    // Clicks inside land on what they hit; the dialog itself is hit by its padding and backdrop
    if (!dialog || event.target !== dialog) return
    const box = dialog.getBoundingClientRect()
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    if (!inside) dialog.close()
  }

  /** @close on the dialog (it closed itself: Esc, or close()) */
  onClose = () => {
    this.#host.requestUpdate()
  }

  hostDisconnected() {
    this.close()
  }
}
