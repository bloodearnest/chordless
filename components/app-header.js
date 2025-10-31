import { LitElement, html, css } from 'lit';

/**
 * AppHeader Component
 *
 * A flexible header component that adapts to different page contexts.
 *
 * Properties:
 * @property {String} title - The main title text to display
 * @property {Boolean} showEditToggle - Whether to show the edit mode toggle button
 * @property {Boolean} showInfoButton - Whether to show the info button
 * @property {Boolean} editMode - Current edit mode state (for styling the toggle button)
 *
 * Slots:
 * @slot controls - Center section for page-specific controls (key selector, font controls, etc.)
 *
 * Events:
 * @fires edit-mode-toggle - When edit toggle button is clicked
 * @fires info-click - When info button is clicked
 * @fires nav-menu-click - When nav menu button is clicked
 *
 * CSS Parts:
 * @csspart header - The main header element
 * @csspart nav-button - The navigation menu button
 * @csspart title - The title text element
 * @csspart edit-toggle - The edit mode toggle button
 * @csspart info-button - The info button
 */
export class AppHeader extends LitElement {
    static properties = {
        title: { type: String },
        showEditToggle: { type: Boolean, attribute: 'show-edit-toggle' },
        showInfoButton: { type: Boolean, attribute: 'show-info-button' },
        editMode: { type: Boolean, reflect: true }
    };

    static styles = css`
        :host {
            display: block;
        }

        header {
            background-color: var(--header-bg, #3498db);
            color: var(--header-text, white);
            padding: 0.5rem 1.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
            gap: 1.5rem;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            flex: 1;
            min-width: 0;
        }

        .nav-menu-button {
            background: none;
            border: none;
            color: var(--header-text, white);
            cursor: pointer;
            padding: 0.5rem;
            margin-right: 0.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s, background-color 0.2s;
            border-radius: 4px;
            min-width: 44px;
            min-height: 44px;
        }

        .nav-menu-button:hover {
            background-color: rgba(255, 255, 255, 0.15);
            transform: scale(1.05);
        }

        .nav-menu-button:active {
            transform: scale(0.95);
        }

        .title {
            font-size: 1.4rem;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: opacity 0.2s ease-in-out;
        }

        .header-center {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            flex: 0 0 auto;
            justify-content: flex-end;
        }

        ::slotted(.header-controls-slot) {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .icon-button {
            background: none;
            border: 2px solid var(--header-text, white);
            color: var(--header-text, white);
            width: 2.5rem;
            height: 2.5rem;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 1.3rem;
            font-weight: bold;
            transition: all 0.2s;
        }

        .icon-button:hover {
            background-color: rgba(255, 255, 255, 0.2);
            transform: scale(1.05);
        }

        .edit-toggle.active {
            background-color: var(--button-bg, white);
            border-color: var(--button-bg, white);
            color: var(--header-bg, #3498db);
            box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.3);
        }

        .edit-toggle.active:hover {
            background-color: rgba(255, 255, 255, 0.9);
            border-color: rgba(255, 255, 255, 0.9);
            transform: scale(1.05);
        }
    `;

    constructor() {
        super();
        this.title = '';
        this.showEditToggle = false;
        this.showInfoButton = false;
        this.editMode = false;
    }

    connectedCallback() {
        super.connectedCallback();
        console.log('[AppHeader] Connected with props:', {
            showEditToggle: this.showEditToggle,
            showInfoButton: this.showInfoButton,
            editMode: this.editMode
        });
    }

    render() {
        return html`
            <header part="header">
                <div class="header-left">
                    <button
                        class="nav-menu-button"
                        part="nav-button"
                        @click=${this._handleNavMenuClick}
                        aria-label="Navigation menu"
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </button>
                    <div class="title" part="title">${this.title}</div>
                </div>

                <div class="header-center">
                    <slot name="controls"></slot>
                </div>

                <div class="header-right">
                    ${this.showEditToggle ? html`
                        <button
                            class="icon-button edit-toggle ${this.editMode ? 'active' : ''}"
                            part="edit-toggle"
                            @click=${this._handleEditToggle}
                            aria-label="Toggle edit mode"
                        >
                            ✎
                        </button>
                    ` : ''}

                    ${this.showInfoButton ? html`
                        <button
                            class="icon-button info-button"
                            part="info-button"
                            @click=${this._handleInfoClick}
                            aria-label="Information"
                        >
                            i
                        </button>
                    ` : ''}
                </div>
            </header>
        `;
    }

    _handleNavMenuClick(e) {
        this.dispatchEvent(new CustomEvent('nav-menu-click', {
            bubbles: true,
            composed: true
        }));
    }

    _handleEditToggle(e) {
        this.dispatchEvent(new CustomEvent('edit-mode-toggle', {
            bubbles: true,
            composed: true
        }));
    }

    _handleInfoClick(e) {
        this.dispatchEvent(new CustomEvent('info-click', {
            bubbles: true,
            composed: true
        }));
    }
}

// Define the custom element
customElements.define('app-header', AppHeader);
