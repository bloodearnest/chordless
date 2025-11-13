import { LitElement, html } from 'lit';

const SECTION_STYLES = html`<style>
.song-section-wrapper {
    padding: 0;
    margin: 0 0 0.1rem 0;
    border: 2px solid transparent;
    border-radius: 8px;
    transition: border-color 0.25s ease-in-out, background-color 0.25s ease-in-out;
}

@media (min-width: 48rem) {
    .song-section-wrapper {
        padding: 0.75rem 0.75rem 0.125rem 0.75rem;
        margin: 0.75rem;
        margin-top: 0.125rem;
        margin-bottom: 0.25rem;
    }
}

body.edit-mode .song-section-wrapper,
body.library-edit-mode .song-section-wrapper {
    border-style: dotted;
    border-color: #bdc3c7;
    background-color: #f9f9f9;
}

.song-section-wrapper .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 2rem;
    width: 100%;
}

.song-section-wrapper details.song-section summary.section-label {
    cursor: pointer;
    list-style: none;
    user-select: none;
    margin: 0;
    outline: none;
    -webkit-tap-highlight-color: transparent;
    tap-highlight-color: transparent;
    line-height: 1.6rem;
    padding: 0.2rem 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
}

.song-section-wrapper details.song-section summary.section-label::-webkit-details-marker,
.song-section-wrapper details.song-section summary.section-label:focus,
.song-section-wrapper details.song-section summary.section-label:focus-visible,
.song-section-wrapper details.song-section summary.section-label:active {
    outline: none;
    background: none;
}

.song-section-wrapper .section-title {
    font-size: 1.6rem;
    color: #7f8c8d;
    font-weight: bold;
    font-style: italic;
    white-space: nowrap;
}

.song-section-wrapper .section-content {
    margin-top: 0;
}

.song-section-wrapper .section-controls {
    display: flex;
    flex-direction: row;
    gap: 0.3rem;
    align-items: center;
    margin-left: auto;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease-in-out;
}

body.edit-mode .song-section-wrapper .section-controls,
body.library-edit-mode .song-section-wrapper .section-controls {
    opacity: 1;
    pointer-events: auto;
}

.song-section-wrapper.section-collapsed .section-content,
.song-section-wrapper.section-hidden .section-content {
    display: none;
}

.song-section-wrapper.section-hidden {
    display: none;
}

body.edit-mode .song-section-wrapper.section-hidden,
body.library-edit-mode .song-section-wrapper.section-hidden {
    display: block;
}

body.edit-mode .song-section-wrapper.section-hidden .section-title,
body.library-edit-mode .song-section-wrapper.section-hidden .section-title {
    text-decoration: line-through;
    opacity: 0.6;
}

.song-section-wrapper .section-control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    padding: 0.2rem 0.3rem;
    background-color: rgba(255, 255, 255, 0.95);
    border: 1.5px solid #7f8c8d;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.2s, border-color 0.2s, box-shadow 0.2s;
    font-size: 0.85rem;
    color: #7f8c8d;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(4px);
    min-height: 1.8rem;
}

.song-section-wrapper .section-control-btn:hover {
    background-color: rgba(127, 140, 141, 0.1);
    transform: scale(1.02);
}

.song-section-wrapper .section-control-btn.active {
    background-color: var(--button-bg);
    border-color: var(--button-bg);
    color: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 0 0 2px rgba(52, 152, 219, 0.3);
}

.song-section-wrapper.chords-hidden .chord {
    display: none;
}

.song-section-wrapper.lyrics-hidden .lyrics {
    display: none;
}
</style>`;

export class SongSection extends LitElement {
    static properties = {
        songIndex: { type: Number, attribute: 'song-index', reflect: true },
        sectionIndex: { type: Number, attribute: 'section-index', reflect: true },
        editMode: { type: Boolean, reflect: true },
        state: { type: Object, attribute: false }
    };

    constructor() {
        super();
        this.songIndex = 0;
        this.sectionIndex = 0;
        this.editMode = false;
        this.state = {
            hideMode: 'none',
            isCollapsed: false,
            isHidden: false
        };
        this._onControlClick = this._onControlClick.bind(this);
        this._onSummaryClick = this._onSummaryClick.bind(this);
    }

    createRenderRoot() {
        return this;
    }

    render() {
        return html`${SECTION_STYLES}<slot></slot>`;
    }

    connectedCallback() {
        super.connectedCallback();
        this._wireEvents();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._unwireEvents();
    }

    _wireEvents() {
        const root = this._getWrapper();
        if (!root) return;
        root.querySelectorAll('.section-control-btn').forEach((btn) => {
            btn.addEventListener('click', this._onControlClick);
        });
        const summary = root.querySelector('.section-label');
        if (summary) {
            summary.addEventListener('click', this._onSummaryClick);
        }
    }

    _unwireEvents() {
        const root = this._getWrapper();
        if (!root) return;
        root.querySelectorAll('.section-control-btn').forEach((btn) => {
            btn.removeEventListener('click', this._onControlClick);
        });
        const summary = root.querySelector('.section-label');
        if (summary) {
            summary.removeEventListener('click', this._onSummaryClick);
        }
    }

    _onControlClick(event) {
        event.stopPropagation();
        const action = event.currentTarget.dataset.action;
        if (!action) return;
        this.dispatchEvent(new CustomEvent('section-action', {
            detail: { songIndex: this.songIndex, sectionIndex: this.sectionIndex, action },
            bubbles: true,
            composed: true
        }));
    }

    _onSummaryClick(event) {
        event.preventDefault();
        this.dispatchEvent(new CustomEvent('section-toggle', {
            detail: { songIndex: this.songIndex, sectionIndex: this.sectionIndex },
            bubbles: true,
            composed: true
        }));
    }

    applyState(state, editMode = false) {
        const nextState = state ? { ...state } : { hideMode: 'none', isCollapsed: false, isHidden: false };
        this.state = nextState;
        this.editMode = !!editMode;
        const wrapper = this._getWrapper();
        if (!wrapper) return;

        wrapper.classList.toggle('section-hidden', !!nextState.isHidden);
        wrapper.classList.toggle('section-collapsed', nextState.hideMode === 'collapse');
        wrapper.classList.toggle('chords-hidden', nextState.hideMode === 'chords');
        wrapper.classList.toggle('lyrics-hidden', nextState.hideMode === 'lyrics');

        const details = wrapper.querySelector('details.song-section');
        if (details) {
            details.open = this.editMode ? true : !(nextState.isCollapsed || nextState.hideMode === 'collapse');
        }

        wrapper.querySelectorAll('.section-control-btn').forEach((btn) => {
            const action = btn.dataset.action;
            if (action === 'collapse') {
                btn.classList.toggle('active', nextState.hideMode === 'collapse');
            } else if (action === 'chords') {
                btn.classList.toggle('active', nextState.hideMode === 'chords');
            } else if (action === 'lyrics') {
                btn.classList.toggle('active', nextState.hideMode === 'lyrics');
            } else if (action === 'hide') {
                btn.classList.toggle('active', !!nextState.isHidden);
            }
        });
    }

    getDetailsElement() {
        return this._getWrapper()?.querySelector('details.song-section') || null;
    }

    _getWrapper() {
        return this.querySelector('.song-section-wrapper');
    }
}

customElements.define('song-section', SongSection);
