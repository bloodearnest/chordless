import { css, html, LitElement } from 'lit'

/**
 * StatusMessage component
 *
 * Displays centered feedback for loading, empty, info, or error states.
 * Provides a consistent layout plus optional detail text and slots for actions.
 */
export class StatusMessage extends LitElement {
  static properties = {
    message: { type: String },
    detail: { type: String },
    state: { type: String, reflect: true },
  }

  constructor() {
    super()
    this.message = ''
    this.detail = ''
    this.state = 'info'
  }

  static styles = css`
    :host {
      display: block;
      padding: 2rem 1rem;
      text-align: center;
      color: var(--text-color, #1a1a1a);
      font-family: var(
        --font-family,
        -apple-system,
        BlinkMacSystemFont,
        'Segoe UI',
        Roboto,
        sans-serif
      );
    }

    :host([state='loading']) {
      color: var(--text-tertiary, #95a5a6);
    }

    :host([state='empty']) {
      color: var(--text-secondary, #7f8c8d);
    }

    :host([state='error']) {
      color: var(--color-danger, #e74c3c);
    }

    .status-card {
      max-width: 560px;
      margin: 0 auto;
    }

    .spinner {
      width: 32px;
      height: 32px;
      margin: 0 auto 1.5rem;
      border-radius: 50%;
      border: 3px solid var(--tint-border);
      border-top-color: currentColor;
      animation: spin 0.8s linear infinite;
    }

    .message {
      font-size: var(--font-ui);
      font-weight: 600;
      margin: 0 0 0.6rem;
    }

    /* In the message's colour, a little softer */
    .detail {
      font-size: var(--font-ui);
      opacity: 0.9;
      margin: 0;
    }

    ::slotted(*) {
      margin-top: 1.5rem;
    }

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
  `

  renderSpinner() {
    if (this.state !== 'loading') return null
    return html`<div class="spinner" role="presentation" aria-hidden="true"></div>`
  }

  render() {
    const role = this.state === 'error' ? 'alert' : 'status'
    const ariaLive = this.state === 'loading' ? 'polite' : 'off'

    return html`
      <div class="status-card" role=${role} aria-live=${ariaLive}>
        ${this.renderSpinner()}
        ${this.message ? html`<p class="message">${this.message}</p>` : null}
        ${this.detail ? html`<p class="detail">${this.detail}</p>` : null}
        <slot></slot>
      </div>
    `
  }
}

customElements.define('status-message', StatusMessage)
