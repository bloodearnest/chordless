// Page-based application logic for Setalight
// Works with service worker routing and Navigation API

import { ChordProParser } from './parser.js';
import { SetalightDB, formatTempo } from './db.js';
import { transposeSong, getAvailableKeys, getKeyOffset } from './transpose.js';

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

class PageApp {
    constructor() {
        this.db = new SetalightDB('TEST');
        this.parser = new ChordProParser();
        this.currentSongIndex = undefined;
        this.songs = [];
        this.currentSetlistId = null;
        // Track section visibility state: { songIndex: { sectionIndex: { hideMode: 'none'|'section'|'chords'|'lyrics' } } }
        this.sectionState = {};
        this.sectionObserver = null;
        this.overviewEditMode = false; // Track whether overview is in edit mode
        this.settingsImportHandler = null;
        this.init();
    }

    async loadTemplates() {
        // Load shared templates if they don't exist yet
        if (document.getElementById('song-header-template')) {
            console.log('Templates already loaded');
            return;
        }

        try {
            const response = await fetch('/templates.html');
            const html = await response.text();

            // Create a temporary container
            const temp = document.createElement('div');
            temp.innerHTML = html;

            // Append all templates to the body
            const templates = temp.querySelectorAll('template');
            templates.forEach(template => {
                document.body.appendChild(template);
            });

            console.log('Loaded', templates.length, 'templates');
        } catch (error) {
            console.error('Failed to load templates:', error);
        }
    }

    async init() {
        // Load templates first
        await this.loadTemplates();

        // Initialize IndexedDB
        await this.db.init();

        // Set up Navigation API with View Transitions
        this.setupNavigationAPI();

        // Detect current route from window.__ROUTE__ or URL
        const route = window.__ROUTE__ || this.parseRoute(window.location.pathname);

        // Render based on route
        if (route.type === 'home') {
            await this.renderHome();
        } else if (route.type === 'songs') {
            await this.renderSongsPage();
        } else if (route.type === 'setlist') {
            await this.renderSetlist(route.setlistId);
        } else if (route.type === 'settings') {
            await this.renderSettings();
        }

        // Set up keyboard navigation
        this.setupKeyboardNavigation(route);

        // Set up navigation menu
        this.setupNavigationMenu(route);
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
        // Just render the setlist list
        await this.renderSetlistsTab();
    }

