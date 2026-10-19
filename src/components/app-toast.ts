import { css, html, LitElement, nothing } from 'lit'
import './icon.ts'
import { buttonStyles } from './shared-styles.ts'

/** How long an info toast stays (an error stays until it is dismissed) */
const INFO_MS = 5000
/** How long one that offers something stays: time to read it and decide */
const OFFER_MS = 15000

/** What a toast says, and can do */
export interface ToastOptions {
  /** An error stays until dismissed, and is announced at once; info goes by itself */
  kind?: 'error' | 'info'
  /** The reason, for whoever wants it: behind a "Details" toggle */
  details?: string
  /** One thing to offer, such as trying again; the toast is dismissed when it is pressed */
  action?: { label: string; run: () => void }
}

/**
 * AppToast Component
 *
 * A short message over the page that does not stop what the user is doing: for a failure the
 * page has no place for (a save that did not work). There is one, shown by toast() (js/toast.ts),
 * which makes it when first needed. It is a popover (`popover="manual"`, in the top layer above
 * the page and any dialog) at the bottom of the screen, clear of the safe area, and does not
 * take focus, so the arrow keys and swipes that move through a setlist carry on working.
 * (Behind a modal dialog, which makes the rest of the page inert, it can be seen but not
 * pressed until the dialog is closed.)
 *
 * A new message replaces the one showing; the same message again counts up (×2) instead.
 */
export class AppToast extends LitElement {
  static override properties = {
    _message: { state: true },
    _kind: { state: true },
    _details: { state: true },
    _action: { state: true },
    _count: { state: true },
  }

  declare _message: string
  declare _kind: 'error' | 'info'
  declare _details: string
  declare _action: ToastOptions['action']
  declare _count: number
  _timer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    super()
    this._message = ''
    this._kind = 'info'
    this._details = ''
    this._action = undefined
    this._count = 0
  }

  static override styles = [
    buttonStyles,
    css`
      /* The host is the popover: its UA styles (centred, bordered, with padding) are undone, and
         it is a strip along the bottom that lets clicks through to the page. The bar in it is
         centred by its own margin: the host's margins would lose to a page's resets. */
      :host {
        position: fixed;
        inset: auto 0 max(1rem, env(safe-area-inset-bottom)) 0;
        width: auto;
        height: auto;
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
        color: var(--header-text);
        overflow: visible;
        pointer-events: none;
        font-family: var(--font-family-base);

        /* Slides up as it opens, and down as it goes (a popover is display: none when closed) */
        opacity: 0;
        transform: translateY(1rem);
        transition:
          opacity 0.2s,
          transform 0.2s,
          display 0.2s allow-discrete,
          overlay 0.2s allow-discrete;
      }

      :host(:popover-open) {
        opacity: 1;
        transform: none;
      }

      @starting-style {
        :host(:popover-open) {
          opacity: 0;
          transform: translateY(1rem);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        :host {
          transition: none;
        }
      }

      .toast {
        pointer-events: auto;
        width: fit-content;
        max-width: min(36rem, calc(100% - 2rem));
        margin: 0 auto;
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        padding: 0.5rem 0.5rem 0.5rem 1rem;
        border-radius: 6px;
        border-left: 0.35rem solid var(--color-info);
        background: var(--header-bg);
        box-shadow: var(--modal-shadow);
        font-size: var(--font-ui);
        line-height: 1.35;
      }

      :host([kind='error']) .toast {
        border-left-color: var(--color-danger);
      }

      .body {
        flex: 1;
        min-width: 0;
        padding: 0.6rem 0;
        overflow-wrap: anywhere;
      }

      .count {
        margin-left: 0.4em;
        opacity: 0.75;
        font-variant-numeric: tabular-nums;
      }

      details {
        margin-top: 0.4rem;
        font-size: var(--font-ui-small);
        opacity: 0.85;
      }

      summary {
        cursor: pointer;
      }

      details p {
        margin: 0.3rem 0 0;
        user-select: text;
      }

      /* The buttons sit on the dark bar in both themes, so they are drawn light on it */
      .btn,
      .close {
        color: inherit;
        --tint: color-mix(in srgb, var(--header-text) 12%, transparent);
        --tint-strong: color-mix(in srgb, var(--header-text) 22%, transparent);
      }

      .btn {
        align-self: center;
        padding: 0.5rem 1rem;
        min-height: 2.75rem;
        white-space: nowrap;
      }

      .close {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        /* A big tap target, for a hand holding a tablet */
        width: 2.75rem;
        height: 2.75rem;
        border: none;
        border-radius: 50%;
        background: none;
        cursor: pointer;
      }

      .close:hover {
        background: var(--tint-strong);
      }

      .close:focus-visible,
      summary:focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 2px;
      }
    `,
  ]

  override connectedCallback(): void {
    super.connectedCallback()
    // A popover that only code opens and closes: no light dismiss, no focus taken
    this.popover = 'manual'
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    clearTimeout(this._timer)
  }

  /** Show a message. The same one again as the one showing counts up instead. */
  show(message: string, { kind = 'info', details = '', action }: ToastOptions = {}): void {
    const again = this.isOpen && message === this._message && kind === this._kind
    this._count = again ? this._count + 1 : 1
    this._message = message
    this._kind = kind
    this._details = details
    this._action = action
    this.setAttribute('kind', kind)

    // Opened again, so it is the topmost of the top layer (above a dialog opened since)
    if (this.isOpen) this.hidePopover()
    this.showPopover()

    clearTimeout(this._timer)
    if (kind === 'info') this._timer = setTimeout(() => this.dismiss(), action ? OFFER_MS : INFO_MS)
  }

  get isOpen(): boolean {
    return this.matches(':popover-open')
  }

  dismiss(): void {
    clearTimeout(this._timer)
    if (this.isOpen) this.hidePopover()
  }

  _act(): void {
    const action = this._action
    this.dismiss()
    action?.run()
  }

  override render() {
    return html`
      <div class="toast" role=${this._kind === 'error' ? 'alert' : 'status'}>
        <div class="body">
          <span class="message">${this._message}</span>${
            this._count > 1 ? html`<span class="count">×${this._count}</span>` : nothing
          }
          ${
            this._details
              ? html`<details><summary>Details</summary><p>${this._details}</p></details>`
              : nothing
          }
        </div>
        ${
          this._action
            ? html`<button class="btn" type="button" @click=${this._act}>${this._action.label}</button>`
            : nothing
        }
        <button class="close" type="button" aria-label="Dismiss" @click=${this.dismiss}>
          <app-icon name="close" size="20"></app-icon>
        </button>
      </div>
    `
  }
}

customElements.define('app-toast', AppToast)

declare global {
  interface HTMLElementTagNameMap {
    'app-toast': AppToast
  }
}
