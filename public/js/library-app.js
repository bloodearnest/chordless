/**
 * Library App
 *
 * Manages the song library view - song list, search, and individual song editing.
 * Uses song-view-manager for shared rendering logic.
 * Uses LibrarySong model for persistence.
 */

import '../components/song-list.js'
import '../components/status-message.js'
import { getCurrentDB } from './db.js'
import { ChordProParser } from './parser.js'
import { createLibrarySongModel } from './song-model-factory.js'
import * as SongViewManager from './song-view-manager.js'
import { getAvailableKeys, transposeSong } from './transpose.js'

const { CONFIG } = SongViewManager

/**
 * LibraryApp - Entry point for songs.html
 *
 * Manages song library: listing, searching, viewing, and editing songs
 */
export class LibraryApp {
  constructor() {
    this.db = null
    this.parser = new ChordProParser()
    this.allSongs = []
    this.currentLibrarySong = null
    this.currentLibrarySongId = null
    this.currentLibraryParsedSong = null
    this.currentLibraryKey = null
    this.currentLibraryFontSize = CONFIG.DEFAULT_FONT_SIZE
    this.currentLibraryCapo = 0
    this.libraryHashHandler = null
    this.libraryScrollObserver = null
    this._libraryHeaderEventsSetup = false
    this._librarySectionActionHandler = null
    this._librarySectionToggleHandler = null
    this._suppressLibraryScrollReset = false
    this._libraryScrollResetTimeout = null

    console.log('[LibraryApp] Initialized')

    // Initialize on construction, like PageApp does
    this.init()
  }

