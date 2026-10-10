import {
  EditModeToggleEvent,
  HeaderExpandToggleEvent,
  HeaderInfoClickEvent,
} from '../components/app-header.js'
import { CapoChangeEvent } from '../components/capo-selector.ts'
import { KeyChangeEvent } from '../components/key-selector.ts'
import { SongSettingsClickEvent } from '../components/musical-metadata-display.ts'
import { MenuOverviewClickEvent, MenuSongClickEvent } from '../components/nav-menu.js'
import { SetlistInfoSaveEvent } from '../components/setlist-info-dialog.js'
import {
  OverviewAddSongEvent,
  OverviewSongClickEvent,
  OverviewSongDeleteEvent,
  OverviewSongKeyChangeEvent,
} from '../components/setlist-overview.js'
import { SectionActionEvent, SectionToggleEvent } from '../components/song-section.js'
import { BpmChangeEvent, SongResetClickEvent } from '../components/song-settings-popover.ts'
import { SongChangeEvent } from './app-events.ts'
import { getCurrentDB } from './db.ts'
import { goTo } from './navigation.ts'
import { preloadPadKey, preloadPadKeysForSongs } from './pad-set-service.ts'
import { ChordProParser } from './parser.ts'
import { getOrganisationPeople } from './people.ts'
import { CapoPreferenceEvent, SectionDefaultsEvent } from './preferences.ts'
import { buildUrl } from './router.ts'
import { AddSongModal } from './setlist/add-song-modal.js'
import { OverviewReorder } from './setlist/overview-reorder.ts'
import { buildRuntimeSongs, parseTempoMetadata } from './setlist/runtime-songs.ts'
import { getAvailableKeys, transposeSong } from './transpose.ts'
import { formatSetlistDate, setlistTitle } from './utils/date-utils.ts'
import { isInModalDialog, isTypingInField } from './utils/keyboard.ts'
import { showStatusMessage } from './utils/status-message.ts'

// Configuration constants
const CONFIG = {
  // Font sizes
  DEFAULT_FONT_SIZE: 1.6, // rem
  MIN_FONT_SIZE: 0.8, // rem
  MAX_FONT_SIZE: 3.0, // rem
  FONT_SIZE_STEP: 0.1, // rem

  // Scrolling
  KEYBOARD_SCROLL_AMOUNT: 200, // px - scroll distance for up/down arrows

  // Intersection Observer
  VISIBILITY_THRESHOLD: 0.5, // 50% - section must be this visible to be considered "current"

  // Import
  DEFAULT_IMPORT_CUTOFF: '2000-01-01', // Default date for importing setlists (imports all)
}

const SECTION_DEFAULTS_KEY = 'section_defaults'

/**
 * The setlist page: the overview of a setlist and each of its songs, side by
 * side in a scroll-snap row, with the header, edit mode and the menu's song list.
 *
 * Shown by SetlistView, which starts it, tells it when the route changes
 * (routeChanged) and disposes of it when the view is left: everything it does to
 * the window, the document, <body> and the menu is undone then.
 *
 * Which song is showing is the route (/setlist/<id>/song/<n>). To move, it
 * navigates (navigateTo); the route change then shows the song.
 */
export class SetlistPage {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root the view this page is in: it looks for its elements there
   * @param {object} [options.restoredState] what captureViewState() gave when the page was
   *   left, if it is being come back to
   */
  constructor({ root, setlistId, songIndex = -1, restoredState = undefined }) {
    this.root = root
    this._restoredState = restoredState
    this._setlistId = setlistId
    this._initialSongIndex = songIndex
    // Aborted by dispose(): the listeners that outlive the view are added with its signal
    this._abort = new AbortController()
    this._disposed = false
    this.db = null // Will be initialized in start()
    this.parser = new ChordProParser()
    this.currentSongIndex = undefined
    this.songs = []
    this.currentSetlistId = null
    // Track section visibility state: { songIndex: { sectionIndex: { hideMode: 'none'|'section'|'chords'|'lyrics' } } }
    this.sectionState = {}
    this.sectionObserver = null
    this.overviewEditMode = false // Track whether overview is in edit mode
    this.settingsImportHandler = null
    this.storageImportHandler = null
    this.globalImportHandler = null
    this._overviewComponent = null
    this._sectionDefaultsCache = null
    this._sectionDefaultsRaw = null
    this._capoEnabled = this._readCapoPreference()
    this._capoChangeHandler = null
    this._currentKeyForCapo = ''
    this._onSectionDefaultsChanged = this._handleSectionDefaultsChanged.bind(this)
    this._onCapoPreferenceChange = this._handleCapoPreferenceChange.bind(this)

    // Bind overview component event handlers once
    this._onOverviewSongClick = event => {
      const index = event.index
      if (typeof index === 'number') {
        this.navigateTo(index)
      }
    }

    this._onOverviewSongDelete = event => {
      const index = event.index
      if (typeof index === 'number' && this.songs[index]) {
        this.showDeleteSongConfirmation(index, this.songs[index])
      }
    }

    this._onOverviewAddSong = () => {
      this._addSongModal.open()
    }

    this._reorder = new OverviewReorder({
      root: this.root,
      isEnabled: () => this.overviewEditMode,
      onMove: (from, to) => this.moveSong(from, to),
    })

    this._addSongModal = new AddSongModal({
      root: this.root,
      getDb: () => this.db,
      onPick: song => this.addSongToSetlist(song),
    })

    this._onOverviewSongKeyChange = event => {
      const { index, key } = event
      if (typeof index === 'number' && key) {
        this.changeSongKeyInSetlist(index, key)
      }
    }
  }

  async start() {
    // Initialize IndexedDB with current organisation
    this.db = await getCurrentDB()

    await this.renderSetlist(this._setlistId, this._initialSongIndex)
    if (this._disposed) return

    this.setupKeyboardNavigation()
    this.setupNavigationMenu()

    const { signal } = this._abort
    window.addEventListener('storage', this._onSectionDefaultsChanged, { signal })
    window.addEventListener(SectionDefaultsEvent.type, this._onSectionDefaultsChanged, { signal })
    window.addEventListener('storage', this._onCapoPreferenceChange, { signal })
    window.addEventListener(CapoPreferenceEvent.type, this._onCapoPreferenceChange, { signal })
  }

  /** The route changed within this setlist: show the song it names */
  /** How far each song (and the overview) is scrolled, to put back if the user returns */
  captureViewState() {
    const scrolls = {}
    for (const section of this.root.querySelectorAll('.section')) {
      if (section.scrollTop) scrolls[section.id] = section.scrollTop
    }
    return Object.keys(scrolls).length > 0 ? { scrolls } : undefined
  }

  /** Put the sections back where they were scrolled to (once: a reload of the setlist is a fresh start) */
  _restoreScrolls() {
    const scrolls = this._restoredState?.scrolls
    this._restoredState = undefined
    for (const [id, top] of Object.entries(scrolls ?? {})) {
      const section = this.root.querySelector(`#${id}`)
      if (section) section.scrollTop = top
    }
  }

  routeChanged(route) {
    if (this._disposed || !this.currentSetlist) return
    const index = route.songIndex
    const section = index >= 0 ? `song-${index}` : 'overview'
    // Already showing it, e.g. the route is catching up with a swipe
    if (section !== this._lastVisibleSection) {
      if (index < 0) this.showOverview(false)
      else if (index < this.songs.length) this.showSong(index, false)
    }
    this.updateNavigationMenu()
  }

  /**
   * Go to a song, or the overview (-1). Moving from the overview into a song adds
   * to the history, and back to the overview undoes it; song to song replaces.
   */
  navigateTo(index, { replace = false } = {}) {
    return goTo(buildUrl({ name: 'setlist', setlistId: this.currentSetlistId, songIndex: index }), {
      replace,
    })
  }

  /** Undo what this page did outside its own elements */
  dispose() {
    if (this._disposed) return
    this._disposed = true
    this._abort.abort()
    this.sectionObserver?.disconnect()
    clearTimeout(this._programmaticScrollTimeout)

    // A drag in progress, and the listeners for the next
    this._reorder.disable()

    // Edit mode is on <body>, which outlives the view; leaving it saves, as exiting does
    this.exitEditMode()
    document.body.classList.remove('header-expanded')
    document.documentElement.style.setProperty('--header-expanded', '0')

    // The menu is the shell's: take the setlist's songs out of it
    const navMenu = document.getElementById('nav-menu')
    if (navMenu) {
      navMenu.songs = []
      navMenu.setlistTitle = 'Setlist'
      navMenu.showOverviewLink = false
    }

    // Nothing is current any more (what is playing carries on)
    this.dispatchSongChange(null)
  }

  _readCapoPreference() {
    try {
      if (typeof localStorage === 'undefined') {
        return false
      }
    } catch {
      return false
    }
    const keys = ['enabled_capo', 'enable_capo']
    return keys.some(key => {
      const value = localStorage.getItem(key)
      return value === 'true' || value === '1'
    })
  }

