import { LitElement, html, css, nothing } from 'lit';
import { ChordProParser } from '../js/parser.js';
import { SetalightDB, formatTempo } from '../js/db.js';
import { transposeSong, getAvailableKeys } from '../js/transpose.js';
import { getCurrentOrganisation } from '../js/workspace.js';
import { preloadPadKeysForSongs, preloadPadKey } from '../js/pad-set-service.js';

// Configuration constants
const CONFIG = {
    // Font sizes
    DEFAULT_FONT_SIZE: 1.6,      // rem
    MIN_FONT_SIZE: 0.8,          // rem
    MAX_FONT_SIZE: 3.0,          // rem
    FONT_SIZE_STEP: 0.1,         // rem

    // Drag and drop
    POSITION_THRESHOLD: 20,      // px - minimum movement to change target position
    DRAG_START_THRESHOLD: 5,     // px - movement before starting drag

    // Scrolling
    KEYBOARD_SCROLL_AMOUNT: 200, // px - scroll distance for up/down arrows

    // Intersection Observer
    VISIBILITY_THRESHOLD: 0.5,   // 50% - section must be this visible to be considered "current"

    // Import
    DEFAULT_IMPORT_CUTOFF: '2000-01-01' // Default date for importing setlists (imports all)
};

/**
 * Main Setlist Application Component
 * Manages routing, state, and rendering for the entire app
 *
 * @element setlist-app
 */
export class Setlist extends LitElement {
    static properties = {
        /** @type {string|null} Current route type (home, setlist, settings, etc) */
        currentRoute: { type: String, state: true },

        /** @type {number|undefined} Current song index in setlist */
        currentSongIndex: { type: Number, state: true },

        /** @type {Array} Songs in current setlist */
        songs: { type: Array, state: true },

        /** @type {string|null} Current setlist ID */
        currentSetlistId: { type: String, state: true },

        /** @type {Object} Section visibility state */
        sectionState: { type: Object, state: true },

        /** @type {boolean} Whether overview is in edit mode */
        overviewEditMode: { type: Boolean, state: true },

        /** @type {Object|null} Current setlist data */
        currentSetlist: { type: Object, state: true },
    };

    // Don't use shadow DOM - render into light DOM like the original PageApp
    createRenderRoot() {
        return this;
    }

    constructor() {
        super();

        // Initialize reactive state
        this.currentRoute = null;
        this.currentSongIndex = undefined;
        this.songs = [];
        this.currentSetlistId = null;
        this.sectionState = {};
        this.overviewEditMode = false;
        this.currentSetlist = null;

        // Non-reactive state (internal)
        this.db = new SetalightDB(getCurrentOrganisation());
        this.parser = new ChordProParser();
        this.sectionObserver = null;
        this.settingsImportHandler = null;
        this.storageImportHandler = null;
        this.globalImportHandler = null;
        this._overviewComponent = null;

        // Bind overview component event handlers once
        this._onOverviewSongClick = (event) => {
            const index = event.detail?.index;
            if (typeof index === 'number') {
                this.navigateToHash(`song-${index}`);
            }
        };

        this._onOverviewSongDelete = (event) => {
            const index = event.detail?.index;
            if (typeof index === 'number' && this.songs[index]) {
                this.showDeleteSongConfirmation(index, this.songs[index]);
            }
        };

        this._onOverviewAddSong = () => {
            this.openAddSongModal();
        };
    }

    async connectedCallback() {
        super.connectedCallback();
        await this.init();
    }

    async init() {
        // Initialize IndexedDB
        await this.db.init();

        // Set up Navigation API with View Transitions
        this.setupNavigationAPI();

        // Detect current route from window.__ROUTE__ or URL
        const route = window.__ROUTE__ || this.parseRoute(window.location.pathname);

        // Set current route (will trigger render)
        this.currentRoute = route.type;

        // Render based on route
        if (route.type === 'home') {
            await this.renderHome();
        } else if (route.type === 'songs') {
            await this.renderSongsPage();
        } else if (route.type === 'setlist') {
            await this.renderSetlist(route.setlistId);
        } else if (route.type === 'settings') {
            await this.renderSettings();
        } else if (route.type === 'storage') {
            await this.renderStorage();
        }

        // Set up keyboard navigation
        this.setupKeyboardNavigation(route);

        // Set up navigation menu
        this.setupNavigationMenu(route);
    }

    render() {
        // For now, just render a container
        // We'll gradually migrate the render methods to return html templates
        return html`<div class="setlist-app-container">
            <!-- Content will be dynamically rendered here -->
            <div id="app-content"></div>
        </div>`;
    }

    parseRoute(pathname) {
        if (pathname === '/' || pathname === '/index.html') {
            return { type: 'home' };
        }

        if (pathname === '/songs' || pathname === '/songs/' || pathname === '/songs.html') {
            return { type: 'songs' };
        }

        if (pathname === '/settings' || pathname === '/settings/' || pathname === '/settings.html') {
            return { type: 'settings' };
        }

        if (pathname === '/storage' || pathname === '/storage/' || pathname === '/storage.html') {
            return { type: 'storage' };
        }

        const setlistMatch = pathname.match(/^\/setlist\/([^\/]+)$/);
        if (setlistMatch) {
            return { type: 'setlist', setlistId: setlistMatch[1], songIndex: -1 };
        }

        const songMatch = pathname.match(/^\/setlist\/([^\/]+)\/song\/(-?\d+)$/);
        if (songMatch) {
            return {
                type: 'song',
                setlistId: songMatch[1],
                songIndex: parseInt(songMatch[2])
            };
        }

        return { type: 'home' };
    }

    setupNavigationAPI() {
        // Just let the browser and service worker handle navigation naturally
        // View transitions will be handled by CSS @view-transition rule
    }

    async renderHome() {
        console.log('[Setlist] TODO: renderHome');
    }

    async renderSongsPage() {
        console.log('[Setlist] TODO: renderSongsPage');
    }

    async renderSetlist(setlistId) {
        console.log('[Setlist] TODO: renderSetlist', setlistId);
    }

    async renderSettings() {
        console.log('[Setlist] TODO: renderSettings');
    }

    async renderStorage() {
        console.log('[Setlist] TODO: renderStorage');
    }

    setupKeyboardNavigation(route) {
        console.log('[Setlist] TODO: setupKeyboardNavigation', route);
    }

    setupNavigationMenu(route) {
        console.log('[Setlist] TODO: setupNavigationMenu', route);
    }

    navigateToHash(hash) {
        console.log('[Setlist] TODO: navigateToHash', hash);
    }

    showDeleteSongConfirmation(index, song) {
        console.log('[Setlist] TODO: showDeleteSongConfirmation', index, song);
    }

    openAddSongModal() {
        console.log('[Setlist] TODO: openAddSongModal');
    }
}

customElements.define('setlist-app', Setlist);
