import { LitElement, html, css } from 'lit';

/**
 * KeySelector component
 *
 * Displays the current key and lets the user select a new key with
 * +/- offset indicators and original-key highlighting.
 */
export class KeySelector extends LitElement {
    static properties = {
        label: { type: String },
        value: { type: String },
        keys: { type: Array },
        originalKey: { type: String },
        open: { type: Boolean, reflect: true }
    };

    constructor() {
        super();
        this.label = 'Key';
        this.value = '-';
        this.keys = [];
        this.originalKey = '';
        this.open = false;

        this._outsideClickHandler = (event) => {
            if (!this.open) return;
            if (!this.shadowRoot) return;
            if (event.composedPath().includes(this.shadowRoot.host)) return;
            this.open = false;
        };
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('click', this._outsideClickHandler, true);
    }

    disconnectedCallback() {
        window.removeEventListener('click', this._outsideClickHandler, true);
        super.disconnectedCallback();
    }

    static styles = css`
        :host {
            display: inline-flex;
            align-items: center;
            gap: 0.8rem;
            position: relative;
            font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }

        .meta-label {
            font-size: 1.2rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #95a5a6;
        }

        .key-selector-btn {
            min-width: 64px;
            padding: 0.8rem 1.4rem;
            border-radius: 999px;
            border: 2px solid transparent;
            background: rgba(236, 240, 241, 0.4);
            color: inherit;
            font-size: 1.4rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s, border-color 0.2s;
        }

        .key-selector-btn:hover,
        :host([open]) .key-selector-btn {
            background: rgba(236, 240, 241, 0.9);
            border-color: rgba(52, 152, 219, 0.4);
        }

        .popover {
            position: absolute;
            top: calc(100% + 0.8rem);
            left: 0;
            width: max-content;
            min-width: 160px;
            z-index: 10;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 18px 30px rgba(0, 0, 0, 0.18);
            padding: 0.6rem;
            display: none;
        }

        :host([open]) .popover {
            display: block;
        }

        .option {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border: none;
            background: transparent;
            color: inherit;
            font-size: 1.4rem;
            padding: 0.6rem 1rem;
            border-radius: 8px;
            cursor: pointer;
        }

        .option:hover,
        .option.selected {
            background: rgba(236, 240, 241, 0.7);
        }

        .key-name {
            font-weight: 600;
        }

        .key-offset {
            font-size: 1.2rem;
            color: #95a5a6;
        }
    `;

    toggleDropdown(event) {
        event?.stopPropagation();
        this.open = !this.open;
    }

    handleSelection(key) {
        this.open = false;
        if (!key || key === this.value) return;
        this.dispatchEvent(new CustomEvent('key-change', {
            detail: { value: key },
            bubbles: true,
            composed: true
        }));
    }

    renderOptionsList() {
        if (!this.keys || this.keys.length === 0) {
            return html`<div class="option" disabled>No keys</div>`;
        }

        const currentIndex = this.keys.indexOf(this.value);
        return this.keys.map((key, index) => {
            const offset = currentIndex === -1 ? 0 : currentIndex - index;
            const offsetText = offset === 0 ? '' : `${offset > 0 ? '+' : '-'}${Math.abs(offset)}`;
            const label = key === this.originalKey ? `${key}*` : key;
            return html`
                <button
                    class="option ${key === this.value ? 'selected' : ''}"
                    @click=${() => this.handleSelection(key)}
                    type="button"
                    role="option"
                    aria-selected=${key === this.value}
                >
                    <span class="key-name">${label}</span>
                    <span class="key-offset">${offsetText}</span>
                </button>
            `;
        });
    }

    render() {
        const displayValue = this.value || '-';
        return html`
            ${this.label ? html`<span class="meta-label">${this.label}</span>` : null}
            <button
                class="key-selector-btn"
                @click=${(event) => this.toggleDropdown(event)}
                aria-haspopup="listbox"
                aria-expanded=${this.open ? 'true' : 'false'}
                type="button"
            >
                ${displayValue}
            </button>
            <div class="popover" role="listbox">
                ${this.renderOptionsList()}
            </div>
        `;
    }
}

customElements.define('key-selector', KeySelector);
