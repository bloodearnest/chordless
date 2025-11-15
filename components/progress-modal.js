import { LitElement, html, css } from 'lit';

/**
 * ProgressModal component
 *
 * Displays a blocking overlay with a title, status message, and progress bar.
 * Exposes helper methods for incremental updates, completion, errors, and closing.
 */
export class ProgressModal extends LitElement {
    static properties = {
        heading: { type: String, attribute: 'heading' },
        message: { type: String },
        progress: { type: Number },
        status: { type: String, reflect: true }
    };

    constructor() {
        super();
        this.heading = 'Processing';
        this.message = 'Working...';
        this.progress = 0;
        this.status = 'in-progress'; // in-progress | complete | error
    }

    static styles = css`
        :host {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.45);
            z-index: 1000;
        }

        .modal {
            background: #ffffff;
            border-radius: 16px;
            padding: 2.5rem;
            max-width: 480px;
            width: min(480px, calc(100vw - 3rem));
            box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
            font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }

        h2 {
            margin: 0 0 1.5rem;
            font-size: 2rem;
            color: #2c3e50;
        }

        .message {
            font-size: 1.5rem;
            color: #2c3e50;
            margin: 0;
        }

        :host([status="error"]) .message {
            color: #e74c3c;
        }

        :host([status="complete"]) .message {
            color: #2ecc71;
        }

        .progress-track {
            margin-top: 1.8rem;
            height: 12px;
            border-radius: 999px;
            background: #ecf0f1;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: var(--color-primary, #3498db);
            width: var(--progress-width, 0%);
            border-radius: inherit;
            transition: width 0.25s ease;
        }

        :host([status="complete"]) .progress-fill {
            background: #2ecc71;
        }

        :host([status="error"]) .progress-fill {
            background: #e74c3c;
        }
    `;

    /**
     * Update the status text and progress bar.
     * @param {{message?: string, current?: number, total?: number, value?: number}} payload
     */
    updateProgress(payload = {}) {
        const { message, current, total, value } = payload;

        if (typeof message === 'string') {
            this.message = message;
        }

        let progressValue = this.progress;
        if (typeof value === 'number') {
            progressValue = value;
        } else if (typeof current === 'number' && typeof total === 'number' && total > 0) {
            progressValue = current / total;
        }

        this.progress = Math.max(0, Math.min(1, progressValue));
        this.status = 'in-progress';
    }

    /**
     * Mark the modal as complete and optionally update the message.
     * @param {string} message
     */
    setComplete(message) {
        if (message) {
            this.message = message;
        }
        this.progress = 1;
        this.status = 'complete';
    }

    /**
     * Display an error state with the supplied message.
     * @param {string} message
     */
    setError(message) {
        this.message = message;
        this.status = 'error';
    }

    /**
     * Close and remove the modal after an optional delay.
     * @param {number} delayMs
     */
    close(delayMs = 0) {
        if (delayMs > 0) {
            setTimeout(() => this.remove(), delayMs);
        } else {
            this.remove();
        }
    }

    get progressPercent() {
        return Math.round(this.progress * 100);
    }

    render() {
        return html`
            <div class="modal" role="status" aria-live="polite">
                <h2>${this.heading}</h2>
                <p class="message">${this.message}</p>
                <div class="progress-track" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${this.progressPercent}>
                    <div class="progress-fill" style="width: ${this.progressPercent}%;"></div>
                </div>
            </div>
        `;
    }
}

customElements.define('progress-modal', ProgressModal);
