import { LitElement, html, css } from 'lit';

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
        state: { type: String, reflect: true }
    };

    constructor() {
        super();
        this.message = '';
        this.detail = '';
        this.state = 'info';
    }

    static styles = css`
        :host {
            display: block;
            padding: 2rem 1rem;
            text-align: center;
            color: #2c3e50;
            font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }

        :host([state="loading"]) {
            color: #95a5a6;
        }

        :host([state="empty"]) {
            color: #7f8c8d;
        }

        :host([state="error"]) {
            color: #e74c3c;
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
            border: 3px solid rgba(0, 0, 0, 0.1);
            border-top-color: currentColor;
            animation: spin 0.8s linear infinite;
        }

        .message {
            font-size: 1.6rem;
            font-weight: 600;
            margin: 0 0 0.6rem;
        }

        .detail {
            font-size: 1.4rem;
            color: rgba(44, 62, 80, 0.85);
            margin: 0;
        }

        :host([state="loading"]) .detail,
        :host([state="empty"]) .detail {
            color: rgba(127, 140, 141, 0.95);
        }

        :host([state="error"]) .detail {
            color: rgba(231, 76, 60, 0.9);
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
    `;

    renderSpinner() {
        if (this.state !== 'loading') return null;
        return html`<div class="spinner" role="presentation" aria-hidden="true"></div>`;
    }

    render() {
        const role = this.state === 'error' ? 'alert' : 'status';
        const ariaLive = this.state === 'loading' ? 'polite' : 'off';

        return html`
            <div class="status-card" role=${role} aria-live=${ariaLive}>
                ${this.renderSpinner()}
                ${this.message ? html`<p class="message">${this.message}</p>` : null}
                ${this.detail ? html`<p class="detail">${this.detail}</p>` : null}
                <slot></slot>
            </div>
        `;
    }
}

customElements.define('status-message', StatusMessage);
