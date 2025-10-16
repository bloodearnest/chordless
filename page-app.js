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
                    currentBPM: parsed.metadata.tempo,
                    currentFontSize: 1.6 // Default font size in rem
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

                // Set up font size controls
                this.setupFontSizeControls();

                // Set up reset button
                this.setupResetButton();
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
        this.exitEditMode();
    }

    showSong(index, instant = false) {
        this.scrollToSection(`song-${index}`, index, instant);
        this.updateHeader(this.songs[index]);
        this.applyFontSize(index);
        this.exitEditMode();
    }

    exitEditMode() {
        const isEditMode = document.body.classList.contains('edit-mode');
        if (isEditMode) {
            const editToggle = document.getElementById('edit-mode-toggle');
            document.body.classList.remove('edit-mode');
            if (editToggle) {
                editToggle.classList.remove('active');
            }

            // Update all sections to reflect non-edit mode
            document.querySelectorAll('.song-section-wrapper[data-song-index][data-section-index]').forEach(wrapper => {
                const songIndex = parseInt(wrapper.dataset.songIndex);
                const sectionIndex = parseInt(wrapper.dataset.sectionIndex);
                this.updateSectionDOM(songIndex, sectionIndex);
            });
        }
    }

    updateHeader(song) {
        const titleEl = document.getElementById('song-title-header');
        const metaEl = document.getElementById('song-meta-header');
        const infoButton = document.getElementById('info-button');
        const keySelector = document.getElementById('key-selector');
        const keyValueDisplay = document.getElementById('key-value-display');
        const keyDisplayWrapper = document.querySelector('.key-display-wrapper');
        const editToggle = document.getElementById('edit-mode-toggle');

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

            // Show key display and edit button
            if (keyDisplayWrapper) keyDisplayWrapper.style.display = 'flex';
            if (editToggle) editToggle.style.display = 'flex';

            // Enable info button
            infoButton.style.display = 'flex';
            infoButton.onclick = () => this.showSongInfo(song);
        } else {
            // Overview
            titleEl.textContent = this.currentSetlistId ? this.formatSetlistName(this.currentSetlistId) : 'Setlist';
            metaEl.innerHTML = '';

            // Hide key display, edit button, and info button on overview
            if (keyDisplayWrapper) keyDisplayWrapper.style.display = 'none';
            if (editToggle) editToggle.style.display = 'none';
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

        if (song.metadata.ccli || song.metadata.ccliSongNumber) {
            html += `<div class="modal-info-item">
                <div class="modal-info-label">CCLI Number</div>
                <div class="modal-info-value" style="display: flex; align-items: center; gap: 1rem;">
                    <span>${this.escapeHtml(song.metadata.ccli || song.metadata.ccliSongNumber)}</span>`;

            if (song.metadata.ccliSongNumber) {
                const songSelectUrl = `https://songselect.ccli.com/songs/${song.metadata.ccliSongNumber}/`;
                html += `<a href="${songSelectUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none; color: #00a3e0; font-size: 1.1rem; font-weight: 600; padding: 0.25rem 0.5rem; border-radius: 4px; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='rgba(0,163,224,0.1)'" onmouseout="this.style.backgroundColor='transparent'">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 1000 1000">
                        <rect fill="#00a3e0" y="0" width="1000" height="1000" rx="190.32" ry="190.32"></rect>
                        <path fill="#fff" d="M758.53,231.15c1.6,1.57,1.61,4.18.02,5.76l-34.9,34.9c-1.54,1.54-4.02,1.53-5.59,0-122.98-119.9-319.88-118.95-441.69,2.86,0,0-97.82,97.82-129.96,129.96-2.86,2.86-7.71.08-6.67-3.83,16.27-61.04,48.19-118.82,96.06-166.7,144.17-144.17,377.31-145.16,522.7-2.96ZM558.62,556.91c-35.53,35.53-94,33.13-126.31-6.85-24.57-30.4-24.76-75.05-.46-105.67,31.36-39.52,88.32-42.93,124.1-10.23,1.59,1.46,4.02,1.47,5.54-.05l34.87-34.88c1.6-1.6,1.59-4.26-.05-5.81-55.76-52.66-143.67-51.7-198.26,2.89,0,0-.01.01-.02.02h0s-241.09,241.09-241.09,241.09c-1.17,1.17-1.52,2.93-.88,4.45,6.75,15.88,14.76,31.45,23.83,46.47,1.35,2.23,4.47,2.6,6.32.75l174.57-174.57c-1.36,30.21,14.69,60.44,37.27,83.03,55.57,55.57,144.88,56.09,201.19-.05.47-.47,218.59-218.58,241.07-241.06,1.15-1.15,1.46-2.85.83-4.34-6.78-15.98-14.86-31.58-23.97-46.66-1.35-2.23-4.47-2.6-6.32-.75l-252.21,252.22ZM357.4,355.89s.07-.07.1-.1c77.04-77.04,201.38-77.96,279.55-2.75,1.57,1.51,4.03,1.52,5.57-.02l34.89-34.89c1.59-1.59,1.58-4.22-.03-5.79-100.58-97.48-260.91-96.82-360.67,2.94l-188.7,188.7c-.79.79-1.23,1.87-1.2,2.99.56,21.22,2.94,42.57,7.13,63.46.63,3.13,4.56,4.28,6.82,2.02l216.54-216.54h0ZM357.5,638.14c-5.57-5.57-10.72-11.41-15.49-17.45-1.49-1.88-4.24-2.07-5.94-.37l-35.08,35.08c-1.47,1.47-1.6,3.83-.28,5.42,5.08,6.15,10.47,12.12,16.23,17.88,100.37,100.37,262.97,100.23,363.34-.14l188.96-188.96c.79-.79,1.23-1.89,1.2-3.01-.64-22.11-3.15-43.27-7.2-63.26-.63-3.13-4.55-4.25-6.81-1.99l-216.73,216.73c-77.97,77.93-204.24,78.03-282.19.07ZM276.38,719.26c-5.59-5.59-10.82-11.38-15.86-17.28-1.52-1.78-4.21-1.89-5.86-.24l-34.98,34.98c-1.5,1.5-1.59,3.9-.2,5.49,5.24,5.99,10.64,11.89,16.35,17.6,145.17,145.17,380.95,145.58,525.7,0,47.87-48.14,80.27-105.98,96.53-167.28,1.06-3.99-3.81-6.84-6.73-3.92l-130.5,130.5c-123.43,123.43-321.68,122.91-444.44.14ZM862.6,887.88c-6.72,0-13.01-1.28-18.93-3.82-5.9-2.54-11.08-6.07-15.57-10.54-4.47-4.47-7.98-9.68-10.54-15.57-2.54-5.9-3.82-12.22-3.82-18.93s1.28-13.03,3.82-18.93c2.56-5.9,6.07-11.1,10.54-15.57,4.49-4.47,9.68-8,15.57-10.54,5.92-2.54,12.22-3.82,18.93-3.82s13.12,1.28,19.02,3.82c5.92,2.54,11.1,6.07,15.57,10.54,4.49,4.47,7.98,9.68,10.49,15.57s3.78,12.22,3.78,18.93-1.26,13.03-3.78,18.93-6,11.1-10.49,15.57c-4.47,4.47-9.66,8-15.57,10.54-5.9,2.54-12.24,3.82-19.02,3.82ZM862.6,878.73c7.35,0,14-1.78,19.98-5.37,6-3.59,10.79-8.37,14.36-14.36,3.59-5.98,5.37-12.66,5.37-19.98s-1.78-14-5.37-19.98c-3.57-5.98-8.35-10.77-14.36-14.36-5.98-3.59-12.64-5.37-19.98-5.37s-13.92,1.78-19.94,5.37c-6,3.59-10.79,8.37-14.36,14.36-3.55,5.98-5.33,12.66-5.33,19.98s1.78,14,5.33,19.98c3.57,5.98,8.35,10.77,14.36,14.36,6.02,3.59,12.68,5.37,19.94,5.37ZM845.81,861.27v-45h21.66c2.31,0,4.53.55,6.72,1.64s3.99,2.67,5.37,4.74c1.41,2.08,2.1,4.62,2.1,7.64s-.71,5.73-2.14,7.93-3.25,3.92-5.5,5.12c-2.22,1.2-4.55,1.81-6.97,1.81h-16.71v-6.3h14.61c2.14,0,4.01-.73,5.63-2.22,1.64-1.49,2.43-3.59,2.43-6.34s-.8-4.81-2.43-6c-1.62-1.2-3.44-1.81-5.46-1.81h-11.25v38.79h-8.06ZM874.6,861.27l-11-20.99h8.73l11.17,20.99h-8.9Z"></path>
                    </svg>
                    <span>View on SongSelect</span>
                </a>`;
            }

            html += `</div></div>`;
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

        // Browser naturally maintains each section's scroll position
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
        } else if (mode === 'collapse') {
            // Toggle collapse state - mutually exclusive with all others
            if (state.isHidden) {
                // If entire section is hidden, unhide it first
                state.isHidden = false;
            }
            // Toggle: if clicking the same mode, turn it off
            if (state.hideMode === 'collapse') {
                state.hideMode = 'none';
                state.isCollapsed = false;
            } else {
                state.hideMode = 'collapse';
                state.isCollapsed = true;
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
        }

        this.saveState();
        this.updateSectionDOM(songIndex, sectionIndex);
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

                // Pass action directly (collapse, chords, lyrics, hide)
                this.setSectionHideMode(songIndex, sectionIndex, action);
            });
        });

        // Listen to native details toggle events
        document.querySelectorAll('.song-section-wrapper .song-section').forEach(details => {
            details.addEventListener('toggle', (e) => {
                const wrapper = details.closest('.song-section-wrapper');
                if (!wrapper) return;

                const songIndex = parseInt(wrapper.dataset.songIndex);
                const sectionIndex = parseInt(wrapper.dataset.sectionIndex);

                // Only sync state in normal mode (not in edit mode, where details is always open)
                const isEditMode = document.body.classList.contains('edit-mode');
                if (!isEditMode) {
                    const state = this.getSectionState(songIndex, sectionIndex);

                    // Update state based on details open/closed
                    if (details.open) {
                        // Details is now open - uncollapse
                        state.isCollapsed = false;
                        state.hideMode = 'none';
                    } else {
                        // Details is now closed - collapse
                        state.isCollapsed = true;
                        state.hideMode = 'collapse';
                    }

                    this.saveState();
                    this.updateButtonStates(wrapper, state);
                }
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

    setupFontSizeControls() {
        const decreaseBtn = document.getElementById('font-size-decrease');
        const increaseBtn = document.getElementById('font-size-increase');

        if (!decreaseBtn || !increaseBtn) return;

        decreaseBtn.addEventListener('click', () => {
            if (this.currentSongIndex >= 0) {
                const song = this.songs[this.currentSongIndex];
                // Decrease by 0.1rem, minimum 0.8rem
                song.currentFontSize = Math.max(0.8, song.currentFontSize - 0.1);
                this.applyFontSize(this.currentSongIndex);
            }
        });

        increaseBtn.addEventListener('click', () => {
            if (this.currentSongIndex >= 0) {
                const song = this.songs[this.currentSongIndex];
                // Increase by 0.1rem, maximum 3.0rem
                song.currentFontSize = Math.min(3.0, song.currentFontSize + 0.1);
                this.applyFontSize(this.currentSongIndex);
            }
        });
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
        const cancelButton = document.getElementById('reset-cancel');
        const confirmButton = document.getElementById('reset-confirm');

        if (!resetButton || !resetModal) return;

        // Show confirmation modal when reset button is clicked
        resetButton.addEventListener('click', () => {
            resetModal.classList.add('active');
        });

        // Cancel - close modal
        if (cancelButton) {
            cancelButton.addEventListener('click', () => {
                resetModal.classList.remove('active');
            });
        }

        // Close modal when clicking outside
        resetModal.addEventListener('click', (e) => {
            if (e.target === resetModal) {
                resetModal.classList.remove('active');
            }
        });

        // Confirm - reset everything
        if (confirmButton) {
            confirmButton.addEventListener('click', () => {
                this.resetCurrentSong();
                resetModal.classList.remove('active');
            });
        }
    }

    resetCurrentSong() {
        if (this.currentSongIndex < 0 || this.currentSongIndex >= this.songs.length) return;

        const song = this.songs[this.currentSongIndex];

        // Reset key to original
        song.currentKey = song.metadata.key;

        // Reset BPM to original
        song.currentBPM = song.metadata.tempo;

        // Reset font size to default
        song.currentFontSize = 1.6;

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
        const keySelector = document.getElementById('key-selector');
        if (keySelector && song.currentKey) {
            keySelector.value = song.currentKey;
        }

        // Reapply section states (all back to default)
        this.applySectionState();
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