  async renderSetlist(setlistId, songIndex = -1) {
    console.log('renderSetlist called with:', setlistId)
    try {
      // Load setlist from IndexedDB
      const setlist = await this.db.getSetlist(setlistId)

      if (!setlist) {
        console.error('[ERROR] Setlist not found in IndexedDB:', setlistId)
        const container = this.root.querySelector('.song-container')
        showStatusMessage(container, {
          message: 'Setlist not found.',
          state: 'error',
        })
        return
      }

      if (setlist.songs.length === 0) {
        console.warn('[WARN] Setlist has no songs')

        // Set instance variables for empty setlist
        this.songs = []
        this.currentSetlistId = setlistId
        this.currentSetlist = setlist
        this._setOverviewComponent(null)

        // Update header to show setlist info
        this.updateHeader(null, true)

        // Header buttons (info, edit mode) must work on an empty setlist too.
        // Both are guarded, so the full setup after the first song is added is fine.
        this.setupEditMode()
        this.setupAppHeaderEvents()

        // Clear container (will show Add Song button via overview)
        const container = this.root.querySelector('.song-container')
        container.textContent = ''
        container.appendChild(this.renderFullSetlist(setlist, []))

        // Show overview immediately
        if (songIndex >= 0) this.navigateTo(-1, { replace: true })
        requestAnimationFrame(() => {
          if (!this._disposed) this.showOverview(true)
        })

        return
      }

      console.log('Loaded setlist:', setlist.date, setlist.songs.length, 'songs')

      // Parse each song on-demand
      const songs = await buildRuntimeSongs(setlist, {
        db: this.db,
        parser: this.parser,
        fontSize: CONFIG.DEFAULT_FONT_SIZE,
      })

      console.log('Parsed songs:', songs.length)

      // Store songs for navigation
      this.songs = songs
      this.currentSetlistId = setlistId
      this.currentSetlist = setlist

      // Kick off background pad caching for all keys in this setlist
      preloadPadKeysForSongs(this.songs)

      // Initialize section states (load saved overrides for this setlist)
      this.sectionState = {}
      this.loadState()

      // Which view to start in comes from the route; a song that isn't there means the overview
      const shouldShowSongDirectly = songIndex >= 0 && songIndex < songs.length
      if (songIndex >= 0 && !shouldShowSongDirectly) this.navigateTo(-1, { replace: true })

      // Render all songs on one page
      const container = this.root.querySelector('.song-container')
      console.log('Rendering full setlist into container:', container)
      // Clear container and append fragment
      container.textContent = ''
      const fragment = this.renderFullSetlist(setlist, songs)
      container.appendChild(fragment)
      this._initializeSongSections(container)

      // If going directly to a song, scroll to it immediately (before layout/paint)
      if (shouldShowSongDirectly) {
        const targetSection = container.querySelector(`#song-${songIndex}`)
        if (targetSection) {
          // Set scroll position immediately, before browser paints
          // scrollTo, not scrollLeft: the stylesheet's smooth scrolling would animate that
          container.scrollTo({ left: targetSection.offsetLeft, behavior: 'instant' })
        } else {
          console.warn(`[Initial Load] Could not find target section song-${songIndex}`)
        }
      }

      // Set up initial view state (no scrolling on page load)
      if (shouldShowSongDirectly) {
        // Song is already visible from pre-render setup above
        this._lastVisibleSection = `song-${songIndex}`
        this.currentSongIndex = songIndex
        this.updateHeader(this.songs[songIndex], true) // true = instant, no animation
        this.applyFontSize(songIndex)
        this.exitEditMode()
        this.dispatchSongChange(this.songs[songIndex])
      } else {
        // Default to overview (already visible)
        this._lastVisibleSection = 'overview'
        this.currentSongIndex = -1
        this.updateHeader(null, true) // true = instant, no animation
        this.exitEditMode()
        this.dispatchSongChange(null)
      }
      this.updateNavigationMenu()

      // The header's buttons (edit mode, info) work as soon as the header shows the setlist,
      // not a frame later
      this.setupEditMode()
      this.setupAppHeaderEvents()

      // Wait for layout to complete before other setup
      requestAnimationFrame(() => {
        if (this._disposed) return
        // Set up drag-and-drop (only enabled in edit mode)
        if (this.overviewEditMode) {
          this._reorder.enable()
        }

        // Set up section control buttons
        this.setupSectionControls()

        // Apply saved state to sections
        this.applySectionState()

        // Set up key selector
        this.setupKeySelector()
        this.setupCapoSelector()

        // Set up Intersection Observer to auto-detect current song
        this.setupSectionObserver()

        this._restoreScrolls()
      })
    } catch (error) {
      console.error('Error loading setlist:', error)
      const container = this.root.querySelector('.song-container')
      showStatusMessage(container, {
        message: 'Error loading songs. Please check the console.',
        state: 'error',
      })
      this._setOverviewComponent(null)
    }
  }

  _setOverviewComponent(component) {
    if (this._overviewComponent) {
      this._overviewComponent.removeEventListener(
        OverviewSongClickEvent.type,
        this._onOverviewSongClick
      )
      this._overviewComponent.removeEventListener(
        'overview-song-delete',
        this._onOverviewSongDelete
      )
      this._overviewComponent.removeEventListener(
        OverviewAddSongEvent.type,
        this._onOverviewAddSong
      )
      this._overviewComponent.removeEventListener(
        'overview-song-key-change',
        this._onOverviewSongKeyChange
      )
    }

    this._overviewComponent = component

    if (component) {
      component.addEventListener(OverviewSongClickEvent.type, this._onOverviewSongClick)
      component.addEventListener(OverviewSongDeleteEvent.type, this._onOverviewSongDelete)
      component.addEventListener(OverviewAddSongEvent.type, this._onOverviewAddSong)
      component.addEventListener(OverviewSongKeyChangeEvent.type, this._onOverviewSongKeyChange)
    }
  }

  _refreshOverviewComponentSongs() {
    if (this._overviewComponent) {
      this._overviewComponent.songs = [...this.songs]
    }
  }

  _refreshOverviewComponentEditMode() {
    if (this._overviewComponent) {
      this._overviewComponent.editMode = this.overviewEditMode
    }
  }

  /** The URL follows a swipe to another song or the overview (not a new history entry) */
  _replaceHistoryForSong(index) {
    this.navigateTo(index, { replace: true })
  }

  _replaceHistoryForOverview() {
    this.navigateTo(-1, { replace: true })
  }

  renderFullSetlist(_setlist, songs) {
    const fragment = document.createDocumentFragment()

    // Create overview section rendered by Lit component
    const overview = document.createElement('div')
    overview.id = 'overview'
    overview.className = 'section'

    const songContentWrapper = document.createElement('div')
    songContentWrapper.className = 'song-content'

    const overviewComponent = document.createElement('setlist-overview')
    overviewComponent.songs = songs
    overviewComponent.editMode = this.overviewEditMode
    this._setOverviewComponent(overviewComponent)

    songContentWrapper.appendChild(overviewComponent)
    overview.appendChild(songContentWrapper)
    fragment.appendChild(overview)

    // Render all songs
    songs.forEach((song, index) => {
      const songElement = document.createElement('div')
      songElement.classList.add('section')
      songElement.id = `song-${index}`
      if (song.parsed) {
        const songDisplay = document.createElement('song-display')
        songDisplay.parsed = song.parsed
        songDisplay.songIndex = song.songIndex
        songDisplay.capo = this._capoEnabled ? song.currentCapo || 0 : 0
        const songContent = document.createElement('div')
        songContent.className = 'song-content'
        songContent.appendChild(songDisplay)
        songElement.appendChild(songContent)
      }
      fragment.appendChild(songElement)
    })

    return fragment
  }

  _initializeSongSections(root = this.root) {
    const isEditMode = document.body.classList.contains('edit-mode')

    // Find all song-section elements, including those inside song-display shadow DOMs
    const sections = []

    // First, get any song-sections directly in the root
    sections.push(...root.querySelectorAll('song-section'))

    // Then, query into song-display shadow roots
    const songDisplays = root.querySelectorAll('song-display')
    songDisplays.forEach(songDisplay => {
      if (songDisplay.shadowRoot) {
        sections.push(...songDisplay.shadowRoot.querySelectorAll('song-section'))
      }
    })

    sections.forEach(section => {
      const songIndex = Number(section.getAttribute('song-index'))
      const sectionIndex = Number(section.getAttribute('section-index'))
      if (Number.isNaN(songIndex) || Number.isNaN(sectionIndex)) {
        return
      }
      const state = this._resolveSectionState(songIndex, sectionIndex, section)
      const hideMode = state.hideMode || 'none'
      // Apply state via reactive properties
      section.hideMode = hideMode
      section.isCollapsed = state.isCollapsed || false
      section.isHidden = state.isHidden || false
      section.editMode = isEditMode
    })
  }

  _getSongSectionComponent(songIndex, sectionIndex) {
    // First try direct query (in case not in shadow DOM)
    let section = this.root.querySelector(
      `song-section[song-index="${songIndex}"][section-index="${sectionIndex}"]`
    )
    if (section) return section

    // Query into song-display shadow roots
    const songDisplays = this.root.querySelectorAll('song-display')
    for (const songDisplay of songDisplays) {
      if (songDisplay.shadowRoot) {
        section = songDisplay.shadowRoot.querySelector(
          `song-section[song-index="${songIndex}"][section-index="${sectionIndex}"]`
        )
        if (section) return section
      }
    }

    return null
  }

