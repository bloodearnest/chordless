import { LitElement, html } from 'lit';
import './app-header.js';
import './key-selector.js';

/**
 * SongHeader Component
 *
 * Lightweight wrapper that renders the app header with the song controls slot.
 * Renders into the light DOM so existing styles and DOM hooks continue to work.
 *
 * @attr variant - "setlist" | "library"
 */
export class SongHeader extends LitElement {
    static properties = {
        variant: { type: String },
        title: { type: String }
    };

    constructor() {
        super();
        this.variant = 'setlist';
        this.title = this.variant === 'library' ? 'Song Library' : 'Loading...';
    }

    createRenderRoot() {
        // Render into light DOM so existing styles/IDs keep working
        return this;
    }

    render() {
        if (this.variant === 'library') {
            return this.renderLibraryHeader();
        }
        return this.renderSetlistHeader();
    }

    renderSetlistHeader() {
        return html`
            <app-header
                id="app-header"
                title=${this.title || 'Loading...'}
                show-edit-toggle
                show-info-button>
                <div slot="controls" class="header-controls-slot">
                    <button class="reset-button edit-mode-control" id="reset-button" aria-label="Reset song">↺</button>
                    <div class="font-size-controls edit-mode-control">
                        <button class="font-size-btn" id="font-size-decrease" aria-label="Decrease font size">A−</button>
                        <button class="font-size-btn" id="font-size-increase" aria-label="Increase font size">A+</button>
                    </div>
                    <div class="key-display-wrapper">
                        <label class="meta-label">Key:</label>
                        <button id="key-selector-button" class="key-selector" popovertarget="key-selector-popover">
                            <span id="key-selector-value">-</span>
                        </button>
                        <div id="key-selector-popover" class="key-popover" popover>
                            <div id="key-options-list" class="key-options-list"></div>
                        </div>
                    </div>
                    <div class="song-meta-compact" id="song-meta-header"></div>
                </div>
            </app-header>
        `;
    }

    renderLibraryHeader() {
        return html`
            <app-header
                id="app-header"
                title=${this.title || 'Song Library'}>
                <div slot="controls" class="header-controls-slot">
                    <button class="reset-button edit-mode-control" id="library-reset-button" aria-label="Reset song" style="display: none;">↺</button>
                    <div class="font-size-controls edit-mode-control" id="library-font-size-controls" style="display: none;">
                        <button class="font-size-btn" id="library-font-size-decrease" aria-label="Decrease font size">A−</button>
                        <button class="font-size-btn" id="library-font-size-increase" aria-label="Increase font size">A+</button>
                    </div>
                    <div class="key-display-wrapper" id="library-key-display" style="display: none;">
                        <label class="meta-label">Key:</label>
                        <key-selector id="library-key-selector"></key-selector>
                    </div>
                    <div class="song-meta-compact" id="library-song-meta-header" style="display: none;"></div>
                </div>
            </app-header>
        `;
    }
}

customElements.define('song-header', SongHeader);
