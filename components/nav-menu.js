import { LitElement, html, css } from 'lit';

/**
 * NavMenu Component
 *
 * A navigation menu popover used across the application.
 * Contains links to main sections (Setlists, Songs, Settings, Bookmarklet)
 * and optionally a back button.
 *
 * Properties:
 * @property {Boolean} showBackButton - Whether to show the back button
 * @property {String} backLabel - Label for the back button (default: "Back")
 * @property {String} popoverId - ID for the popover element (default: "nav-menu-popover")
 *
 * Events:
 * @fires back-click - When back button is clicked
 *
 * CSS Parts:
 * @csspart popover - The popover container
 * @csspart nav - The nav element
 * @csspart nav-item - Each navigation item
 * @csspart back-button - The back button
 */
export class NavMenu extends LitElement {
    static properties = {
        showBackButton: { type: Boolean, attribute: 'show-back-button' },
        backLabel: { type: String, attribute: 'back-label' },
        popoverId: { type: String, attribute: 'popover-id' }
    };

    static styles = css`
        :host {
            display: contents;
        }

        * {
            box-sizing: border-box;
        }

        .nav-menu-popover {
            border: none;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            padding: 0;
            background: white;
            min-width: 250px;
            max-width: 250px;
            margin: 0;
            position: fixed;
            inset: unset;
            overflow: hidden;
        }

        .nav-menu-popover::backdrop {
            background-color: transparent;
        }

        .nav-menu {
            display: flex;
            flex-direction: column;
            padding: 0.5rem 0;
            width: 100%;
        }

        .nav-menu-item {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem 1.5rem;
            text-decoration: none;
            color: var(--color-text, #2c3e50);
            background: transparent;
            border: none;
            font-size: 1.4rem;
            font-family: inherit;
            cursor: pointer;
            transition: background-color 0.2s;
            width: 100%;
            text-align: left;
            box-sizing: border-box;
        }

        .nav-menu-item:hover {
            background-color: #ecf0f1;
        }

        .nav-menu-item:active {
            background-color: #d5dbdb;
        }

        .nav-icon {
            flex-shrink: 0;
            color: var(--color-primary, #3498db);
        }

        .back-button {
            margin-bottom: 0.5rem;
            padding-bottom: 1rem;
            position: relative;
        }

        .back-button::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: #ecf0f1;
        }
    `;

    constructor() {
        super();
        this.showBackButton = false;
        this.backLabel = 'Back';
        this.popoverId = 'nav-menu-popover';
        this.triggerButton = null;
    }

    connectedCallback() {
        super.connectedCallback();
        // Set up positioning after the component is rendered
        this.updateComplete.then(() => {
            const popover = this.shadowRoot?.querySelector(`#${this.popoverId}`);
            if (popover) {
                popover.addEventListener('toggle', (e) => {
                    if (e.newState === 'open') {
                        this._positionPopover();
                    }
                });
            }
        });
    }

    // Set the trigger button element for positioning
    setTriggerButton(button) {
        this.triggerButton = button;
    }

    // Position the popover relative to the trigger button
    _positionPopover() {
        const popover = this.shadowRoot?.querySelector(`#${this.popoverId}`);
        if (!popover || !this.triggerButton) return;

        const buttonRect = this.triggerButton.getBoundingClientRect();
        popover.style.top = `${buttonRect.bottom + 4}px`;
        popover.style.left = `${buttonRect.left}px`;
    }

    render() {
        return html`
            <div id="${this.popoverId}" class="nav-menu-popover" part="popover" popover>
                <nav class="nav-menu" part="nav">
                    ${this.showBackButton ? html`
                        <button
                            class="nav-menu-item back-button"
                            part="nav-item back-button"
                            @click=${this._handleBackClick}
                        >
                            <svg class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="19" y1="12" x2="5" y2="12"></line>
                                <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                            <span>${this.backLabel}</span>
                        </button>
                    ` : ''}

                    <a href="/" class="nav-menu-item" part="nav-item">
                        <svg class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <span>Setlists</span>
                    </a>

                    <a href="/songs" class="nav-menu-item" part="nav-item">
                        <svg class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 18V5l12-2v13"></path>
                            <circle cx="6" cy="18" r="3"></circle>
                            <circle cx="18" cy="16" r="3"></circle>
                        </svg>
                        <span>Song Library</span>
                    </a>

                    <a href="/settings" class="nav-menu-item" part="nav-item">
                        <svg class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M12 1v6m0 6v6"></path>
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"></path>
                        </svg>
                        <span>Settings</span>
                    </a>

                    <a href="/bookmarklet" class="nav-menu-item" part="nav-item">
                        <svg class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span>Bookmarklet</span>
                    </a>
                </nav>
            </div>
        `;
    }

    _handleBackClick(e) {
        this.dispatchEvent(new CustomEvent('back-click', {
            bubbles: true,
            composed: true
        }));

        // Close the popover after back is clicked
        this.closePopover();
    }

    // Public API for controlling the popover
    showPopover() {
        const popover = this.shadowRoot?.querySelector(`#${this.popoverId}`);
        popover?.showPopover();
    }

    closePopover() {
        const popover = this.shadowRoot?.querySelector(`#${this.popoverId}`);
        popover?.hidePopover();
    }

    togglePopover() {
        const popover = this.shadowRoot?.querySelector(`#${this.popoverId}`);
        popover?.togglePopover();
    }
}

// Define the custom element
customElements.define('nav-menu', NavMenu);