  showOverview(instant = false) {
    // Update the last visible section to prevent observer from triggering
    this._lastVisibleSection = 'overview'

    this.scrollToSection('overview', -1, instant)
    // Update header with animation for programmatic navigation
    this.updateHeader(null, false)
    this.exitEditMode()

    // Dispatch song-change event with null to clear media player
    this.dispatchSongChange(null)
  }

  showSong(index, instant = false) {
    // Update the last visible section to prevent observer from triggering
    this._lastVisibleSection = `song-${index}`

    // Leaving overview edit mode when navigating into a song
    this.setOverviewEditMode(false)

    this.scrollToSection(`song-${index}`, index, instant)
    // Update header with animation for programmatic navigation
    this.updateHeader(this.songs[index], false)
    this.applyFontSize(index)
    this.exitEditMode()

    // Dispatch song-change event for media player
    if (this.songs[index]) {
      this.dispatchSongChange(this.songs[index])
    }
  }

  async exitEditMode() {
    const isEditMode = document.body.classList.contains('edit-mode')
    if (isEditMode) {
      const appHeader = this.root.querySelector('#app-header')
      const keySelector = this.root.querySelector('#key-selector')
      const capoSelector = this.root.querySelector('#capo-selector')
      document.body.classList.remove('edit-mode')
      document.body.removeAttribute('data-edit-mode')
      if (appHeader) {
        appHeader.editMode = false
      }
      if (keySelector) {
        keySelector.editMode = false
      }
      if (capoSelector) {
        capoSelector.editMode = false
      }

      // Update all sections to reflect non-edit mode
      this._initializeSongSections()

      // Save setlist to IndexedDB
      if (this.currentSetlist) {
        // Update timestamp
        this.currentSetlist.modifiedDate = new Date().toISOString()

        // Save to database
        await this.db.saveSetlist(this.currentSetlist)
        console.log('[ExitEditMode] Saved setlist to IndexedDB')
      }
    }
  }

  async updateHeader(song, instant = false) {
    const appHeader = this.root.querySelector('#app-header')
    const musicalMetadata = this.root.querySelector('#musical-metadata')
    const keySelector = this.root.querySelector('#key-selector')
    const capoSelector = this.root.querySelector('#capo-selector')
    const fontSizeControls = this.root.querySelector('.font-size-controls')

    // Determine new title
    let newTitle
    if (song) {
      newTitle = song.title
    } else {
      if (this.currentSetlist) {
        newTitle = setlistTitle(this.currentSetlist, 'short')
      } else {
        newTitle = 'Setlist'
      }
    }

    // Check if content is actually changing
    const titleChanged = appHeader.heading !== newTitle
    if (!titleChanged && !instant) {
      return // No change needed
    }

    if (instant) {
      // Instant update - no animation
      appHeader.setTitleInstant(newTitle)
      this._updateHeaderContent(song, musicalMetadata, keySelector, capoSelector, fontSizeControls)
    } else {
      // Animated update - fade out old, swap content, fade in new
      appHeader.heading = newTitle

      await this._animateSlottedContent(async () => {
        this._updateHeaderContent(
          song,
          musicalMetadata,
          keySelector,
          capoSelector,
          fontSizeControls
        )
      })
    }
  }

  _updateHeaderContent(song, musicalMetadata, keySelector, capoSelector, _fontSizeControls) {
    if (song) {
      // Update key selector
      if (song.currentKey) {
        this.updateKeySelector(song.currentKey)
      } else {
        if (keySelector) {
          keySelector.value = '-'
          keySelector.keys = []
        }
      }

      if (capoSelector) {
        if (this._capoEnabled) {
          this.updateCapoSelector(song.currentCapo ?? 0, song.currentKey)
        }
      }

      // Update song settings popover
      this.updateSongSettingsPopover()

      // Update musical metadata display
      if (musicalMetadata) {
        musicalMetadata.keyValue = song.currentKey || ''
        musicalMetadata.capoValue = song.currentCapo ?? 0
        musicalMetadata.bpm = song.currentBPM || null
        musicalMetadata.timeSignature = song.metadata?.time || song.metadata?.timeSignature || ''
        musicalMetadata.style.display = ''
      }

      // Store current song for info button handler
      this._currentSongForInfo = song
    } else {
      // Overview - hide musical metadata
      if (musicalMetadata) {
        musicalMetadata.style.display = 'none'
      }

      // Clear key selector
      if (keySelector) {
        keySelector.value = '-'
        keySelector.keys = []
      }
      if (capoSelector) {
        capoSelector.referenceKey = ''
      }

      // Store that we're on overview for info button handler
      this._currentSongForInfo = null
    }
  }

  dispatchSongChange(song) {
    // Dispatch custom event for media player to listen to
    document.dispatchEvent(new SongChangeEvent(song))
    console.log('[SongChange] Dispatched song:', song?.songId, song?.title)
  }

  async showSongInfo(song) {
    const dialog = this.root.querySelector('#song-info-dialog')
    if (!dialog) return
    dialog.db = this.db
    await dialog.show(song.songId, { title: song.title })
  }

  async showSetlistInfo() {
    const dialog = this.root.querySelector('#setlist-info-dialog')
    if (!dialog || !this.currentSetlist) return
    if (!this._setlistDetailsSaveHandler) {
      this._setlistDetailsSaveHandler = event => this.saveSetlistDetails(event.changes)
      dialog.addEventListener(SetlistInfoSaveEvent.type, this._setlistDetailsSaveHandler)
    }
    dialog.people = (await getOrganisationPeople()).people
    await dialog.show(this.currentSetlist)
  }

  /**
   * Save edited setlist details (date, time, type, name, leader) from the info
   * dialog. On failure the dialog stays in edit mode with what was typed.
   */
  async saveSetlistDetails(changes) {
    const dialog = this.root.querySelector('#setlist-info-dialog')
    const setlist = this.currentSetlist
    const previous = { ...setlist }
    try {
      Object.assign(setlist, changes, { modifiedDate: new Date().toISOString() })
      await this.db.saveSetlist(setlist)
    } catch (error) {
      Object.assign(setlist, previous)
      console.error('[SetlistInfo] Failed to save setlist details:', error)
      alert(`Couldn't save the setlist details: ${error.message}`)
      return
    }

    const song = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null
    this.updateHeader(song, true)
    await dialog?.show(setlist)
  }

  scrollToSection(sectionId, newIndex, instant = false) {
    const section = this.root.querySelector(`#${sectionId}`)
    const container = this.root.querySelector('.song-container')

    console.log('Scrolling to:', sectionId, 'index:', newIndex, 'instant:', instant)

    if (!section || !container) return

    // Disable observer during programmatic scroll
    this._isProgrammaticScroll = true

    // Scroll the container to bring the section into view
    const scrollLeft = section.offsetLeft

    if (instant) {
      // Jump immediately without animation
      container.scrollTo({ left: scrollLeft, behavior: 'instant' })
      // Re-enable observer immediately for instant scrolls
      this._isProgrammaticScroll = false
    } else {
      // Smooth scroll animation
      container.scrollTo({
        left: scrollLeft,
        behavior: 'smooth',
      })

      // Re-enable observer after scroll animation completes
      // Smooth scrolling typically takes 300-500ms
      clearTimeout(this._programmaticScrollTimeout)
      this._programmaticScrollTimeout = setTimeout(() => {
        this._isProgrammaticScroll = false
      }, 600)
    }

    // Note: currentSongIndex is now automatically tracked by Intersection Observer
    // but we set it here for immediate feedback before observer fires
    this.currentSongIndex = newIndex
  }

  setupSectionObserver() {
    // Clean up existing observer if any
    if (this.sectionObserver) {
      this.sectionObserver.disconnect()
    }

    const container = this.root.querySelector('.song-container')
    if (!container) return

    // Track the most recently visible section to avoid duplicate updates
    this._lastVisibleSection = null

    // Observer watches which section is currently in view
    this.sectionObserver = new IntersectionObserver(
      entries => {
        // Skip if this is a programmatic scroll
        if (this._isProgrammaticScroll) return

        // Find the most visible entry
        let mostVisible = null
        let maxRatio = 0

        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            mostVisible = entry
          }
        })

