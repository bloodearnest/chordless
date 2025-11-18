// Page-based application logic for Setalight
// Works with service worker routing and Navigation API

import { ChordProParser } from './parser.js';
import { getCurrentDB, formatTempo } from './db.js';
import { transposeSong, getAvailableKeys } from './transpose.js';
import { preloadPadKeysForSongs, preloadPadKey } from './pad-set-service.js';
import '../components/status-message.js';
import '../components/song-list.js';
import '../components/progress-modal.js';
import '../components/setlist-group.js';

// Configuration constants
const CONFIG = {
  // Font sizes
  DEFAULT_FONT_SIZE: 1.6, // rem
  MIN_FONT_SIZE: 0.8, // rem
  MAX_FONT_SIZE: 3.0, // rem
  FONT_SIZE_STEP: 0.1, // rem

  // Drag and drop
  POSITION_THRESHOLD: 20, // px - minimum movement to change target position
  DRAG_START_THRESHOLD: 5, // px - movement before starting drag

  // Scrolling
  KEYBOARD_SCROLL_AMOUNT: 200, // px - scroll distance for up/down arrows

  // Intersection Observer
  VISIBILITY_THRESHOLD: 0.5, // 50% - section must be this visible to be considered "current"

  // Import
  DEFAULT_IMPORT_CUTOFF: '2000-01-01', // Default date for importing setlists (imports all)
};

class PageApp {
  constructor() {
    this.db = null; // Will be initialized in init()
    this.parser = new ChordProParser();
    this.currentSongIndex = undefined;
    this.songs = [];
    this.currentSetlistId = null;
    // Track section visibility state: { songIndex: { sectionIndex: { hideMode: 'none'|'section'|'chords'|'lyrics' } } }
    this.sectionState = {};
    this.sectionObserver = null;
    this.overviewEditMode = false; // Track whether overview is in edit mode
    this.settingsImportHandler = null;
    this.storageImportHandler = null;
    this.globalImportHandler = null;
    this._overviewComponent = null;
    this._suppressLibraryScrollReset = false;
    this._libraryScrollResetTimeout = null;

    // Bind overview component event handlers once
    this._onOverviewSongClick = event => {
      const index = event.detail?.index;
      if (typeof index === 'number') {
        this.navigateToHash(`song-${index}`);
      }
    };

    this._onOverviewSongDelete = event => {
      const index = event.detail?.index;
      if (typeof index === 'number' && this.songs[index]) {
        this.showDeleteSongConfirmation(index, this.songs[index]);
      }
    };

    this._onOverviewAddSong = () => {
      this.openAddSongModal();
    };

    this.init();
  }

  async init() {
    // Initialize IndexedDB with current organisation
    this.db = await getCurrentDB();

    // Check for first-time Google auth and rename org if needed
    // This must happen before rendering to avoid showing "Personal" briefly
    const { checkFirstTimeAuth } = await import('./first-time-auth.js');
    await checkFirstTimeAuth();

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
    } else if (route.type === 'storage') {
      await this.renderStorage();
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

    if (pathname === '/storage' || pathname === '/storage/' || pathname === '/storage.html') {
      return { type: 'storage' };
    }

    const setlistMatch = pathname.match(/^\/setlist\/([^/]+)$/);
    if (setlistMatch) {
      return { type: 'setlist', setlistId: setlistMatch[1], songIndex: -1 };
    }

    const songMatch = pathname.match(/^\/setlist\/([^/]+)\/song\/(-?\d+)$/);
    if (songMatch) {
      return {
        type: 'song',
        setlistId: songMatch[1],
        songIndex: parseInt(songMatch[2]),
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

    // Set up header event listeners (once)
    this.setupLibraryHeaderEvents();

    // Set up hash change handler for navigation
    this.setupLibraryHashNavigation();

    // Set up scroll observer to detect swipe back to library
    this.setupLibraryScrollObserver();

    // If hash is provided, load that song
    if (hash) {
      const { getSongWithContent } = await import('./song-utils.js');
      try {
        const song = await getSongWithContent(hash);
        await this.viewLibrarySong(song, false); // false = don't update URL (we're already there)
      } catch (error) {
        console.error('Song not found:', hash, error);
        // Clear the hash if song not found
        window.history.replaceState({}, '', '/songs');
        // Scroll back to library list
        const container = document.querySelector(
          '.home-content-container, .songs-content-container'
        );
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

  async renderStorage() {
    // Setup the import button on the storage page
    this.setupStorageImportButton();
  }

  setupLibraryHashNavigation() {
    // Remove old handler if exists
    if (this.libraryHashHandler) {
      window.removeEventListener('hashchange', this.libraryHashHandler);
    }

    // Create new handler
    this.libraryHashHandler = async () => {
      const hash = window.location.hash.substring(1);

      if (!hash) {
        // No hash = show library list
        this.closeLibrarySongView(false); // false = don't update URL (already changed)
      } else {
        // Hash present = show specific song
        const { getSongWithContent } = await import('./song-utils.js');
        try {
          const song = await getSongWithContent(hash);
          await this.viewLibrarySong(song, false); // false = don't update URL
        } catch (error) {
          // Song not found, go back to library
          console.error('Song not found:', hash, error);
          window.location.hash = '';
        }
      }
    };

    window.addEventListener('hashchange', this.libraryHashHandler);
  }

  setupLibraryScrollObserver() {
    // Disconnect any existing observer
    if (this.libraryScrollObserver) {
      this.libraryScrollObserver.disconnect();
    }

    // Get the library view element
    const libraryView = document.querySelector('.library-view');
    if (!libraryView) return;

    // Create observer to detect when library view becomes visible (from swipe)
    this.libraryScrollObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (this._suppressLibraryScrollReset) {
            return;
          }
          // When library view becomes fully visible
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            // Check if we have a hash (song is open)
            const hash = window.location.hash.substring(1);
            if (hash) {
              // User swiped back to library, clear the hash
              // This will trigger the hashchange handler which calls closeLibrarySongView
              window.location.hash = '';
            }
          }
        });
      },
      {
        threshold: [0.5, 1.0],
      }
    );

    // Start observing the library view
    this.libraryScrollObserver.observe(libraryView);
  }

  _suppressLibraryScrollResetTemporarily(duration = 600) {
    this._suppressLibraryScrollReset = true;
    if (this._libraryScrollResetTimeout) {
      clearTimeout(this._libraryScrollResetTimeout);
    }
    this._libraryScrollResetTimeout = setTimeout(() => {
      this._suppressLibraryScrollReset = false;
      this._libraryScrollResetTimeout = null;
    }, duration);
  }

  /**
   * Render a consistent status message in the target container.
   * @param {HTMLElement} container
   * @param {{message?: string, detail?: string, state?: string, slotContent?: Node|Node[]}} options
   */
  showStatusMessage(container, options = {}) {
    if (!container) return null;
    container.textContent = '';
    const element = this.createStatusMessageElement(options);
    container.appendChild(element);
    return element;
  }

