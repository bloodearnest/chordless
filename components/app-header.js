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
 * @fires header-expand-toggle - When header expand toggle is clicked (detail: {expanded: boolean})
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
        showShareButton: { type: Boolean, attribute: 'show-share-button' },
        editMode: { type: Boolean, reflect: true },
        disableAnimation: { type: Boolean, attribute: 'disable-animation' },
        expanded: { type: Boolean, reflect: true }
    };

    static styles = css`
        :host {
            display: block;
        }

        header {
            background-color: var(--header-bg, #3498db);
            color: var(--header-text, white);
            padding: 0.5rem 0.5rem;
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
            gap: 0.5rem;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
            min-width: 0;
            overflow: hidden;
            transition: height 0.3s ease-in-out;
        }

        /* Larger padding and gap on tablet/desktop */
        @media (min-width: 48rem) {
            header {
                padding: 0.5rem 1.5rem;
                gap: 1.5rem;
                flex-wrap: nowrap;
            }
        }

        .header-row-1 {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            flex: 1;
            min-width: 0;
        }

        .header-row-2 {
            display: flex;
            align-items: center;
            gap: 0.75rem;
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
            font-size: calc(1.4rem * var(--font-scale, 1));
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            transition: opacity 0.3s ease-in-out;
        }

        .title.fade-out {
            opacity: 0;
        }

        .header-center {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            flex: 0 0 auto;
            justify-content: flex-end;
            transition: opacity 0.3s ease-in-out;
        }

        .header-center.fade-out {
            opacity: 0;
        }

        ::slotted(.header-controls-slot) {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            transition: opacity 0.3s ease-in-out;
            flex-wrap: wrap;
        }

        /* Force visibility of slotted controls when expanded on mobile */
        @media (max-width: 47.99rem) {
            :host([expanded]) ::slotted(.header-controls-slot) {
                display: flex !important;
                visibility: visible !important;
                gap: 0.2rem !important;
                flex-wrap: nowrap !important;
            }

            :host([expanded]) ::slotted(.header-controls-slot > *) {
                display: flex !important;
                visibility: visible !important;
                flex-shrink: 0 !important;
            }
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        /* Mobile: two-row layout when expanded */
        @media (max-width: 47.99rem) {
            /* Row 1: always visible */
            .header-row-1 {
                width: 100%;
            }

            .header-row-1 .title {
                flex: 1;
                min-width: 0;
            }

            /* Row 2: hidden by default */
            .header-row-2 {
                display: none;
            }

            /* Always show expand toggle on mobile */
            .header-row-1 .expand-toggle {
                display: flex !important;
            }

            /* When expanded: show row 2 */
            :host([expanded]) .header-row-2 {
                display: flex;
                width: 100%;
                justify-content: flex-end;
                gap: 0.2rem;
                flex-wrap: nowrap;
                overflow-x: auto;
                -webkit-overflow-scrolling: touch;
            }

            /* Make buttons smaller on mobile */
            :host([expanded]) .icon-button {
                width: 1.8rem;
                height: 1.8rem;
                font-size: 0.9rem;
                flex-shrink: 0;
                border-width: 1px;
            }
        }

        /* Tablet/desktop: single row, hide expand button */
        @media (min-width: 48rem) {
            .header-row-1 {
                flex: 0 0 auto;
            }

            .header-row-1 .expand-toggle {
                display: none !important;
            }

            .header-row-2 {
                display: flex;
                justify-content: flex-end;
                flex: 1;
            }
        }

        .icon-button {
            background: none;
            border: 2px solid var(--header-text, white);
            color: var(--header-text, white);
            width: calc(2.5rem * var(--font-scale, 1));
            height: calc(2.5rem * var(--font-scale, 1));
            min-width: calc(2.5rem * var(--font-scale, 1));
            min-height: calc(2.5rem * var(--font-scale, 1));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: calc(1.3rem * var(--font-scale, 1));
            font-weight: bold;
            transition: all 0.2s;
            flex-shrink: 0;
        }

        .expand-toggle {
            display: flex;
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
        this.showShareButton = false;
        this.editMode = false;
        this.disableAnimation = false;
        this.expanded = false;
        this._previousTitle = '';
        this._animating = false;
        this._displayTitle = ''; // The title actually shown in the UI
        this._pendingTitle = null; // Title waiting to be shown after fade-out
    }

    connectedCallback() {
        super.connectedCallback();
        // Initialize display title
        this._displayTitle = this.title;
        this._previousTitle = this.title;
        console.log('[AppHeader] Connected with props:', {
            showEditToggle: this.showEditToggle,
            showInfoButton: this.showInfoButton,
            editMode: this.editMode
        });
    }

    updated(changedProperties) {
        super.updated(changedProperties);

        // Cache DOM element references after each render
        this._cachedTitleEl = this.shadowRoot?.querySelector('.title');
        this._cachedCenterEl = this.shadowRoot?.querySelector('.header-center');

        // Handle title changes
        if (changedProperties.has('title') && this.title !== this._previousTitle) {
            if (this.disableAnimation) {
                // No animation - update immediately
                this._displayTitle = this.title;
                this._previousTitle = this.title;
                this.requestUpdate();
            } else if (!this._animating) {
                // Animate the transition
                this._animateTransition();
            } else {
                // Animation in progress - queue this update
                this._pendingTitle = this.title;
            }
        }
    }

    async _animateTransition() {
        if (this._animating) return;
        this._animating = true;

        // Use cached references for initial fade-out
        const titleEl = this._cachedTitleEl;
        const centerEl = this._cachedCenterEl;

        // Fade out old content
        titleEl?.classList.add('fade-out');
        centerEl?.classList.add('fade-out');

        // Wait for fade-out to complete
        await new Promise(resolve => setTimeout(resolve, 300));

        // Update the displayed title
        this._displayTitle = this.title;
        this._previousTitle = this.title;
        this.requestUpdate();

        // Wait for re-render
        await this.updateComplete;

        // Get fresh references after re-render
        const newTitleEl = this.shadowRoot?.querySelector('.title');
        const newCenterEl = this.shadowRoot?.querySelector('.header-center');

        // Fade in new content
        requestAnimationFrame(() => {
            newTitleEl?.classList.remove('fade-out');
            newCenterEl?.classList.remove('fade-out');
        });

        // Wait for fade-in to complete
        await new Promise(resolve => setTimeout(resolve, 300));

        this._animating = false;

        // Handle any pending updates
        if (this._pendingTitle && this._pendingTitle !== this.title) {
            this._pendingTitle = null;
            this._animateTransition();
        }
    }

    // Public method to update without animation
    setTitleInstant(newTitle) {
        this.disableAnimation = true;
        this.title = newTitle;
        // Re-enable after a tick
        setTimeout(() => {
            this.disableAnimation = false;
        }, 0);
    }

    render() {
        return html`
            <header part="header">
                <!-- Row 1: Always visible on mobile -->
                <div class="header-row-1">
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
                    <div class="title" part="title">${this._displayTitle}</div>
                    <button
                        class="icon-button expand-toggle ${this.expanded ? 'active' : ''}"
                        @click=${this._handleExpandToggle}
                        aria-label="Toggle header controls"
                    >
                        ${this.expanded ? '▲' : '▼'}
                    </button>
                </div>

                <!-- Row 2: Controls (hidden on mobile unless expanded) -->
                <div class="header-row-2">
                    <slot name="controls"></slot>

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

                    ${this.showShareButton ? html`
                        <button
                            class="icon-button share-button"
                            part="share-button"
                            @click=${this._handleShareClick}
                            aria-label="Share setlist"
                        >
                            ↗
                        </button>
                    ` : ''}
                </div>
            </header>
        `;
    }

    _handleNavMenuClick() {
        this.dispatchEvent(new CustomEvent('nav-menu-click', {
            bubbles: true,
            composed: true
        }));
    }

    _handleEditToggle() {
        this.dispatchEvent(new CustomEvent('edit-mode-toggle', {
            bubbles: true,
            composed: true
        }));
    }

    _handleInfoClick() {
        this.dispatchEvent(new CustomEvent('info-click', {
            bubbles: true,
            composed: true
        }));
    }

    _handleShareClick() {
        this.dispatchEvent(new CustomEvent('share-click', {
            bubbles: true,
            composed: true
        }));
    }

    _handleExpandToggle() {
        this.expanded = !this.expanded;
        console.log('[AppHeader] Expanded state:', this.expanded);

        // Emit custom event instead of direct DOM manipulation
        this.dispatchEvent(new CustomEvent('header-expand-toggle', {
            detail: { expanded: this.expanded },
            bubbles: true,
            composed: true
        }));
    }
}

// Define the custom element
customElements.define('app-header', AppHeader);