        // Only update if we found a visible section and it's different from last time
        if (mostVisible && mostVisible.intersectionRatio > CONFIG.VISIBILITY_THRESHOLD) {
          const sectionId = mostVisible.target.id

          // Skip if this is the same section we just updated
          if (sectionId === this._lastVisibleSection) return

          this._lastVisibleSection = sectionId

          if (sectionId === 'overview') {
            this.currentSongIndex = -1
            this.updateHeader(null, false) // animate=true for smooth transition
            this.dispatchSongChange(null)
            this._replaceHistoryForOverview()
          } else if (sectionId.startsWith('song-')) {
            const index = parseInt(sectionId.split('-')[1], 10)
            if (index >= 0 && index < this.songs.length) {
              this.setOverviewEditMode(false)
              this.currentSongIndex = index
              this.updateHeader(this.songs[index], false) // animate=true for smooth transition
              this.applyFontSize(index)
              this.dispatchSongChange(this.songs[index])
              this._replaceHistoryForSong(index)
            }
          }
        }
      },
      {
        root: container,
        threshold: [0, 0.5, 1], // Trigger at 0%, 50%, and 100% visibility
        rootMargin: '0px',
      }
    )

    // Observe all sections (overview + all songs)
    this.root.querySelectorAll('.section').forEach(section => {
      this.sectionObserver.observe(section)
    })
  }

  /**
   * Load this setlist's saved section states and capos, from localStorage
   * state-<setlistId>, saved by the song models as {sectionState, capoValues}
   * (keyed by song index). Saves made before the models were flat:
   * {<songIndex>: sections, capo: capos}, and are still read.
   */
  loadState() {
    const stateKey = `state-${this.currentSetlistId}`
    let saved = {}
    try {
      saved = JSON.parse(localStorage.getItem(stateKey)) ?? {}
    } catch (e) {
      console.error('Failed to parse saved state:', e)
    }
    const sections =
      saved.sectionState ??
      Object.fromEntries(Object.entries(saved).filter(([key]) => /^\d+$/.test(key)))
    const capos = saved.capoValues ?? saved.capo ?? {}

    this.sectionState = sections
    if (this._capoEnabled) {
      for (const [songIndex, capo] of Object.entries(capos)) {
        const song = this.songs[Number(songIndex)]
        if (song) song.currentCapo = this._normalizeCapoValue(capo)
      }
    }

    // Apply capo defaults from song user prefs (for songs without explicit setlist override)
    this._applyCapoDefaults()
  }

  async _applyCapoDefaults() {
    if (!this._capoEnabled) return

    const { getSongUserPrefs } = await import('./song-user-prefs.ts')

    this.songs.forEach((song, index) => {
      // Skip if capo already set by setlist state (highest priority)
      if (song.currentCapo !== undefined && song.currentCapo !== 0) {
        return
      }

      // Get song user prefs
      const songUserPrefs = getSongUserPrefs(song.songId, this.db.organisationId)
      if (!songUserPrefs || songUserPrefs.capo === undefined) {
        return
      }

      // Only apply song prefs capo if using canonical key
      const setlistSongEntry = this.currentSetlist?.songs?.[index]
      if (!setlistSongEntry) return

      // Get canonical song to compare keys
      const canonicalSong = this.songs[index]
      if (!canonicalSong) return

      // Check if setlist key matches what the user's prefs are based on
      // We need to compare against the canonical song's current key
      // The song user prefs capo is based on the canonical key at the time they set it
      if (setlistSongEntry.key === song.currentKey) {
        // Key hasn't been changed from canonical, apply user's preferred capo
        song.currentCapo = this._normalizeCapoValue(songUserPrefs.capo)
        console.log(
          `[Capo] Applied song user pref capo=${songUserPrefs.capo} for song ${song.title}`
        )
      }
    })
  }

  /** Save the section states and capos, in the song models' format (see loadState) */
  saveState() {
    const capoValues = {}
    if (this._capoEnabled) {
      this.songs.forEach((song, index) => {
        if (song.currentCapo !== undefined && song.currentCapo !== 0) {
          capoValues[index] = song.currentCapo
        }
      })
    }
    localStorage.setItem(
      `state-${this.currentSetlistId}`,
      JSON.stringify({ sectionState: this.sectionState, capoValues })
    )
  }

  /**
   * Save section states for a specific song using SongModel
   */
  async _saveSectionStateViaModel(songIndex) {
    const song = this.songs[songIndex]
    if (!song) return

    const { createSetlistSongModel, syncSectionStates } = await import('./song-model-factory.ts')
    const model = createSetlistSongModel(
      song,
      song._setlistEntry,
      song._canonicalSong,
      this.currentSetlistId,
      this.db,
      this.db.organisationId
    )

    // Sync all section states for this song
    const sectionStatesForSong = this.sectionState[songIndex] || {}
    syncSectionStates(model, sectionStatesForSong)

    await model.save()
    console.log('[SongModel] Saved section states via model for song:', songIndex)
  }

  _getSectionDefaultsConfig() {
    let stored = null
    try {
      stored = localStorage.getItem(SECTION_DEFAULTS_KEY)
    } catch (error) {
      console.error('Failed to read section defaults:', error)
      stored = null
    }
    if (stored === this._sectionDefaultsRaw) {
      return this._sectionDefaultsCache
    }
    this._sectionDefaultsRaw = stored
    if (!stored) {
      this._sectionDefaultsCache = null
      return null
    }
    try {
      this._sectionDefaultsCache = JSON.parse(stored)
    } catch (error) {
      console.error('Failed to parse section defaults:', error)
      this._sectionDefaultsCache = null
    }
    return this._sectionDefaultsCache
  }

  _resolveSectionState(songIndex, sectionIndex, sectionElement = null) {
    // Priority 1: Setlist state override (explicit per-setlist override)
    const overridesForSong = this.sectionState[songIndex] || {}
    const override = overridesForSong[sectionIndex] || null

    // Priority 2: Song user prefs (user's defaults for this song)
    const songUserPrefsDefaults = this._getSongUserPrefsSectionDefaults(songIndex, sectionIndex)

    // Priority 3: Global section defaults & app defaults
    const appDefaults = {
      hideMode: this._resolveDefaultHideMode(sectionElement, songIndex, sectionIndex),
      isCollapsed: false,
      isHidden: false,
    }

    // Merge priorities
    if (!override && !songUserPrefsDefaults) {
      return appDefaults
    }

    return {
      hideMode: override?.hideMode ?? songUserPrefsDefaults?.hideMode ?? appDefaults.hideMode,
      isCollapsed:
        override?.isCollapsed ?? songUserPrefsDefaults?.isCollapsed ?? appDefaults.isCollapsed,
      isHidden: override?.isHidden ?? songUserPrefsDefaults?.isHidden ?? appDefaults.isHidden,
    }
  }

  _getSongUserPrefsSectionDefaults(songIndex, sectionIndex) {
    // Get song user prefs for this song
    const song = this.songs?.[songIndex]
    if (!song) return null

    // Get songId (library songs use .id, setlist songs use .songId)
    const songId = song.songId || song.id
    if (!songId) return null

    // Check if we have cached prefs
    if (!this._songUserPrefsCache) {
      this._songUserPrefsCache = {}
    }

    // Load prefs if not cached
    if (!(songId in this._songUserPrefsCache)) {
      try {
        // Synchronous access for performance
        const key = `song-prefs-${this.db.organisationId}`
        const allPrefs = JSON.parse(localStorage.getItem(key) || '{}')
        this._songUserPrefsCache[songId] = allPrefs[songId] || null
      } catch (error) {
        console.error('[SongUserPrefs] Error loading prefs:', error)
        this._songUserPrefsCache[songId] = null
      }
    }

    const prefs = this._songUserPrefsCache[songId]
    if (!prefs?.sectionDefaults) return null

    return prefs.sectionDefaults[sectionIndex.toString()] || null
  }

  _ensureSectionOverride(songIndex, sectionIndex, sectionElement = null) {
    if (!this.sectionState[songIndex]) {
      this.sectionState[songIndex] = {}
    }
    if (!this.sectionState[songIndex][sectionIndex]) {
      const resolved = this._resolveSectionState(songIndex, sectionIndex, sectionElement)
      this.sectionState[songIndex][sectionIndex] = {
        hideMode: resolved.hideMode,
        isCollapsed: resolved.isCollapsed,
        isHidden: resolved.isHidden,
      }
    }
    return this.sectionState[songIndex][sectionIndex]
  }

  _resolveDefaultHideMode(sectionElement, songIndex, sectionIndex) {
    if (!sectionElement) {
      sectionElement = this._getSongSectionComponent(songIndex, sectionIndex)
    }
    const recommended =
      sectionElement && typeof sectionElement.getRecommendedHideMode === 'function'
        ? sectionElement.getRecommendedHideMode() || 'none'
        : 'none'
    let defaultsConfig = this._getSectionDefaultsConfig()
    if (!defaultsConfig || typeof defaultsConfig !== 'object') {
      defaultsConfig = { all: 'all' }
      this._sectionDefaultsCache = defaultsConfig
      this._sectionDefaultsRaw = JSON.stringify(defaultsConfig)
      try {
        localStorage.setItem(SECTION_DEFAULTS_KEY, this._sectionDefaultsRaw)
      } catch (error) {
        console.error('Failed to persist default section defaults:', error)
      }
    }
    let hideMode = null
    if (defaultsConfig) {
      const label = this._normalizeSectionLabel(sectionElement)
      if (label && Object.hasOwn(defaultsConfig, label)) {
        hideMode = this._mapDefaultChoiceToHideMode(defaultsConfig[label])
      } else if (Object.hasOwn(defaultsConfig, 'all')) {
        hideMode = this._mapDefaultChoiceToHideMode(defaultsConfig.all)
      }
    }

    if (!hideMode || hideMode === 'none') {
      return recommended || 'none'
    }

    if (hideMode === 'chords' && recommended === 'lyrics') {
      // User wants lyrics-only view, but section has only chords
      return 'collapse'
    }

    if (hideMode === 'lyrics' && recommended === 'chords') {
      // User wants chords-only view, but section has only lyrics
      return 'collapse'
    }

    return hideMode
  }

  _mapDefaultChoiceToHideMode(choice) {
    const value = (choice || '').toString().toLowerCase()
    switch (value) {
      case 'all':
      case 'show-all':
      case 'default':
      case 'none':
        return 'none'
      case 'lyrics':
        return 'chords'
      case 'chords':
        return 'lyrics'
      case 'collapse':
        return 'collapse'
      case 'hide':
      case 'hidden':
        return 'hide'
      default:
        return 'none'
    }
  }

  _normalizeSectionLabel(sectionElement) {
    if (!sectionElement) {
      return ''
    }
    const label = sectionElement.dataset?.label || sectionElement.label || ''
    return label.trim().toLowerCase()
  }

  async setSectionHideMode(songIndex, sectionIndex, mode) {
    const component = this._getSongSectionComponent(songIndex, sectionIndex)
    const state = this._ensureSectionOverride(songIndex, sectionIndex, component)

    if (mode === 'collapse') {
      const details = component?.getDetailsElement()
      if (details) {
        this.animateSectionToggle(songIndex, sectionIndex, details)
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
        state.isHidden = true
        state.hideMode = 'hide'
        state.isCollapsed = false
      } else {
        state.isHidden = !state.isHidden
        if (state.isHidden) {
          state.hideMode = 'hide'
          state.isCollapsed = false
        } else {
          state.hideMode = 'none'
        }
      }
      await this._saveSectionStateViaModel(songIndex)
      this.updateSectionDOM(songIndex, sectionIndex)
      return
    }

    if (state.isHidden) {
      state.isHidden = false
    }
    if (state.isCollapsed) {
      state.isCollapsed = false
    }

    if (isExplicit || mappedMode === 'none') {
      state.hideMode = mappedMode || 'none'
    } else {
      state.hideMode = state.hideMode === mappedMode ? 'none' : mappedMode
    }
    await this._saveSectionStateViaModel(songIndex)
    this.updateSectionDOM(songIndex, sectionIndex)
  }

  async animateSectionToggle(songIndex, sectionIndex, details) {
    const state = this._ensureSectionOverride(songIndex, sectionIndex)
    const content = details.querySelector('.section-content')
    const wrapper = details.closest('.song-section-wrapper') || details
    if (!content) return

    const isEditMode = document.body.classList.contains('edit-mode')

    // Determine if we're opening or closing based on current state
    const isCurrentlyCollapsed = state.isCollapsed
    const isOpening = isCurrentlyCollapsed

    if (isOpening) {
      // Opening: update state first
      state.isCollapsed = false
      state.hideMode = 'none'
      await this._saveSectionStateViaModel(songIndex)

      // Update wrapper classes
      wrapper.classList.remove('section-collapsed')

      // In normal mode, open details; in edit mode it's always open
      if (!isEditMode) {
        details.open = true
      }

      // Get the natural height
      const startHeight = 0
      const endHeight = content.scrollHeight

      // Animate from 0 to full height
      content.style.height = `${startHeight}px`
      content.style.overflow = 'hidden'

      requestAnimationFrame(() => {
        content.style.transition = 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)'
        content.style.height = `${endHeight}px`

        // Clean up after animation
        setTimeout(() => {
          content.style.height = ''
          content.style.overflow = ''
          content.style.transition = ''
        }, 350)
      })
    } else {
      // Closing: animate first, then update state
      const startHeight = content.scrollHeight
      const endHeight = 0

      // Set explicit height
      content.style.height = `${startHeight}px`
      content.style.overflow = 'hidden'

      requestAnimationFrame(() => {
        content.style.transition = 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)'
        content.style.height = `${endHeight}px`

        // After animation completes, update state
        setTimeout(async () => {
          state.isCollapsed = true
          state.hideMode = 'collapse'
          await this._saveSectionStateViaModel(songIndex)

          // Update wrapper classes (adds section-collapsed)
          wrapper.classList.add('section-collapsed')

          // In normal mode, close details; in edit mode keep it open
          if (!isEditMode) {
            details.open = false
          }

          content.style.height = ''
          content.style.overflow = ''
          content.style.transition = ''
        }, 350)
      })
    }
  }

  updateSectionDOM(songIndex, sectionIndex) {
    const component = this._getSongSectionComponent(songIndex, sectionIndex)
    if (!component) {
      return
    }
    const state = this._resolveSectionState(songIndex, sectionIndex, component)
    const isEditMode = document.body.classList.contains('edit-mode')
    // Apply state via reactive properties
    component.hideMode = state.hideMode || 'none'
    component.isCollapsed = state.isCollapsed || false
    component.isHidden = state.isHidden || false
    component.editMode = isEditMode
  }

  applySectionState() {
    this._initializeSongSections()
  }

  setupEditMode() {
    if (this._editModeSetup) return
    this._editModeSetup = true

    const appHeader = this.root.querySelector('#app-header')
    if (!appHeader) return

    // Listen to the edit-mode-toggle event from app-header
    appHeader.addEventListener(EditModeToggleEvent.type, async () => {
      // Check if we're on overview or song view
      if (this.currentSongIndex < 0) {
        // We're on overview - toggle overview edit mode
        this.toggleOverviewEditMode()
        return
      }

      // We're on song view - handle song edit mode
      const isEnteringEditMode = !document.body.classList.contains('edit-mode')

      if (isEnteringEditMode) {
        // Entering edit mode - fade out normal controls, fade in edit controls
        document.body.classList.add('edit-mode')
        document.body.setAttribute('data-edit-mode', '')
        appHeader.editMode = true

        // Update musical metadata to edit mode (makes it clickable)
        const musicalMetadata = this.root.querySelector('#musical-metadata')
        if (musicalMetadata) {
          musicalMetadata.editMode = true
        }

        // Update key selector edit mode
        const keySelector = this.root.querySelector('#key-selector')
        if (keySelector) {
          keySelector.editMode = true
        }
        const capoSelector = this.root.querySelector('#capo-selector')
        if (capoSelector && this._capoEnabled) {
          capoSelector.editMode = true
        }

        // Clear inline display:none if it was set during previous exit
        this.root.querySelectorAll('.edit-mode-control').forEach(el => {
          el.style.display = ''
        })

        // Trigger fade-in for all edit mode controls after a frame
        requestAnimationFrame(() => {
          this.root.querySelectorAll('.edit-mode-control').forEach(el => {
            el.classList.add('fade-in')
          })
        })

        // After fade completes, mark normal controls as fade-complete
        setTimeout(() => {
          this.root.querySelectorAll('.normal-mode-control').forEach(el => {
            el.classList.add('fade-complete')
          })
        }, 250)

        // Update all sections based on edit mode
        this._initializeSongSections()
      } else {
        // Exiting edit mode - fade everything simultaneously
        // Remove edit mode class immediately to trigger all fades
        document.body.classList.remove('edit-mode')
        document.body.removeAttribute('data-edit-mode')
        appHeader.editMode = false

        // Update musical metadata to normal mode (not clickable)
        const musicalMetadata = this.root.querySelector('#musical-metadata')
        if (musicalMetadata) {
          musicalMetadata.editMode = false
        }

        // Update key selector edit mode
        const keySelector = this.root.querySelector('#key-selector')
        if (keySelector) {
          keySelector.editMode = false
        }
        const capoSelector = this.root.querySelector('#capo-selector')
        if (capoSelector) {
          capoSelector.editMode = false
        }

        // Remove fade-in classes from edit controls (triggers fade out)
        this.root.querySelectorAll('.edit-mode-control').forEach(el => {
          el.classList.remove('fade-in')
        })

        // Remove fade-complete from normal controls (makes them visible again)
        this.root.querySelectorAll('.normal-mode-control').forEach(el => {
          el.classList.remove('fade-complete')
        })

        // Refresh song sections immediately so their controls begin fading out in sync
        this._initializeSongSections()

        // Wait for fade to complete, then save and cleanup
        setTimeout(async () => {
          // Hide edit controls completely now that fade is done
          this.root.querySelectorAll('.edit-mode-control').forEach(el => {
            el.style.display = 'none'
          })

          // Save setlist to IndexedDB
          if (this.currentSetlist) {
            // Update timestamp
            this.currentSetlist.modifiedDate = new Date().toISOString()

            // Save to database
            await this.db.saveSetlist(this.currentSetlist)
            console.log('[ExitEditMode] Saved setlist to IndexedDB')
          }
        }, 250)
      }
    })
  }

  setupAppHeaderEvents() {
    if (this._appHeaderEventsSetup) return
    this._appHeaderEventsSetup = true

    const appHeader = this.root.querySelector('#app-header')
    if (!appHeader) return

    // Listen to info button clicks
    appHeader.addEventListener(HeaderInfoClickEvent.type, () => {
      if (this._currentSongForInfo) {
        this.showSongInfo(this._currentSongForInfo)
      } else {
        this.showSetlistInfo()
      }
    })

    // Listen for header-expand-toggle event
    appHeader.addEventListener(HeaderExpandToggleEvent.type, e => {
      const { expanded } = e
      if (expanded) {
        document.body.classList.add('header-expanded')
        document.documentElement.style.setProperty('--header-expanded', '1')
      } else {
        document.body.classList.remove('header-expanded')
        document.documentElement.style.setProperty('--header-expanded', '0')
      }
    })

    // Setup song settings popover
    const musicalMetadata = this.root.querySelector('#musical-metadata')
    const songSettingsPopover = this.root.querySelector('#song-settings-popover')
    if (musicalMetadata && songSettingsPopover) {
      // Set the trigger button for positioning
      songSettingsPopover.setTriggerButton(musicalMetadata)

      // Listen to musical metadata clicks (only works in edit mode)
      musicalMetadata.addEventListener(SongSettingsClickEvent.type, () => {
        songSettingsPopover.toggle()
      })

      songSettingsPopover.addEventListener(BpmChangeEvent.type, async e => {
        const newValue = e.value
        await this.handleBPMChange(newValue)
      })

      songSettingsPopover.addEventListener(SongResetClickEvent.type, async () => {
        // Close the settings first, so the question is the only thing showing
        songSettingsPopover.close()
        const modal = this.root.querySelector('#reset-confirm-modal')
        if (modal) {
          const confirmed = await modal.ask()
          if (confirmed) {
            await this.resetCurrentSong()
          }
        }
      })
    }
  }

  setupSectionControls() {
    const container = this.root.querySelector('.song-container')
    if (!container) return

    if (!this._sectionActionHandler) {
      this._sectionActionHandler = event => {
        const { songIndex, sectionIndex, action } = event
        if (typeof songIndex !== 'number' || typeof sectionIndex !== 'number' || !action) {
          return
        }
        this.setSectionHideMode(songIndex, sectionIndex, action)
      }
      container.addEventListener(SectionActionEvent.type, this._sectionActionHandler)
    }

    if (!this._sectionToggleHandler) {
      this._sectionToggleHandler = event => {
        const { songIndex, sectionIndex } = event
        if (typeof songIndex !== 'number' || typeof sectionIndex !== 'number') {
          return
        }
        const component = this._getSongSectionComponent(songIndex, sectionIndex)
        const details = component?.getDetailsElement()
        if (details) {
          this.animateSectionToggle(songIndex, sectionIndex, details)
        }
      }
      container.addEventListener(SectionToggleEvent.type, this._sectionToggleHandler)
    }
  }

  updateKeySelector(selectedKey) {
    const keySelector = this.root.querySelector('#key-selector')
    if (!keySelector) return

    // Get available keys rotated around the selected key
    const keys = getAvailableKeys(selectedKey)

    // Get original key from current song
    let originalKey = null
    if (this.currentSongIndex >= 0 && this.songs[this.currentSongIndex]) {
      originalKey = this.songs[this.currentSongIndex].originalKey
    }

    // Update component properties
    keySelector.value = selectedKey
    keySelector.keys = keys
    keySelector.originalKey = originalKey
    keySelector.editMode = document.body.classList.contains('edit-mode')
  }

  updateCapoSelector(value, currentKey = null) {
    if (!this._capoEnabled) return
    const capoSelector = this.root.querySelector('#capo-selector')
    if (!capoSelector) return
    capoSelector.value = this._normalizeCapoValue(value)
    capoSelector.referenceKey = currentKey || this._currentKeyForCapo || ''
    this._currentKeyForCapo = capoSelector.referenceKey
    capoSelector.editMode = document.body.classList.contains('edit-mode')
  }

  setupKeySelector() {
    const keySelector = this.root.querySelector('#key-selector')
    if (!keySelector) return

    if (!this._keyChangeHandler) {
      this._keyChangeHandler = async e => {
        const newKey = e.value
        await this.handleKeyChange(newKey)
      }
      keySelector.addEventListener(KeyChangeEvent.type, this._keyChangeHandler)
    }

    // Initialize with current song's key
    if (this.currentSongIndex >= 0 && this.songs[this.currentSongIndex]) {
      const currentKey = this.songs[this.currentSongIndex].currentKey
      if (currentKey) {
        this.updateKeySelector(currentKey)
      }
    }
  }

  setupCapoSelector() {
    const capoSelector = this.root.querySelector('#capo-selector')
    if (!capoSelector) return

    if (!this._capoEnabled) {
      return
    }

    if (!this._capoChangeHandler) {
      this._capoChangeHandler = event => {
        const newValue = event.value
        this.handleCapoChange(newValue)
      }
      capoSelector.addEventListener(CapoChangeEvent.type, this._capoChangeHandler)
    }

    const currentSong = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null
    const currentCapo = currentSong?.currentCapo || 0
    this.updateCapoSelector(currentCapo, currentSong?.currentKey || null)
  }

  updateSongSettingsPopover() {
    const songSettingsPopover = this.root.querySelector('#song-settings-popover')
    if (!songSettingsPopover) return

    const song = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null
    if (!song) return

    // Update BPM value
    songSettingsPopover.bpmValue = song.currentBPM || 120
  }

  async handleBPMChange(newValue) {
    if (this.currentSongIndex < 0) return
    const song = this.songs[this.currentSongIndex]
    if (!song || song.currentBPM === newValue) return

    console.log(`BPM changed to: ${newValue} for song ${this.currentSongIndex}`)

    song.currentBPM = newValue

    // Use SongModel to persist the change
    const { createSetlistSongModel } = await import('./song-model-factory.ts')
    const model = createSetlistSongModel(
      song,
      song._setlistEntry,
      song._canonicalSong,
      this.currentSetlistId,
      this.db,
      this.db.organisationId
    )
    model.setTempo(newValue)
    await model.save()

    console.log('[SongModel] Saved BPM change via model:', newValue)

    // Update the musical metadata display with the new BPM
    const musicalMetadata = this.root.querySelector('#musical-metadata')
    if (musicalMetadata) {
      musicalMetadata.bpm = newValue
    }

    // Update the song settings popover
    this.updateSongSettingsPopover()

    // Notify media player so it refreshes tempo data
    if (this.songs[this.currentSongIndex]) {
      this.dispatchSongChange(this.songs[this.currentSongIndex])
    }
  }

  async handleCapoChange(newValue) {
    if (!this._capoEnabled || this.currentSongIndex < 0) return
    const normalized = this._normalizeCapoValue(newValue)
    const song = this.songs[this.currentSongIndex]
    if (!song || song.currentCapo === normalized) return

    song.currentCapo = normalized

    // Use SongModel to persist the change
    const { createSetlistSongModel } = await import('./song-model-factory.ts')
    const model = createSetlistSongModel(
      song,
      song._setlistEntry,
      song._canonicalSong,
      this.currentSetlistId,
      this.db,
      this.db.organisationId
    )
    model.setCapo(normalized)
    await model.save()

    console.log('[SongModel] Saved capo change via model:', normalized)

    this.updateCapoSelector(normalized, song.currentKey)
    this._updateSongDisplayCapo(this.currentSongIndex, normalized)

    // Update the musical metadata display with the new capo value
    const musicalMetadata = this.root.querySelector('#musical-metadata')
    if (musicalMetadata) {
      musicalMetadata.capoValue = normalized
    }

    // Update the song settings popover
    this.updateSongSettingsPopover()
  }

  async handleKeyChange(newKey) {
    if (!newKey || this.currentSongIndex < 0) return

    console.log(`Key changed to: ${newKey} for song ${this.currentSongIndex}`)

    const song = this.songs[this.currentSongIndex]
    if (!song) return

    // Update key in runtime song object
    song.currentKey = newKey

    // Use SongModel to persist the change
    const { createSetlistSongModel } = await import('./song-model-factory.ts')
    const model = createSetlistSongModel(
      song,
      song._setlistEntry,
      song._canonicalSong,
      this.currentSetlistId,
      this.db,
      this.db.organisationId
    )
    model.setKey(newKey)
    await model.save()

    console.log('[SongModel] Saved key change via model:', newKey)

    // Re-render the song with transposition
    await this.reRenderSong(this.currentSongIndex)

    // Update the key selector with the new key
    this.updateKeySelector(newKey)

    // Update the musical metadata display with the new key
    const musicalMetadata = this.root.querySelector('#musical-metadata')
    if (musicalMetadata) {
      musicalMetadata.keyValue = newKey
    }

    // Update the song settings popover
    this.updateSongSettingsPopover()

    // Notify media player so it refreshes tempo/time/key data
    if (this.songs[this.currentSongIndex]) {
      this.dispatchSongChange(this.songs[this.currentSongIndex])
    }

    // Ensure the pad for this key is cached for upcoming playback
    preloadPadKey(newKey)
  }

  async _animateSlottedContent(updateCallback) {
    const controlsSlot = this.root.querySelector('.header-controls-slot')

    // Fade out (use the controls slot to fade everything together)
    if (controlsSlot) {
      controlsSlot.style.opacity = '0'
    }

    // Wait for fade-out (300ms to match app-header)
    await new Promise(resolve => setTimeout(resolve, 300))

    // Update content (this happens while opacity is 0, so changes are invisible)
    await updateCallback()

    // Small delay to ensure DOM has updated
    await new Promise(resolve => setTimeout(resolve, 10))

    // Fade in
    if (controlsSlot) {
      controlsSlot.style.opacity = '1'
    }
  }

  applyFontSize(songIndex) {
    if (songIndex < 0 || songIndex >= this.songs.length) return

    const song = this.songs[songIndex]
    const songSection = this.root.querySelector(`#song-${songIndex}`)

    if (songSection) {
      const songContainer = songSection.querySelector('.song-content')
      if (songContainer) {
        songContainer.style.fontSize = `${song.currentFontSize}rem`
      }
    }
  }

  async resetCurrentSong() {
    console.log('[resetCurrentSong] Called - currentSongIndex:', this.currentSongIndex)
    if (this.currentSongIndex < 0 || this.currentSongIndex >= this.songs.length) {
      console.warn('[resetCurrentSong] Invalid song index, returning')
      return
    }

    const song = this.songs[this.currentSongIndex]
    console.log('[resetCurrentSong] Resetting song:', song.title)
    console.log(
      '[resetCurrentSong] Current key:',
      song.currentKey,
      'Original key:',
      song.originalKey
    )

    const originalKey = song.originalKey

    // Reset BPM to original
    song.currentBPM = song.metadata.tempo

    // Reset font size to default
    song.currentFontSize = CONFIG.DEFAULT_FONT_SIZE

    // Reset capo to 0 (using handleCapoChange to update all displays)
    if (this._capoEnabled && song.currentCapo !== 0) {
      console.log('[resetCurrentSong] Resetting capo from', song.currentCapo, 'to 0')
      await this.handleCapoChange(0)
    }

    // Reset all section states for this song
    if (this.sectionState[this.currentSongIndex]) {
      delete this.sectionState[this.currentSongIndex]
    }

    // Reapply section states (all back to default)
    this.applySectionState()

    // Apply font size
    this.applyFontSize(this.currentSongIndex)

    // Reset key last - this will handle re-rendering and updating all displays
    console.log(
      '[resetCurrentSong] Checking key reset - originalKey:',
      originalKey,
      'currentKey:',
      song.currentKey,
      'different?:',
      song.currentKey !== originalKey
    )
    if (originalKey && song.currentKey !== originalKey) {
      console.log('[resetCurrentSong] Calling handleKeyChange to reset key to:', originalKey)
      await this.handleKeyChange(originalKey)
    } else if (originalKey) {
      console.log('[resetCurrentSong] Key already correct, just updating displays')
      // Key is already correct, just update displays
      const musicalMetadata = this.root.querySelector('#musical-metadata')
      if (musicalMetadata) {
        musicalMetadata.keyValue = originalKey
        musicalMetadata.bpm = song.currentBPM || null
      }
    } else {
      console.warn('[resetCurrentSong] No original key found in metadata!')
    }

    // Save state
    this.saveState()
  }

  /**
   * A song card was dragged to a new place in the overview: move the song, in the
   * setlist and on the page, and save it.
   */
  async moveSong(startIndex, newIndex) {
    // Reorder songs in the setlist
    const movedSong = this.currentSetlist.songs.splice(startIndex, 1)[0]
    this.currentSetlist.songs.splice(newIndex, 0, movedSong)

    // Update order field for each song
    this.currentSetlist.songs.forEach((song, index) => {
      song.order = index
    })

    // Reorder runtime songs array
    const movedRuntimeSong = this.songs.splice(startIndex, 1)[0]
    this.songs.splice(newIndex, 0, movedRuntimeSong)

    // Save to database
    this.currentSetlist.modifiedDate = new Date().toISOString()
    await this.db.saveSetlist(this.currentSetlist)

    // Re-order song sections in the DOM to match new order
    const container = this.root.querySelector('.song-container')

    // Get all song sections in their current DOM order
    const songSections = Array.from(this.root.querySelectorAll('.section[id^="song-"]'))

    // The section that was at startIndex moved to newIndex
    // We need to physically move that DOM section
    const sectionToMove = songSections[startIndex]

    if (sectionToMove) {
      // Remove the section from its current position
      sectionToMove.remove()

      // Get a fresh list of sections after removal
      const remainingSections = Array.from(this.root.querySelectorAll('.section[id^="song-"]'))

      // Insert at the new position
      if (newIndex === 0) {
        // Insert at the beginning (after overview)
        const overview = this.root.querySelector('#overview')
        if (overview?.nextSibling) {
          container.insertBefore(sectionToMove, overview.nextSibling)
        } else {
          container.insertBefore(sectionToMove, container.firstChild)
        }
      } else if (newIndex >= remainingSections.length) {
        // Insert at the end
        container.appendChild(sectionToMove)
      } else {
        // Insert before the section that's currently at the target position
        const targetSection = remainingSections[newIndex]
        if (targetSection && targetSection.parentNode === container) {
          container.insertBefore(sectionToMove, targetSection)
        } else {
          container.appendChild(sectionToMove)
        }
      }

      // Now update all section IDs and data-song-index attributes to match new order
      const updatedSections = Array.from(this.root.querySelectorAll('.section[id^="song-"]'))
      updatedSections.forEach((section, index) => {
        section.id = `song-${index}`

        // Update data-song-index on all wrappers inside this section
        section.querySelectorAll('[data-song-index]').forEach(el => {
          el.dataset.songIndex = index
        })
      })

      // Re-apply section states with new indices
      this.applySectionState()

      // Re-apply font sizes
      this.songs.forEach((_song, index) => {
        this.applyFontSize(index)
      })
    }

    this._refreshOverviewComponentSongs()
  }

  toggleOverviewEditMode() {
    this.setOverviewEditMode(!this.overviewEditMode)
  }

  setOverviewEditMode(enabled) {
    if (this.overviewEditMode === enabled) {
      return
    }

    this.overviewEditMode = enabled

    // Update button state (use the header edit toggle button)
    const appHeader = this.root.querySelector('#app-header')
    if (appHeader) {
      appHeader.editMode = this.overviewEditMode
    }
    this._refreshOverviewComponentEditMode()

    // Toggle drag-drop: only enable in edit mode
    if (this.overviewEditMode) {
      this._reorder.enable()
    } else {
      this._reorder.disable()
    }

    this._initializeSongSections()
  }

  /**
   * Re-render a song after key change or text edits
   */
  async reRenderSong(songIndex) {
    if (songIndex < 0 || songIndex >= this.songs.length) return

    const song = this.songs[songIndex]
    const songEntry = this.currentSetlist.songs[songIndex]

    // Re-parse from source
    const parsed = this.parser.parse(song.sourceText)

    // Apply transposition if targetKey is set
    const targetKey = songEntry.key
    if (targetKey && targetKey !== song.originalKey) {
      transposeSong(parsed, song.originalKey, targetKey)
      parsed.metadata.key = targetKey
    }

    // Apply BPM override
    const bpmOverride = songEntry.tempo
    if (bpmOverride) {
      parsed.metadata.tempo = bpmOverride
    }

    // Normalize tempo + signature so media player gets consistent payloads
    const parsedTempoInfo = parseTempoMetadata(parsed.metadata.tempo ?? song.metadata?.tempo)
    const currentBPM = parsedTempoInfo.bpm ?? song.currentBPM ?? null
    let tempoNote = parsedTempoInfo.tempoNote ?? song.metadata?.tempoNote ?? null
    const timeSignature = parsed.metadata.time || song.metadata?.timeSignature || null

    if (!tempoNote) {
      tempoNote = '1/4'
    }
    if (timeSignature && (!tempoNote || tempoNote === '1/4')) {
      const [, denominator] = timeSignature.split('/').map(s => s.trim())
      if (denominator) {
        tempoNote = `1/${denominator}`
      }
    }

    // Update runtime song object
    song.parsed = parsed
    song.songIndex = songIndex
    song.metadata = {
      ...parsed.metadata,
      tempo: currentBPM,
      tempoNote,
      timeSignature,
    }
    song.currentKey = parsed.metadata.key
    song.currentBPM = currentBPM
    this._refreshOverviewComponentSongs()

    // Update DOM
    const songSection = this.root.querySelector(`#song-${songIndex}`)
    if (songSection) {
      const songContent = songSection.querySelector('.song-content')
      if (songContent) {
        songContent.textContent = ''
        const songDisplay = document.createElement('song-display')
        songDisplay.parsed = song.parsed
        songDisplay.songIndex = song.songIndex
        songDisplay.capo = this._capoEnabled ? song.currentCapo || 0 : 0
        songContent.appendChild(songDisplay)

        // Wait for Lit to render the shadow DOM contents
        await songDisplay.updateComplete
      }

      // Section states are now loaded from setlist_local, not from setlist modifications
      // No need to re-apply them here during re-render

      // Wait for song-section elements to be ready before initializing
      await customElements.whenDefined('song-section')
      this._initializeSongSections(songSection)

      // Re-apply font size
      const songContentEl = songSection.querySelector('.song-content')
      if (songContentEl) {
        songContentEl.style.fontSize = `${song.currentFontSize}rem`
      }
    }

    // Update header
    if (this.currentSongIndex === songIndex) {
      this.updateHeader(song)
    }
  }

  _updateSongDisplayCapo(songIndex, capoValue) {
    if (songIndex < 0) return
    const normalized = this._capoEnabled ? this._normalizeCapoValue(capoValue) : 0
    const songSection = this.root.querySelector(`#song-${songIndex}`)
    const songDisplay = songSection?.querySelector('song-display')
    if (songDisplay) {
      songDisplay.capo = normalized
    }
  }

  _normalizeCapoValue(value) {
    const num = Number(value)
    if (!Number.isFinite(num)) {
      return 0
    }
    if (num <= 0) {
      return 0
    }
    if (num >= 11) {
      return 11
    }
    return Math.round(num)
  }

  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return text.replace(/[&<>"']/g, m => map[m])
  }

  setupKeyboardNavigation() {
    document.addEventListener(
      'keydown',
      e => {
        // Leave keys alone while typing in a field (e.g. the setlist details form),
        // or in a modal, which handles its own keys (Esc closes it)
        if (isTypingInField(e) || isInModalDialog(e)) return

        // Handle Escape key to exit edit mode
        if (e.key === 'Escape') {
          const isEditMode = document.body.classList.contains('edit-mode')
          if (isEditMode) {
            e.preventDefault()
            const appHeader = this.root.querySelector('#app-header')
            if (appHeader) {
              // Trigger the edit-mode-toggle event
              appHeader.dispatchEvent(new EditModeToggleEvent())
            }
          }
          return
        }

        // Don't intercept if modifier keys are pressed (Alt, Ctrl, Meta)
        // This allows browser shortcuts like Alt+Left/Right to work
        if (e.altKey || e.ctrlKey || e.metaKey) {
          return
        }

        switch (e.key) {
          case 'ArrowLeft':
            e.preventDefault()
            // Navigate to previous song or overview
            if (this.currentSongIndex > 0) {
              this.navigateTo(this.currentSongIndex - 1)
            } else if (this.currentSongIndex === 0) {
              this.navigateTo(-1)
            }
            break
          case 'ArrowRight':
            e.preventDefault()
            // Navigate to next song
            if (this.currentSongIndex < 0 && this.songs.length > 0) {
              // From overview to first song
              this.navigateTo(0)
            } else if (
              this.currentSongIndex >= 0 &&
              this.currentSongIndex < this.songs.length - 1
            ) {
              this.navigateTo(this.currentSongIndex + 1)
            }
            break
          case 'ArrowUp': {
            e.preventDefault()
            const currentSectionUp =
              this.currentSongIndex >= 0
                ? this.root.querySelector(`#song-${this.currentSongIndex}`)
                : this.root.querySelector('#overview')
            currentSectionUp?.scrollBy({ top: -CONFIG.KEYBOARD_SCROLL_AMOUNT, behavior: 'smooth' })
            break
          }
          case 'ArrowDown': {
            e.preventDefault()
            const currentSectionDown =
              this.currentSongIndex >= 0
                ? this.root.querySelector(`#song-${this.currentSongIndex}`)
                : this.root.querySelector('#overview')
            currentSectionDown?.scrollBy({ top: CONFIG.KEYBOARD_SCROLL_AMOUNT, behavior: 'smooth' })
            break
          }
        }
      },
      { signal: this._abort.signal }
    )
  }

  setupNavigationMenu() {
    const navMenu = document.getElementById('nav-menu')

    if (!navMenu) return

    // The menu is the shell's, so these go with the abort signal when this page is disposed
    const { signal } = this._abort

    // Setup song click handler for setlist song navigation
    navMenu.addEventListener(
      MenuSongClickEvent.type,
      e => {
        const songIndex = e.index
        if (songIndex !== undefined && songIndex >= 0) {
          this.navigateTo(songIndex)
        }
      },
      { signal }
    )

    // Setup overview click handler for setlist navigation
    navMenu.addEventListener(MenuOverviewClickEvent.type, () => this.navigateTo(-1), { signal })

    this.updateNavigationMenu()
  }

  /** The menu lists the setlist's songs, and links to the overview from a song */
  updateNavigationMenu() {
    const navMenu = document.getElementById('nav-menu')
    if (!navMenu) return

    if (this.songs?.length > 0) {
      navMenu.songs = this.songs

      // Set setlist title (name if available, otherwise date and type)
      if (this.currentSetlist) {
        if (this.currentSetlist.name) {
          navMenu.setlistTitle = this.currentSetlist.name
        } else {
          const datePart = formatSetlistDate(this.currentSetlist.date, 'short')
          const typePart = this.currentSetlist.type ? ` - ${this.currentSetlist.type}` : ''
          navMenu.setlistTitle = datePart + typePart
        }
      }
    } else {
      navMenu.songs = []
      navMenu.setlistTitle = 'Setlist'
    }

    // When viewing a song, show Overview in the setlist section
    navMenu.showOverviewLink = this.currentSongIndex >= 0
  }

  async addSongToSetlist(song) {
    try {
      // Get current setlist
      const setlist = this.currentSetlist
      if (!setlist) {
        console.error('No current setlist')
        return
      }

      // Create new song entry using new schema with explicit snapshot
      // Key and tempo are explicitly set from canonical song (snapshot in time)
      const songCurrentKey = song?.key || song?.metadata?.key || song?.parsed?.metadata?.key || null
      const songCurrentTempo = song?.tempo || song?.metadata?.tempo || null

      const newSongEntry = {
        order: setlist.songs.length,
        songId: song.id,
        key: songCurrentKey, // Explicit snapshot of canonical key
        tempo: songCurrentTempo, // Explicit snapshot of canonical tempo
        notes: '',
        chordproEdits: null,
      }

      // Preload pads for the song's current key in the background
      if (songCurrentKey) {
        preloadPadKey(songCurrentKey)
      }

      // Add to setlist
      setlist.songs.push(newSongEntry)
      setlist.modifiedDate = new Date().toISOString()

      // Save to database
      await this.db.saveSetlist(setlist)

      console.log('Added song to setlist:', song.title, 'with current key:', songCurrentKey)

      this._addSongModal.close()

      // Reload the setlist to show the new song
      await this.renderSetlist(setlist.id)
    } catch (error) {
      console.error('Error adding song to setlist:', error)
      alert('Failed to add song to setlist. Please try again.')
    }
  }

  async showDeleteSongConfirmation(index, song) {
    this.root.querySelector('#delete-song-title').textContent = song.title
    // ask() settles on confirm, cancel or close, leaving no listener behind: a
    // confirm handler left by a cancelled ask would delete a second song later
    if (await this.root.querySelector('#delete-song-modal').ask()) {
      await this.deleteSongFromSetlist(index)
    }
  }

  async changeSongKeyInSetlist(index, newKey) {
    const setlist = this.currentSetlist
    if (!setlist?.songs?.[index]) return

    setlist.songs[index].key = newKey
    setlist.modifiedDate = new Date().toISOString()
    await this.db.saveSetlist(setlist)

    await this.renderSetlist(setlist.id)
  }

  async deleteSongFromSetlist(index) {
    try {
      const setlist = this.currentSetlist
      if (!setlist) {
        console.error('No current setlist')
        return
      }

      // Remove song from array
      setlist.songs.splice(index, 1)

      // Update order for remaining songs
      setlist.songs.forEach((song, i) => {
        song.order = i
      })

      setlist.modifiedDate = new Date().toISOString()

      // Save to database
      await this.db.saveSetlist(setlist)

      console.log('Deleted song from setlist at index:', index)

      // Reload the setlist
      await this.renderSetlist(setlist.id)
    } catch (error) {
      console.error('Error deleting song from setlist:', error)
      alert('Failed to delete song. Please try again.')
    }
  }

  _handleSectionDefaultsChanged() {
    this._sectionDefaultsCache = null
    this._sectionDefaultsRaw = null
    if (this.currentSongIndex === undefined) {
      return
    }
    this.applySectionState()
  }

  _handleCapoPreferenceChange() {
    const previous = this._capoEnabled
    this._capoEnabled = this._readCapoPreference()
    if (previous === this._capoEnabled) {
      return
    }
    this._applyCapoPreferenceToDisplays()
  }

  _applyCapoPreferenceToDisplays() {
    const capoSelector = this.root.querySelector('#capo-selector')
    const currentSong = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null
    if (capoSelector) {
      if (this._capoEnabled && currentSong) {
        this.updateCapoSelector(currentSong.currentCapo ?? 0, currentSong.currentKey)
      } else {
        capoSelector.referenceKey = ''
      }
    }

    const songDisplays = this.root.querySelectorAll('song-display')
    songDisplays.forEach(display => {
      const attrIndex = Number(display.getAttribute('song-index'))
      const fallbackIndex =
        Number.isNaN(attrIndex) && typeof display.songIndex === 'number'
          ? display.songIndex
          : attrIndex
      const index = Number.isNaN(fallbackIndex) ? -1 : fallbackIndex
      if (this._capoEnabled && index >= 0 && this.songs[index]) {
        display.capo = this.songs[index].currentCapo || 0
      } else {
        display.capo = 0
      }
    })
  }
}
