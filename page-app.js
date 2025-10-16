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
            // Set date in header
            document.getElementById('setlist-date').textContent = this.formatDate(setlistId);

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
                const htmlContent = this.parser.toHTML(parsed);

                return {
                    title: parsed.metadata.title || `Song ${index + 1}`,
                    htmlContent: htmlContent,
                    metadata: parsed.metadata
                };
            });

            console.log('Parsed songs:', songs.length);

            // Store songs for navigation
            this.songs = songs;
            this.currentSetlistId = setlistId;

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
        document.getElementById('song-position').textContent = 'Setlist';
        this.updateNavigationForOverview();
    }

    showSong(index, instant = false) {
        this.scrollToSection(`song-${index}`, index, instant);
        document.getElementById('song-position').textContent = `${index + 1} / ${this.songs.length}`;
        this.updateNavigationForSong(index);
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

        // Reset vertical scroll to top
        document.getElementById('main-content').scrollTop = 0;

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

    updateNavigationForOverview() {
        const prevButton = document.getElementById('prev-song');
        const nextButton = document.getElementById('next-song');

        if (prevButton) prevButton.disabled = true;

        if (nextButton && this.songs.length > 0) {
            nextButton.disabled = false;
            nextButton.onclick = (e) => {
                e.preventDefault();
                this.navigateToHash('song-0');
            };
        }
    }

    updateNavigationForSong(index) {
        const prevButton = document.getElementById('prev-song');
        const nextButton = document.getElementById('next-song');

        // Previous button
        if (prevButton) {
            if (index > 0) {
                prevButton.disabled = false;
                prevButton.onclick = (e) => {
                    e.preventDefault();
                    this.navigateToHash(`song-${index - 1}`);
                };
            } else {
                prevButton.disabled = false;
                prevButton.onclick = (e) => {
                    e.preventDefault();
                    this.navigateToHash('overview');
                };
            }
        }

        // Next button
        if (nextButton) {
            if (index < this.songs.length - 1) {
                nextButton.disabled = false;
                nextButton.onclick = (e) => {
                    e.preventDefault();
                    this.navigateToHash(`song-${index + 1}`);
                };
            } else {
                nextButton.disabled = true;
            }
        }
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
            // Don't intercept if modifier keys are pressed (Alt, Ctrl, Meta)
            // This allows browser shortcuts like Alt+Left/Right to work
            if (e.altKey || e.ctrlKey || e.metaKey) {
                return;
            }

            const prevButton = document.getElementById('prev-song');
            const nextButton = document.getElementById('next-song');

            switch(e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    if (prevButton && !prevButton.disabled) {
                        prevButton.click();
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (nextButton && !nextButton.disabled) {
                        nextButton.click();
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    document.getElementById('main-content')?.scrollBy({ top: -200, behavior: 'smooth' });
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    document.getElementById('main-content')?.scrollBy({ top: 200, behavior: 'smooth' });
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
                const prevButton = document.getElementById('prev-song');
                const nextButton = document.getElementById('next-song');

                if (deltaX > 0 && prevButton && !prevButton.disabled) {
                    prevButton.click();
                } else if (deltaX < 0 && nextButton && !nextButton.disabled) {
                    nextButton.click();
                }
            }
        });
    }
}

// Initialize the app
const app = new PageApp();
