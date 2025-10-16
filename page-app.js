// Page-based application logic for Setalight
// Works with service worker routing and Navigation API

import { ChordProParser } from './chordpro-parser.js';
import { FileSystemSongsDB } from './songs-db.js';

class PageApp {
    constructor() {
        this.db = new FileSystemSongsDB();
        this.parser = new ChordProParser();
        this.currentSongIndex = undefined;
        this.songs = [];
        this.currentSetlistId = null;
        // Track section visibility state: { songIndex: { sectionIndex: { hideMode: 'none'|'section'|'chords'|'lyrics' } } }
        this.sectionState = {};
        this.init();
    }

    async init() {
        // Set up Navigation API with View Transitions
        this.setupNavigationAPI();

        // Detect current route from window.__ROUTE__ or URL
        const route = window.__ROUTE__ || this.parseRoute(window.location.pathname);

        // Render based on route
        if (route.type === 'home') {
            await this.renderHome();
        } else if (route.type === 'setlist') {
            await this.renderSetlist(route.setlistId);
        }

        // Set up keyboard navigation
        this.setupKeyboardNavigation(route);

        // Set up touch/swipe support
        this.setupTouchSupport(route);
    }

    parseRoute(pathname) {
        if (pathname === '/' || pathname === '/index.html') {
            return { type: 'home' };
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
        const listContainer = document.getElementById('setlist-list');

        try {
            listContainer.innerHTML = '<p>Loading setlists...</p>';

            const setlists = await this.db.getSetlists();

            if (setlists.length === 0) {
                listContainer.innerHTML = '<p>No setlists found.</p>';
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

            // Render grouped setlists
            listContainer.innerHTML = '';
            for (const year of years) {
                const yearSection = this.createYearSection(year, groupedByYear[year], year == currentYear);
                listContainer.appendChild(yearSection);
            }
        } catch (error) {
            console.error('Error loading setlists:', error);
            listContainer.innerHTML = '<p class="error">Error loading setlists. Please check the console.</p>';
        }
    }

    extractYear(dateStr) {
        const match = dateStr.match(/^(\d{4})/);
        return match ? match[1] : 'Unknown';
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
            link.textContent = this.formatSetlistName(setlist.date);
            list.appendChild(link);
        }

        section.appendChild(header);
        section.appendChild(list);

        if (expanded) {
            section.classList.add('expanded');
        }

        return section;
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
            // Get list of songs
            const songList = await this.db.getSongs(setlistId);
            console.log('Loaded songs:', songList.length);

            if (songList.length === 0) {
                document.querySelector('.song-container').innerHTML = '<p>No songs found in this setlist.</p>';
                return;
            }

            // Load all song contents
            const loadPromises = songList.map(song => this.db.getSongContent(song.path));
            const songContents = await Promise.all(loadPromises);

            const songs = songContents.map((content, index) => {
                const parsed = this.parser.parse(content);
                const htmlContent = this.parser.toHTML(parsed, index);

                return {
                    title: parsed.metadata.title || `Song ${index + 1}`,
                    htmlContent: htmlContent,
                    metadata: parsed.metadata, // Original metadata (never modified)
                    // Current key/tempo that can be modified
                    currentKey: parsed.metadata.key,
                    currentBPM: parsed.metadata.tempo
                };
            });

            console.log('Parsed songs:', songs.length);

            // Store songs for navigation
            this.songs = songs;
            this.currentSetlistId = setlistId;

            // Load state from localStorage
            this.loadState();

            // Render all songs on one page
            const container = document.querySelector('.song-container');
            console.log('Rendering full setlist into container:', container);
            container.innerHTML = this.renderFullSetlist(setlistId, songs);

            // Set up navigation based on hash
            console.log('About to setup hash navigation');
            this.setupHashNavigation(setlistId, songs.length);

            // Navigate to the correct section based on hash
            const hash = window.location.hash;
            console.log('Current hash:', hash);

            // Wait for layout to complete before scrolling
            requestAnimationFrame(() => {
                if (hash) {
                    const hashValue = hash.substring(1);
                    if (hashValue === 'overview') {
                        this.showOverview(true); // true = instant, no animation
                    } else if (hashValue.startsWith('song-')) {
                        const index = parseInt(hashValue.split('-')[1]);
                        this.showSong(index, true); // true = instant, no animation
                    }
                } else {
                    // Default to overview
                    console.log('No hash, showing overview');
                    this.showOverview(true); // true = instant, no animation
                }

                // Set up click handlers for overview song buttons
                document.querySelectorAll('.overview-song-button').forEach(button => {
                    button.addEventListener('click', () => {
                        const songIndex = parseInt(button.dataset.songIndex);
                        this.navigateToHash(`song-${songIndex}`);
                    });
                });

                // Set up edit mode toggle
                this.setupEditMode();

                // Set up section control buttons
                this.setupSectionControls();

                // Apply saved state to sections
                this.applySectionState();

                // Set up key selector
                this.setupKeySelector();
            });

        } catch (error) {
            console.error('Error loading setlist:', error);
            document.querySelector('.song-container').innerHTML = '<p>Error loading songs. Please check the console.</p>';
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

    renderFullSetlist(setlistId, songs) {
        let html = '';

        // Render overview section
        html += '<div id="overview" class="section">';
        html += '<div class="song-content"><div class="setlist-overview">';
        const setlistTitle = this.formatSetlistName(setlistId);
        html += `<h2 class="overview-title">${this.escapeHtml(setlistTitle)}</h2>`;
        html += `<div class="overview-songs">`;

        songs.forEach((song, index) => {
            html += `<button class="overview-song-button" data-song-index="${index}">`;
            html += `<span class="overview-song-number">${index + 1}</span>`;
            html += `<div class="overview-song-info">`;
            html += `<span class="overview-song-title">${this.escapeHtml(song.title)}</span>`;

            const metadata = [];
            if (song.metadata.key) {
                metadata.push(`Key: ${this.escapeHtml(song.metadata.key)}`);
            }
            if (song.metadata.tempo) {
                metadata.push(`Tempo: ${this.escapeHtml(song.metadata.tempo)}`);
            }

            if (metadata.length > 0) {
                html += `<span class="overview-song-meta">${metadata.join(' • ')}</span>`;
            }

            html += `</div>`;
            html += `</button>`;
        });

        html += `</div></div></div>`;
        html += '</div>';

        // Render all songs
        songs.forEach((song, index) => {
            html += `<div id="song-${index}" class="section">`;
            html += `<div class="song-content">${song.htmlContent}</div>`;
            html += `</div>`;
        });

        return html;
    }

    showOverview(instant = false) {
        this.scrollToSection('overview', -1, instant);
        this.updateHeader(null);
    }

    showSong(index, instant = false) {
        this.scrollToSection(`song-${index}`, index, instant);
        this.updateHeader(this.songs[index]);
    }

    updateHeader(song) {
        const titleEl = document.getElementById('song-title-header');
        const metaEl = document.getElementById('song-meta-header');
        const infoButton = document.getElementById('info-button');
        const keySelector = document.getElementById('key-selector');
        const keyValueDisplay = document.getElementById('key-value-display');

        if (song) {
            // Update title
            titleEl.textContent = song.title;

            // Update key display (for normal mode) - use current key
            if (keyValueDisplay) {
                keyValueDisplay.textContent = song.currentKey || '-';
            }

            // Update key selector (for edit mode) - use current key
            if (keySelector && song.currentKey) {
                keySelector.value = song.currentKey;
            }

            // Update metadata - only show BPM (key is in separate wrapper now) - use current BPM
            const meta = [];
            if (song.currentBPM) {
                meta.push(`<span class="meta-item"><span class="meta-label">BPM:</span> ${this.escapeHtml(song.currentBPM)}</span>`);
            }
            metaEl.innerHTML = meta.join('');

            // Enable info button
            infoButton.style.display = 'flex';
            infoButton.onclick = () => this.showSongInfo(song);
        } else {
            // Overview
            titleEl.textContent = this.currentSetlistId ? this.formatSetlistName(this.currentSetlistId) : 'Setlist';
            metaEl.innerHTML = '';
            infoButton.style.display = 'none';

            if (keyValueDisplay) {
                keyValueDisplay.textContent = '-';
            }
            if (keySelector) {
                // Reset to first valid key option
                keySelector.selectedIndex = 0;
            }
        }
    }

    showSongInfo(song) {
        const modal = document.getElementById('song-info-modal');
        const modalBody = document.getElementById('modal-body');

        let html = `<h2>${this.escapeHtml(song.title)}</h2>`;
        html += '<div class="modal-info-grid">';

        if (song.metadata.artist) {
            html += `<div class="modal-info-item">
                <div class="modal-info-label">Artist</div>
                <div class="modal-info-value">${this.escapeHtml(song.metadata.artist)}</div>
            </div>`;
        }

        if (song.metadata.key) {
            html += `<div class="modal-info-item">
                <div class="modal-info-label">Original Key</div>
                <div class="modal-info-value">${this.escapeHtml(song.metadata.key)}</div>
            </div>`;
        }

        if (song.metadata.tempo) {
            html += `<div class="modal-info-item">
                <div class="modal-info-label">Original BPM</div>
                <div class="modal-info-value">${this.escapeHtml(song.metadata.tempo)}</div>
            </div>`;
        }

        if (song.metadata.time) {
            html += `<div class="modal-info-item">
                <div class="modal-info-label">Time Signature</div>
                <div class="modal-info-value">${this.escapeHtml(song.metadata.time)}</div>
            </div>`;
        }

        if (song.metadata.ccli) {
            html += `<div class="modal-info-item">
                <div class="modal-info-label">CCLI Number</div>
                <div class="modal-info-value">${this.escapeHtml(song.metadata.ccli)}</div>
            </div>`;
        }

        html += '</div>';

        if (song.metadata.copyright) {
            html += `<div class="modal-ccli">${this.escapeHtml(song.metadata.copyright)}</div>`;
        }

        if (song.metadata.ccliTrailer) {
            html += `<div class="modal-ccli">${this.escapeHtml(song.metadata.ccliTrailer)}</div>`;
        }

        modalBody.innerHTML = html;
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

        // Scroll the container to bring the section into view
        const scrollLeft = section.offsetLeft;

        if (instant) {
            // Jump immediately without animation
            container.scrollLeft = scrollLeft;
        } else {
            // Smooth scroll animation
            container.scrollTo({
                left: scrollLeft,
                behavior: 'smooth'
            });
        }

        // Reset vertical scroll to top of the section
        section.scrollTop = 0;

        this.currentSongIndex = newIndex;
    }

    setupHashNavigation(setlistId, totalSongs) {
        // Listen for hash changes
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.substring(1);
            console.log('Hash changed to:', hash);
            if (hash === 'overview' || !hash) {
                this.showOverview();
            } else if (hash.startsWith('song-')) {
                const index = parseInt(hash.split('-')[1]);
                console.log('Navigating to song index:', index);
                if (index >= 0 && index < totalSongs) {
                    this.showSong(index);
                }
            }
        });

        console.log('Hash navigation setup complete for', totalSongs, 'songs');
    }