  createStatusMessageElement({
    message = '',
    detail = '',
    state = 'info',
    slotContent = null,
  } = {}) {
    const element = document.createElement('status-message');
    if (message) element.message = message;
    if (detail) element.detail = detail;
    element.state = state;

    const slotItems = Array.isArray(slotContent) ? slotContent : slotContent ? [slotContent] : [];
    slotItems.forEach(node => {
      if (node) {
        element.appendChild(node);
      }
    });

    return element;
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
      this.showStatusMessage(listContainer, {
        message: 'Loading setlists...',
        state: 'loading',
      });

      const setlists = await this.db.getAllSetlists();

      if (setlists.length === 0) {
        // No setlists - show import guidance
        this.showStatusMessage(listContainer, {
          message: 'No setlists found in database.',
          detail: 'Go to Settings to import setlists.',
          state: 'empty',
        });
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
        const formattedSetlists = groupedByYear[year].map(setlist => {
          const songCount = Array.isArray(setlist.songs) ? setlist.songs.length : 0;
          const baseName = this.formatSetlistName(setlist.date);
          const displayName = setlist.name ? `${baseName} - ${setlist.name}` : baseName;
          return {
            id: setlist.id,
            url: `/setlist/${setlist.id}`,
            displayName,
            songCount,
          };
        });

        const yearSection = document.createElement('setlist-group');
        yearSection.year = year;
        yearSection.setlists = formattedSetlists;
        yearSection.expanded = year == currentYear;
        listContainer.appendChild(yearSection);
      }
    } catch (error) {
      console.error('Error loading setlists:', error);
      this.showStatusMessage(listContainer, {
        message: 'Error loading setlists. Please check the console.',
        state: 'error',
      });
    }
  }

  async renderSongLibraryTab() {
    const libraryContainer = document.getElementById('song-library-list');
    const searchInput = document.getElementById('song-search');

    try {
      // Show loading message
      this.showStatusMessage(libraryContainer, {
        message: 'Loading songs...',
        state: 'loading',
      });

      // Load songs from per-org database
      const { getSongWithContent } = await import('./song-utils.js');
      const songRecords = await this.db.getAllSongs();
      console.log('Loaded song records:', songRecords.length);

      if (songRecords.length === 0) {
        this.showStatusMessage(libraryContainer, {
          message: 'No songs in library.',
          detail: 'Import setlists to populate the song library.',
          state: 'empty',
        });
        return;
      }

      // Group songs by deterministic ID to get unique songs (not all variants)
      const songsById = new Map();
      for (const song of songRecords) {
        if (song.isDefault || !songsById.has(song.id)) {
          songsById.set(song.id, song);
        }
      }

      // Parse titles from chordpro and enrich with usage data
      const songs = [];
      for (const songRecord of songsById.values()) {
        try {
          const fullSong = await getSongWithContent(songRecord.uuid);

          // Get usage data from organisation DB (using deterministic ID)
          const usage = await this.db.getSongUsageFromSetlists(fullSong.id);
          if (usage && usage.length > 0) {
            const lastUsage = usage[0];
            fullSong.lastUsageInfo = {
              date: lastUsage.setlistDate,
              leader: lastUsage.owner,
              key: lastUsage.playedInKey,
            };
          }

          songs.push(fullSong);
        } catch (error) {
          console.error(`Error loading song ${songRecord.uuid}:`, error);
          // Continue with next song
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
        searchInput.addEventListener('input', e => {
          this.filterSongs(e.target.value);
        });
      }

      // Initial render with all songs
      this.renderSongList(songs);
    } catch (error) {
      console.error('Error loading songs:', error);
      this.showStatusMessage(libraryContainer, {
        message: 'Error loading songs. Please check the console.',
        state: 'error',
      });
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

      return title.includes(term) || artist.includes(term) || lyricsText.includes(term);
    });

    this.renderSongList(filtered);
  }

  renderSongList(songs) {
    const libraryContainer = document.getElementById('song-library-list');

    console.log('renderSongList called with', songs.length, 'songs');
    console.log('libraryContainer:', libraryContainer);

    libraryContainer.textContent = '';

    const songList = document.createElement('song-list');
    songList.songs = songs;
    songList.variant = 'library';
    songList.emptyMessage = 'No songs match your search.';
    songList.addEventListener('song-select', event => {
      const { song } = event.detail || {};
      if (song) {
        this.viewLibrarySong(song);
      }
    });

    libraryContainer.appendChild(songList);
    console.log('Finished rendering', songs.length, 'songs');
  }

  async viewLibrarySong(song, updateHash = true) {
    console.log('viewLibrarySong called with:', song);

    // Store the current library song for editing
    this.currentLibrarySong = song;
    this.currentLibrarySongId = song.uuid; // Use UUID for lookups

    // Update URL hash if requested (uses UUID)
    if (updateHash) {
      window.location.hash = song.uuid;
    }

    // Update navigation menu for library song context (uses deterministic ID for usage tracking)
    this.updateNavigationMenu({ type: 'librarySong', songId: song.id });

    // Get chordpro content from new model
    const chordproContent = song.chordpro;
    if (!chordproContent) {
      console.error('Song has no ChordPro content!', song);
      console.error('Available fields:', Object.keys(song));
      throw new Error('Song has no ChordPro content');
    }

    // Use already-parsed data if available, otherwise parse
    const parsed = song.parsed || this.parser.parse(chordproContent);

    // Store parsed song for library context
    this.currentLibraryParsedSong = parsed;
    this.currentLibraryKey = parsed.metadata.key;

    // Update title in header
    const appHeader = document.getElementById('library-app-header');
    if (appHeader) {
      appHeader.heading = parsed.metadata.title || 'Untitled';
    }

    // Show all header controls
    const keySelector = document.getElementById('library-key-selector');
    const metaHeader = document.getElementById('library-song-meta-header');
    const resetButton = document.getElementById('library-reset-button');
    const fontSizeControls = document.getElementById('library-font-size-controls');

    if (keySelector) keySelector.style.display = '';
    if (metaHeader) metaHeader.style.display = 'flex';
    if (resetButton) resetButton.style.display = 'none'; // Initially hidden
    if (fontSizeControls) fontSizeControls.style.display = 'none'; // Initially hidden

    // Update key selector
    if (keySelector && parsed.metadata.key) {
      this.updateLibraryKeySelector(parsed.metadata.key);
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

    // Create song-display component
    const songDisplay = document.createElement('song-display');
    songDisplay.parsed = parsed;
    songDisplay.songIndex = 0;

    songContent.appendChild(songDisplay);
    contentElement.appendChild(songContent);

    // Initialize song sections (must happen after DOM is attached)
    await customElements.whenDefined('song-section');
    this._initializeSongSections(contentElement);

    // Setup key selector for library
    this.setupLibraryKeySelector(parsed);

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
      this._suppressLibraryScrollResetTemporarily();
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
    const keySelector = document.getElementById('library-key-selector');
    const metaHeader = document.getElementById('library-song-meta-header');
    const resetButton = document.getElementById('library-reset-button');
    const fontSizeControls = document.getElementById('library-font-size-controls');

    if (keySelector) keySelector.style.display = 'none';
    if (metaHeader) metaHeader.style.display = 'none';
    if (resetButton) resetButton.style.display = 'none';
    if (fontSizeControls) fontSizeControls.style.display = 'none';

    // Restore "Song Library" title
    const appHeader = document.getElementById('library-app-header');
    if (appHeader) {
      appHeader.heading = 'Song Library';
    }

    // Clear edit mode state
    const isEditMode = document.body.classList.contains('edit-mode');
    if (isEditMode && appHeader) {
      appHeader.editMode = false;
      document.body.classList.remove('edit-mode');
      document.body.removeAttribute('data-edit-mode');
      const keySel = document.getElementById('library-key-selector');
      if (keySel) keySel.editMode = false;
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

  setupLibraryHeaderEvents() {
    const appHeader = document.getElementById('library-app-header');
    const navMenu = document.getElementById('nav-menu');
    if (!appHeader) return;

    // Only set up listeners once
    if (this._libraryHeaderEventsSetup) return;
    this._libraryHeaderEventsSetup = true;

    // Listen for nav-menu-click event
    appHeader.addEventListener('nav-menu-click', () => {
      if (navMenu) {
        // Get the nav button from the app-header component's shadow root
        const navButton = appHeader.shadowRoot?.querySelector('.nav-menu-button');
        if (navButton) {
          navMenu.setTriggerButton(navButton);
        }
        navMenu.togglePopover();
      }
    });

    // Listen for edit-mode-toggle event
    appHeader.addEventListener('edit-mode-toggle', () => {
      const isEnteringEditMode = !document.body.classList.contains('edit-mode');
      const keySelector = document.getElementById('library-key-selector');

      if (isEnteringEditMode) {
        // Enter edit mode
        document.body.classList.add('edit-mode');
        document.body.setAttribute('data-edit-mode', '');
        appHeader.editMode = true;

        // Update key selector edit mode
        if (keySelector) {
          keySelector.editMode = true;
        }

        console.log('Entered edit mode - changes will save to global songs database');

        // Update all section components
        this._initializeSongSections();
      } else {
        // Exit edit mode - save to global database
        document.body.classList.remove('edit-mode');
        document.body.removeAttribute('data-edit-mode');
        appHeader.editMode = false;

        // Update key selector edit mode
        if (keySelector) {
          keySelector.editMode = false;
        }

        this.saveLibrarySongToDatabase();

        // Update all section components
        this._initializeSongSections();
      }
    });

    // Listen for info-click event
    appHeader.addEventListener('info-click', () => {
      if (this.currentLibraryParsedSong && this.currentLibrarySong) {
        this.showLibrarySongInfo(this.currentLibraryParsedSong, this.currentLibrarySong);
      }
    });

    // Listen for header-expand-toggle event
    appHeader.addEventListener('header-expand-toggle', e => {
      const { expanded } = e.detail;
      if (expanded) {
        document.body.classList.add('header-expanded');
        document.documentElement.style.setProperty('--header-expanded', '1');
      } else {
        document.body.classList.remove('header-expanded');
        document.documentElement.style.setProperty('--header-expanded', '0');
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
      // currentLibrarySongId is the UUID
      const song = await this.db.getSong(this.currentLibrarySongId);

      if (!song) {
        console.error('Song not found in database');
        return;
      }

      // Update the timestamp
      song.modifiedDate = new Date().toISOString();

      // Save back to per-org database
      await this.db.saveSong(song);

      console.log('Saved song to database:', song.title);

      // Refresh the library song view with updated data
      const { getSongWithContent } = await import('./song-utils.js');
      const fullSong = await getSongWithContent(song.uuid, this.db);
      this.currentLibrarySong = fullSong;
      await this.viewLibrarySong(fullSong);
    } catch (error) {
      console.error('Error saving library song:', error);
    }
  }

  setupLibraryKeySelector(parsed) {
    const keySelector = document.getElementById('library-key-selector');
    if (!keySelector) return;

    // Listen for key-change events
    keySelector.addEventListener('key-change', async e => {
      const newKey = e.detail.value;
      await this.handleLibraryKeyChange(newKey);
    });

    // Populate key selector with current key
    const currentKey = parsed.metadata.key || this.currentLibraryKey;
    if (currentKey) {
      this.updateLibraryKeySelector(currentKey);
    }
  }

  updateLibraryKeySelector(selectedKey) {
    const keySelector = document.getElementById('library-key-selector');
    if (!keySelector) return;

    // Get available keys rotated around the selected key
    const keys = getAvailableKeys(selectedKey);

    // Get original key from current song
    const originalKey = this.currentLibraryParsedSong?.metadata?.key;

    // Update component properties
    keySelector.value = selectedKey;
    keySelector.keys = keys;
    keySelector.originalKey = originalKey;
    keySelector.editMode = document.body.classList.contains('edit-mode');
  }

  async handleLibraryKeyChange(newKey) {
    if (!newKey || !this.currentLibraryParsedSong) return;

    console.log(`Library key changed to: ${newKey}`);

    // Update current key
    this.currentLibraryKey = newKey;

    // Re-render the song with transposition
    await this.reRenderLibrarySong(newKey);

    // Update the key selector with the new key
    this.updateLibraryKeySelector(newKey);
  }

  async reRenderLibrarySong(targetKey) {
    if (!this.currentLibraryParsedSong) return;

    const contentElement = document.getElementById('library-song-content');
    if (!contentElement) return;

    const originalParsed = this.currentLibraryParsedSong;
    if (!originalParsed) return;

    const originalKey = originalParsed.metadata.key;
    const parsedForRender =
      typeof structuredClone === 'function'
        ? structuredClone(originalParsed)
        : JSON.parse(JSON.stringify(originalParsed));

    if (targetKey && originalKey && targetKey !== originalKey) {
      transposeSong(parsedForRender, originalKey, targetKey);
      parsedForRender.metadata.key = targetKey;
    }

    // Re-render with updated data
    contentElement.innerHTML = '';
    const songContent = document.createElement('div');
    songContent.className = 'song-content library-single-song';

    // Create song-display component
    const songDisplay = document.createElement('song-display');
    songDisplay.parsed = parsedForRender;
    songDisplay.songIndex = 0;

    songContent.appendChild(songDisplay);
    contentElement.appendChild(songContent);

    // Wait for Lit to render the shadow DOM contents
    await songDisplay.updateComplete;

    // Wait for song-section elements to be ready before initializing
    await customElements.whenDefined('song-section');

    // Re-initialize sections with current edit mode state
    this._initializeSongSections(contentElement);

    // Re-apply font size
    this.applyLibraryFontSize();
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
    const songUsage = await this.db.getSongUsageFromSetlists(song.id);

    const appearances = songUsage.map(entry => ({
      setlistId: entry.setlistId,
      date: entry.setlistDate,
      playedInKey: entry.playedInKey,
      leader: entry.owner,
      setlistName: entry.setlistName,
    }));

    // Create song data object
    const songData = {
      ...song,
      title: parsed.metadata.title || song.title,
      metadata: parsed.metadata,
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
      this.currentLibraryFontSize = Math.max(
        CONFIG.MIN_FONT_SIZE,
        this.currentLibraryFontSize - CONFIG.FONT_SIZE_STEP
      );
      this.applyLibraryFontSize();
    });

    newIncreaseBtn.addEventListener('click', () => {
      this.currentLibraryFontSize = Math.min(
        CONFIG.MAX_FONT_SIZE,
        this.currentLibraryFontSize + CONFIG.FONT_SIZE_STEP
      );
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

    // Update key selector
    if (this.currentLibraryKey) {
      this.updateLibraryKeySelector(this.currentLibraryKey);
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
        lastPlayedDate: null,
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
    const sortedAppearances = [...song.appearances].sort((a, b) => b.date.localeCompare(a.date));
    const lastPlayedDate = sortedAppearances[0].date;

    return {
      totalAppearances,
      last12MonthsAppearances,
      lastPlayedDate,
    };
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
        leader: appearance.owner,
      }));
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

  setupStorageImportButton() {
    const storagePage = document.getElementById('storage-page');
    console.log('[PageApp] setupStorageImportButton', !!storagePage);
    if (!storagePage) return;

    if (!this.globalImportHandler) {
      this.globalImportHandler = () => {
        this.runImport();
      };
      document.addEventListener('import-requested', this.globalImportHandler);
    }
  }

  async runImport() {
    // Dynamically import the importer
    const { SetlistImporter } = await import('./import.js');
    const importer = new SetlistImporter(); // Defaults to 'TEST' organisation
    await importer.init();

    // Show progress modal
    const progressModal = document.createElement('progress-modal');
    progressModal.heading = 'Importing Setlists';
    progressModal.message = 'Initializing...';
    progressModal.progress = 0;
    document.body.appendChild(progressModal);

    try {
      const result = await importer.importFromServer(progress => {
        progressModal.updateProgress({
          message: progress.message,
          current: progress.current,
          total: progress.total,
        });
      });

      if (result.cancelled) {
        progressModal.close();
        return;
      }

      progressModal.setComplete(
        `Import complete! ${result.setlists} setlists, ${result.songs} songs`
      );

      // Wait a moment then navigate to home to see imported setlists
      setTimeout(() => {
        progressModal.close();
        window.location.href = '/';
      }, 1500);
    } catch (error) {
      console.error('Import failed:', error);
      progressModal.setError(`Import failed: ${error.message}`);
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
    const eventName =
      eventParts.length > 0 ? this.capitalizeWords(eventParts.join(' ').replace(/_/g, ' ')) : null;

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
    } catch {
      return dateStr;
    }
  }

  capitalizeWords(str) {
    return str
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  getOrdinalSuffix(day) {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
      case 1:
        return 'st';
      case 2:
        return 'nd';
      case 3:
        return 'rd';
      default:
        return 'th';
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
        this.showStatusMessage(container, {
          message: 'Setlist not found.',
          state: 'error',
        });
        return;
      }

      if (setlist.songs.length === 0) {
        console.warn('[WARN] Setlist has no songs');

        // Set instance variables for empty setlist
        this.songs = [];
        this.currentSetlistId = setlistId;
        this.currentSetlist = setlist;
        this._setOverviewComponent(null);

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
      const { getSongById } = await import('./song-utils.js');

      for (const songEntry of setlist.songs) {
        // Get source text (local edits or from Songs collection)
        let sourceText;
        let canonicalSong = null;
        if (songEntry.chordproEdits) {
          sourceText = songEntry.chordproEdits;
        } else {
          // Get song with content using deterministic ID
          try {
            canonicalSong = await getSongById(songEntry.songId, this.db);
            sourceText = canonicalSong.chordpro;
          } catch (error) {
            console.error('[ERROR] Song not found in DB:', songEntry.songId, error);
            continue;
          }
        }

        // Parse the chordpro
        const parsed = this.parser.parse(sourceText);

        // Capture original key before any transposition so we can always return to it
        const originalKey = parsed.metadata.key || null;
        const targetKey = songEntry.key;

        // Apply transposition if requested and we have a reference key
        if (targetKey && originalKey && targetKey !== originalKey) {
          transposeSong(parsed, originalKey, targetKey);
          parsed.metadata.key = targetKey;
        } else if (targetKey && !originalKey) {
          // Still reflect the requested key in metadata even if we can't transpose
          parsed.metadata.key = targetKey;
        }

        // Apply BPM override
        const bpmOverride = songEntry.tempo;
        if (bpmOverride) {
          parsed.metadata.tempo = bpmOverride;
        }

        // Use tempo and time signature from database if available (already parsed), otherwise use ChordPro
        const parsedTempoInfo = this._parseTempoMetadata(parsed.metadata.tempo);
        let currentBPM = parsedTempoInfo.bpm;
        let timeSignature = parsed.metadata.time; // ChordPro uses 'time'
        let tempoNote = parsedTempoInfo.tempoNote || null;
        if (canonicalSong && canonicalSong.metadata) {
          const canonicalTempoInfo = this._parseTempoMetadata(canonicalSong.metadata.tempo);
          if (canonicalTempoInfo.bpm !== null) {
            currentBPM = canonicalTempoInfo.bpm;
          }
          timeSignature = canonicalSong.metadata.timeSignature || parsed.metadata.time;
          tempoNote = canonicalTempoInfo.tempoNote || tempoNote;
        }

        // Derive default tempoNote from time signature denominator if not explicitly set
        if (!tempoNote) {
          tempoNote = '1/4'; // Default to quarter notes
        }
        if (timeSignature && (!tempoNote || tempoNote === '1/4')) {
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
          parsed: parsed,
          songIndex: songEntry.order,
          metadata: {
            ...parsed.metadata,
            tempo: currentBPM,
            tempoNote: tempoNote,
            timeSignature: timeSignature,
          },
          originalKey: originalKey, // Immutable original
          currentKey: parsed.metadata.key,
          currentBPM: currentBPM,
          currentFontSize: CONFIG.DEFAULT_FONT_SIZE, // fontSize is now in setlist_local, not modifications
          songId: songEntry.songId,
          sourceText: sourceText,
          hasLocalEdits: songEntry.chordproEdits !== null,
        });
      }

      console.log('Parsed songs:', songs.length);

      // Store songs for navigation
      this.songs = songs;
      this.currentSetlistId = setlistId;
      this.currentSetlist = setlist;

      // Kick off background pad caching for all keys in this setlist
      preloadPadKeysForSongs(this.songs);

      // Initialize section states (now loaded from setlist_local, not from setlist modifications)
      this.sectionState = {};

      // Check hash BEFORE rendering to determine initial view state
      const hash = window.location.hash;
      const hashValue = hash.substring(1);
      const shouldShowSongDirectly = hashValue && hashValue.startsWith('song-');
      console.log(
        '[Initial Load] hash:',
        hash,
        'hashValue:',
        hashValue,
        'shouldShowSongDirectly:',
        shouldShowSongDirectly
      );

      // Render all songs on one page
      const container = document.querySelector('.song-container');
      console.log('Rendering full setlist into container:', container);
      // Clear container and append fragment
      container.textContent = '';
      const fragment = this.renderFullSetlist(setlist, songs);
      container.appendChild(fragment);
      this._initializeSongSections(container);

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
      this.showStatusMessage(container, {
        message: 'Error loading songs. Please check the console.',
        state: 'error',
      });
      this._setOverviewComponent(null);
    }
  }

  _setOverviewComponent(component) {
    if (this._overviewComponent) {
      this._overviewComponent.removeEventListener('overview-song-click', this._onOverviewSongClick);
      this._overviewComponent.removeEventListener(
        'overview-song-delete',
        this._onOverviewSongDelete
      );
      this._overviewComponent.removeEventListener('overview-add-song', this._onOverviewAddSong);
    }

    this._overviewComponent = component;

    if (component) {
      component.addEventListener('overview-song-click', this._onOverviewSongClick);
      component.addEventListener('overview-song-delete', this._onOverviewSongDelete);
      component.addEventListener('overview-add-song', this._onOverviewAddSong);
    }
  }

  _refreshOverviewComponentSongs() {
    if (this._overviewComponent) {
      this._overviewComponent.songs = [...this.songs];
    }
  }

  _refreshOverviewComponentEditMode() {
    if (this._overviewComponent) {
      this._overviewComponent.editMode = this.overviewEditMode;
    }
  }

  _replaceHistoryForSong(index) {
    if (typeof window === 'undefined' || !window.history || !window.location) return;
    const currentState = history.state || {};
    const newUrl = `${window.location.pathname}#song-${index}`;
    const nextState = {
      ...currentState,
      view: 'song',
      index,
      fromOverview: currentState.fromOverview === true,
    };
    history.replaceState(nextState, '', newUrl);
  }

  _replaceHistoryForOverview() {
    if (typeof window === 'undefined' || !window.history || !window.location) return;
    const newUrl = `${window.location.pathname}#overview`;
    history.replaceState({ view: 'overview' }, '', newUrl);
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
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  renderFullSetlist(setlist, songs) {
    const fragment = document.createDocumentFragment();

    // Create overview section rendered by Lit component
    const overview = document.createElement('div');
    overview.id = 'overview';
    overview.className = 'section';

    const songContentWrapper = document.createElement('div');
    songContentWrapper.className = 'song-content';

    const overviewComponent = document.createElement('setlist-overview');
    overviewComponent.songs = songs;
    overviewComponent.editMode = this.overviewEditMode;
    this._setOverviewComponent(overviewComponent);

    songContentWrapper.appendChild(overviewComponent);
    overview.appendChild(songContentWrapper);
    fragment.appendChild(overview);

    // Render all songs
    songs.forEach((song, index) => {
      const songElement = document.createElement('div');
      songElement.classList.add('section');
      songElement.id = `song-${index}`;
      if (song.parsed) {
        const songDisplay = document.createElement('song-display');
        songDisplay.parsed = song.parsed;
        songDisplay.songIndex = song.songIndex;
        const songContent = document.createElement('div');
        songContent.className = 'song-content';
        songContent.appendChild(songDisplay);
        songElement.appendChild(songContent);
      }
      fragment.appendChild(songElement);
    });

    return fragment;
  }

  _initializeSongSections(root = document) {
    const isEditMode = document.body.classList.contains('edit-mode');

    // Find all song-section elements, including those inside song-display shadow DOMs
    const sections = [];

    // First, get any song-sections directly in the root
    sections.push(...root.querySelectorAll('song-section'));

    // Then, query into song-display shadow roots
    const songDisplays = root.querySelectorAll('song-display');
    songDisplays.forEach(songDisplay => {
      if (songDisplay.shadowRoot) {
        sections.push(...songDisplay.shadowRoot.querySelectorAll('song-section'));
      }
    });

    sections.forEach(section => {
      const songIndex = Number(section.getAttribute('song-index'));
      const sectionIndex = Number(section.getAttribute('section-index'));
      if (Number.isNaN(songIndex) || Number.isNaN(sectionIndex)) {
        return;
      }
      const state = this.getSectionState(songIndex, sectionIndex);

      // Use smart default if saved hideMode is 'none'
      let hideMode = state.hideMode || 'none';
      if (hideMode === 'none' && typeof section.getRecommendedHideMode === 'function') {
        hideMode = section.getRecommendedHideMode();
        // Update saved state with the smart default
        if (state.hideMode !== hideMode) {
          state.hideMode = hideMode;
          this.saveState();
        }
      }

      // Apply state via reactive properties
      section.hideMode = hideMode;
      section.isCollapsed = state.isCollapsed || false;
      section.isHidden = state.isHidden || false;
      section.editMode = isEditMode;
    });
  }

  _getSongSectionComponent(songIndex, sectionIndex) {
    // First try direct query (in case not in shadow DOM)
    let section = document.querySelector(
      `song-section[song-index="${songIndex}"][section-index="${sectionIndex}"]`
    );
    if (section) return section;

    // Query into song-display shadow roots
    const songDisplays = document.querySelectorAll('song-display');
    for (const songDisplay of songDisplays) {
      if (songDisplay.shadowRoot) {
        section = songDisplay.shadowRoot.querySelector(
          `song-section[song-index="${songIndex}"][section-index="${sectionIndex}"]`
        );
        if (section) return section;
      }
    }

    return null;
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

    // Leaving overview edit mode when navigating into a song
    this.setOverviewEditMode(false);

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
      const keySelector = document.getElementById('key-selector');
      document.body.classList.remove('edit-mode');
      document.body.removeAttribute('data-edit-mode');
      if (appHeader) {
        appHeader.editMode = false;
      }
      if (keySelector) {
        keySelector.editMode = false;
      }

      // Update all sections to reflect non-edit mode
      this._initializeSongSections();

      // Save setlist to IndexedDB
      if (this.currentSetlist) {
        // Update timestamp
        this.currentSetlist.modifiedDate = new Date().toISOString();

        // Save to database
        await this.db.saveSetlist(this.currentSetlist);
        console.log('[ExitEditMode] Saved setlist to IndexedDB');
      }
    }
  }

  async updateHeader(song, instant = false) {
    const appHeader = document.getElementById('app-header');
    const metaEl = document.getElementById('song-meta-header');
    const keySelector = document.getElementById('key-selector');
    const resetButton = document.getElementById('reset-button');
    const fontSizeControls = document.querySelector('.font-size-controls');

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
    const titleChanged = appHeader.heading !== newTitle;
    if (!titleChanged && !instant) {
      return; // No change needed
    }

    if (instant) {
      // Instant update - no animation
      appHeader.setTitleInstant(newTitle);
      this._updateHeaderContent(song, metaEl, keySelector, resetButton, fontSizeControls);
    } else {
      // Animated update - fade out old, swap content, fade in new
      appHeader.heading = newTitle;

      await this._animateSlottedContent(async () => {
        this._updateHeaderContent(song, metaEl, keySelector, resetButton, fontSizeControls);
      });
    }
  }

  _updateHeaderContent(song, metaEl, keySelector, resetButton, fontSizeControls) {
    if (song) {
      // Update key selector
      if (song.currentKey) {
        this.updateKeySelector(song.currentKey);
      } else {
        if (keySelector) {
          keySelector.value = '-';
          keySelector.keys = [];
        }
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
      if (keySelector) keySelector.style.display = '';
      if (resetButton) resetButton.style.display = 'block';
      if (fontSizeControls) fontSizeControls.style.display = 'flex';

      // Store current song for info button handler
      this._currentSongForInfo = song;
    } else {
      // Overview - clear key
      if (keySelector) {
        keySelector.value = '-';
        keySelector.keys = [];
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
      if (keySelector) keySelector.style.display = 'none';
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
      composed: true,
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

    // Load full song data from database to get metadata/variants
    let fullSong = null;
    try {
      const { getSongById } = await import('./song-utils.js');
      fullSong = await getSongById(song.songId, this.db);
    } catch (error) {
      console.error('Could not load full song data for:', song.songId, error);
    }

    if (!fullSong) {
      songInfoEl.loading = false;
      songInfoEl.song = null;
      return;
    }

    // Load song usage data to get appearances
    const songUsage = await this.db.getSongUsageFromSetlists(song.songId);
    const appearances = songUsage.map(entry => ({
      setlistId: entry.setlistId,
      date: entry.setlistDate,
      playedInKey: entry.playedInKey,
      leader: entry.owner,
      setlistName: entry.setlistName,
    }));

    // Merge the display song data with the full database song data
    const songData = {
      ...fullSong,
      title: song.title,
      metadata: song.metadata,
    };

    // Update component
    songInfoEl.loading = false;
    songInfoEl.song = songData;
    songInfoEl.appearances = appearances;
  }

  async showSetlistInfo() {
    const modal = document.getElementById('song-info-modal');
    const modalBody = document.getElementById('modal-body');

    // Clear previous content
    modalBody.textContent = '';

    modal.show();

    // Create or get setlist-info component
    let setlistInfoEl = modalBody.querySelector('setlist-info');
    if (!setlistInfoEl) {
      setlistInfoEl = document.createElement('setlist-info');
      modalBody.appendChild(setlistInfoEl);
    }

    // Show loading state
    setlistInfoEl.loading = true;

    // Get leader asynchronously
    const leader = await this.getSetlistLeader();

    // Update component with data
    setlistInfoEl.loading = false;
    setlistInfoEl.setlist = this.currentSetlist;
    setlistInfoEl.leader = leader;
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
        behavior: 'smooth',
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
    this.sectionObserver = new IntersectionObserver(
      entries => {
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
            this._replaceHistoryForOverview();
          } else if (sectionId.startsWith('song-')) {
            const index = parseInt(sectionId.split('-')[1]);
            if (index >= 0 && index < this.songs.length) {
              this.setOverviewEditMode(false);
              this.currentSongIndex = index;
              this.updateHeader(this.songs[index], false); // animate=true for smooth transition
              this.applyFontSize(index);
              this.dispatchSongChange(this.songs[index]);
              this._replaceHistoryForSong(index);
            }
          }
        }
      },
      {
        root: container,
        threshold: [0, 0.5, 1], // Trigger at 0%, 50%, and 100% visibility
        rootMargin: '0px',
      }
    );

    // Observe all sections (overview + all songs)
    document.querySelectorAll('.section').forEach(section => {
      this.sectionObserver.observe(section);
    });
  }

  setupHashNavigation(setlistId, totalSongs) {
    // Clean up previous handlers to avoid duplicates when re-rendering setlist
    if (this._popstateHandler) {
      window.removeEventListener('popstate', this._popstateHandler);
    }
    if (this._hashChangeHandler) {
      window.removeEventListener('hashchange', this._hashChangeHandler);
    }

    const handleHashNavigation = () => {
      const hashValue = window.location.hash.substring(1) || 'overview';
      console.log('[HashNavigation] Handling hash change:', hashValue);

      if (!hashValue || hashValue === 'overview') {
        this.showOverview(false);
      } else if (hashValue.startsWith('song-')) {
        const index = parseInt(hashValue.split('-')[1]);
        if (!Number.isNaN(index) && index >= 0 && index < totalSongs) {
          this.showSong(index, false);
        }
      }

      const route = window.__ROUTE__ || this.parseRoute(window.location.pathname);
      this.updateNavigationMenu(route);
    };

    this._popstateHandler = event => {
      console.log('[Popstate] state:', event.state, 'hash:', window.location.hash);
      handleHashNavigation();
    };
    this._hashChangeHandler = () => {
      console.log('[HashChange] hash changed to:', window.location.hash);
      handleHashNavigation();
    };

    window.addEventListener('popstate', this._popstateHandler);
    window.addEventListener('hashchange', this._hashChangeHandler);

    console.log('History/hash navigation setup complete for', totalSongs, 'songs');
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
      // Get smart default based on content if section exists
      let defaultHideMode = 'none';
      const section = this._getSongSectionComponent(songIndex, sectionIndex);
      if (section && typeof section.getRecommendedHideMode === 'function') {
        defaultHideMode = section.getRecommendedHideMode();
      }

      this.sectionState[songIndex][sectionIndex] = {
        hideMode: defaultHideMode, // 'none', 'collapse', 'chords', 'lyrics', 'hide'
        isCollapsed: false,
        isHidden: false,
      };
    }
    return this.sectionState[songIndex][sectionIndex];
  }

  setSectionHideMode(songIndex, sectionIndex, mode) {
    const state = this.getSectionState(songIndex, sectionIndex);

    if (mode === 'collapse') {
      const component = this._getSongSectionComponent(songIndex, sectionIndex);
      const details = component?.getDetailsElement();
      if (details) {
        this.animateSectionToggle(songIndex, sectionIndex, details);
      }
      return;
    }

    const explicitShowMap = {
      'show-all': 'none',
      'show-lyrics': 'chords',
      'show-chords': 'lyrics',
      'show-none': 'hide',
    };
    const mappedMode = explicitShowMap[mode] || mode;
    const isExplicit = Boolean(explicitShowMap[mode]);

    if (mappedMode === 'hide') {
      if (isExplicit) {
        state.isHidden = true;
        state.hideMode = 'hide';
        state.isCollapsed = false;
      } else {
        state.isHidden = !state.isHidden;
        if (state.isHidden) {
          state.hideMode = 'hide';
          state.isCollapsed = false;
        } else {
          state.hideMode = 'none';
        }
      }
      this.saveState();
      this.updateSectionDOM(songIndex, sectionIndex);
      return;
    }

    if (state.isHidden) {
      state.isHidden = false;
    }
    if (state.isCollapsed) {
      state.isCollapsed = false;
    }

    if (isExplicit || mappedMode === 'none') {
      state.hideMode = mappedMode || 'none';
    } else {
      state.hideMode = state.hideMode === mappedMode ? 'none' : mappedMode;
    }
    this.saveState();
    this.updateSectionDOM(songIndex, sectionIndex);
  }

  animateSectionToggle(songIndex, sectionIndex, details) {
    const state = this.getSectionState(songIndex, sectionIndex);
    const content = details.querySelector('.section-content');
    const wrapper = details.closest('.song-section-wrapper') || details;
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
    const component = this._getSongSectionComponent(songIndex, sectionIndex);
    if (!component) {
      return;
    }
    const state = this.getSectionState(songIndex, sectionIndex);
    const isEditMode = document.body.classList.contains('edit-mode');
    // Apply state via reactive properties
    component.hideMode = state.hideMode || 'none';
    component.isCollapsed = state.isCollapsed || false;
    component.isHidden = state.isHidden || false;
    component.editMode = isEditMode;
  }

  applySectionState() {
    this._initializeSongSections();
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
        document.body.setAttribute('data-edit-mode', '');
        appHeader.editMode = true;

        // Update key selector edit mode
        const keySelector = document.getElementById('key-selector');
        if (keySelector) {
          keySelector.editMode = true;
        }

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
        this._initializeSongSections();
      } else {
        // Exiting edit mode - fade everything simultaneously
        // Remove edit mode class immediately to trigger all fades
        document.body.classList.remove('edit-mode');
        document.body.removeAttribute('data-edit-mode');
        appHeader.editMode = false;

        // Update key selector edit mode
        const keySelector = document.getElementById('key-selector');
        if (keySelector) {
          keySelector.editMode = false;
        }

        // Remove fade-in classes from edit controls (triggers fade out)
        document.querySelectorAll('.edit-mode-control').forEach(el => {
          el.classList.remove('fade-in');
        });

        // Remove fade-complete from normal controls (makes them visible again)
        document.querySelectorAll('.normal-mode-control').forEach(el => {
          el.classList.remove('fade-complete');
        });

        // Refresh song sections immediately so their controls begin fading out in sync
        this._initializeSongSections();

        // Wait for fade to complete, then save and cleanup
        setTimeout(async () => {
          // Hide edit controls completely now that fade is done
          document.querySelectorAll('.edit-mode-control').forEach(el => {
            el.style.display = 'none';
          });

          // Save setlist to IndexedDB
          if (this.currentSetlist) {
            // Update timestamp
            this.currentSetlist.modifiedDate = new Date().toISOString();

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
    appHeader.addEventListener('nav-menu-click', () => {
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

    // Listen for header-expand-toggle event
    appHeader.addEventListener('header-expand-toggle', e => {
      const { expanded } = e.detail;
      if (expanded) {
        document.body.classList.add('header-expanded');
        document.documentElement.style.setProperty('--header-expanded', '1');
      } else {
        document.body.classList.remove('header-expanded');
        document.documentElement.style.setProperty('--header-expanded', '0');
      }
    });
  }

  setupSectionControls() {
    const container = document.querySelector('.song-container');
    if (!container) return;

    if (!this._sectionActionHandler) {
      this._sectionActionHandler = event => {
        const { songIndex, sectionIndex, action } = event.detail || {};
        if (typeof songIndex !== 'number' || typeof sectionIndex !== 'number' || !action) {
          return;
        }
        this.setSectionHideMode(songIndex, sectionIndex, action);
      };
      container.addEventListener('section-action', this._sectionActionHandler);
    }

    if (!this._sectionToggleHandler) {
      this._sectionToggleHandler = event => {
        const { songIndex, sectionIndex } = event.detail || {};
        if (typeof songIndex !== 'number' || typeof sectionIndex !== 'number') {
          return;
        }
        const component = this._getSongSectionComponent(songIndex, sectionIndex);
        const details = component?.getDetailsElement();
        if (details) {
          this.animateSectionToggle(songIndex, sectionIndex, details);
        }
      };
      container.addEventListener('section-toggle', this._sectionToggleHandler);
    }
  }

  updateKeySelector(selectedKey) {
    const keySelector = document.getElementById('key-selector');
    if (!keySelector) return;

    // Get available keys rotated around the selected key
    const keys = getAvailableKeys(selectedKey);

    // Get original key from current song
    let originalKey = null;
    if (this.currentSongIndex >= 0 && this.songs[this.currentSongIndex]) {
      originalKey = this.songs[this.currentSongIndex].originalKey;
    }

    // Update component properties
    keySelector.value = selectedKey;
    keySelector.keys = keys;
    keySelector.originalKey = originalKey;
    keySelector.editMode = document.body.classList.contains('edit-mode');
  }

  setupKeySelector() {
    const keySelector = document.getElementById('key-selector');
    if (!keySelector) return;

    // Listen for key-change events
    keySelector.addEventListener('key-change', async e => {
      const newKey = e.detail.value;
      await this.handleKeyChange(newKey);
    });

    // Initialize with current song's key
    if (this.currentSongIndex >= 0 && this.songs[this.currentSongIndex]) {
      const currentKey = this.songs[this.currentSongIndex].currentKey;
      if (currentKey) {
        this.updateKeySelector(currentKey);
      }
    }
  }

  async handleKeyChange(newKey) {
    if (!newKey || this.currentSongIndex < 0) return;

    console.log(`Key changed to: ${newKey} for song ${this.currentSongIndex}`);

    // Update key in setlist (use new schema property)
    this.currentSetlist.songs[this.currentSongIndex].key = newKey;

    // Re-render the song with transposition
    await this.reRenderSong(this.currentSongIndex);

    // Update the key selector with the new key
    this.updateKeySelector(newKey);

    // Notify media player so it refreshes tempo/time/key data
    if (this.songs[this.currentSongIndex]) {
      this.dispatchSongChange(this.songs[this.currentSongIndex]);
    }

    // Ensure the pad for this key is cached for upcoming playback
    preloadPadKey(newKey);
  }

  setupFontSizeControls() {
    const decreaseBtn = document.getElementById('font-size-decrease');
    const increaseBtn = document.getElementById('font-size-increase');

    if (!decreaseBtn || !increaseBtn) return;

    decreaseBtn.addEventListener('click', () => {
      if (this.currentSongIndex >= 0) {
        const song = this.songs[this.currentSongIndex];
        song.currentFontSize = Math.max(
          CONFIG.MIN_FONT_SIZE,
          song.currentFontSize - CONFIG.FONT_SIZE_STEP
        );
        this.applyFontSize(this.currentSongIndex);
      }
    });

    increaseBtn.addEventListener('click', () => {
      if (this.currentSongIndex >= 0) {
        const song = this.songs[this.currentSongIndex];
        song.currentFontSize = Math.min(
          CONFIG.MAX_FONT_SIZE,
          song.currentFontSize + CONFIG.FONT_SIZE_STEP
        );
        this.applyFontSize(this.currentSongIndex);
      }
    });
  }

  async _animateSlottedContent(updateCallback) {
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
      this.updateKeySelector(song.currentKey);
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
      pointerType: null,
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

    const updateDrag = clientY => {
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
        // Find Y position of current accepted target
        let currentY;
        if (dragState.lastAcceptedIndex === 0) {
          currentY = buttonsArray[0]?.getBoundingClientRect().top || 0;
        } else if (dragState.lastAcceptedIndex >= buttonsArray.length) {
          currentY =
            buttonsArray[buttonsArray.length - 1]?.getBoundingClientRect().bottom || clientY;
        } else {
          currentY =
            buttonsArray[dragState.lastAcceptedIndex]?.getBoundingClientRect().top || clientY;
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
        btn.classList.remove(
          'drag-over-above',
          'drag-over-below',
          'will-move-up',
          'will-move-down'
        );
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
          buttonsArray.forEach(btn => {
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
      let overviewNeedsRefresh = false;

      // Tell component that drag happened, suppress its click
      // Clean up visual state
      button.classList.remove('dragging');
      button.style.transform = ''; // Reset transform
      overviewSongs.classList.remove('reordering');
      document.body.style.userSelect = '';

      const buttonsArray = Array.from(document.querySelectorAll('.overview-song-card'));
      buttonsArray.forEach(btn => {
        btn.classList.remove(
          'drag-over-above',
          'drag-over-below',
          'will-move-up',
          'will-move-down'
        );
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
        this.currentSetlist.modifiedDate = new Date().toISOString();
        await this.db.saveSetlist(this.currentSetlist);
        overviewNeedsRefresh = true;

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

      if (overviewNeedsRefresh) {
        this._refreshOverviewComponentSongs();
        if (this.overviewEditMode) {
          this.setupOverviewDragDrop();
        }
      }
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
          btn.classList.remove(
            'drag-over-above',
            'drag-over-below',
            'will-move-up',
            'will-move-down'
          );
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
      const handler = e => {
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
    this._dragPointerMoveHandler = e => {
      // Only handle the pointer we're tracking
      if (e.pointerId !== dragState.pointerId) return;

      if (dragState.active) {
        e.preventDefault(); // Prevent scrolling while dragging
        updateDrag(e.clientY);
      }
    };

    this._dragPointerUpHandler = e => {
      // Only handle the pointer we're tracking
      if (e.pointerId !== dragState.pointerId) return;

      if (dragState.active) {
        e.preventDefault(); // Prevent click event
        endDrag();
      }

      dragState.pointerId = null;
      dragState.button = null;
    };

    this._dragPointerCancelHandler = e => {
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
    this.setOverviewEditMode(!this.overviewEditMode);
  }

  setOverviewEditMode(enabled) {
    if (this.overviewEditMode === enabled) {
      return;
    }

    this.overviewEditMode = enabled;

    // Update button state (use the header edit toggle button)
    const appHeader = document.getElementById('app-header');
    if (appHeader) {
      appHeader.editMode = this.overviewEditMode;
    }
    this._refreshOverviewComponentEditMode();

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

    this._initializeSongSections();
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
    const targetKey = songEntry.key;
    if (targetKey && targetKey !== song.originalKey) {
      transposeSong(parsed, song.originalKey, targetKey);
      parsed.metadata.key = targetKey;
    }

    // Apply BPM override
    const bpmOverride = songEntry.tempo;
    if (bpmOverride) {
      parsed.metadata.tempo = bpmOverride;
    }

    // Normalize tempo + signature so media player gets consistent payloads
    const parsedTempoInfo = this._parseTempoMetadata(parsed.metadata.tempo ?? song.metadata?.tempo);
    let currentBPM = parsedTempoInfo.bpm ?? song.currentBPM ?? null;
    let tempoNote = parsedTempoInfo.tempoNote ?? song.metadata?.tempoNote ?? null;
    let timeSignature = parsed.metadata.time || song.metadata?.timeSignature || null;

    if (!tempoNote) {
      tempoNote = '1/4';
    }
    if (timeSignature && (!tempoNote || tempoNote === '1/4')) {
      const [, denominator] = timeSignature.split('/').map(s => s.trim());
      if (denominator) {
        tempoNote = `1/${denominator}`;
      }
    }

    // Update runtime song object
    song.parsed = parsed;
    song.songIndex = songIndex;
    song.metadata = {
      ...parsed.metadata,
      tempo: currentBPM,
      tempoNote,
      timeSignature,
    };
    song.currentKey = parsed.metadata.key;
    song.currentBPM = currentBPM;
    this._refreshOverviewComponentSongs();

    // Update DOM
    const songSection = document.getElementById(`song-${songIndex}`);
    if (songSection) {
      const songContent = songSection.querySelector('.song-content');
      if (songContent) {
        songContent.textContent = '';
        const songDisplay = document.createElement('song-display');
        songDisplay.parsed = song.parsed;
        songDisplay.songIndex = song.songIndex;
        songContent.appendChild(songDisplay);

        // Wait for Lit to render the shadow DOM contents
        await songDisplay.updateComplete;
      }

      // Section states are now loaded from setlist_local, not from setlist modifications
      // No need to re-apply them here during re-render

      // Wait for song-section elements to be ready before initializing
      await customElements.whenDefined('song-section');
      this._initializeSongSections(songSection);

      // Re-apply font size
      const songContentEl = songSection.querySelector('.song-content');
      if (songContentEl) {
        songContentEl.style.fontSize = `${song.currentFontSize}rem`;
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
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  setupKeyboardNavigation(route) {
    if (route.type === 'home') return;

    document.addEventListener('keydown', e => {
      // Handle Escape key to exit edit mode
      if (e.key === 'Escape') {
        const isEditMode = document.body.classList.contains('edit-mode');
        if (isEditMode) {
          e.preventDefault();
          const appHeader = document.getElementById('app-header');
          if (appHeader) {
            // Trigger the edit-mode-toggle event
            appHeader.dispatchEvent(
              new CustomEvent('edit-mode-toggle', {
                bubbles: true,
                composed: true,
              })
            );
          }
        }
        return;
      }

      // Don't intercept if modifier keys are pressed (Alt, Ctrl, Meta)
      // This allows browser shortcuts like Alt+Left/Right to work
      if (e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }

      switch (e.key) {
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
        case 'ArrowUp': {
          e.preventDefault();
          const currentSectionUp =
            this.currentSongIndex >= 0
              ? document.getElementById(`song-${this.currentSongIndex}`)
              : document.getElementById('overview');
          currentSectionUp?.scrollBy({ top: -CONFIG.KEYBOARD_SCROLL_AMOUNT, behavior: 'smooth' });
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const currentSectionDown =
            this.currentSongIndex >= 0
              ? document.getElementById(`song-${this.currentSongIndex}`)
              : document.getElementById('overview');
          currentSectionDown?.scrollBy({ top: CONFIG.KEYBOARD_SCROLL_AMOUNT, behavior: 'smooth' });
          break;
        }
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
    navMenu.addEventListener('song-click', e => {
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
      backAction = () => (window.location.href = `/setlist/${route.setlistId}`);
    } else if (route.type === 'librarySong') {
      backLabel = 'Back to Song Library';
      backAction = () => this.closeLibrarySongView();
    } else if (route.type === 'settings') {
      backLabel = 'Back to Home';
      backAction = () => (window.location.href = '/');
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
      this.showStatusMessage(resultsContainer, {
        message: 'Loading songs...',
        state: 'loading',
      });

      // Load songs from per-org database and parse titles
      const { getSongWithContent } = await import('./song-utils.js');
      const songRecords = await this.db.getAllSongs();
      console.log('[Add Song Modal] Loaded song records:', songRecords.length);

      if (songRecords.length === 0) {
        this.showStatusMessage(resultsContainer, {
          message: 'No songs in library',
          detail: 'Import setlists from the Settings page to populate the song library.',
          state: 'empty',
        });
        return;
      }

      // Group songs by deterministic ID to get unique songs (not all variants)
      const songsById = new Map();
      for (const song of songRecords) {
        if (song.isDefault || !songsById.has(song.id)) {
          songsById.set(song.id, song);
        }
      }

      // Parse titles from chordpro
      const songs = [];
      for (const songRecord of songsById.values()) {
        try {
          const fullSong = await getSongWithContent(songRecord.uuid);
          songs.push(fullSong);
        } catch (error) {
          console.error(`Error loading song ${songRecord.uuid}:`, error);
        }
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

      // Focus search input and wire events when modal opens successfully
      setTimeout(() => searchInput.focus(), 100);

      const handleSearch = e => {
        this.filterAddSongResults(e.target.value, resultsContainer);
      };

      searchInput.addEventListener('input', handleSearch);

      const handleClose = () => {
        searchInput.removeEventListener('input', handleSearch);
        this.addSongModalSongs = null;
      };

      modal.addEventListener('close', handleClose, { once: true });
    } catch (error) {
      console.error('[Add Song Modal] Error loading songs:', error);
      this.showStatusMessage(resultsContainer, {
        message: 'Error loading songs. Please try again.',
        state: 'error',
      });
      modal.show();
    }
  }

  async getSetlistLeader() {
    const owner = this.currentSetlist?.owner;
    if (owner && owner.trim()) {
      return owner.trim();
    }

    // Scan song usage entries for this setlist
    if (!this.currentSetlist?.songs?.length) {
      return null;
    }

    for (const songEntry of this.currentSetlist.songs) {
      if (!songEntry.songId) continue;
      try {
        const usage = await this.db.getSongUsageFromSetlists(songEntry.songId);
        const historyEntry = usage.find(h => h.setlistId === this.currentSetlist.id);
        const historyOwner = historyEntry?.owner;
        if (historyOwner && historyOwner.trim()) {
          return historyOwner.trim();
        }
      } catch (error) {
        console.warn('[SetlistInfo] Failed to load usage for song', songEntry.songId, error);
      }
    }

    return null;
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

      return title.includes(term) || artist.includes(term) || lyricsText.includes(term);
    });

    this.renderAddSongResults(filtered, resultsContainer);
  }

  renderAddSongResults(songs, resultsContainer) {
    console.log('[Add Song Modal] renderAddSongResults called with', songs.length, 'songs');

    resultsContainer.textContent = '';

    const songList = document.createElement('song-list');
    songList.songs = songs;
    songList.variant = 'library';
    songList.emptyMessage = 'No songs match your search.';
    songList.dense = true;
    songList.addEventListener('song-select', event => {
      const { song } = event.detail || {};
      if (song) {
        this.addSongToSetlist(song);
      }
    });

    resultsContainer.appendChild(songList);
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
          sectionStates: {},
        },
      };

      // Preload pads for the song's default key in the background
      const songDefaultKey = song?.metadata?.key || song?.parsed?.metadata?.key || null;
      if (songDefaultKey) {
        preloadPadKey(songDefaultKey);
      }

      // Add to setlist
      setlist.songs.push(newSongEntry);
      setlist.modifiedDate = new Date().toISOString();

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

      setlist.modifiedDate = new Date().toISOString();

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

  _parseTempoMetadata(raw) {
    if (raw === undefined || raw === null || raw === '') {
      return { bpm: null, tempoNote: null };
    }
    if (typeof raw === 'number') {
      return { bpm: raw, tempoNote: null };
    }
    const str = `${raw}`.trim();
    let tempoNote = null;
    let bpmPart = str;
    const parenMatch = str.match(/\(([^)]+)\)/);
    if (parenMatch) {
      tempoNote = parenMatch[1].trim();
      bpmPart = str.replace(/\([^)]*\)/g, '').trim();
    }
    const bpmMatch = bpmPart.match(/-?\d+(?:\.\d+)?/);
    const bpm = bpmMatch ? Number(bpmMatch[0]) : null;
    return {
      bpm: Number.isFinite(bpm) ? bpm : null,
      tempoNote,
    };
  }
}

// Initialize the app
new PageApp();
