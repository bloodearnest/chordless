// Main application entry point
import { ChordProParser } from './chordpro-parser.js';

class SetalightApp {
    constructor() {
        this.currentSongIndex = 0;
        this.songs = [];
        this.renderedSongs = [];
        this.init();
    }

    async init() {
        // Set up event listeners
        document.getElementById('prev-song').addEventListener('click', () => this.previousSong());
        document.getElementById('next-song').addEventListener('click', () => this.nextSong());

        // Keyboard navigation
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));

        // Touch/swipe support
        this.setupTouchSupport();

        // Load initial setlist
        await this.loadSetlist();
    }

    handleKeyPress(event) {
        switch(event.key) {
            case 'ArrowLeft':
                event.preventDefault();
                this.previousSong();
                break;
            case 'ArrowRight':
                event.preventDefault();
                this.nextSong();
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.scrollUp();
                break;
            case 'ArrowDown':
                event.preventDefault();
                this.scrollDown();
                break;
        }
    }

    setupTouchSupport() {
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
                    this.previousSong();
                } else {
                    this.nextSong();
                }
            }
        });
    }

    async loadSetlist() {
        // Set date to October 12, 2025 for this setlist
        document.getElementById('setlist-date').textContent = 'October 12, 2025';

        // List of song files in the setlist
        const songFiles = [
            'sets/2025-10-12/1hosanna-praise-is-rising-chordpro-E.txt',
            'sets/2025-10-12/2holy-forever-chordpro-A.txt',
            'sets/2025-10-12/3to-the-one-chordpro-A.txt',
            'sets/2025-10-12/4way-maker-chordpro-E.txt',
            'sets/2025-10-12/5firm-foundation-he-wont-chordpro-E.txt',
            'sets/2025-10-12/6praise-chordpro-E.txt'
        ];

        // Load and parse all songs
        try {
            const loadPromises = songFiles.map(file => fetch(file).then(r => r.text()));
            const songContents = await Promise.all(loadPromises);

            const parser = new ChordProParser();

            this.songs = songContents.map((content, index) => {
                const parsed = parser.parse(content);
                const htmlContent = parser.toHTML(parsed);

                return {
                    title: parsed.metadata.title || `Song ${index + 1}`,
                    chordProContent: content,
                    htmlContent: htmlContent,
                    metadata: parsed.metadata
                };
            });

            // Render all songs at once
            this.renderAllSongs();
            this.showSong(0);

        } catch (error) {
            console.error('Error loading setlist:', error);
            document.querySelector('.song-container').innerHTML =
                '<p>Error loading songs. Please check the console.</p>';
        }
    }

    renderAllSongs() {
        const container = document.querySelector('.song-container');
        container.innerHTML = '';

        this.songs.forEach((song, index) => {
            const songDiv = document.createElement('div');
            songDiv.className = 'song';
            songDiv.dataset.index = index;
            songDiv.style.display = 'none';
            songDiv.innerHTML = `<div class="song-content">${song.htmlContent}</div>`;
            container.appendChild(songDiv);
        });

        document.getElementById('song-position').textContent =
            `1 / ${this.songs.length}`;
    }

    showSong(index) {
        // Hide all songs
        document.querySelectorAll('.song').forEach(song => {
            song.style.display = 'none';
        });

        // Show the selected song
        const songElement = document.querySelector(`.song[data-index="${index}"]`);
        if (songElement) {
            songElement.style.display = 'block';
        }

        document.getElementById('song-position').textContent =
            `${index + 1} / ${this.songs.length}`;

        // Scroll to top
        document.getElementById('main-content').scrollTop = 0;
    }

    nextSong() {
        if (this.currentSongIndex < this.songs.length - 1) {
            this.currentSongIndex++;
            this.showSong(this.currentSongIndex);
        }
    }

    previousSong() {
        if (this.currentSongIndex > 0) {
            this.currentSongIndex--;
            this.showSong(this.currentSongIndex);
        }
    }

    scrollUp() {
        const mainContent = document.getElementById('main-content');
        mainContent.scrollBy({ top: -200, behavior: 'smooth' });
    }

    scrollDown() {
        const mainContent = document.getElementById('main-content');
        mainContent.scrollBy({ top: 200, behavior: 'smooth' });
    }
}

// Initialize the app
const app = new SetalightApp();