    async renderSongsPage() {
        // Check if there's a hash indicating a specific song
        const hash = window.location.hash.substring(1); // Remove the #

        // Render the standalone songs page
        await this.renderSongLibraryTab();

        // Set up hash change handler for navigation
        this.setupLibraryHashNavigation();

        // If hash is provided, load that song
        if (hash) {
            const song = await this.db.getSong(hash);
            if (song) {
                await this.viewLibrarySong(song, false); // false = don't update URL (we're already there)
            } else {
                console.error('Song not found:', hash);
                // Clear the hash if song not found
                window.history.replaceState({}, '', '/songs');
                // Scroll back to library list
                const container = document.querySelector('.home-content-container, .songs-content-container');
                const libraryList = container?.querySelector('.library-view');
                if (libraryList) {
                    libraryList.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'start' });
                }
            }
        }
    }

    async renderSettings() {
        // Setup the import button on the settings page
        this.setupImportButton();
    }

    setupLibraryHashNavigation() {
        // Remove old handler if exists
        if (this.libraryHashHandler) {
            window.removeEventListener('hashchange', this.libraryHashHandler);
        }

        // Create new handler
        this.libraryHashHandler = async (event) => {
            const hash = window.location.hash.substring(1);

            if (!hash) {
                // No hash = show library list
                this.closeLibrarySongView(false); // false = don't update URL (already changed)
            } else {
                // Hash present = show specific song
                const song = await this.db.getSong(hash);
                if (song) {
                    await this.viewLibrarySong(song, false); // false = don't update URL
                } else {
                    // Song not found, go back to library
                    window.location.hash = '';
                }
            }
        };

        window.addEventListener('hashchange', this.libraryHashHandler);
    }

    setupTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabName = button.dataset.tab;
                this.switchTab(tabName);
            });
        });
    }

    switchTab(tabName) {
        // Update button states
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update tab content visibility
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });
    }

    async renderSetlistsTab() {
        const listContainer = document.getElementById('setlist-list');

        try {
            // Show loading message
            listContainer.textContent = '';
            const loadingMsg = document.createElement('p');
            loadingMsg.textContent = 'Loading setlists...';
            listContainer.appendChild(loadingMsg);

            const setlists = await this.db.getAllSetlists();

            if (setlists.length === 0) {
                // No setlists - show import button
                listContainer.textContent = '';

                const container = document.createElement('div');
                container.style.textAlign = 'center';
                container.style.padding = '2rem';

                const message = document.createElement('p');
                message.style.marginBottom = '2rem';
                message.textContent = 'No setlists found in database. Go to Settings to import setlists.';
                container.appendChild(message);

                listContainer.appendChild(container);
                return;
            }

            // Group setlists by year
            const currentYear = new Date().getFullYear();
            const groupedByYear = {};

            for (const setlist of setlists) {
                const year = this.extractYear(setlist.date);
                if (!groupedByYear[year]) {
                    groupedByYear[year] = [];
                }
                groupedByYear[year].push(setlist);
            }

            // Sort years descending
            const years = Object.keys(groupedByYear).sort((a, b) => b - a);

            // Sort setlists within each year by date descending (newest first)
            for (const year of years) {
                groupedByYear[year].sort((a, b) => b.date.localeCompare(a.date));
            }

            // Clear and render setlists
            listContainer.textContent = '';

            // Render grouped setlists (only current year expanded by default)
            for (const year of years) {
                const yearSection = this.createYearSection(year, groupedByYear[year], year == currentYear);
                listContainer.appendChild(yearSection);
            }
        } catch (error) {
            console.error('Error loading setlists:', error);
            listContainer.textContent = '';
            const errorMsg = document.createElement('p');
            errorMsg.className = 'error';
            errorMsg.textContent = 'Error loading setlists. Please check the console.';
            listContainer.appendChild(errorMsg);
        }
    }

    async renderSongLibraryTab() {
        const libraryContainer = document.getElementById('song-library-list');
        const searchInput = document.getElementById('song-search');

        try {
            // Show loading message
            libraryContainer.textContent = '';
            const loadingMsg = document.createElement('p');
            loadingMsg.textContent = 'Loading songs...';
            libraryContainer.appendChild(loadingMsg);

            const songs = await this.db.getAllSongs();
            console.log('Loaded songs:', songs.length, songs);

            if (songs.length === 0) {
                libraryContainer.textContent = '';
                const message = document.createElement('p');
                message.style.textAlign = 'center';
                message.style.color = '#7f8c8d';
                message.textContent = 'No songs in library. Import setlists to populate the song library.';
                libraryContainer.appendChild(message);
                return;
            }

            // Enrich songs with latest usage data
            for (const song of songs) {
                const usage = await this.db.getSongUsage(song.id);
                if (usage && usage.usageHistory && usage.usageHistory.length > 0) {
                    // Most recent is first (already sorted by date descending)
                    const lastUsage = usage.usageHistory[0];
                    song.lastUsageInfo = {
                        date: lastUsage.setlistDate,
                        leader: lastUsage.leader,
                        key: lastUsage.playedInKey
                    };
                }
            }

            // Sort songs alphabetically by title
            songs.sort((a, b) => {
                const titleA = (a.title || '').toLowerCase();
                const titleB = (b.title || '').toLowerCase();
                return titleA.localeCompare(titleB);
            });

            // Store all songs for search filtering
            this.allSongs = songs;

            // Setup search
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.filterSongs(e.target.value);
                });
            }

            // Initial render with all songs
            this.renderSongList(songs);

        } catch (error) {
            console.error('Error loading songs:', error);
            libraryContainer.textContent = '';
            const errorMsg = document.createElement('p');
            errorMsg.className = 'error';
            errorMsg.textContent = 'Error loading songs. Please check the console.';
            libraryContainer.appendChild(errorMsg);
        }
    }

    filterSongs(searchTerm) {
        if (!this.allSongs) return;

        const term = searchTerm.toLowerCase().trim();

        if (!term) {
            // Show all songs if search is empty
            this.renderSongList(this.allSongs);
            return;
        }

        // Filter songs by title, artist, or lyrics
        const filtered = this.allSongs.filter(song => {
            const title = (song.title || '').toLowerCase();
            const artist = (song.artist || '').toLowerCase();
            const lyricsText = (song.lyricsText || '').toLowerCase();

            return title.includes(term) ||
                   artist.includes(term) ||
                   lyricsText.includes(term);
        });

        this.renderSongList(filtered);
    }

    renderSongList(songs) {
        const libraryContainer = document.getElementById('song-library-list');

        console.log('renderSongList called with', songs.length, 'songs');
        console.log('libraryContainer:', libraryContainer);

        libraryContainer.textContent = '';

        if (songs.length === 0) {
            const message = document.createElement('p');
            message.style.textAlign = 'center';
            message.style.color = '#7f8c8d';
            message.textContent = 'No songs match your search.';
            libraryContainer.appendChild(message);
            return;
        }

        for (const song of songs) {
            // Create the Lit song-card component
            const songCard = document.createElement('song-card');
            songCard.song = song;
            songCard.variant = 'library';

            // Add some bottom margin
            songCard.style.marginBottom = '1rem';

            // Make card clickable - view and edit song
            songCard.addEventListener('song-click', (e) => {
                console.log('Song clicked:', song.title, song);
                console.log('Event:', e);
                this.viewLibrarySong(song);
            });

            libraryContainer.appendChild(songCard);
        }
        console.log('Finished rendering', songs.length, 'songs');
    }

    async viewLibrarySong(song, updateHash = true) {
        console.log('viewLibrarySong called with:', song);

        // Store the current library song for editing
        this.currentLibrarySong = song;
        this.currentLibrarySongId = song.id;

        // Update URL hash if requested
        if (updateHash) {
            window.location.hash = song.id;
        }

        // Update navigation menu for library song context
        this.updateNavigationMenu({ type: 'librarySong', songId: song.id });

        // Debug: log the song object to see what fields it has
        console.log('Song object:', song);
        console.log('Available fields:', Object.keys(song));

        // Parse the song (note: field is chordproText with lowercase 'p')
        const chordproContent = song.chordproText || song.rawChordPro;
        if (!chordproContent) {
            console.error('Song has no ChordPro content!', song);
            throw new Error('Song has no ChordPro content');
        }
        console.log('Parsing song:', chordproContent.substring(0, 100));
        const parsed = this.parser.parse(chordproContent);

        // Store parsed song for library context
        this.currentLibraryParsedSong = parsed;
        this.currentLibraryKey = parsed.metadata.key;

        // Update title in header
        const titleElement = document.getElementById('library-song-title');
        if (titleElement) {
            titleElement.textContent = parsed.metadata.title || 'Untitled';
        }

        // Show all header controls
        const editToggle = document.getElementById('library-edit-toggle');
        const infoButton = document.getElementById('library-info-button');
        const keyDisplay = document.getElementById('library-key-display');
        const metaHeader = document.getElementById('library-song-meta-header');

        if (editToggle) editToggle.style.display = 'flex';
        if (infoButton) infoButton.style.display = 'flex';
        if (keyDisplay) keyDisplay.style.display = 'flex';
        if (metaHeader) metaHeader.style.display = 'flex';

        // Update key display
        const keyValue = document.getElementById('library-key-selector-value');
        if (keyValue) {
            keyValue.textContent = parsed.metadata.key || '-';
        }

        // Update meta display (tempo, time signature)
        if (metaHeader) {
            const metaParts = [];
            if (parsed.metadata.tempo) {
                metaParts.push(`${parsed.metadata.tempo} BPM`);
            }
            if (parsed.metadata.time) {
                metaParts.push(parsed.metadata.time);
            }
            metaHeader.textContent = metaParts.join(' • ');
        }

        // Render the song content
        const contentElement = document.getElementById('library-song-content');
        contentElement.innerHTML = '';

        const songContent = document.createElement('div');
        songContent.className = 'song-content library-single-song';
        // Use toHTML method (returns DocumentFragment, not HTML string)
        const fragment = this.parser.toHTML(parsed, 0);
        songContent.appendChild(fragment);
        contentElement.appendChild(songContent);

        // Setup edit mode for library song
        this.setupLibrarySongEditMode();

        // Setup key selector for library
        this.setupLibraryKeySelector(parsed);

        // Setup info button for library
        this.setupLibraryInfoButton(parsed, song);

        // Setup font size controls
        this.setupLibraryFontSizeControls();

        // Setup reset button
        this.setupLibraryResetButton();

        // Apply initial font size
        if (!this.currentLibraryFontSize) {
            this.currentLibraryFontSize = CONFIG.DEFAULT_FONT_SIZE;
        }
        this.applyLibraryFontSize();

        // Scroll to song view using native scroll-snap
        const container = document.querySelector('.home-content-container, .songs-content-container');
        const libraryView = container?.querySelector('.library-song-view');
        if (libraryView) {
            libraryView.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }
    }

    closeLibrarySongView(updateUrl = true) {
        // Scroll back to library list using native scroll-snap
        const container = document.querySelector('.home-content-container, .songs-content-container');
        const libraryList = container?.querySelector('.library-view');
        if (libraryList) {
            libraryList.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }

        // Hide all header controls
        const editToggle = document.getElementById('library-edit-toggle');
        const infoButton = document.getElementById('library-info-button');
        const keyDisplay = document.getElementById('library-key-display');
        const metaHeader = document.getElementById('library-song-meta-header');
        const resetButton = document.getElementById('library-reset-button');
        const fontSizeControls = document.getElementById('library-font-size-controls');

        if (editToggle) editToggle.style.display = 'none';
        if (infoButton) infoButton.style.display = 'none';
        if (keyDisplay) keyDisplay.style.display = 'none';
        if (metaHeader) metaHeader.style.display = 'none';
        if (resetButton) resetButton.style.display = 'none';
        if (fontSizeControls) fontSizeControls.style.display = 'none';

        // Restore "Song Library" title
        const titleElement = document.getElementById('library-song-title');
        if (titleElement) {
            titleElement.textContent = 'Song Library';
        }

        // Clear edit mode state
        if (editToggle && editToggle.classList.contains('active')) {
            editToggle.click(); // Exit edit mode if active
        }

        this.currentLibrarySong = null;
        this.currentLibrarySongId = null;

        // Clear the hash to go back to library list
        if (updateUrl) {
            window.location.hash = '';
        }

        // Update navigation menu for songs library context
        this.updateNavigationMenu({ type: 'songs' });
    }

    setupLibrarySongEditMode() {
        const editToggle = document.getElementById('library-edit-toggle');
        if (!editToggle) return;

        // Remove old listeners by cloning
        const newEditToggle = editToggle.cloneNode(true);
        editToggle.parentNode.replaceChild(newEditToggle, editToggle);

        newEditToggle.addEventListener('click', () => {
            const isEnteringEditMode = !document.body.classList.contains('library-edit-mode');

            if (isEnteringEditMode) {
                // Enter edit mode
                document.body.classList.add('library-edit-mode');
                newEditToggle.classList.add('active');

                console.log('Entered library edit mode - changes will save to global songs database');
            } else {
                // Exit edit mode - save to global database
                document.body.classList.remove('library-edit-mode');
                newEditToggle.classList.remove('active');

                this.saveLibrarySongToDatabase();
            }
        });
    }

    async saveLibrarySongToDatabase() {
        if (!this.currentLibrarySong || !this.currentLibrarySongId) {
            console.warn('No current library song to save');
            return;
        }

        try {
            // Get the updated song from database (in case it was modified)
            const song = await this.db.getSong(this.currentLibrarySongId);

            if (!song) {
                console.error('Song not found in database');
                return;
            }

            // Update the timestamp
            song.updatedAt = new Date().toISOString();

            // Save back to global songs database
            await this.db.saveSong(song);

            console.log('Saved song to global database:', song.title);

            // Refresh the library song view with updated data
            this.currentLibrarySong = song;
            await this.viewLibrarySong(song);

        } catch (error) {
            console.error('Error saving library song:', error);
        }
    }

    setupLibraryKeySelector(parsed) {
        const keyValue = document.getElementById('library-key-selector-value');
        const keyOptionsList = document.getElementById('library-key-options-list');
        const popover = document.getElementById('library-key-selector-popover');
        const button = document.getElementById('library-key-selector-button');

        if (!keyValue || !keyOptionsList) return;

        // Populate key selector with current key
        const currentKey = parsed.metadata.key || this.currentLibraryKey;
        if (currentKey) {
            this.populateLibraryKeySelector(currentKey);
        }

        // Set up popover positioning
        if (button && popover) {
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

    populateLibraryKeySelector(selectedKey) {
        const keyOptionsList = document.getElementById('library-key-options-list');
        const keySelectorValue = document.getElementById('library-key-selector-value');
        if (!keyOptionsList || !keySelectorValue) return;

        // Get available keys rotated around the selected key
        const keys = getAvailableKeys(selectedKey);

        // Get original key from current song
        const originalKey = this.currentLibraryParsedSong?.metadata?.key;

        // Clear existing options
        keyOptionsList.textContent = '';

        // Find the index of the current key in the list
        const currentIndex = keys.indexOf(selectedKey);

        // Add available keys as clickable items with offset indicators
        keys.forEach((key, index) => {
            const item = document.createElement('button');
            item.className = 'key-option-item';
            if (key === selectedKey) {
                item.classList.add('selected');
            }

            // Calculate offset based on position in list
            const positionOffset = currentIndex - index;

            // Format key name with * suffix if original
            let keyText = key === originalKey ? `${key}*` : key;

            // Create key name span
            const keyNameSpan = document.createElement('span');
            keyNameSpan.className = 'key-name';
            keyNameSpan.textContent = keyText;

            // Create offset span
            const offsetSpan = document.createElement('span');
            offsetSpan.className = 'key-offset';
            if (positionOffset !== 0) {
                const sign = positionOffset > 0 ? '+' : '-';
                offsetSpan.textContent = `${sign}${Math.abs(positionOffset)}`;
            }

            item.appendChild(keyNameSpan);
            item.appendChild(offsetSpan);

            // Click handler
            item.addEventListener('click', async () => {
                await this.selectLibraryKey(key);
            });

            keyOptionsList.appendChild(item);
        });

        // Update button text to show selected key
        keySelectorValue.textContent = selectedKey;
    }

    async selectLibraryKey(newKey) {
        if (!newKey || !this.currentLibraryParsedSong) return;

        console.log(`Library key changed to: ${newKey}`);

        // Close the popover
        const popover = document.getElementById('library-key-selector-popover');
        if (popover) {
            popover.hidePopover();
        }

        // Update the displayed key value
        const keyValueDisplay = document.getElementById('library-key-selector-value');
        if (keyValueDisplay) {
            keyValueDisplay.textContent = newKey;
        }

        // Update current key
        this.currentLibraryKey = newKey;

        // Re-render the song with transposition
        await this.reRenderLibrarySong(newKey);

        // Repopulate the dropdown with the new key in the middle
        this.populateLibraryKeySelector(newKey);
    }

    async reRenderLibrarySong(targetKey) {
        if (!this.currentLibraryParsedSong) return;

        const contentElement = document.getElementById('library-song-content');
        if (!contentElement) return;

        // Calculate semitone offset
        const originalKey = this.currentLibraryParsedSong.metadata.key;
        const offset = calculateTransposeOffset(originalKey, targetKey);

        // Re-render with transposition
        contentElement.innerHTML = '';
        const songContent = document.createElement('div');
        songContent.className = 'song-content library-single-song';
        const fragment = this.parser.toHTML(this.currentLibraryParsedSong, offset);
        songContent.appendChild(fragment);
        contentElement.appendChild(songContent);
    }

    setupLibraryInfoButton(parsed, song) {
        const infoButton = document.getElementById('library-info-button');
        if (!infoButton) return;

        // Remove old listener by cloning
        const newInfoButton = infoButton.cloneNode(true);
        infoButton.parentNode.replaceChild(newInfoButton, infoButton);

        newInfoButton.onclick = () => this.showLibrarySongInfo(parsed, song);
    }

    async showLibrarySongInfo(parsed, song) {
        const modal = document.getElementById('library-song-info-modal');
        const modalBody = document.getElementById('library-modal-body');

        if (!modal || !modalBody) return;

        modal.show();

        // Clear previous content
        modalBody.textContent = '';

        // Create or get song-info component
        let songInfoEl = modalBody.querySelector('song-info');
        if (!songInfoEl) {
            songInfoEl = document.createElement('song-info');
            modalBody.appendChild(songInfoEl);
        }

        // Show loading state
        songInfoEl.loading = true;

        // Load song usage data to get appearances
        const songUsage = await this.db.getSongUsage(song.id);

        // Convert usage history to appearances format
        const appearances = songUsage?.usageHistory?.map(entry => ({
            setlistId: entry.setlistId,
            date: entry.setlistDate,
            playedInKey: entry.playedInKey,
            leader: entry.leader,
            setlistName: entry.setlistName
        })) || [];

        // Create song data object
        const songData = {
            ...song,
            title: parsed.metadata.title || song.title,
            metadata: parsed.metadata
        };

        // Update component
        songInfoEl.loading = false;
        songInfoEl.song = songData;
        songInfoEl.appearances = appearances;
    }

    setupLibraryFontSizeControls() {
        const decreaseBtn = document.getElementById('library-font-size-decrease');
        const increaseBtn = document.getElementById('library-font-size-increase');

        if (!decreaseBtn || !increaseBtn) return;

        // Remove old listeners
        const newDecreaseBtn = decreaseBtn.cloneNode(true);
        const newIncreaseBtn = increaseBtn.cloneNode(true);
        decreaseBtn.parentNode.replaceChild(newDecreaseBtn, decreaseBtn);
        increaseBtn.parentNode.replaceChild(newIncreaseBtn, increaseBtn);

        if (!this.currentLibraryFontSize) {
            this.currentLibraryFontSize = CONFIG.DEFAULT_FONT_SIZE;
        }

        newDecreaseBtn.addEventListener('click', () => {
            this.currentLibraryFontSize = Math.max(CONFIG.MIN_FONT_SIZE, this.currentLibraryFontSize - CONFIG.FONT_SIZE_STEP);
            this.applyLibraryFontSize();
        });

        newIncreaseBtn.addEventListener('click', () => {
            this.currentLibraryFontSize = Math.min(CONFIG.MAX_FONT_SIZE, this.currentLibraryFontSize + CONFIG.FONT_SIZE_STEP);
            this.applyLibraryFontSize();
        });
    }

    applyLibraryFontSize() {
        const contentElement = document.getElementById('library-song-content');
        if (!contentElement) return;

        const songContent = contentElement.querySelector('.song-content');
        if (songContent) {
            songContent.style.fontSize = `${this.currentLibraryFontSize}rem`;
        }
    }

    setupLibraryResetButton() {
        const resetButton = document.getElementById('library-reset-button');
        const resetModal = document.getElementById('library-reset-confirm-modal');

        if (!resetButton || !resetModal) return;

        // Remove old listener
        const newResetButton = resetButton.cloneNode(true);
        resetButton.parentNode.replaceChild(newResetButton, resetButton);

        // Show confirmation modal when reset button is clicked
        newResetButton.addEventListener('click', () => {
            resetModal.show();
        });

        // Listen for confirm event
        resetModal.addEventListener('confirm', () => {
            this.resetLibrarySong();
        });
    }

    async resetLibrarySong() {
        if (!this.currentLibraryParsedSong) return;

        // Reset key to original
        this.currentLibraryKey = this.currentLibraryParsedSong.metadata.key;

        // Reset font size to default
        this.currentLibraryFontSize = CONFIG.DEFAULT_FONT_SIZE;

        // Re-render with original key
        await this.reRenderLibrarySong(this.currentLibraryKey);

        // Update key display
        const keyValue = document.getElementById('library-key-selector-value');
        if (keyValue) {
            keyValue.textContent = this.currentLibraryKey || '-';
        }

        // Update key selector
        if (this.currentLibraryKey) {
            this.populateLibraryKeySelector(this.currentLibraryKey);
        }

        // Apply font size
        this.applyLibraryFontSize();

        console.log('Library song reset to defaults');
    }

    extractYear(dateStr) {
        const match = dateStr.match(/^(\d{4})/);
        return match ? match[1] : 'Unknown';
    }

    calculateAppearanceStats(song) {
        if (!song.appearances || song.appearances.length === 0) {
            return {
                totalAppearances: 0,
                last12MonthsAppearances: 0,
                lastPlayedDate: null
            };
        }

        const totalAppearances = song.appearances.length;

        // Calculate date 12 months ago
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

        // Filter appearances in last 12 months
        const last12MonthsAppearances = song.appearances.filter(appearance => {
            const appearanceDate = new Date(appearance.date);
            return appearanceDate >= twelveMonthsAgo;
        }).length;

        // Find most recent appearance date
        const sortedAppearances = [...song.appearances].sort((a, b) =>
            b.date.localeCompare(a.date)
        );
        const lastPlayedDate = sortedAppearances[0].date;

        return {
            totalAppearances,
            last12MonthsAppearances,
            lastPlayedDate
        };
    }

    formatDate(dateStr) {
        // Parse YYYY-MM-DD format and convert to readable format
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    getWeeksAgo(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        const diffTime = now - date;
        const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));

        if (diffWeeks === 0) {
            return 'This week';
        } else if (diffWeeks === 1) {
            return '1 week ago';
        } else {
            return `${diffWeeks} weeks ago`;
        }
    }

    getRecentAppearances(song) {
        if (!song.appearances || song.appearances.length === 0) {
            return [];
        }

        // Calculate date 12 months ago
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

        // Filter and sort appearances in last 12 months (most recent first)
        return song.appearances
            .filter(appearance => {
                const appearanceDate = new Date(appearance.date);
                return appearanceDate >= twelveMonthsAgo;
            })
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(appearance => ({
                date: appearance.date,
                formattedDate: this.formatDate(appearance.date),
                weeksAgo: this.getWeeksAgo(appearance.date),
                playedInKey: appearance.playedInKey,
                leader: appearance.leader
            }));
    }

    createYearSection(year, setlists, expanded = false) {
        const section = document.createElement('div');
        section.className = 'year-section';

        const header = document.createElement('button');
        header.className = 'year-header';
        header.textContent = year;
        header.addEventListener('click', () => {
            section.classList.toggle('expanded');
        });

        const list = document.createElement('div');
        list.className = 'year-list';

        for (const setlist of setlists) {
            const link = document.createElement('a');
            link.href = `/setlist/${setlist.id}`;
            link.className = 'setlist-button';

            // Format name: use custom name if present, otherwise format date
            const displayName = setlist.name
                ? `${this.formatSetlistName(setlist.date)} - ${setlist.name}`
                : this.formatSetlistName(setlist.date);

            // Create content wrapper with name and song count
            const nameSpan = document.createElement('span');
            nameSpan.className = 'setlist-name';
            nameSpan.textContent = displayName;

            const countSpan = document.createElement('span');
            countSpan.className = 'setlist-song-count';
            const songCount = setlist.songs ? setlist.songs.length : 0;
            countSpan.textContent = `${songCount} song${songCount !== 1 ? 's' : ''}`;

            link.appendChild(nameSpan);
            link.appendChild(countSpan);
            list.appendChild(link);
        }

        section.appendChild(header);
        section.appendChild(list);

        if (expanded) {
            section.classList.add('expanded');
        }

        return section;
    }

    setupImportButton() {
        const appSettings = document.getElementById('app-settings');
        if (!appSettings) return;

        if (this.settingsImportHandler) {
            appSettings.removeEventListener('import-requested', this.settingsImportHandler);
        }

        this.settingsImportHandler = () => this.runImport();
        appSettings.addEventListener('import-requested', this.settingsImportHandler);
    }

    async runImport() {
        // Dynamically import the importer
        const { SetlistImporter } = await import('./import.js');
        const importer = new SetlistImporter('TEST');
        await importer.init();

        // Show progress modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';

        const title = document.createElement('h2');
        title.textContent = 'Importing Setlists';
        modalContent.appendChild(title);

        const progressContainer = document.createElement('div');
        progressContainer.id = 'import-progress';
        progressContainer.style.margin = '2rem 0';

        const message = document.createElement('p');
        message.id = 'import-message';
        message.textContent = 'Initializing...';
        progressContainer.appendChild(message);

        const progressBarContainer = document.createElement('div');
        progressBarContainer.style.background = '#ecf0f1';
        progressBarContainer.style.borderRadius = '4px';
        progressBarContainer.style.height = '20px';
        progressBarContainer.style.marginTop = '1rem';
        progressBarContainer.style.overflow = 'hidden';

        const progressBar = document.createElement('div');
        progressBar.id = 'import-progress-bar';
        progressBar.style.background = 'var(--button-bg)';
        progressBar.style.height = '100%';
        progressBar.style.width = '0%';
        progressBar.style.transition = 'width 0.3s';
        progressBarContainer.appendChild(progressBar);

        progressContainer.appendChild(progressBarContainer);
        modalContent.appendChild(progressContainer);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // progressBar and message are already defined above, no need to query DOM

        try {
            const result = await importer.importFromServer((progress) => {
                message.textContent = progress.message;

                if (progress.current && progress.total) {
                    const percent = (progress.current / progress.total) * 100;
                    progressBar.style.width = `${percent}%`;
                }
            });

            if (result.cancelled) {
                modal.remove();
                return;
            }

            message.textContent = `Import complete! ${result.setlists} setlists, ${result.songs} songs`;
            progressBar.style.width = '100%';

            // Wait a moment then navigate to home to see imported setlists
            setTimeout(() => {
                modal.remove();
                window.location.href = '/';
            }, 1500);

        } catch (error) {
            console.error('Import failed:', error);
            message.textContent = `Import failed: ${error.message}`;
            message.style.color = '#e74c3c';
        }
    }

    formatSetlistName(dateStr) {
        const parts = dateStr.split('-');

        if (parts.length < 3) {
            return dateStr;
        }

        const year = parts[0];
        const month = parts[1];
        const day = parts[2];

        const eventParts = parts.slice(3);
        const eventName = eventParts.length > 0
            ? this.capitalizeWords(eventParts.join(' ').replace(/_/g, ' '))
            : null;

        try {
            const date = new Date(`${year}-${month}-${day}T00:00:00`);
            if (isNaN(date.getTime())) {
                return dateStr;
            }

            const dayNum = date.getDate();
            const monthName = date.toLocaleDateString('en-US', { month: 'long' });
            const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
            const ordinalSuffix = this.getOrdinalSuffix(dayNum);

            const formattedDate = `${dayNum}${ordinalSuffix} ${monthName} (${dayName})`;

            return eventName ? `${formattedDate} - ${eventName}` : formattedDate;
        } catch (error) {
            return dateStr;
        }
    }

    capitalizeWords(str) {
        return str.split(' ').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
    }

    getOrdinalSuffix(day) {
        if (day > 3 && day < 21) return 'th';
        switch (day % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    }

    async renderSetlist(setlistId) {
        console.log('renderSetlist called with:', setlistId);
        try {
            // Load setlist from IndexedDB
            const setlist = await this.db.getSetlist(setlistId);

            if (!setlist) {
                console.error('[ERROR] Setlist not found in IndexedDB:', setlistId);
                const container = document.querySelector('.song-container');
                container.textContent = '';
                const msg = document.createElement('p');
                msg.textContent = 'Setlist not found.';
                container.appendChild(msg);
                return;
            }

            if (setlist.songs.length === 0) {
                console.warn('[WARN] Setlist has no songs');

                // Set instance variables for empty setlist
                this.songs = [];
                this.currentSetlistId = setlistId;
                this.currentSetlist = setlist;

                // Update header to show setlist info
                this.updateHeader(null, true);

                // Clear container (will show Add Song button via overview)
                const container = document.querySelector('.song-container');
                container.textContent = '';
                container.appendChild(this.renderFullSetlist(setlist, []));

                // Show overview immediately
                requestAnimationFrame(() => {
                    this.showOverview(true);
                    history.replaceState({ view: 'overview' }, '', window.location.href);
                });

                return;
            }

            console.log('Loaded setlist:', setlist.date, setlist.songs.length, 'songs');

            // Parse each song on-demand
            const songs = [];
            for (const songEntry of setlist.songs) {
                // Get source text (local edits or from Songs collection)
                let sourceText;
                let canonicalSong = null;
                if (songEntry.chordproEdits) {
                    sourceText = songEntry.chordproEdits;
                } else {
                    canonicalSong = await this.db.getSong(songEntry.songId);

                    if (!canonicalSong) {
                        console.error('[ERROR] Song not found in DB:', songEntry.songId);
                        continue;
                    }
                    sourceText = canonicalSong.chordproText;
                }

                // Parse the chordpro
                const parsed = this.parser.parse(sourceText);

                // Apply transposition if targetKey is set
                if (songEntry.modifications.targetKey) {
                    // TODO: Implement transposition
                    // For now, just update the displayed key
                    parsed.metadata.key = songEntry.modifications.targetKey;
                }

                // Apply BPM override
                if (songEntry.modifications.bpmOverride) {
                    parsed.metadata.tempo = songEntry.modifications.bpmOverride;
                }

                // Generate HTML
                const htmlContent = this.parser.toHTML(parsed, songEntry.order);

                // Store original key for transposition reference
                const originalKey = parsed.metadata.key;

                // Use tempo and time signature from database if available (already parsed), otherwise use ChordPro
                let currentBPM = parsed.metadata.tempo;
                let timeSignature = parsed.metadata.time; // ChordPro uses 'time'
                if (canonicalSong && canonicalSong.metadata) {
                    currentBPM = canonicalSong.metadata.tempo || parsed.metadata.tempo;
                    timeSignature = canonicalSong.metadata.timeSignature || parsed.metadata.time;
                }

                // Derive default tempoNote from time signature denominator if not explicitly set
                let tempoNote = '1/4'; // Default to quarter notes
                if (timeSignature) {
                    const [, denominator] = timeSignature.split('/').map(s => s.trim());
                    if (denominator) {
                        tempoNote = `1/${denominator}`;
                    }
                }
                // Override with explicit tempoNote if available from database
                if (canonicalSong && canonicalSong.metadata && canonicalSong.metadata.tempoNote) {
                    tempoNote = canonicalSong.metadata.tempoNote;
                }

                // Create song object for runtime
                songs.push({
                    title: parsed.metadata.title || `Song ${songEntry.order + 1}`,
                    htmlContent: htmlContent,
                    metadata: {
                        ...parsed.metadata,
                        tempo: currentBPM,
                        tempoNote: tempoNote,
                        timeSignature: timeSignature
                    },
                    originalKey: originalKey, // Immutable original
                    currentKey: parsed.metadata.key,
                    currentBPM: currentBPM,
                    currentFontSize: songEntry.modifications.fontSize || CONFIG.DEFAULT_FONT_SIZE,
                    songId: songEntry.songId,
                    sourceText: sourceText,
                    hasLocalEdits: songEntry.chordproEdits !== null
                });
            }

            console.log('Parsed songs:', songs.length);

            // Store songs for navigation
            this.songs = songs;
            this.currentSetlistId = setlistId;
            this.currentSetlist = setlist;

            // Load section states from setlist modifications (not localStorage anymore)
            this.sectionState = {};
            setlist.songs.forEach((songEntry, index) => {
                if (songEntry.modifications.sectionStates) {
                    this.sectionState[index] = {};
                    for (const [sectionIdx, state] of Object.entries(songEntry.modifications.sectionStates)) {
                        this.sectionState[index][parseInt(sectionIdx)] = state;
                    }
                }
            });

            // Check hash BEFORE rendering to determine initial view state
            const hash = window.location.hash;
            const hashValue = hash.substring(1);
            const shouldShowSongDirectly = hashValue && hashValue.startsWith('song-');
            console.log('[Initial Load] hash:', hash, 'hashValue:', hashValue, 'shouldShowSongDirectly:', shouldShowSongDirectly);

            // Render all songs on one page
            const container = document.querySelector('.song-container');
            console.log('Rendering full setlist into container:', container);
            // Clear container and append fragment
            container.textContent = '';
            const fragment = this.renderFullSetlist(setlist, songs);
            container.appendChild(fragment);

            // If going directly to a song, scroll to it immediately (before layout/paint)
            if (shouldShowSongDirectly) {
                const songIndex = parseInt(hashValue.split('-')[1]);
                console.log('[Initial Load] Going directly to song index:', songIndex);

                const targetSection = container.querySelector(`#song-${songIndex}`);
                if (targetSection) {
                    // Set scroll position immediately, before browser paints
                    container.scrollLeft = targetSection.offsetLeft;
                    console.log('[Initial Load] Set scroll position to:', targetSection.offsetLeft);
                } else {
                    console.warn('[Initial Load] Could not find target section song-' + songIndex);
                }
            }

            // Set up navigation based on hash
            console.log('About to setup hash navigation');
            this.setupHashNavigation(setlistId, songs.length);

            // Navigate to the correct section based on hash
            console.log('Current hash:', hash);

            // Set up initial view state (no scrolling on page load)
            if (hash) {
                if (hashValue === 'overview') {
                    // Overview is already visible by default
                    this._lastVisibleSection = 'overview';
                    this.updateHeader(null, true); // true = instant, no animation
                    this.exitEditMode();
                    this.dispatchSongChange(null);
                    // Set initial history state
                    history.replaceState({ view: 'overview' }, '', window.location.href);
                } else if (hashValue.startsWith('song-')) {
                    const index = parseInt(hashValue.split('-')[1]);
                    // Song is already visible from pre-render setup above
                    this._lastVisibleSection = `song-${index}`;
                    this.updateHeader(this.songs[index], true); // true = instant, no animation
                    this.applyFontSize(index);
                    this.exitEditMode();
                    // Dispatch song-change event for media player
                    if (this.songs[index]) {
                        this.dispatchSongChange(this.songs[index]);
                    }
                    // Set initial history state (without fromOverview since we loaded directly)
                    history.replaceState({ view: 'song', index: index }, '', window.location.href);
                }
            } else {
                // Default to overview (already visible)
                console.log('No hash, showing overview');
                this._lastVisibleSection = 'overview';
                this.updateHeader(null, true); // true = instant, no animation
                this.exitEditMode();
                this.dispatchSongChange(null);
                // Set initial history state and add hash
                const overviewUrl = `${window.location.pathname}#overview`;
                history.replaceState({ view: 'overview' }, '', overviewUrl);
            }

            // Wait for layout to complete before other setup
            requestAnimationFrame(() => {

                // Set up drag-and-drop (only enabled in edit mode)
                if (this.overviewEditMode) {
                    this.setupOverviewDragDrop();
                }

                // Set up edit mode toggle (handles both overview and song edit modes)
                this.setupEditMode();

                // Set up app-header event listeners (info button and nav menu)
                this.setupAppHeaderEvents();

                // Set up section control buttons
                this.setupSectionControls();

                // Apply saved state to sections
                this.applySectionState();

                // Set up key selector
                this.setupKeySelector();

                // Set up font size controls
                this.setupFontSizeControls();

                // Set up reset button
                this.setupResetButton();

                // Set up Intersection Observer to auto-detect current song
                this.setupSectionObserver();
            });

        } catch (error) {
            console.error('Error loading setlist:', error);
            const container = document.querySelector('.song-container');
            container.textContent = '';
            const msg = document.createElement('p');
            msg.textContent = 'Error loading songs. Please check the console.';
            container.appendChild(msg);
        }
    }

    formatDate(dateStr) {
        try {
            const date = new Date(dateStr + 'T00:00:00');
            if (isNaN(date.getTime())) {
                return dateStr;
            }
            return date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch (error) {
            return dateStr;
        }
    }

    renderFullSetlist(setlist, songs) {
        const fragment = document.createDocumentFragment();

        // Create overview section
        const overview = document.createElement('div');
        overview.id = 'overview';
        overview.className = 'section';

        const songContentWrapper = document.createElement('div');
        songContentWrapper.className = 'song-content';

        const setlistOverview = document.createElement('div');
        setlistOverview.className = 'setlist-overview';

        const overviewSongs = document.createElement('div');
        overviewSongs.className = 'overview-songs';

        songs.forEach((song, index) => {
            // Create the Lit song-card component
            const card = document.createElement('song-card');
            card.song = song;
            card.variant = 'setlist';
            card.editMode = this.overviewEditMode; // Pass edit mode state
            card.classList.add('overview-song-card');
            card.dataset.songIndex = index;

            // Add click handler to navigate to song
            card.addEventListener('song-click', (e) => {
                this.navigateToHash(`song-${index}`);
            });

            // Add delete button handler (for edit mode)
            card.addEventListener('song-delete', (e) => {
                this.showDeleteSongConfirmation(index, song);
            });

            overviewSongs.appendChild(card);
        });

        // Add "Add Song" button
        const addSongButton = document.createElement('button');
        addSongButton.className = 'song-card add-song-button';
        addSongButton.innerHTML = `
            <div class="song-card-info">
                <div class="song-card-title-row">
                    <div class="song-card-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 8px;">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Add Song
                    </div>
                </div>
            </div>
        `;
        addSongButton.addEventListener('click', () => {
            this.openAddSongModal();
        });

        // Initially hidden - only show in edit mode
        addSongButton.style.display = 'none';

        overviewSongs.appendChild(addSongButton);

        setlistOverview.appendChild(overviewSongs);
        songContentWrapper.appendChild(setlistOverview);
        overview.appendChild(songContentWrapper);
        fragment.appendChild(overview);

        // Render all songs
        songs.forEach((song, index) => {
            const songSection = document.createElement('div');
            songSection.id = `song-${index}`;
            songSection.className = 'section';

            const songContent = document.createElement('div');
            songContent.className = 'song-content';
            // Parser returns DocumentFragment now
            songContent.appendChild(song.htmlContent);

            songSection.appendChild(songContent);
            fragment.appendChild(songSection);
        });

        return fragment;
    }

    showOverview(instant = false) {
        // Update the last visible section to prevent observer from triggering
        this._lastVisibleSection = 'overview';

        this.scrollToSection('overview', -1, instant);
        // Update header with animation for programmatic navigation
        this.updateHeader(null, false);
        this.exitEditMode();

        // Dispatch song-change event with null to clear media player
        this.dispatchSongChange(null);
    }

    showSong(index, instant = false) {
        // Update the last visible section to prevent observer from triggering
        this._lastVisibleSection = `song-${index}`;

        this.scrollToSection(`song-${index}`, index, instant);
        // Update header with animation for programmatic navigation
        this.updateHeader(this.songs[index], false);
        this.applyFontSize(index);
        this.exitEditMode();

        // Dispatch song-change event for media player
        if (this.songs[index]) {
            this.dispatchSongChange(this.songs[index]);
        }
    }

    async exitEditMode() {
        const isEditMode = document.body.classList.contains('edit-mode');
        if (isEditMode) {
            const appHeader = document.getElementById('app-header');
            document.body.classList.remove('edit-mode');
            if (appHeader) {
                appHeader.editMode = false;
            }

            // Update all sections to reflect non-edit mode
            document.querySelectorAll('.song-section-wrapper[data-song-index][data-section-index]').forEach(wrapper => {
                const songIndex = parseInt(wrapper.dataset.songIndex);
                const sectionIndex = parseInt(wrapper.dataset.sectionIndex);
                this.updateSectionDOM(songIndex, sectionIndex);
            });

            // Save setlist to IndexedDB
            if (this.currentSetlist) {
                // Update modifications for each song
                this.songs.forEach((song, index) => {
                    this.currentSetlist.songs[index].modifications.fontSize = song.currentFontSize;

                    // Save section states
                    const sectionStates = {};
                    if (this.sectionState[index]) {
                        for (const [sectionIdx, state] of Object.entries(this.sectionState[index])) {
                            sectionStates[sectionIdx] = state;
                        }
                    }
                    this.currentSetlist.songs[index].modifications.sectionStates = sectionStates;
                });

                // Update timestamp
                this.currentSetlist.updatedAt = new Date().toISOString();

                // Save to database
                await this.db.saveSetlist(this.currentSetlist);
                console.log('[ExitEditMode] Saved setlist to IndexedDB');
            }
        }
    }

    async updateHeader(song, instant = false) {
        const appHeader = document.getElementById('app-header');
        const metaEl = document.getElementById('song-meta-header');
        const keyDisplayWrapper = document.querySelector('.key-display-wrapper');
        const resetButton = document.getElementById('reset-button');
        const fontSizeControls = document.querySelector('.font-size-controls');
        const keySelectorValue = document.getElementById('key-selector-value');

        // Determine new title
        let newTitle;
        if (song) {
            newTitle = song.title;
        } else {
            if (this.currentSetlist) {
                const formattedDate = this.formatSetlistName(this.currentSetlist.date);
                newTitle = this.currentSetlist.name
                    ? `${formattedDate} - ${this.currentSetlist.name}`
                    : formattedDate;
            } else {
                newTitle = 'Setlist';
            }
        }

        // Check if content is actually changing
        const titleChanged = appHeader.title !== newTitle;
        if (!titleChanged && !instant) {
            return; // No change needed
        }

        if (instant) {
            // Instant update - no animation
            appHeader.setTitleInstant(newTitle);
            this._updateHeaderContent(song, metaEl, keyDisplayWrapper, resetButton, fontSizeControls, keySelectorValue);
        } else {
            // Animated update - fade out old, swap content, fade in new
            appHeader.title = newTitle;

            await this._animateSlottedContent(async () => {
                this._updateHeaderContent(song, metaEl, keyDisplayWrapper, resetButton, fontSizeControls, keySelectorValue);
            });
        }
    }

    _updateHeaderContent(song, metaEl, keyDisplayWrapper, resetButton, fontSizeControls, keySelectorValue) {
        if (song) {
            // Update key selector value
            if (song.currentKey) {
                this.populateKeySelector(song.currentKey);
            } else {
                if (keySelectorValue) keySelectorValue.textContent = '-';
            }

            // Update BPM
            metaEl.textContent = '';
            if (song.currentBPM) {
                const metaItem = document.createElement('span');
                metaItem.className = 'meta-item';

                const label = document.createElement('span');
                label.className = 'meta-label';
                label.textContent = 'BPM:';
                metaItem.appendChild(label);

                const formattedTempo = formatTempo(song.currentBPM, song.metadata?.tempoNote);
                metaItem.appendChild(document.createTextNode(' ' + formattedTempo));
                metaEl.appendChild(metaItem);
            }

            // Show song-specific controls
            if (keyDisplayWrapper) keyDisplayWrapper.style.display = 'flex';
            if (resetButton) resetButton.style.display = 'block';
            if (fontSizeControls) fontSizeControls.style.display = 'flex';

            // Store current song for info button handler
            this._currentSongForInfo = song;
        } else {
            // Overview - clear key
            if (keySelectorValue) {
                keySelectorValue.textContent = '-';
            }

            // Show setlist type in metadata
            metaEl.textContent = '';
            if (this.currentSetlist && this.currentSetlist.type) {
                const typeSpan = document.createElement('span');
                typeSpan.className = 'meta-item';
                typeSpan.textContent = this.currentSetlist.type;
                metaEl.appendChild(typeSpan);
            }

            // Hide song-specific controls on overview
            if (keyDisplayWrapper) keyDisplayWrapper.style.display = 'none';
            if (resetButton) resetButton.style.display = 'none';
            if (fontSizeControls) fontSizeControls.style.display = 'none';

            // Store that we're on overview for info button handler
            this._currentSongForInfo = null;
        }
    }

    dispatchSongChange(song) {
        // Dispatch custom event for media player to listen to
        const event = new CustomEvent('song-change', {
            detail: { song },
            bubbles: true,
            composed: true
        });

        document.dispatchEvent(event);
        console.log('[SongChange] Dispatched song:', song?.songId, song?.title);
    }

    async showSongInfo(song) {
        const modal = document.getElementById('song-info-modal');
        const modalBody = document.getElementById('modal-body');

        // Clear previous content
        modalBody.textContent = '';

        modal.show();

        // Create or get song-info component
        let songInfoEl = modalBody.querySelector('song-info');
        if (!songInfoEl) {
            songInfoEl = document.createElement('song-info');
            modalBody.appendChild(songInfoEl);
        }

        // Show loading state
        songInfoEl.loading = true;

        // Load full song data from database to get appearances
        const fullSong = await this.db.getSong(song.songId);
        if (!fullSong) {
            console.error('Could not load full song data for:', song.songId);
            songInfoEl.loading = false;
            songInfoEl.song = null;
            return;
        }

        // Load song usage data to get appearances
        const songUsage = await this.db.getSongUsage(song.songId);

        // Convert usage history to appearances format
        const appearances = songUsage?.usageHistory?.map(entry => ({
            setlistId: entry.setlistId,
            date: entry.setlistDate,
            playedInKey: entry.playedInKey,
            leader: entry.leader,
            setlistName: entry.setlistName
        })) || [];

        // Merge the display song data with the full database song data
        const songData = {
            ...fullSong,
            title: song.title,
            metadata: song.metadata
        };

        // Update component
        songInfoEl.loading = false;
        songInfoEl.song = songData;
        songInfoEl.appearances = appearances;
    }

    showSetlistInfo() {
        const modal = document.getElementById('song-info-modal');
        const modalBody = document.getElementById('modal-body');

        // Clear previous content
        modalBody.textContent = '';

        if (!this.currentSetlist) {
            modalBody.textContent = 'No setlist information available.';
            modal.show();
            return;
        }

        modal.show();

        // Create title
        const title = document.createElement('h2');
        const formattedDate = this.formatSetlistName(this.currentSetlist.date);
        title.textContent = this.currentSetlist.name
            ? `${formattedDate} - ${this.currentSetlist.name}`
            : formattedDate;
        modalBody.appendChild(title);

        // Create info grid
        const infoGrid = document.createElement('div');
        infoGrid.className = 'modal-info-grid';

        // Get template for info items
        const itemTemplate = document.getElementById('song-info-item-template');

        // Helper function to add info items
        const addInfoItem = (label, value) => {
            if (!value) return; // Skip empty values
            const clone = itemTemplate.content.cloneNode(true);
            const labelEl = clone.querySelector('.modal-info-label');
            const valueEl = clone.querySelector('.modal-info-value');

            labelEl.textContent = label;
            valueEl.textContent = value;

            infoGrid.appendChild(clone);
        };

        // Add setlist metadata
        addInfoItem('Date', this.formatSetlistName(this.currentSetlist.date));

        if (this.currentSetlist.time) {
            addInfoItem('Time', this.currentSetlist.time);
        }

        if (this.currentSetlist.type) {
            addInfoItem('Type', this.currentSetlist.type);
        }

        if (this.currentSetlist.name) {
            addInfoItem('Name', this.currentSetlist.name);
        }

        if (this.currentSetlist.leader) {
            addInfoItem('Leader', this.currentSetlist.leader);
        }

        if (this.currentSetlist.venue) {
            addInfoItem('Venue', this.currentSetlist.venue);
        }

        // Add song count
        const songCount = this.currentSetlist.songs ? this.currentSetlist.songs.length : 0;
        addInfoItem('Songs', `${songCount} song${songCount !== 1 ? 's' : ''}`);

        // Add timestamps
        if (this.currentSetlist.createdAt) {
            const created = new Date(this.currentSetlist.createdAt);
            addInfoItem('Created', created.toLocaleString());
        }

        if (this.currentSetlist.updatedAt) {
            const updated = new Date(this.currentSetlist.updatedAt);
            addInfoItem('Last Modified', updated.toLocaleString());
        }

        modalBody.appendChild(infoGrid);

        // Show modal
        modal.classList.add('active');

        // Close modal handlers
        const closeBtn = document.getElementById('modal-close');
        closeBtn.onclick = () => modal.classList.remove('active');
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        };
    }

    scrollToSection(sectionId, newIndex, instant = false) {
        const section = document.getElementById(sectionId);
        const container = document.querySelector('.song-container');

        console.log('Scrolling to:', sectionId, 'index:', newIndex, 'instant:', instant);

        if (!section || !container) return;

        // Disable observer during programmatic scroll
        this._isProgrammaticScroll = true;

        // Scroll the container to bring the section into view
        const scrollLeft = section.offsetLeft;

        if (instant) {
            // Jump immediately without animation
            container.scrollLeft = scrollLeft;
            // Re-enable observer immediately for instant scrolls
            this._isProgrammaticScroll = false;
        } else {
            // Smooth scroll animation
            container.scrollTo({
                left: scrollLeft,
                behavior: 'smooth'
            });

            // Re-enable observer after scroll animation completes
            // Smooth scrolling typically takes 300-500ms
            setTimeout(() => {
                this._isProgrammaticScroll = false;
            }, 600);
        }

        // Note: currentSongIndex is now automatically tracked by Intersection Observer
        // but we set it here for immediate feedback before observer fires
        this.currentSongIndex = newIndex;
    }

    setupSectionObserver() {
        // Clean up existing observer if any
        if (this.sectionObserver) {
            this.sectionObserver.disconnect();
        }

        const container = document.querySelector('.song-container');
        if (!container) return;

        // Track the most recently visible section to avoid duplicate updates
        this._lastVisibleSection = null;

        // Observer watches which section is currently in view
        this.sectionObserver = new IntersectionObserver((entries) => {
            // Skip if this is a programmatic scroll
            if (this._isProgrammaticScroll) return;

            // Find the most visible entry
            let mostVisible = null;
            let maxRatio = 0;

            entries.forEach(entry => {
                if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
                    maxRatio = entry.intersectionRatio;
                    mostVisible = entry;
                }
            });

            // Only update if we found a visible section and it's different from last time
            if (mostVisible && mostVisible.intersectionRatio > CONFIG.VISIBILITY_THRESHOLD) {
                const sectionId = mostVisible.target.id;

                // Skip if this is the same section we just updated
                if (sectionId === this._lastVisibleSection) return;

                this._lastVisibleSection = sectionId;

                if (sectionId === 'overview') {
                    this.currentSongIndex = -1;
                    this.updateHeader(null, false); // animate=true for smooth transition
                    this.dispatchSongChange(null);
                } else if (sectionId.startsWith('song-')) {
                    const index = parseInt(sectionId.split('-')[1]);
                    if (index >= 0 && index < this.songs.length) {
                        this.currentSongIndex = index;
                        this.updateHeader(this.songs[index], false); // animate=true for smooth transition
                        this.applyFontSize(index);
                        this.dispatchSongChange(this.songs[index]);
                    }
                }
            }
        }, {
            root: container,
            threshold: [0, 0.5, 1], // Trigger at 0%, 50%, and 100% visibility
            rootMargin: '0px'
        });

        // Observe all sections (overview + all songs)
        document.querySelectorAll('.section').forEach(section => {
            this.sectionObserver.observe(section);
        });
    }

    setupHashNavigation(setlistId, totalSongs) {
        // Listen for popstate (back/forward button)
        window.addEventListener('popstate', (event) => {
            const hash = window.location.hash.substring(1) || 'overview';
            console.log('Popstate to:', hash, 'state:', event.state);

            if (hash === 'overview' || !hash) {
                this.showOverview(false);
            } else if (hash.startsWith('song-')) {
                const index = parseInt(hash.split('-')[1]);
                if (index >= 0 && index < totalSongs) {
                    this.showSong(index, false);
                }
            }

            // Update navigation menu after popstate
            const route = window.__ROUTE__ || this.parseRoute(window.location.pathname);
            this.updateNavigationMenu(route);
        });

        console.log('History navigation setup complete for', totalSongs, 'songs');
    }

    navigateToHash(hash) {
        const targetIsSong = hash.startsWith('song-');
        const targetIsOverview = hash === 'overview';
        const currentIsSong = this.currentSongIndex >= 0;
        const currentIsOverview = this.currentSongIndex < 0;

        const newUrl = `${window.location.pathname}#${hash}`;

        // Determine navigation action based on current and target
        if (currentIsOverview && targetIsSong) {
            // Overview → Song: PUSH (going deeper into the app)
            const songIndex = parseInt(hash.split('-')[1]);
            history.pushState({ fromOverview: true, view: 'song', index: songIndex }, '', newUrl);
            this.showSong(songIndex, false);
        } else if (currentIsSong && targetIsSong) {
            // Song → Song: REPLACE (lateral navigation within same level)
            const songIndex = parseInt(hash.split('-')[1]);
            // Preserve fromOverview flag if it exists
            const fromOverview = history.state?.fromOverview || false;
            history.replaceState({ fromOverview, view: 'song', index: songIndex }, '', newUrl);
            this.showSong(songIndex, false);
        } else if (currentIsSong && targetIsOverview) {
            // Song → Overview: Try to go back if we came from overview
            if (history.state && history.state.fromOverview) {
                // We pushed from overview, so we can safely go back
                // The popstate handler will call showOverview()
                history.back();
            } else {
                // We didn't come from overview (e.g., direct link), so replace
                history.replaceState({ view: 'overview' }, '', newUrl);
                this.showOverview(false);
            }
        } else {
            // Overview → Overview or other edge cases: REPLACE
            history.replaceState({ view: 'overview' }, '', newUrl);
            if (targetIsOverview) {
                this.showOverview(false);
            }
        }

        // Update navigation menu after changing hash
        const route = window.__ROUTE__ || this.parseRoute(window.location.pathname);
        this.updateNavigationMenu(route);
    }

    loadState() {
        const stateKey = `setalight-state-${this.currentSetlistId}`;
        const savedState = localStorage.getItem(stateKey);
        if (savedState) {
            try {
                this.sectionState = JSON.parse(savedState);
            } catch (e) {
                console.error('Failed to parse saved state:', e);
                this.sectionState = {};
            }
        } else {
            this.sectionState = {};
        }
    }

    saveState() {
        const stateKey = `setalight-state-${this.currentSetlistId}`;
        localStorage.setItem(stateKey, JSON.stringify(this.sectionState));
    }

    getSectionState(songIndex, sectionIndex) {
        if (!this.sectionState[songIndex]) {
            this.sectionState[songIndex] = {};
        }
        if (!this.sectionState[songIndex][sectionIndex]) {
            this.sectionState[songIndex][sectionIndex] = {
                hideMode: 'none', // 'none', 'collapse', 'chords', 'lyrics', 'hide'
                isCollapsed: false,
                isHidden: false
            };
        }
        return this.sectionState[songIndex][sectionIndex];
    }

    setSectionHideMode(songIndex, sectionIndex, mode) {
        const state = this.getSectionState(songIndex, sectionIndex);

        if (mode === 'hide') {
            // Toggle hide state - mutually exclusive with all others
            state.isHidden = !state.isHidden;
            if (state.isHidden) {
                // Clear other modes when hiding entire section
                state.hideMode = 'hide';
                state.isCollapsed = false;
            } else {
                state.hideMode = 'none';
            }
            this.saveState();
            this.updateSectionDOM(songIndex, sectionIndex);
        } else if (mode === 'collapse') {
            // Simulate clicking the section heading (same behavior as normal mode)
            const wrapper = document.querySelector(`.song-section-wrapper[data-song-index="${songIndex}"][data-section-index="${sectionIndex}"]`);
            if (wrapper) {
                const summary = wrapper.querySelector('.section-label');
                if (summary) {
                    summary.click();
                }
            }
        } else {
            // chords or lyrics mode - mutually exclusive with all others
            if (state.isHidden) {
                // If entire section is hidden, unhide it first
                state.isHidden = false;
            }
            if (state.isCollapsed) {
                // If collapsed, uncollapse it first
                state.isCollapsed = false;
            }
            // Toggle: if clicking the same mode, turn it off
            state.hideMode = (state.hideMode === mode) ? 'none' : mode;
            this.saveState();
            this.updateSectionDOM(songIndex, sectionIndex);
        }
    }

    animateSectionToggle(songIndex, sectionIndex, details) {
        const state = this.getSectionState(songIndex, sectionIndex);
        const content = details.querySelector('.section-content');
        const wrapper = details.closest('.song-section-wrapper');
        if (!content) return;

        const isEditMode = document.body.classList.contains('edit-mode');

        // Determine if we're opening or closing based on current state
        const isCurrentlyCollapsed = state.isCollapsed;
        const isOpening = isCurrentlyCollapsed;

        if (isOpening) {
            // Opening: update state first
            state.isCollapsed = false;
            state.hideMode = 'none';
            this.saveState();

            // Update wrapper classes
            wrapper.classList.remove('section-collapsed');
            this.updateButtonStates(wrapper, state);

            // In normal mode, open details; in edit mode it's always open
            if (!isEditMode) {
                details.open = true;
            }

            // Get the natural height
            const startHeight = 0;
            const endHeight = content.scrollHeight;

            // Animate from 0 to full height
            content.style.height = startHeight + 'px';
            content.style.overflow = 'hidden';

            requestAnimationFrame(() => {
                content.style.transition = 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
                content.style.height = endHeight + 'px';

                // Clean up after animation
                setTimeout(() => {
                    content.style.height = '';
                    content.style.overflow = '';
                    content.style.transition = '';
                }, 350);
            });
        } else {
            // Closing: animate first, then update state
            const startHeight = content.scrollHeight;
            const endHeight = 0;

            // Set explicit height
            content.style.height = startHeight + 'px';
            content.style.overflow = 'hidden';

            requestAnimationFrame(() => {
                content.style.transition = 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
                content.style.height = endHeight + 'px';

                // After animation completes, update state
                setTimeout(() => {
                    state.isCollapsed = true;
                    state.hideMode = 'collapse';
                    this.saveState();

                    // Update wrapper classes (adds section-collapsed)
                    wrapper.classList.add('section-collapsed');
                    this.updateButtonStates(wrapper, state);

                    // In normal mode, close details; in edit mode keep it open
                    if (!isEditMode) {
                        details.open = false;
                    }

                    content.style.height = '';
                    content.style.overflow = '';
                    content.style.transition = '';
                }, 350);
            });
        }
    }

    updateSectionDOM(songIndex, sectionIndex) {
        const wrapper = document.querySelector(`.song-section-wrapper[data-song-index="${songIndex}"][data-section-index="${sectionIndex}"]`);
        if (!wrapper) return;

        const state = this.getSectionState(songIndex, sectionIndex);
        const details = wrapper.querySelector('.song-section');

        // Update classes based on hideMode
        wrapper.classList.toggle('section-hidden', state.isHidden);
        wrapper.classList.toggle('section-collapsed', state.hideMode === 'collapse');
        wrapper.classList.toggle('chords-hidden', state.hideMode === 'chords');
        wrapper.classList.toggle('lyrics-hidden', state.hideMode === 'lyrics');

        // Update details open/closed based on edit mode and collapsed state
        const isEditMode = document.body.classList.contains('edit-mode');
        if (isEditMode) {
            details.open = true; // Always open in edit mode
        } else {
            details.open = !state.isCollapsed; // Closed if section is collapsed, when not in edit mode
        }

        // Update button states (active/inactive)
        this.updateButtonStates(wrapper, state);
    }

    updateButtonStates(wrapper, state) {
        const collapseBtn = wrapper.querySelector('.section-collapse-btn');
        const chordsBtn = wrapper.querySelector('.chords-toggle-btn');
        const lyricsBtn = wrapper.querySelector('.lyrics-toggle-btn');
        const hideBtn = wrapper.querySelector('.section-hide-btn');

        if (collapseBtn) {
            collapseBtn.classList.toggle('active', state.hideMode === 'collapse');
        }
        if (chordsBtn) {
            chordsBtn.classList.toggle('active', state.hideMode === 'chords');
        }
        if (lyricsBtn) {
            lyricsBtn.classList.toggle('active', state.hideMode === 'lyrics');
        }
        if (hideBtn) {
            hideBtn.classList.toggle('active', state.isHidden);
        }
    }

    applySectionState() {
        // Apply all saved state to DOM
        document.querySelectorAll('.song-section-wrapper[data-song-index][data-section-index]').forEach(wrapper => {
            const songIndex = parseInt(wrapper.dataset.songIndex);
            const sectionIndex = parseInt(wrapper.dataset.sectionIndex);
            this.updateSectionDOM(songIndex, sectionIndex);
        });
    }

    setupEditMode() {
        const appHeader = document.getElementById('app-header');
        if (!appHeader) return;

        // Listen to the edit-mode-toggle event from app-header
        appHeader.addEventListener('edit-mode-toggle', async () => {
            // Check if we're on overview or song view
            if (this.currentSongIndex < 0) {
                // We're on overview - toggle overview edit mode
                this.toggleOverviewEditMode();
                return;
            }

            // We're on song view - handle song edit mode
            const isEnteringEditMode = !document.body.classList.contains('edit-mode');

            if (isEnteringEditMode) {
                // Entering edit mode - fade out normal controls, fade in edit controls
                document.body.classList.add('edit-mode');
                appHeader.editMode = true;

                // Clear inline display:none if it was set during previous exit
                document.querySelectorAll('.edit-mode-control').forEach(el => {
                    el.style.display = '';
                });

                // Trigger fade-in for all edit mode controls after a frame
                requestAnimationFrame(() => {
                    document.querySelectorAll('.edit-mode-control').forEach(el => {
                        el.classList.add('fade-in');
                    });
                });

                // After fade completes, mark normal controls as fade-complete
                setTimeout(() => {
                    document.querySelectorAll('.normal-mode-control').forEach(el => {
                        el.classList.add('fade-complete');
                    });
                }, 250);

                // Update all sections based on edit mode
                document.querySelectorAll('.song-section-wrapper[data-song-index][data-section-index]').forEach(wrapper => {
                    const songIndex = parseInt(wrapper.dataset.songIndex);
                    const sectionIndex = parseInt(wrapper.dataset.sectionIndex);
                    this.updateSectionDOM(songIndex, sectionIndex);
                });
            } else {
                // Exiting edit mode - fade everything simultaneously
                // Remove edit mode class immediately to trigger all fades
                document.body.classList.remove('edit-mode');
                appHeader.editMode = false;

                // Remove fade-in classes from edit controls (triggers fade out)
                document.querySelectorAll('.edit-mode-control').forEach(el => {
                    el.classList.remove('fade-in');
                });

                // Remove fade-complete from normal controls (makes them visible again)
                document.querySelectorAll('.normal-mode-control').forEach(el => {
                    el.classList.remove('fade-complete');
                });

                // Wait for fade to complete, then save and cleanup
                setTimeout(async () => {
                    // Hide edit controls completely now that fade is done
                    document.querySelectorAll('.edit-mode-control').forEach(el => {
                        el.style.display = 'none';
                    });

                    // Update all sections to reflect non-edit mode (apply collapsed/open states to <details>)
                    // This must happen AFTER removing edit-mode class so details elements get the right state
                    document.querySelectorAll('.song-section-wrapper[data-song-index][data-section-index]').forEach(wrapper => {
                        const songIndex = parseInt(wrapper.dataset.songIndex);
                        const sectionIndex = parseInt(wrapper.dataset.sectionIndex);
                        this.updateSectionDOM(songIndex, sectionIndex);
                    });

                    // Save setlist to IndexedDB
                    if (this.currentSetlist) {
                        // Update modifications for each song
                        this.songs.forEach((song, index) => {
                            this.currentSetlist.songs[index].modifications.fontSize = song.currentFontSize;

                            // Save section states
                            const sectionStates = {};
                            if (this.sectionState[index]) {
                                for (const [sectionIdx, state] of Object.entries(this.sectionState[index])) {
                                    sectionStates[sectionIdx] = state;
                                }
                            }
                            this.currentSetlist.songs[index].modifications.sectionStates = sectionStates;
                        });

                        // Update timestamp
                        this.currentSetlist.updatedAt = new Date().toISOString();

                        // Save to database
                        await this.db.saveSetlist(this.currentSetlist);
                        console.log('[ExitEditMode] Saved setlist to IndexedDB');
                    }
                }, 250);
            }
        });
    }

    setupAppHeaderEvents() {
        const appHeader = document.getElementById('app-header');
        if (!appHeader) return;

        // Listen to info button clicks
        appHeader.addEventListener('info-click', () => {
            if (this._currentSongForInfo) {
                this.showSongInfo(this._currentSongForInfo);
            } else {
                this.showSetlistInfo();
            }
        });

        // Listen to share button clicks
        appHeader.addEventListener('share-click', () => {
            const shareModal = document.getElementById('share-modal');
            const shareSetlist = document.getElementById('share-setlist');
            if (shareModal && shareSetlist) {
                // Pass current setlist to share component
                shareSetlist.setlist = this.currentSetlist;
                shareModal.show();
            }
        });

        // Listen to nav menu clicks - toggle the popover
        appHeader.addEventListener('nav-menu-click', (e) => {
            const navMenu = document.getElementById('nav-menu');
            if (navMenu) {
                // Get the nav button from the app-header component
                const navButton = appHeader.shadowRoot?.querySelector('.nav-menu-button');
                if (navButton) {
                    navMenu.setTriggerButton(navButton);
                }
                navMenu.togglePopover();
            }
        });
    }

    setupSectionControls() {
        document.querySelectorAll('.section-control-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = button.dataset.action;
                const wrapper = button.closest('.song-section-wrapper');

                const songIndex = parseInt(wrapper.dataset.songIndex);
                const sectionIndex = parseInt(wrapper.dataset.sectionIndex);

                // Pass action directly (collapse, chords, lyrics, hide)
                this.setSectionHideMode(songIndex, sectionIndex, action);
            });
        });

        // Listen to native details toggle events with animation
        document.querySelectorAll('.song-section-wrapper .song-section').forEach(details => {
            // Click handler for summary to animate the toggle
            const summary = details.querySelector('.section-label');
            if (summary) {
                summary.addEventListener('click', (e) => {
                    const wrapper = details.closest('.song-section-wrapper');
                    if (!wrapper) return;

                    const songIndex = parseInt(wrapper.dataset.songIndex);
                    const sectionIndex = parseInt(wrapper.dataset.sectionIndex);

                    // Always prevent default and use our animation
                    e.preventDefault();
                    this.animateSectionToggle(songIndex, sectionIndex, details);
                });
            }
        });
    }

    populateKeySelector(selectedKey) {
        const keyOptionsList = document.getElementById('key-options-list');
        const keySelectorValue = document.getElementById('key-selector-value');
        if (!keyOptionsList || !keySelectorValue) return;

        // Get available keys rotated around the selected key
        const keys = getAvailableKeys(selectedKey);

        // Get original key from current song
        let originalKey = null;
        if (this.currentSongIndex >= 0 && this.songs[this.currentSongIndex]) {
            originalKey = this.songs[this.currentSongIndex].originalKey;
        }

        // Clear existing options
        keyOptionsList.textContent = '';

        // Unicode superscript mapping for smaller offset numbers
        const toSuperscript = (num) => {
            const superscripts = {
                '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
                '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
                '+': '⁺', '-': '⁻'
            };
            return String(num).split('').map(c => superscripts[c] || c).join('');
        };

        // Find the index of the current key in the list
        const currentIndex = keys.indexOf(selectedKey);

        // Add available keys as clickable items with offset indicators
        keys.forEach((key, index) => {
            const item = document.createElement('button');
            item.className = 'key-option-item';
            if (key === selectedKey) {
                item.classList.add('selected');
            }

            // Calculate offset based on position in list
            const positionOffset = currentIndex - index;

            // Format key name with * suffix if original
            let keyText = key === originalKey ? `${key}*` : key;

            // Create key name span
            const keyNameSpan = document.createElement('span');
            keyNameSpan.className = 'key-name';
            keyNameSpan.textContent = keyText;

            // Create offset span
            const offsetSpan = document.createElement('span');
            offsetSpan.className = 'key-offset';
            if (positionOffset !== 0) {
                const sign = positionOffset > 0 ? '+' : '-';
                offsetSpan.textContent = `${sign}${Math.abs(positionOffset)}`;
            }

            item.appendChild(keyNameSpan);
            item.appendChild(offsetSpan);

            // Click handler
            item.addEventListener('click', async () => {
                await this.selectKey(key);
            });

            keyOptionsList.appendChild(item);
        });

        // Update button text to show selected key
        keySelectorValue.textContent = selectedKey;
    }

    setupKeySelector() {
        // Initialize with current song's key
        if (this.currentSongIndex >= 0 && this.songs[this.currentSongIndex]) {
            const currentKey = this.songs[this.currentSongIndex].currentKey;
            if (currentKey) {
                this.populateKeySelector(currentKey);
            }
        }

        // Set up popover positioning
        const button = document.getElementById('key-selector-button');
        const popover = document.getElementById('key-selector-popover');

        if (button && popover) {
            // Position popover when it opens
            popover.addEventListener('toggle', (e) => {
                if (e.newState === 'open') {
                    const buttonRect = button.getBoundingClientRect();
                    popover.style.top = `${buttonRect.bottom + 4}px`;
                    popover.style.left = `${buttonRect.left}px`;
                }
            });
        }
    }

    async selectKey(newKey) {
        if (!newKey || this.currentSongIndex < 0) return;

        console.log(`Key changed to: ${newKey} for song ${this.currentSongIndex}`);

        // Close the popover
        const popover = document.getElementById('key-selector-popover');
        if (popover) {
            popover.hidePopover();
        }

        // Update the displayed key value
        const keyValueDisplay = document.getElementById('key-value-display');
        if (keyValueDisplay) {
            keyValueDisplay.textContent = newKey;
        }

        // Update modification in setlist
        this.currentSetlist.songs[this.currentSongIndex].modifications.targetKey = newKey;

        // Re-render the song with transposition
        await this.reRenderSong(this.currentSongIndex);

        // Repopulate the dropdown with the new key in the middle
        this.populateKeySelector(newKey);
    }

    setupFontSizeControls() {
        const decreaseBtn = document.getElementById('font-size-decrease');
        const increaseBtn = document.getElementById('font-size-increase');

        if (!decreaseBtn || !increaseBtn) return;

        decreaseBtn.addEventListener('click', () => {
            if (this.currentSongIndex >= 0) {
                const song = this.songs[this.currentSongIndex];
                song.currentFontSize = Math.max(CONFIG.MIN_FONT_SIZE, song.currentFontSize - CONFIG.FONT_SIZE_STEP);
                this.applyFontSize(this.currentSongIndex);
            }
        });

        increaseBtn.addEventListener('click', () => {
            if (this.currentSongIndex >= 0) {
                const song = this.songs[this.currentSongIndex];
                song.currentFontSize = Math.min(CONFIG.MAX_FONT_SIZE, song.currentFontSize + CONFIG.FONT_SIZE_STEP);
                this.applyFontSize(this.currentSongIndex);
            }
        });
    }

    async _animateSlottedContent(updateCallback) {
        const keyDisplayWrapper = document.querySelector('.key-display-wrapper');
        const metaEl = document.getElementById('song-meta-header');
        const controlsSlot = document.querySelector('.header-controls-slot');

        // Fade out (use the controls slot to fade everything together)
        if (controlsSlot) {
            controlsSlot.style.opacity = '0';
        }

        // Wait for fade-out (300ms to match app-header)
        await new Promise(resolve => setTimeout(resolve, 300));

        // Update content (this happens while opacity is 0, so changes are invisible)
        await updateCallback();

        // Small delay to ensure DOM has updated
        await new Promise(resolve => setTimeout(resolve, 10));

        // Fade in
        if (controlsSlot) {
            controlsSlot.style.opacity = '1';
        }
    }

    applyFontSize(songIndex) {
        if (songIndex < 0 || songIndex >= this.songs.length) return;

        const song = this.songs[songIndex];
        const songSection = document.getElementById(`song-${songIndex}`);

        if (songSection) {
            const songContainer = songSection.querySelector('.song-content');
            if (songContainer) {
                songContainer.style.fontSize = `${song.currentFontSize}rem`;
            }
        }
    }

    setupResetButton() {
        const resetButton = document.getElementById('reset-button');
        const resetModal = document.getElementById('reset-confirm-modal');

        if (!resetButton || !resetModal) return;

        // Show confirmation modal when reset button is clicked
        resetButton.addEventListener('click', () => {
            resetModal.show();
        });

        // Listen for confirm event
        resetModal.addEventListener('confirm', () => {
            this.resetCurrentSong();
        });
    }

    resetCurrentSong() {
        if (this.currentSongIndex < 0 || this.currentSongIndex >= this.songs.length) return;

        const song = this.songs[this.currentSongIndex];

        // Reset key to original
        song.currentKey = song.metadata.key;

        // Reset BPM to original
        song.currentBPM = song.metadata.tempo;

        // Reset font size to default
        song.currentFontSize = CONFIG.DEFAULT_FONT_SIZE;

        // Reset all section states for this song
        if (this.sectionState[this.currentSongIndex]) {
            delete this.sectionState[this.currentSongIndex];
        }

        // Save state
        this.saveState();

        // Update UI
        this.updateHeader(song);
        this.applyFontSize(this.currentSongIndex);

        // Update key selector
        if (song.currentKey) {
            this.populateKeySelector(song.currentKey);
        }

        // Reapply section states (all back to default)
        this.applySectionState();
    }

    setupOverviewDragDrop() {
        const overviewSongs = document.querySelector('.overview-songs');
        if (!overviewSongs) return;

        const buttons = Array.from(document.querySelectorAll('.overview-song-card'));
        if (buttons.length === 0) return;

        // Clean up any existing global event listeners
        if (this._dragPointerMoveHandler) {
            document.removeEventListener('pointermove', this._dragPointerMoveHandler);
        }
        if (this._dragPointerUpHandler) {
            document.removeEventListener('pointerup', this._dragPointerUpHandler);
        }
        if (this._dragPointerCancelHandler) {
            document.removeEventListener('pointercancel', this._dragPointerCancelHandler);
        }

        // Clean up any existing card-level listeners
        if (this._cardPointerDownHandlers) {
            this._cardPointerDownHandlers.forEach((handler, button) => {
                button.removeEventListener('pointerdown', handler);
            });
            this._cardPointerDownHandlers.clear();
        }

        let dragState = {
            active: false,
            button: null,
            startIndex: null,
            currentIndex: null,
            lastAcceptedIndex: null,
            startY: 0,
            currentY: 0,
            buttonInitialTop: 0,
            buttonHeight: 0,
            rafId: null,
            pointerId: null,
            pointerType: null
        };

        const startDrag = (button, clientY) => {
            dragState.active = true;
            dragState.button = button;
            dragState.startIndex = parseInt(button.dataset.songIndex);
            dragState.currentIndex = dragState.startIndex;
            dragState.lastAcceptedIndex = dragState.startIndex;
            dragState.startY = clientY;
            dragState.currentY = clientY;

            // Store initial button position and height
            const rect = button.getBoundingClientRect();
            dragState.buttonInitialTop = rect.top;
            dragState.buttonHeight = rect.height;

            // Add visual feedback
            button.classList.add('dragging');
            overviewSongs.classList.add('reordering');

            // Prevent text selection during drag
            document.body.style.userSelect = 'none';

            // Show initial drop indicator at original position
            performDragUpdate();
        };

        const updateDrag = (clientY) => {
            if (!dragState.active) return;

            dragState.currentY = clientY;

            // Update dragged button position IMMEDIATELY (no throttling for smooth following)
            const offsetY = clientY - dragState.startY;
            dragState.button.style.transform = `scale(1.05) translateY(${offsetY}px)`;

            // Throttle drop target calculations with requestAnimationFrame
            if (dragState.rafId) return;

            dragState.rafId = requestAnimationFrame(() => {
                dragState.rafId = null;
                performDragUpdate();
            });
        };

        const performDragUpdate = () => {
            if (!dragState.active) return;

            const clientY = dragState.currentY;

            // Find which button is being hovered over
            const buttonsArray = Array.from(document.querySelectorAll('.overview-song-card'));
            let proposedIndex = null;

            for (let i = 0; i < buttonsArray.length; i++) {
                const btn = buttonsArray[i];
                if (btn === dragState.button) continue;

                const rect = btn.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;

                if (clientY < midY && clientY >= rect.top) {
                    // Insert before this button
                    proposedIndex = parseInt(btn.dataset.songIndex);
                    break;
                } else if (clientY >= midY && clientY < rect.bottom) {
                    // Insert after this button
                    proposedIndex = parseInt(btn.dataset.songIndex) + 1;
                    break;
                }
            }

            // If no specific target, determine from position
            if (proposedIndex === null) {
                const firstRect = buttonsArray[0]?.getBoundingClientRect();
                const lastRect = buttonsArray[buttonsArray.length - 1]?.getBoundingClientRect();

                if (firstRect && clientY < firstRect.top) {
                    proposedIndex = 0;
                } else if (lastRect && clientY > lastRect.bottom) {
                    proposedIndex = buttonsArray.length;
                } else {
                    proposedIndex = dragState.lastAcceptedIndex;
                }
            }

            // Apply hysteresis: only accept new position if sufficiently different
            // Calculate if we need to switch positions
            let shouldUpdatePosition = false;

            if (proposedIndex !== dragState.lastAcceptedIndex) {
                // Find Y position of the proposed target
                let targetY;
                if (proposedIndex === 0) {
                    targetY = buttonsArray[0]?.getBoundingClientRect().top || 0;
                } else if (proposedIndex >= buttonsArray.length) {
                    targetY = buttonsArray[buttonsArray.length - 1]?.getBoundingClientRect().bottom || clientY;
                } else {
                    targetY = buttonsArray[proposedIndex]?.getBoundingClientRect().top || clientY;
                }

                // Find Y position of current accepted target
                let currentY;
                if (dragState.lastAcceptedIndex === 0) {
                    currentY = buttonsArray[0]?.getBoundingClientRect().top || 0;
                } else if (dragState.lastAcceptedIndex >= buttonsArray.length) {
                    currentY = buttonsArray[buttonsArray.length - 1]?.getBoundingClientRect().bottom || clientY;
                } else {
                    currentY = buttonsArray[dragState.lastAcceptedIndex]?.getBoundingClientRect().top || clientY;
                }

                // Only switch if we've moved past the threshold
                const distance = Math.abs(clientY - currentY);
                if (distance > CONFIG.POSITION_THRESHOLD) {
                    shouldUpdatePosition = true;
                }
            }

            // Update accepted position if threshold met
            if (shouldUpdatePosition) {
                dragState.lastAcceptedIndex = proposedIndex;
            }

            const targetIndex = dragState.lastAcceptedIndex;

            // Clear all drop indicators
            buttonsArray.forEach(btn => {
                btn.classList.remove('drag-over-above', 'drag-over-below', 'will-move-up', 'will-move-down');
                btn.style.removeProperty('--drag-card-height');
            });

            // Apply drop indicator - always show where it will land
            if (targetIndex !== null) {
                // Determine which button to show the indicator on
                let indicatorButton = null;
                let indicatorClass = null;

                if (targetIndex === dragState.startIndex) {
                    // At original position - show placeholder where it was
                    // Use the button immediately after (or before if last)
                    if (dragState.startIndex < buttonsArray.length - 1) {
                        // Not the last button - show above the next button
                        indicatorButton = buttonsArray[dragState.startIndex + 1];
                        indicatorClass = 'drag-over-above';
                    } else if (dragState.startIndex > 0) {
                        // Last button - show below the previous button
                        indicatorButton = buttonsArray[dragState.startIndex - 1];
                        indicatorClass = 'drag-over-below';
                    }
                } else if (targetIndex === dragState.startIndex + 1) {
                    // Adjacent to original - same as original position
                    if (dragState.startIndex < buttonsArray.length - 1) {
                        indicatorButton = buttonsArray[dragState.startIndex + 1];
                        indicatorClass = 'drag-over-above';
                    } else if (dragState.startIndex > 0) {
                        indicatorButton = buttonsArray[dragState.startIndex - 1];
                        indicatorClass = 'drag-over-below';
                    }
                } else if (targetIndex < dragState.startIndex) {
                    // Moving up - show above the target position
                    indicatorButton = buttonsArray[targetIndex];
                    indicatorClass = 'drag-over-above';
                } else {
                    // Moving down - show below the button before the target
                    indicatorButton = buttonsArray[targetIndex - 1];
                    indicatorClass = 'drag-over-below';
                }

                // Apply the indicator class (never on the dragged button)
                if (indicatorButton && indicatorButton !== dragState.button) {
                    indicatorButton.classList.add(indicatorClass);
                    // Set the drop indicator height to match the dragged card
                    indicatorButton.style.setProperty('--drag-card-height', `${dragState.buttonHeight}px`);
                }

                // Apply preview animations only if position actually changes
                if (targetIndex !== dragState.startIndex && targetIndex !== dragState.startIndex + 1) {
                    buttonsArray.forEach((btn, i) => {
                        const btnIndex = parseInt(btn.dataset.songIndex);
                        if (btnIndex === dragState.startIndex) return; // Skip dragged item

                        if (targetIndex < dragState.startIndex) {
                            // Moving up in list
                            if (btnIndex >= targetIndex && btnIndex < dragState.startIndex) {
                                btn.classList.add('will-move-down');
                            }
                        } else {
                            // Moving down in list
                            if (btnIndex > dragState.startIndex && btnIndex < targetIndex) {
                                btn.classList.add('will-move-up');
                            }
                        }
                    });
                }
            }

            dragState.currentIndex = targetIndex;
        };

        const endDrag = async () => {
            if (!dragState.active) return;

            const button = dragState.button;
            const startIndex = dragState.startIndex;
            const targetIndex = dragState.currentIndex;

            // Tell component that drag happened, suppress its click
            // Clean up visual state
            button.classList.remove('dragging');
            button.style.transform = ''; // Reset transform
            overviewSongs.classList.remove('reordering');
            document.body.style.userSelect = '';

            const buttonsArray = Array.from(document.querySelectorAll('.overview-song-card'));
            buttonsArray.forEach(btn => {
                btn.classList.remove('drag-over-above', 'drag-over-below', 'will-move-up', 'will-move-down');
                btn.style.removeProperty('--drag-card-height');
            });

            // Reorder if position changed
            if (targetIndex !== null && targetIndex !== startIndex && targetIndex !== startIndex + 1) {
                // Calculate actual new index (accounting for removal of old position)
                let newIndex = targetIndex > startIndex ? targetIndex - 1 : targetIndex;

                // Reorder songs in the setlist
                const movedSong = this.currentSetlist.songs.splice(startIndex, 1)[0];
                this.currentSetlist.songs.splice(newIndex, 0, movedSong);

                // Update order field for each song
                this.currentSetlist.songs.forEach((song, index) => {
                    song.order = index;
                });

                // Reorder runtime songs array
                const movedRuntimeSong = this.songs.splice(startIndex, 1)[0];
                this.songs.splice(newIndex, 0, movedRuntimeSong);

                // Save to database
                this.currentSetlist.updatedAt = new Date().toISOString();
                await this.db.saveSetlist(this.currentSetlist);

                // Re-render the overview to reflect new order
                const overviewContainer = document.querySelector('.overview-songs');
                if (overviewContainer) {
                    overviewContainer.textContent = '';

                    this.songs.forEach((song, index) => {
                        // Create the Lit song-card component
                        const card = document.createElement('song-card');
                        card.song = song;
                        card.variant = 'setlist';
                        card.editMode = this.overviewEditMode; // Preserve edit mode state
                        card.classList.add('overview-song-card');
                        card.dataset.songIndex = index;

                        // Add click handler to navigate to song
                        card.addEventListener('song-click', () => {
                            this.navigateToHash(`song-${index}`);
                        });

                        // Add delete button handler (for edit mode)
                        card.addEventListener('song-delete', () => {
                            this.showDeleteSongConfirmation(index, song);
                        });

                        overviewContainer.appendChild(card);
                    });

                    this.setupOverviewDragDrop();
                }

                // Re-order song sections in the DOM to match new order
                const container = document.querySelector('.song-container');

                // Get all song sections in their current DOM order
                const songSections = Array.from(document.querySelectorAll('.section[id^="song-"]'));

                // The section that was at startIndex moved to newIndex
                // We need to physically move that DOM section
                const sectionToMove = songSections[startIndex];

                if (sectionToMove) {
                    // Remove the section from its current position
                    sectionToMove.remove();

                    // Get a fresh list of sections after removal
                    const remainingSections = Array.from(document.querySelectorAll('.section[id^="song-"]'));

                    // Insert at the new position
                    if (newIndex === 0) {
                        // Insert at the beginning (after overview)
                        const overview = document.getElementById('overview');
                        if (overview && overview.nextSibling) {
                            container.insertBefore(sectionToMove, overview.nextSibling);
                        } else {
                            container.insertBefore(sectionToMove, container.firstChild);
                        }
                    } else if (newIndex >= remainingSections.length) {
                        // Insert at the end
                        container.appendChild(sectionToMove);
                    } else {
                        // Insert before the section that's currently at the target position
                        const targetSection = remainingSections[newIndex];
                        if (targetSection && targetSection.parentNode === container) {
                            container.insertBefore(sectionToMove, targetSection);
                        } else {
                            container.appendChild(sectionToMove);
                        }
                    }

                    // Now update all section IDs and data-song-index attributes to match new order
                    const updatedSections = Array.from(document.querySelectorAll('.section[id^="song-"]'));
                    updatedSections.forEach((section, index) => {
                        section.id = `song-${index}`;

                        // Update data-song-index on all wrappers inside this section
                        section.querySelectorAll('[data-song-index]').forEach(el => {
                            el.dataset.songIndex = index;
                        });
                    });

                    // Re-apply section states with new indices
                    this.applySectionState();

                    // Re-apply font sizes
                    this.songs.forEach((song, index) => {
                        this.applyFontSize(index);
                    });
                }
            }

            // Cancel any pending animation frame
            if (dragState.rafId) {
                cancelAnimationFrame(dragState.rafId);
            }

            // Reset drag state
            dragState.active = false;
            dragState.button = null;
            dragState.startIndex = null;
            dragState.currentIndex = null;
            dragState.lastAcceptedIndex = null;
            dragState.pointerId = null;
            dragState.pointerType = null;
        };

        const cancelDrag = () => {
            if (dragState.rafId) {
                cancelAnimationFrame(dragState.rafId);
            }

            if (dragState.active) {
                // Clean up visual state without reordering
                if (dragState.button) {
                    dragState.button.classList.remove('dragging');
                    dragState.button.style.transform = ''; // Reset transform
                }
                overviewSongs.classList.remove('reordering');
                document.body.style.userSelect = '';

                const buttonsArray = Array.from(document.querySelectorAll('.overview-song-card'));
                buttonsArray.forEach(btn => {
                    btn.classList.remove('drag-over-above', 'drag-over-below', 'will-move-up', 'will-move-down');
                });
            }

            dragState.active = false;
            dragState.button = null;
            dragState.startIndex = null;
            dragState.currentIndex = null;
            dragState.lastAcceptedIndex = null;
            dragState.pointerId = null;
            dragState.pointerType = null;
        };

        // Store card handlers so we can clean them up later
        this._cardPointerDownHandlers = this._cardPointerDownHandlers || new Map();

        // Attach drag handlers to cards (we'll check if the handle was clicked)
        buttons.forEach(button => {
            const handler = (e) => {
                // Don't start drag if not in edit mode
                if (!this.overviewEditMode) return;

                // Don't start drag if already dragging
                if (dragState.active) return;

                // Only handle primary pointer (left mouse button, primary touch)
                if (!e.isPrimary) return;

                // Check if the event originated from the drag handle
                // We need to check the composed path since the handle is in shadow DOM
                const path = e.composedPath();
                const dragHandle = path.find(el => el.classList?.contains('drag-handle'));

                if (!dragHandle) return; // Only drag when handle is grabbed

                // Prevent the click from bubbling
                e.stopPropagation();

                // Store pointer info
                dragState.button = button;
                dragState.startY = e.clientY;
                dragState.pointerId = e.pointerId;
                dragState.pointerType = e.pointerType;

                // Start drag immediately when handle is grabbed
                startDrag(button, e.clientY);
            };

            button.addEventListener('pointerdown', handler);
            this._cardPointerDownHandlers.set(button, handler);
        });

        // Global pointer event handlers for smooth dragging
        this._dragPointerMoveHandler = (e) => {
            // Only handle the pointer we're tracking
            if (e.pointerId !== dragState.pointerId) return;

            if (dragState.active) {
                e.preventDefault(); // Prevent scrolling while dragging
                updateDrag(e.clientY);
            }
        };

        this._dragPointerUpHandler = (e) => {
            // Only handle the pointer we're tracking
            if (e.pointerId !== dragState.pointerId) return;

            if (dragState.active) {
                e.preventDefault(); // Prevent click event
                endDrag();
            }

            dragState.pointerId = null;
            dragState.button = null;
        };

        this._dragPointerCancelHandler = (e) => {
            // Only handle the pointer we're tracking
            if (e.pointerId !== dragState.pointerId) return;

            // For touch/pen, pointercancel fires when global handlers take over - ignore it
            // For mouse, cancel the drag
            if (e.pointerType === 'mouse') {
                cancelDrag();
            }
        };

        document.addEventListener('pointermove', this._dragPointerMoveHandler);
        document.addEventListener('pointerup', this._dragPointerUpHandler);
        document.addEventListener('pointercancel', this._dragPointerCancelHandler);
    }

    toggleOverviewEditMode() {
        this.overviewEditMode = !this.overviewEditMode;

        // Update button state (use the header edit toggle button)
        const appHeader = document.getElementById('app-header');
        if (appHeader) {
            appHeader.editMode = this.overviewEditMode;
        }

        // Update all song cards with new edit mode
        const cards = document.querySelectorAll('.overview-song-card');
        cards.forEach(card => {
            card.editMode = this.overviewEditMode;
        });

        // Toggle drag-drop: only enable in edit mode
        if (this.overviewEditMode) {
            this.setupOverviewDragDrop();
        } else {
            // Clean up drag-drop listeners
            if (this._dragPointerMoveHandler) {
                document.removeEventListener('pointermove', this._dragPointerMoveHandler);
            }
            if (this._dragPointerUpHandler) {
                document.removeEventListener('pointerup', this._dragPointerUpHandler);
            }
            if (this._dragPointerCancelHandler) {
                document.removeEventListener('pointercancel', this._dragPointerCancelHandler);
            }

            // Clean up card-level pointerdown listeners
            if (this._cardPointerDownHandlers) {
                this._cardPointerDownHandlers.forEach((handler, button) => {
                    button.removeEventListener('pointerdown', handler);
                });
                this._cardPointerDownHandlers.clear();
            }
        }

        // Show/hide add song button based on edit mode (only show in edit mode)
        const addButton = document.querySelector('.add-song-button');
        if (addButton) {
            addButton.style.display = this.overviewEditMode ? 'block' : 'none';
        }
    }

    /**
     * Re-render a song after key change or text edits
     */
    async reRenderSong(songIndex) {
        if (songIndex < 0 || songIndex >= this.songs.length) return;

        const song = this.songs[songIndex];
        const songEntry = this.currentSetlist.songs[songIndex];

        // Re-parse from source
        const parsed = this.parser.parse(song.sourceText);

        // Apply transposition if targetKey is set
        const targetKey = songEntry.modifications.targetKey || song.originalKey;
        if (targetKey && targetKey !== song.originalKey) {
            transposeSong(parsed, song.originalKey, targetKey);
            parsed.metadata.key = targetKey;
        }

        // Apply BPM override
        if (songEntry.modifications.bpmOverride) {
            parsed.metadata.tempo = songEntry.modifications.bpmOverride;
        }

        // Re-generate HTML
        const htmlContent = this.parser.toHTML(parsed, songIndex);

        // Update runtime song object
        song.htmlContent = htmlContent;
        song.metadata = parsed.metadata;
        song.currentKey = parsed.metadata.key;
        song.currentBPM = parsed.metadata.tempo;

        // Update DOM
        const songSection = document.getElementById(`song-${songIndex}`);
        if (songSection) {
            const songContent = songSection.querySelector('.song-content');
            if (songContent) {
                // Clear and append fragment
                songContent.textContent = '';
                songContent.appendChild(htmlContent);

                // Re-apply section states
                // First, restore section states from the modifications
                const savedSectionStates = songEntry.modifications.sectionStates || {};
                for (const [sectionIdx, state] of Object.entries(savedSectionStates)) {
                    const idx = parseInt(sectionIdx);
                    if (!this.sectionState[songIndex]) {
                        this.sectionState[songIndex] = {};
                    }
                    this.sectionState[songIndex][idx] = state;
                }

                // Now apply to DOM
                document.querySelectorAll(`.song-section-wrapper[data-song-index="${songIndex}"]`).forEach(wrapper => {
                    const sectionIndex = parseInt(wrapper.dataset.sectionIndex);
                    this.updateSectionDOM(songIndex, sectionIndex);
                });

                // Re-setup section controls for this song
                songContent.querySelectorAll('.section-control-btn').forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const action = button.dataset.action;
                        const wrapper = button.closest('.song-section-wrapper');
                        const si = parseInt(wrapper.dataset.songIndex);
                        const sectionIdx = parseInt(wrapper.dataset.sectionIndex);
                        this.setSectionHideMode(si, sectionIdx, action);
                    });
                });

                // Re-apply font size
                songContent.style.fontSize = `${song.currentFontSize}rem`;
            }
        }

        // Update header
        if (this.currentSongIndex === songIndex) {
            this.updateHeader(song);
        }
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }


    setupKeyboardNavigation(route) {
        if (route.type === 'home') return;

        document.addEventListener('keydown', (e) => {
            // Handle Escape key to exit edit mode
            if (e.key === 'Escape') {
                const isEditMode = document.body.classList.contains('edit-mode');
                if (isEditMode) {
                    e.preventDefault();
                    const appHeader = document.getElementById('app-header');
                    if (appHeader) {
                        // Trigger the edit-mode-toggle event
                        appHeader.dispatchEvent(new CustomEvent('edit-mode-toggle', {
                            bubbles: true,
                            composed: true
                        }));
                    }
                }
                return;
            }

            // Don't intercept if modifier keys are pressed (Alt, Ctrl, Meta)
            // This allows browser shortcuts like Alt+Left/Right to work
            if (e.altKey || e.ctrlKey || e.metaKey) {
                return;
            }

            switch(e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    // Navigate to previous song or overview
                    if (this.currentSongIndex > 0) {
                        this.navigateToHash(`song-${this.currentSongIndex - 1}`);
                    } else if (this.currentSongIndex === 0) {
                        this.navigateToHash('overview');
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    // Navigate to next song
                    if (this.currentSongIndex < 0 && this.songs.length > 0) {
                        // From overview to first song
                        this.navigateToHash('song-0');
                    } else if (this.currentSongIndex >= 0 && this.currentSongIndex < this.songs.length - 1) {
                        this.navigateToHash(`song-${this.currentSongIndex + 1}`);
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    const currentSectionUp = this.currentSongIndex >= 0
                        ? document.getElementById(`song-${this.currentSongIndex}`)
                        : document.getElementById('overview');
                    currentSectionUp?.scrollBy({ top: -CONFIG.KEYBOARD_SCROLL_AMOUNT, behavior: 'smooth' });
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    const currentSectionDown = this.currentSongIndex >= 0
                        ? document.getElementById(`song-${this.currentSongIndex}`)
                        : document.getElementById('overview');
                    currentSectionDown?.scrollBy({ top: CONFIG.KEYBOARD_SCROLL_AMOUNT, behavior: 'smooth' });
                    break;
            }
        });
    }


    setupNavigationMenu(route) {
        const navMenu = document.getElementById('nav-menu');

        if (!navMenu) return;

        // Setup back button click handler
        navMenu.addEventListener('back-click', () => {
            if (this.navBackAction) {
                this.navBackAction();
            }
        });

        // Setup song click handler for setlist song navigation
        navMenu.addEventListener('song-click', (e) => {
            const songIndex = e.detail.index;
            if (songIndex !== undefined && songIndex >= 0) {
                this.navigateToHash(`song-${songIndex}`);
            }
        });

        // Setup overview click handler for setlist navigation
        navMenu.addEventListener('overview-click', () => {
            this.navigateToHash('overview');
        });

        // Set initial back button state
        this.updateNavigationMenu(route);
    }

    updateNavigationMenu(route) {
        const navMenu = document.getElementById('nav-menu');

        // Determine back button label and action based on route
        let backLabel = 'Back';
        let backAction = () => window.history.back();
        let showOverviewLink = false;

        if (route.type === 'setlist') {
            // Check if we're viewing a specific song (via hash) or the overview
            const hash = window.location.hash;
            const isViewingSong = hash && hash.startsWith('#song-');

            if (isViewingSong) {
                // When viewing a song, show Overview in the setlist section
                showOverviewLink = true;
            } else {
                // When viewing overview, show back to setlists
                backLabel = 'Back to Setlists';
                backAction = () => window.history.back();
            }
        } else if (route.type === 'song') {
            backLabel = 'Back to Setlist';
            backAction = () => window.location.href = `/setlist/${route.setlistId}`;
        } else if (route.type === 'librarySong') {
            backLabel = 'Back to Song Library';
            backAction = () => this.closeLibrarySongView();
        } else if (route.type === 'settings') {
            backLabel = 'Back to Home';
            backAction = () => window.location.href = '/';
        }

        if (navMenu) {
            // Set songs list for setlist routes
            if (route.type === 'setlist' && this.songs && this.songs.length > 0) {
                navMenu.songs = this.songs;

                // Set setlist title (name if available, otherwise date and type)
                if (this.currentSetlist) {
                    if (this.currentSetlist.name) {
                        navMenu.setlistTitle = this.currentSetlist.name;
                    } else {
                        let datePart = this.formatSetlistName(this.currentSetlist.date);
                        // Remove the day name in parentheses (e.g., "(Sunday)")
                        datePart = datePart.replace(/\s*\([^)]+\)/, '');
                        const typePart = this.currentSetlist.type ? ` - ${this.currentSetlist.type}` : '';
                        navMenu.setlistTitle = datePart + typePart;
                    }
                }
            } else {
                navMenu.songs = [];
                navMenu.setlistTitle = 'Setlist';
            }

            // Set overview link visibility
            navMenu.showOverviewLink = showOverviewLink;

            // Set back button visibility
            if (route.type === 'setlist') {
                const hash = window.location.hash;
                const isViewingSong = hash && hash.startsWith('#song-');
                navMenu.showBackButton = !isViewingSong; // Only show when viewing overview
            } else if (route.type === 'songs') {
                navMenu.showBackButton = false; // No back button for song library
            } else {
                navMenu.showBackButton = true;
            }
            navMenu.setAttribute('back-label', backLabel);
        }

        // Store action for the click handler
        this.navBackAction = backAction;
    }

    async openAddSongModal() {
        console.log('[Add Song Modal] Opening modal');
        const modal = document.getElementById('add-song-modal');
        const searchInput = document.getElementById('add-song-search-input');
        const resultsContainer = document.getElementById('add-song-results');

        console.log('[Add Song Modal] Elements:', { modal, searchInput, resultsContainer });

        // Load all songs for searching
        try {
            resultsContainer.innerHTML = '<p style="text-align: center; color: #95a5a6;">Loading songs...</p>';

            const songs = await this.db.getAllSongs();
            console.log('[Add Song Modal] Loaded songs:', songs.length);

            if (songs.length === 0) {
                resultsContainer.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: #7f8c8d;">
                        <p style="font-size: 1.3rem; margin-bottom: 1rem;">No songs in library</p>
                        <p>Import setlists from the Settings page to populate the song library.</p>
                    </div>
                `;
                return;
            }

            // Sort songs alphabetically by title
            songs.sort((a, b) => {
                const titleA = (a.title || '').toLowerCase();
                const titleB = (b.title || '').toLowerCase();
                return titleA.localeCompare(titleB);
            });

            // Store for filtering
            this.addSongModalSongs = songs;

            // Clear search and show all songs initially
            searchInput.value = '';
            this.renderAddSongResults(songs, resultsContainer);

            modal.show();

        } catch (error) {
            console.error('[Add Song Modal] Error loading songs:', error);
            resultsContainer.innerHTML = '<p style="text-align: center; color: #e74c3c;">Error loading songs. Please try again.</p>';
            modal.show();
        }

        // Focus search input
        setTimeout(() => searchInput.focus(), 100);

        // Setup search handler - same pattern as song library
        const handleSearch = (e) => {
            this.filterAddSongResults(e.target.value, resultsContainer);
        };

        searchInput.addEventListener('input', handleSearch);

        // Setup close handler to clean up
        const handleClose = () => {
            searchInput.removeEventListener('input', handleSearch);
            this.addSongModalSongs = null;
        };

        modal.addEventListener('close', handleClose, { once: true });
    }

    filterAddSongResults(searchTerm, resultsContainer) {
        if (!this.addSongModalSongs) return;

        const term = searchTerm.toLowerCase().trim();

        if (!term) {
            // Show all songs if search is empty
            this.renderAddSongResults(this.addSongModalSongs, resultsContainer);
            return;
        }

        // Filter songs by title, artist, or lyrics - same as song library
        const filtered = this.addSongModalSongs.filter(song => {
            const title = (song.title || '').toLowerCase();
            const artist = (song.artist || '').toLowerCase();
            const lyricsText = (song.lyricsText || '').toLowerCase();

            return title.includes(term) ||
                   artist.includes(term) ||
                   lyricsText.includes(term);
        });

        this.renderAddSongResults(filtered, resultsContainer);
    }

    renderAddSongResults(songs, resultsContainer) {
        console.log('[Add Song Modal] renderAddSongResults called with', songs.length, 'songs');

        resultsContainer.textContent = '';

        if (songs.length === 0) {
            console.log('[Add Song Modal] No songs to display');
            const message = document.createElement('p');
            message.style.textAlign = 'center';
            message.style.color = '#95a5a6';
            message.textContent = 'No songs match your search.';
            resultsContainer.appendChild(message);
            return;
        }

        for (const song of songs) {
            // Create the Lit song-card component
            const card = document.createElement('song-card');
            card.song = song;
            card.variant = 'library';

            // Make card clickable to add to setlist
            card.addEventListener('song-click', () => {
                this.addSongToSetlist(song);
            });

            resultsContainer.appendChild(card);
        }
        console.log('[Add Song Modal] Finished rendering', songs.length, 'songs');
    }

    async addSongToSetlist(song) {
        try {
            // Get current setlist
            const setlist = this.currentSetlist;
            if (!setlist) {
                console.error('No current setlist');
                return;
            }

            // Create new song entry
            const newSongEntry = {
                order: setlist.songs.length,
                songId: song.id,
                chordproEdits: null,
                modifications: {
                    targetKey: null,
                    bpmOverride: null,
                    fontSize: 1.6,
                    sectionStates: {}
                }
            };

            // Add to setlist
            setlist.songs.push(newSongEntry);
            setlist.updatedAt = new Date().toISOString();

            // Save to database
            await this.db.saveSetlist(setlist);

            console.log('Added song to setlist:', song.title);

            // Close modal
            const modal = document.getElementById('add-song-modal');
            modal.close();

            // Reload the setlist to show the new song
            await this.renderSetlist(setlist.id);
        } catch (error) {
            console.error('Error adding song to setlist:', error);
            alert('Failed to add song to setlist. Please try again.');
        }
    }

    showDeleteSongConfirmation(index, song) {
        const modal = document.getElementById('delete-song-modal');
        const songTitleEl = document.getElementById('delete-song-title');

        songTitleEl.textContent = song.title;

        modal.show();

        const handleConfirm = async () => {
            await this.deleteSongFromSetlist(index);
            cleanup();
        };

        const cleanup = () => {
            modal.removeEventListener('confirm', handleConfirm);
        };

        modal.addEventListener('confirm', handleConfirm, { once: true });
    }

    async deleteSongFromSetlist(index) {
        try {
            const setlist = this.currentSetlist;
            if (!setlist) {
                console.error('No current setlist');
                return;
            }

            // Remove song from array
            setlist.songs.splice(index, 1);

            // Update order for remaining songs
            setlist.songs.forEach((song, i) => {
                song.order = i;
            });

            setlist.updatedAt = new Date().toISOString();

            // Save to database
            await this.db.saveSetlist(setlist);

            console.log('Deleted song from setlist at index:', index);

            // Reload the setlist
            await this.renderSetlist(setlist.id);
        } catch (error) {
            console.error('Error deleting song from setlist:', error);
            alert('Failed to delete song. Please try again.');
        }
    }
}

// Initialize the app
const app = new PageApp();
