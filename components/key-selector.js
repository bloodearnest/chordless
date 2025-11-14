import { LitElement, html, css } from 'lit';

/**
 * KeySelector component
 *
 * Displays the current key and lets the user select a new key with
 * +/- offset indicators and original-key highlighting.
 *
 * Uses shadow DOM with encapsulated styles.
 * Uses native Popover API for the dropdown.
 *
 * Properties:
 * @property {string} label - Label text (default: 'Key')
 * @property {string} value - Currently selected key
 * @property {Array<string>} keys - Available keys to select from
 * @property {string} originalKey - Original key of the song (marked with *)
 * @property {boolean} editMode - Whether component is in edit mode (affects styling)
 *
 * Events:
 * @fires key-change - When a new key is selected (detail: {value: string})
 */
export class KeySelector extends LitElement {
    static properties = {
        label: { type: String },
        value: { type: String },
        keys: { type: Array },
        originalKey: { type: String },
        editMode: { type: Boolean }
    };

    static styles = css`
        :host {
            display: inline-flex;
        }

        .key-display-wrapper {
            display: flex;
            align-items: center;
            gap: 0.3rem;
        }

        .meta-label {
            opacity: 0.8;
            font-size: 1.3rem;
            color: var(--header-text, #fff);
        }

        .key-selector {
            background: transparent;
            color: var(--header-text, #fff);
            border: 2px solid transparent;
            border-radius: 6px;
            padding: 0.3rem 0.5rem;
            font-size: 1.3rem;
            cursor: default;
            transition: all 0.2s;
            font-family: inherit;
            min-width: 3rem;
            text-align: center;
            pointer-events: none;
            white-space: nowrap;
        }

        /* In edit mode, make it look and behave like a button */
        :host([edit-mode]) .key-selector {
            background-color: rgba(255, 255, 255, 0.2);
            border-color: rgba(255, 255, 255, 0.3);
            cursor: pointer;
            pointer-events: auto;
        }

        :host([edit-mode]) .key-selector:hover {
            background-color: rgba(255, 255, 255, 0.3);
            border-color: rgba(255, 255, 255, 0.5);
        }

        :host([edit-mode]) .key-selector:focus {
            outline: none;
            background-color: rgba(255, 255, 255, 0.3);
            border-color: var(--header-text, #fff);
        }

        /* Popover container */
        .key-popover {
            background-color: var(--header-bg, #2c3e50);
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 8px;
            padding: 0.5rem;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            max-height: 80vh;
            overflow-y: auto;
            margin: 0;
            inset: unset;
        }

        .key-popover::backdrop {
            background-color: rgba(0, 0, 0, 0.3);
        }

        /* Key options list */
        .key-options-list {
            display: flex;
            flex-direction: column;
            gap: 0;
        }

        /* Individual key option */
        .key-option-item {
            background-color: transparent;
            color: var(--header-text, #fff);
            border: none;
            border-radius: 6px;
            padding: 0.75rem 1rem;
            font-size: 1.4rem;
            cursor: pointer;
            transition: background-color 0.2s;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
            font-family: inherit;
            text-align: left;
            width: 100%;
            white-space: nowrap;
        }

        .key-option-item:hover {
            background-color: rgba(255, 255, 255, 0.2);
        }

        .key-option-item.selected {
            background-color: rgba(255, 255, 255, 0.3);
        }

        .key-option-item .key-name {
            flex: 0 0 auto;
        }

        .key-option-item .key-offset {
            flex: 0 0 auto;
            font-size: 1rem;
            color: rgba(255, 255, 255, 0.5);
        }
    `;

    constructor() {
        super();
        this.label = 'Key';
        this.value = '-';
        this.keys = [];
        this.originalKey = '';
        this.editMode = false;
        // Generate unique ID for popover
        this._popoverId = `key-popover-${Math.random().toString(36).substr(2, 9)}`;
    }

    connectedCallback() {
        super.connectedCallback();
        // Reflect edit-mode as attribute for CSS selectors
        this._updateEditModeAttribute();
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        if (changedProperties.has('editMode')) {
            this._updateEditModeAttribute();
        }

        // Setup popover positioning after render
        if (changedProperties.has('keys') || changedProperties.has('value')) {
            this._setupPopoverPositioning();
        }
    }

    _updateEditModeAttribute() {
        if (this.editMode) {
            this.setAttribute('edit-mode', '');
        } else {
            this.removeAttribute('edit-mode');
        }
    }

    _setupPopoverPositioning() {
        const button = this.shadowRoot.querySelector('.key-selector');
        const popover = this.shadowRoot.querySelector('.key-popover');

        if (button && popover) {
            // Position popover when it opens
            const toggleHandler = (e) => {
                if (e.newState === 'open') {
                    const buttonRect = button.getBoundingClientRect();
                    popover.style.top = `${buttonRect.bottom + 4}px`;
                    popover.style.left = `${buttonRect.left}px`;
                }
            };

            // Remove old listener if exists
            popover.removeEventListener('toggle', toggleHandler);
            popover.addEventListener('toggle', toggleHandler);
        }
    }

    _handleSelection(key) {
        if (!key || key === this.value) return;

        // Close the popover
        const popover = this.shadowRoot.querySelector('.key-popover');
        if (popover) {
            popover.hidePopover();
        }

        // Dispatch event
        this.dispatchEvent(new CustomEvent('key-change', {
            detail: { value: key },
            bubbles: true,
            composed: true
        }));
    }

    _renderOptions() {
        if (!this.keys || this.keys.length === 0) {
            return html``;
        }

        const currentIndex = this.keys.indexOf(this.value);
        return this.keys.map((key, index) => {
            const positionOffset = currentIndex === -1 ? 0 : currentIndex - index;
            const offsetText = positionOffset === 0 ? '' : `${positionOffset > 0 ? '+' : '-'}${Math.abs(positionOffset)}`;
            const keyText = key === this.originalKey ? `${key}*` : key;
            const isSelected = key === this.value;

            return html`
                <button
                    class="key-option-item ${isSelected ? 'selected' : ''}"
                    @click=${() => this._handleSelection(key)}
                    type="button"
                >
                    <span class="key-name">${keyText}</span>
                    <span class="key-offset">${offsetText}</span>
                </button>
            `;
        });
    }

    render() {
        const displayValue = this.value || '-';
        return html`
            <div class="key-display-wrapper">
                ${this.label ? html`<label class="meta-label">${this.label}:</label>` : ''}
                <button
                    class="key-selector"
                    popovertarget=${this._popoverId}
                    type="button"
                >
                    <span>${displayValue}</span>
                </button>
                <div id=${this._popoverId} class="key-popover" popover>
                    <div class="key-options-list">
                        ${this._renderOptions()}
                    </div>
                </div>
            </div>
        `;
    }
}

customElements.define('key-selector', KeySelector);