    navigateToHash(hash) {
        // Replace the hash without adding to history
        const newUrl = `${window.location.pathname}#${hash}`;
        history.replaceState(null, '', newUrl);

        // Manually trigger the navigation
        if (hash === 'overview') {
            this.showOverview(false);
        } else if (hash.startsWith('song-')) {
            const index = parseInt(hash.split('-')[1]);
            this.showSong(index, false);
        }
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
                hideMode: 'none' // 'none', 'section', 'chords', 'lyrics'
            };
        }
        return this.sectionState[songIndex][sectionIndex];
    }

    setSectionHideMode(songIndex, sectionIndex, mode) {
        const state = this.getSectionState(songIndex, sectionIndex);
        // Toggle: if clicking the same mode, turn it off
        state.hideMode = (state.hideMode === mode) ? 'none' : mode;
        this.saveState();
        this.updateSectionDOM(songIndex, sectionIndex);
    }

    updateSectionDOM(songIndex, sectionIndex) {
        const wrapper = document.querySelector(`.song-section-wrapper[data-song-index="${songIndex}"][data-section-index="${sectionIndex}"]`);
        if (!wrapper) return;

        const state = this.getSectionState(songIndex, sectionIndex);
        const details = wrapper.querySelector('.song-section');

        // Update classes based on hideMode
        wrapper.classList.toggle('section-hidden', state.hideMode === 'section');
        wrapper.classList.toggle('chords-hidden', state.hideMode === 'chords');
        wrapper.classList.toggle('lyrics-hidden', state.hideMode === 'lyrics');

        // Update details open/closed based on edit mode and hidden state
        const isEditMode = document.body.classList.contains('edit-mode');
        if (isEditMode) {
            details.open = true; // Always open in edit mode
        } else {
            details.open = state.hideMode !== 'section'; // Closed if section is hidden, when not in edit mode
        }

        // Update button states (active/inactive)
        this.updateButtonStates(wrapper, state);
    }

    updateButtonStates(wrapper, state) {
        const toggleBtn = wrapper.querySelector('.section-toggle-btn');
        const chordsBtn = wrapper.querySelector('.chords-toggle-btn');
        const lyricsBtn = wrapper.querySelector('.lyrics-toggle-btn');

        if (toggleBtn) {
            toggleBtn.classList.toggle('active', state.hideMode === 'section');
        }
        if (chordsBtn) {
            chordsBtn.classList.toggle('active', state.hideMode === 'chords');
        }
        if (lyricsBtn) {
            lyricsBtn.classList.toggle('active', state.hideMode === 'lyrics');
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
        const editToggle = document.getElementById('edit-mode-toggle');
        if (!editToggle) return;

        editToggle.addEventListener('click', () => {
            const isEnteringEditMode = !document.body.classList.contains('edit-mode');

            document.body.classList.toggle('edit-mode');
            editToggle.classList.toggle('active');

            // Update all sections based on edit mode
            document.querySelectorAll('.song-section-wrapper[data-song-index][data-section-index]').forEach(wrapper => {
                const songIndex = parseInt(wrapper.dataset.songIndex);
                const sectionIndex = parseInt(wrapper.dataset.sectionIndex);
                this.updateSectionDOM(songIndex, sectionIndex);
            });
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

                // Map action to hideMode
                const modeMap = {
                    'toggle': 'section',
                    'chords': 'chords',
                    'lyrics': 'lyrics'
                };

                this.setSectionHideMode(songIndex, sectionIndex, modeMap[action]);
            });
        });
    }

    setupKeySelector() {
        const keySelector = document.getElementById('key-selector');
        if (!keySelector) return;

        // All possible keys (major and minor)
        const keys = [
            'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
            'Cm', 'C#m', 'Dbm', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gbm', 'Gm', 'G#m', 'Abm', 'Am', 'A#m', 'Bbm', 'Bm'
        ];

        // Clear existing options and populate with all keys
        keySelector.innerHTML = '';

        // Add all keys as options
        keys.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            keySelector.appendChild(option);
        });

        // Set initial value to current song's key if we're on a song
        if (this.currentSongIndex >= 0 && this.songs[this.currentSongIndex]) {
            const currentKey = this.songs[this.currentSongIndex].currentKey;
            if (currentKey) {
                keySelector.value = currentKey;
            }
        }

        // Add change event listener (transposition logic will be added later)
        keySelector.addEventListener('change', (e) => {
            const newKey = e.target.value;
            if (newKey && this.currentSongIndex >= 0) {
                console.log(`Key changed to: ${newKey} for song ${this.currentSongIndex}`);

                // Update the displayed key value
                const keyValueDisplay = document.getElementById('key-value-display');
                if (keyValueDisplay) {
                    keyValueDisplay.textContent = newKey;
                }

                // Update the current key (not the original metadata)
                this.songs[this.currentSongIndex].currentKey = newKey;

                // TODO: Implement transposition logic here
            }
        });
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
                    const editToggle = document.getElementById('edit-mode-toggle');
                    if (editToggle) {
                        editToggle.click();
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
                    currentSectionUp?.scrollBy({ top: -200, behavior: 'smooth' });
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    const currentSectionDown = this.currentSongIndex >= 0
                        ? document.getElementById(`song-${this.currentSongIndex}`)
                        : document.getElementById('overview');
                    currentSectionDown?.scrollBy({ top: 200, behavior: 'smooth' });
                    break;
            }
        });
    }

    setupTouchSupport(route) {
        if (route.type === 'home') return;

        let touchStartX = 0;
        let touchStartY = 0;

        document.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        });

        document.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;

            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;

            // Horizontal swipe (song navigation)
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                if (deltaX > 0) {
                    // Swipe right - go to previous
                    if (this.currentSongIndex > 0) {
                        this.navigateToHash(`song-${this.currentSongIndex - 1}`);
                    } else if (this.currentSongIndex === 0) {
                        this.navigateToHash('overview');
                    }
                } else if (deltaX < 0) {
                    // Swipe left - go to next
                    if (this.currentSongIndex < 0 && this.songs.length > 0) {
                        this.navigateToHash('song-0');
                    } else if (this.currentSongIndex >= 0 && this.currentSongIndex < this.songs.length - 1) {
                        this.navigateToHash(`song-${this.currentSongIndex + 1}`);
                    }
                }
            }
        });
    }
}

// Initialize the app
const app = new PageApp();