  /**
   * Initialize the library app
   */
  async init() {
    // Initialize IndexedDB with current organisation
    this.db = await getCurrentDB()

    // Check for first-time Google auth and rename org if needed
    const { checkFirstTimeAuth } = await import('./first-time-auth.js')
    await checkFirstTimeAuth()

    // Check if there's a hash indicating a specific song
    const hash = window.location.hash.substring(1) // Remove the #

    // Render the standalone songs page
    await this.renderSongLibraryTab()

    // Set up header event listeners (once)
    this.setupLibraryHeaderEvents()

    // Set up hash change handler for navigation
    this.setupLibraryHashNavigation()

    // Set up scroll observer to detect swipe back to library
    this.setupLibraryScrollObserver()

    // If hash is provided, load that song
    if (hash) {
      const { getSongWithContent } = await import('./song-utils.js')
      try {
        const song = await getSongWithContent(hash)
        await this.viewLibrarySong(song, false) // false = don't update URL (we're already there)
      } catch (error) {
        console.error('Song not found:', hash, error)
        // Clear the hash if song not found
        window.history.replaceState({}, '', '/songs')
        // Scroll back to library list
        const container = document.querySelector('.songs-content-container')
        const libraryList = container?.querySelector('.library-view')
        if (libraryList) {
          libraryList.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'start' })
        }
      }
    }

    console.log('[LibraryApp] Library app ready')
  }

  // ==================== Song Library Rendering ====================

  async renderSongLibraryTab() {
    const libraryContainer = document.getElementById('song-library-list')
    const searchInput = document.getElementById('song-search')

    try {
      // Show loading message
      this.showStatusMessage(libraryContainer, {
        message: 'Loading songs...',
        state: 'loading',
      })

      // Load songs from per-org database
      const { getSongWithContent } = await import('./song-utils.js')
      const songRecords = await this.db.getAllSongs()
      console.log('Loaded song records:', songRecords.length)

      if (songRecords.length === 0) {
        this.showStatusMessage(libraryContainer, {
          message: 'No songs in library.',
          detail: 'Import setlists to populate the song library.',
          state: 'empty',
        })
        return
      }

      // Group songs by deterministic ID to get unique songs (not all variants)
      const songsById = new Map()
      for (const song of songRecords) {
        if (song.isDefault || !songsById.has(song.id)) {
          songsById.set(song.id, song)
        }
      }

      // Parse titles from chordpro and enrich with usage data
      const songs = []
      for (const songRecord of songsById.values()) {
        try {
          const fullSong = await getSongWithContent(songRecord.uuid)

          // Get usage data from organisation DB (using deterministic ID)
          const usage = await this.db.getSongUsageFromSetlists(fullSong.id)
          if (usage && usage.length > 0) {
            const lastUsage = usage[0]
            fullSong.lastUsageInfo = {
              date: lastUsage.setlistDate,
              leader: lastUsage.owner,
              key: lastUsage.playedInKey,
            }
          }

          songs.push(fullSong)
        } catch (error) {
          console.error(`Error loading song ${songRecord.uuid}:`, error)
          // Continue with next song
        }
      }

      // Sort songs alphabetically by title
      songs.sort((a, b) => {
        const titleA = (a.title || '').toLowerCase()
        const titleB = (b.title || '').toLowerCase()
        return titleA.localeCompare(titleB)
      })

      // Store all songs for search filtering
      this.allSongs = songs

      // Setup search
      if (searchInput) {
        searchInput.addEventListener('input', e => {
          this.filterSongs(e.target.value)
        })
      }

      // Initial render with all songs
      this.renderSongList(songs)
    } catch (error) {
      console.error('Error loading songs:', error)
      this.showStatusMessage(libraryContainer, {
        message: 'Error loading songs. Please check the console.',
        state: 'error',
      })
    }
  }

  filterSongs(searchTerm) {
    if (!this.allSongs) return

    const term = searchTerm.toLowerCase().trim()

    if (!term) {
      // Show all songs if search is empty
      this.renderSongList(this.allSongs)
      return
    }

    // Filter songs by title, artist, or lyrics
    const filtered = this.allSongs.filter(song => {
      const title = (song.title || '').toLowerCase()
      const artist = (song.artist || '').toLowerCase()
      const lyricsText = (song.lyricsText || '').toLowerCase()

      return title.includes(term) || artist.includes(term) || lyricsText.includes(term)
    })

    this.renderSongList(filtered)
  }

  renderSongList(songs) {
    const libraryContainer = document.getElementById('song-library-list')

    console.log('renderSongList called with', songs.length, 'songs')

    libraryContainer.textContent = ''

    const songList = document.createElement('song-list')
    songList.songs = songs
    songList.variant = 'library'
    songList.emptyMessage = 'No songs match your search.'
    songList.addEventListener('song-select', event => {
      const { song } = event.detail || {}
      if (song) {
        this.viewLibrarySong(song)
      }
    })

    libraryContainer.appendChild(songList)
    console.log('Finished rendering', songs.length, 'songs')
  }

  // ==================== Single Song View ====================

  async viewLibrarySong(song, updateHash = true) {
    console.log('viewLibrarySong called with:', song)

    // Store the current library song for editing
    this.currentLibrarySong = song
    this.currentLibrarySongId = song.uuid // Use UUID for lookups

    // Update URL hash if requested (uses UUID)
    if (updateHash) {
      window.location.hash = song.uuid
    }

    // Get chordpro content
    const chordproContent = song.chordpro
    if (!chordproContent) {
      console.error('Song has no ChordPro content!', song)
      throw new Error('Song has no ChordPro content')
    }

    // Use already-parsed data if available, otherwise parse
    const parsed = song.parsed || this.parser.parse(chordproContent)

    // Store parsed song for library context
    this.currentLibraryParsedSong = parsed
    this.currentLibraryKey = parsed.metadata.key

    // Update title in header
    const appHeader = document.getElementById('library-app-header')
    if (appHeader) {
      appHeader.heading = parsed.metadata.title || 'Untitled'
    }

    // Show all header controls
    const keySelector = document.getElementById('library-key-selector')
    const metaHeader = document.getElementById('library-song-meta-header')
    const resetButton = document.getElementById('library-reset-button')
    const fontSizeControls = document.getElementById('library-font-size-controls')

    if (keySelector) keySelector.style.display = ''
    if (metaHeader) metaHeader.style.display = 'flex'
    if (resetButton) resetButton.style.display = 'none' // Initially hidden
    if (fontSizeControls) fontSizeControls.style.display = 'none' // Initially hidden

    // Update key selector
    if (keySelector && parsed.metadata.key) {
      this.updateLibraryKeySelector(parsed.metadata.key)
    }

    // Update meta display (tempo, time signature)
    if (metaHeader) {
      const metaParts = []
      if (parsed.metadata.tempo) {
        metaParts.push(`${parsed.metadata.tempo} BPM`)
      }
      if (parsed.metadata.time) {
        metaParts.push(parsed.metadata.time)
      }
      metaHeader.textContent = metaParts.join(' • ')
    }

    // Render the song content using song-view-manager
    const contentElement = document.getElementById('library-song-content')
    await SongViewManager.renderSongView(parsed, contentElement, {
      songIndex: 0,
      capo: this.currentLibraryCapo,
    })

    // Create LibrarySong model
    const model = createLibrarySongModel(this.currentLibrarySong, this.db, this.db.organisationId)

    // Initialize song sections with model state
    SongViewManager.initializeSongSections(contentElement, model, {
      editMode: false,
    })

    // Setup section controls for library
    this.setupLibrarySectionControls()

    // Setup key selector for library
    this.setupLibraryKeySelector(parsed)

    // Setup font size controls
    this.setupLibraryFontSizeControls()

    // Setup reset button
    this.setupLibraryResetButton()

    // Apply initial font size
    if (!this.currentLibraryFontSize) {
      this.currentLibraryFontSize = CONFIG.DEFAULT_FONT_SIZE
    }
    this.applyLibraryFontSize()

    // Scroll to song view using native scroll-snap
    const container = document.querySelector('.songs-content-container')
    const libraryView = container?.querySelector('.library-song-view')
    if (libraryView) {
      this._suppressLibraryScrollResetTemporarily()
      libraryView.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
    }
  }

  closeLibrarySongView(updateUrl = true) {
    // Scroll back to library list using native scroll-snap
    const container = document.querySelector('.songs-content-container')
    const libraryList = container?.querySelector('.library-view')
    if (libraryList) {
      libraryList.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
    }

    // Hide all header controls
    const keySelector = document.getElementById('library-key-selector')
    const metaHeader = document.getElementById('library-song-meta-header')
    const resetButton = document.getElementById('library-reset-button')
    const fontSizeControls = document.getElementById('library-font-size-controls')

    if (keySelector) keySelector.style.display = 'none'
    if (metaHeader) metaHeader.style.display = 'none'
    if (resetButton) resetButton.style.display = 'none'
    if (fontSizeControls) fontSizeControls.style.display = 'none'

    // Restore "Song Library" title
    const appHeader = document.getElementById('library-app-header')
    if (appHeader) {
      appHeader.heading = 'Song Library'
    }

    // Clear edit mode state
    const isEditMode = document.body.classList.contains('edit-mode')
    if (isEditMode && appHeader) {
      appHeader.editMode = false
      document.body.classList.remove('edit-mode')
      document.body.removeAttribute('data-edit-mode')
      const keySel = document.getElementById('library-key-selector')
      if (keySel) keySel.editMode = false
    }

    this.currentLibrarySong = null
    this.currentLibrarySongId = null

    // Clear the hash to go back to library list
    if (updateUrl) {
      window.location.hash = ''
    }
  }

  // ==================== Navigation ====================

  setupLibraryHashNavigation() {
    // Remove old handler if exists
    if (this.libraryHashHandler) {
      window.removeEventListener('hashchange', this.libraryHashHandler)
    }

    // Create new handler
    this.libraryHashHandler = async () => {
      const hash = window.location.hash.substring(1)

      if (!hash) {
        // No hash = show library list
        this.closeLibrarySongView(false) // false = don't update URL (already changed)
      } else {
        // Hash present = show specific song
        const { getSongWithContent } = await import('./song-utils.js')
        try {
          const song = await getSongWithContent(hash)
          await this.viewLibrarySong(song, false) // false = don't update URL
        } catch (error) {
          // Song not found, go back to library
          console.error('Song not found:', hash, error)
          window.location.hash = ''
        }
      }
    }

    window.addEventListener('hashchange', this.libraryHashHandler)
  }

  setupLibraryScrollObserver() {
    // Disconnect any existing observer
    if (this.libraryScrollObserver) {
      this.libraryScrollObserver.disconnect()
    }

    // Get the library view element
    const libraryView = document.querySelector('.library-view')
    if (!libraryView) return

    // Create observer to detect when library view becomes visible (from swipe)
    this.libraryScrollObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (this._suppressLibraryScrollReset) {
            return
          }
          // When library view becomes fully visible
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            // Check if we have a hash (song is open)
            const hash = window.location.hash.substring(1)
            if (hash) {
              // User swiped back to library, clear the hash
              // This will trigger the hashchange handler which calls closeLibrarySongView
              window.location.hash = ''
            }
          }
        })
      },
      {
        threshold: [0.5, 1.0],
      }
    )

    // Start observing the library view
    this.libraryScrollObserver.observe(libraryView)
  }

  _suppressLibraryScrollResetTemporarily(duration = 600) {
    this._suppressLibraryScrollReset = true
    if (this._libraryScrollResetTimeout) {
      clearTimeout(this._libraryScrollResetTimeout)
    }
    this._libraryScrollResetTimeout = setTimeout(() => {
      this._suppressLibraryScrollReset = false
      this._libraryScrollResetTimeout = null
    }, duration)
  }

  // ==================== Header Events (Edit Mode) ====================

  setupLibraryHeaderEvents() {
    const appHeader = document.getElementById('library-app-header')
    const navMenu = document.getElementById('nav-menu')
    if (!appHeader) return

    // Only set up listeners once
    if (this._libraryHeaderEventsSetup) return
    this._libraryHeaderEventsSetup = true

    // Listen for nav-menu-click event
    appHeader.addEventListener('nav-menu-click', () => {
      if (navMenu) {
        // Get the nav button from the app-header component's shadow root
        const navButton = appHeader.shadowRoot?.querySelector('.nav-menu-button')
        if (navButton) {
          navMenu.setTriggerButton(navButton)
        }
        navMenu.togglePopover()
      }
    })

    // Listen for edit-mode-toggle event
    appHeader.addEventListener('edit-mode-toggle', () => {
      const isEnteringEditMode = !document.body.classList.contains('edit-mode')
      const keySelector = document.getElementById('library-key-selector')

      if (isEnteringEditMode) {
        // Enter edit mode
        document.body.classList.add('edit-mode')
        document.body.setAttribute('data-edit-mode', '')
        appHeader.editMode = true

        // Update key selector edit mode
        if (keySelector) {
          keySelector.editMode = true
        }

        // Update section edit mode
        this._updateSectionEditMode(true)

        console.log('Entered edit mode - changes will save to global songs database')
      } else {
        // Exit edit mode - save changes
        document.body.classList.remove('edit-mode')
        document.body.removeAttribute('data-edit-mode')
        appHeader.editMode = false

        // Update key selector edit mode
        if (keySelector) {
          keySelector.editMode = false
        }

        // Update section edit mode
        this._updateSectionEditMode(false)

        // Save changes to database
        this.saveLibrarySongToDatabase()

        console.log('Exited edit mode - saved changes')
      }
    })

    // Listen for info button click
    appHeader.addEventListener('info-button-click', () => {
      if (this.currentLibraryParsedSong && this.currentLibrarySong) {
        this.showLibrarySongInfo(this.currentLibraryParsedSong, this.currentLibrarySong)
      }
    })
  }

  // ==================== Song Editing ====================

  async saveLibrarySongToDatabase() {
    if (!this.currentLibrarySong || !this.currentLibrarySongId) {
      console.warn('No current library song to save')
      return
    }

    try {
      // Use LibrarySong model for persistence
      const model = createLibrarySongModel(this.currentLibrarySong, this.db, this.db.organisationId)

      // Update key if it has changed
      if (this.currentLibraryKey && this.currentLibraryKey !== model.getKey()) {
        model.setKey(this.currentLibraryKey)
        console.log(`[LibrarySong Model] Updated song key to: ${this.currentLibraryKey}`)
      }

      // Collect and save section defaults
      const sectionDefaults = this._collectLibrarySectionDefaults()
      if (sectionDefaults && Object.keys(sectionDefaults).length > 0) {
        for (const [index, state] of Object.entries(sectionDefaults)) {
          model.setSectionState(Number(index), state)
        }
      }

      // Save capo if set
      if (this.currentLibraryCapo !== undefined && this.currentLibraryCapo !== 0) {
        model.setCapo(this.currentLibraryCapo)
      }

      // Save all changes via model
      await model.save()
      console.log('[LibrarySong Model] Saved all changes via model')

      // Update in-memory song key if changed
      if (this.currentLibraryKey && this.currentLibraryKey !== this.currentLibrarySong.key) {
        this.currentLibrarySong.key = this.currentLibraryKey
      }

      // Don't reload the view - just update edit mode state on sections
      // This preserves the section visibility that was just saved
      const contentElement = document.getElementById('library-song-content')
      if (contentElement) {
        const songDisplay = contentElement.querySelector('song-display')
        if (songDisplay && songDisplay.shadowRoot) {
          const sections = songDisplay.shadowRoot.querySelectorAll('song-section')
          sections.forEach(section => {
            section.editMode = false
          })
        }
      }
    } catch (error) {
      console.error('Error saving library song:', error)
    }
  }

  _collectLibrarySectionDefaults() {
    const contentElement = document.getElementById('library-song-content')
    if (!contentElement) return {}

    const sectionDefaults = {}

    // Find all song-section elements in library view
    const sections = []
    const songDisplay = contentElement.querySelector('song-display')
    if (songDisplay && songDisplay.shadowRoot) {
      sections.push(...songDisplay.shadowRoot.querySelectorAll('song-section'))
    }

    sections.forEach(section => {
      const sectionIndex = Number(section.getAttribute('section-index'))
      if (Number.isNaN(sectionIndex)) return

      // Only save if not in default state
      const hideMode = section.hideMode || 'none'
      const isCollapsed = section.isCollapsed || false
      const isHidden = section.isHidden || false

      // Check if different from defaults
      if (hideMode !== 'none' || isCollapsed !== false || isHidden !== false) {
        sectionDefaults[sectionIndex.toString()] = {
          hideMode,
          isCollapsed,
          isHidden,
        }
      }
    })

    return sectionDefaults
  }

  // ==================== Key Selector ====================

  setupLibraryKeySelector(parsed) {
    const keySelector = document.getElementById('library-key-selector')
    if (!keySelector) return

    // Listen for key-change events
    keySelector.addEventListener('key-change', async e => {
      const newKey = e.detail.value
      await this.handleLibraryKeyChange(newKey)
    })

    // Populate key selector with current key
    const currentKey = parsed.metadata.key || this.currentLibraryKey
    if (currentKey) {
      this.updateLibraryKeySelector(currentKey)
    }
  }

  updateLibraryKeySelector(selectedKey) {
    const keySelector = document.getElementById('library-key-selector')
    if (!keySelector) return

    // Get available keys rotated around the selected key
    const keys = getAvailableKeys(selectedKey)

    // Get original imported key from current song
    const originalKey =
      this.currentLibrarySong?.originalKey || this.currentLibraryParsedSong?.metadata?.key

    // Update component properties
    keySelector.value = selectedKey
    keySelector.keys = keys
    keySelector.originalKey = originalKey
    keySelector.editMode = document.body.classList.contains('edit-mode')
  }

  async handleLibraryKeyChange(newKey) {
    if (!newKey || !this.currentLibraryParsedSong) return

    console.log(`Library key changed to: ${newKey}`)

    // Update current key
    this.currentLibraryKey = newKey

    // Re-render the song with transposition
    await this.reRenderLibrarySong(newKey)

    // Update the key selector with the new key
    this.updateLibraryKeySelector(newKey)
  }

  async reRenderLibrarySong(targetKey) {
    if (!this.currentLibraryParsedSong) return

    console.log('Re-rendering library song with key:', targetKey)

    // Transpose to target key
    const originalParsed = this.currentLibraryParsedSong
    const transposedData = transposeSong(originalParsed, targetKey)

    // Update stored key
    this.currentLibraryKey = targetKey

    // Re-render song with transposed data
    const contentElement = document.getElementById('library-song-content')
    await SongViewManager.renderSongView(transposedData.parsed, contentElement, {
      songIndex: 0,
      capo: this.currentLibraryCapo,
    })

    // Re-initialize sections and controls
    const model = createLibrarySongModel(this.currentLibrarySong, this.db, this.db.organisationId)
    SongViewManager.initializeSongSections(contentElement, model, {
      editMode: document.body.classList.contains('edit-mode'),
    })

    this.setupLibrarySectionControls()
    this.applyLibraryFontSize()
  }

  // ==================== Song Info Modal ====================

  async showLibrarySongInfo(parsed, song) {
    const modal = document.getElementById('library-song-info-modal')
    const modalBody = document.getElementById('library-modal-body')

    if (!modal || !modalBody) return

    // Create song-info component
    const songInfo = document.createElement('song-info')
    songInfo.song = song
    songInfo.parsed = parsed

    modalBody.innerHTML = ''
    modalBody.appendChild(songInfo)

    // Show the modal
    modal.open()
  }

  // ==================== Font Size Controls ====================

  setupLibraryFontSizeControls() {
    const decreaseBtn = document.getElementById('library-font-size-decrease')
    const increaseBtn = document.getElementById('library-font-size-increase')

    if (!decreaseBtn || !increaseBtn) return

    // Remove old listeners
    const newDecreaseBtn = decreaseBtn.cloneNode(true)
    const newIncreaseBtn = increaseBtn.cloneNode(true)
    decreaseBtn.parentNode.replaceChild(newDecreaseBtn, decreaseBtn)
    increaseBtn.parentNode.replaceChild(newIncreaseBtn, increaseBtn)

    if (!this.currentLibraryFontSize) {
      this.currentLibraryFontSize = CONFIG.DEFAULT_FONT_SIZE
    }

    newDecreaseBtn.addEventListener('click', () => {
      this.currentLibraryFontSize = Math.max(
        CONFIG.MIN_FONT_SIZE,
        this.currentLibraryFontSize - CONFIG.FONT_SIZE_STEP
      )
      this.applyLibraryFontSize()
    })

    newIncreaseBtn.addEventListener('click', () => {
      this.currentLibraryFontSize = Math.min(
        CONFIG.MAX_FONT_SIZE,
        this.currentLibraryFontSize + CONFIG.FONT_SIZE_STEP
      )
      this.applyLibraryFontSize()
    })
  }

  applyLibraryFontSize() {
    const contentElement = document.getElementById('library-song-content')
    if (!contentElement) return

    const songContent = contentElement.querySelector('.song-content')
    if (songContent) {
      songContent.style.fontSize = `${this.currentLibraryFontSize}rem`
    }
  }

  // ==================== Section Controls ====================

  setupLibrarySectionControls() {
    const container = document.getElementById('library-song-content')
    if (!container) return

    // Set up section action handler (hide mode buttons)
    if (!this._librarySectionActionHandler) {
      this._librarySectionActionHandler = event => {
        const { sectionIndex, action } = event.detail || {}
        if (typeof sectionIndex !== 'number' || !action) {
          return
        }
        // Library view treats the song as songIndex = 0
        this.setLibrarySectionHideMode(sectionIndex, action)
      }
      container.addEventListener('section-action', this._librarySectionActionHandler)
    }

    // Set up section toggle handler (collapse/expand)
    if (!this._librarySectionToggleHandler) {
      this._librarySectionToggleHandler = event => {
        const { sectionIndex } = event.detail || {}
        if (typeof sectionIndex !== 'number') {
          return
        }
        // Library view treats the song as songIndex = 0
        const songDisplay = container.querySelector('song-display')
        if (songDisplay && songDisplay.shadowRoot) {
          const component = songDisplay.shadowRoot.querySelector(
            `song-section[section-index="${sectionIndex}"]`
          )
          const details = component?.getDetailsElement()
          if (details) {
            this.animateLibrarySectionToggle(sectionIndex, details)
          }
        }
      }
      container.addEventListener('section-toggle', this._librarySectionToggleHandler)
    }
  }

  setLibrarySectionHideMode(sectionIndex, mode) {
    const container = document.getElementById('library-song-content')
    if (!container) return

    const songDisplay = container.querySelector('song-display')
    if (!songDisplay || !songDisplay.shadowRoot) return

    const component = songDisplay.shadowRoot.querySelector(
      `song-section[section-index="${sectionIndex}"]`
    )
    if (!component) return

    // Apply the mode change directly to the component
    if (mode === 'collapse') {
      const details = component.getDetailsElement()
      if (details) {
        this.animateLibrarySectionToggle(sectionIndex, details)
      }
      return
    }

    const explicitShowMap = {
      'show-all': 'none',
      'show-lyrics': 'chords',
      'show-chords': 'lyrics',
      'show-none': 'hide',
    }
    const mappedMode = explicitShowMap[mode] || mode
    const isExplicit = Boolean(explicitShowMap[mode])

    if (mappedMode === 'hide') {
      if (isExplicit) {
        component.isHidden = true
        component.hideMode = 'hide'
        component.isCollapsed = false
      } else {
        component.isHidden = !component.isHidden
        if (component.isHidden) {
          component.hideMode = 'hide'
          component.isCollapsed = false
        }
      }
    } else {
      component.isHidden = false
      component.hideMode = mappedMode
    }
  }

  animateLibrarySectionToggle(sectionIndex, detailsElement) {
    const isOpen = detailsElement.open
    const container = document.getElementById('library-song-content')
    if (!container) return

    const songDisplay = container.querySelector('song-display')
    if (!songDisplay || !songDisplay.shadowRoot) return

    const component = songDisplay.shadowRoot.querySelector(
      `song-section[section-index="${sectionIndex}"]`
    )
    if (!component) return

    if (isOpen) {
      // Closing
      component.isCollapsed = true
      detailsElement.open = false
    } else {
      // Opening
      component.isCollapsed = false
      detailsElement.open = true
    }
  }

  _updateSectionEditMode(editMode) {
    const container = document.getElementById('library-song-content')
    if (!container) return

    const songDisplay = container.querySelector('song-display')
    if (!songDisplay || !songDisplay.shadowRoot) return

    const sections = songDisplay.shadowRoot.querySelectorAll('song-section')
    sections.forEach(section => {
      section.editMode = editMode
    })
  }

  // ==================== Reset ====================

  setupLibraryResetButton() {
    const resetButton = document.getElementById('library-reset-button')
    const resetModal = document.getElementById('library-reset-confirm-modal')

    if (!resetButton || !resetModal) return

    // Remove old listener
    const newResetButton = resetButton.cloneNode(true)
    resetButton.parentNode.replaceChild(newResetButton, resetButton)

    // Show confirmation modal when reset button is clicked
    newResetButton.addEventListener('click', () => {
      resetModal.open()
    })

    // Listen for confirm event
    resetModal.addEventListener('confirm', () => {
      this.resetLibrarySong()
    })
  }

  async resetLibrarySong() {
    if (!this.currentLibraryParsedSong || !this.currentLibrarySong) return

    // Reset key to original imported key
    const originalKey =
      this.currentLibrarySong.originalKey || this.currentLibraryParsedSong.metadata.key
    this.currentLibraryKey = originalKey

    // Reset font size to default
    this.currentLibraryFontSize = CONFIG.DEFAULT_FONT_SIZE

    // Re-render with original key
    await this.reRenderLibrarySong(originalKey)

    // Update key selector
    if (originalKey) {
      this.updateLibraryKeySelector(originalKey)
    }

    // Apply font size
    this.applyLibraryFontSize()

    // Save the reset key back to the database
    await this.saveLibrarySongToDatabase()
  }

  // ==================== Status Messages ====================

  showStatusMessage(container, options = {}) {
    if (!container) return null
    container.textContent = ''
    const element = this.createStatusMessageElement(options)
    container.appendChild(element)
    return element
  }

  createStatusMessageElement({
    message = '',
    detail = '',
    state = 'info',
    slotContent = null,
  } = {}) {
    const element = document.createElement('status-message')
    if (message) element.message = message
    if (detail) element.detail = detail
    if (state) element.state = state
    if (slotContent) {
      if (Array.isArray(slotContent)) {
        slotContent.forEach(node => element.appendChild(node))
      } else {
        element.appendChild(slotContent)
      }
    }
    return element
  }
}

/**
 * Initialize library app
 */
if (typeof window !== 'undefined') {
  const app = new LibraryApp()
  window.libraryApp = app // For debugging
}
