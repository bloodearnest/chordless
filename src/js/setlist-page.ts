import {
  type AppHeader,
  EditModeToggleEvent,
  HeaderExpandToggleEvent,
  HeaderInfoClickEvent,
} from '../components/app-header.ts'
import type { AppModal } from '../components/app-modal.ts'
import { CapoChangeEvent, type CapoSelector } from '../components/capo-selector.ts'
import { KeyChangeEvent, type KeySelector } from '../components/key-selector.ts'
import {
  type MusicalMetadataDisplay,
  SongSettingsClickEvent,
} from '../components/musical-metadata-display.ts'
import { MenuOverviewClickEvent, MenuSongClickEvent, type NavMenu } from '../components/nav-menu.ts'
import { type SetlistDiffers, SetlistRevertedEvent } from '../components/setlist-differs.ts'
import {
  SetlistInfoDeleteEvent,
  type SetlistInfoDialog,
  SetlistInfoSaveEvent,
} from '../components/setlist-info-dialog.ts'
import {
  OverviewAddSongEvent,
  OverviewSongBpmChangeEvent,
  OverviewSongClickEvent,
  OverviewSongDeleteEvent,
  OverviewSongKeyChangeEvent,
  type SetlistOverview,
} from '../components/setlist-overview.ts'
import { type SetlistShare, SetlistShareChangeEvent } from '../components/setlist-share.ts'
import type { SongDisplay } from '../components/song-display.ts'
import type { SongInfoDialog } from '../components/song-info-dialog.ts'
import {
  BpmChangeEvent,
  PadSetChoiceEvent,
  SongResetClickEvent,
  type SongSettingsPopover,
} from '../components/song-settings-popover.ts'
import { DoubleClickToggleEvent, SongChangeEvent } from './app-events.ts'
import { DataChangeEvent, touches } from './data-changes.ts'
import type { Setlist, SetlistEntry, SongWithContent } from './data-types.ts'
import { type ChordlessDB, getCurrentDB, NO_CHANGE } from './db.ts'
import { getLive, goLive, isLiveSetlist, LiveChangeEvent, leaveLive } from './live.ts'
import { wantsMediaPlayer } from './media-player-loader.ts'
import { goTo, setPageTitle } from './navigation.ts'
import { listPadSets, preloadPadKey, preloadPadKeysForSongs } from './pad-set-service.ts'
import { ChordProParser } from './parser.ts'
import { getSpacePeople } from './people.ts'
import { CapoPreferenceEvent, getCapoPreference, SectionDefaultsEvent } from './preferences.ts'
import { buildUrl, type Route } from './router.ts'
import { AddSongModal } from './setlist/add-song-modal.ts'
import { enterEditMode, leaveEditMode } from './setlist/edit-mode-ui.ts'
import { listenForNavigationKeys } from './setlist/keyboard-navigation.ts'
import {
  afterMove,
  clearSetlistLocalState,
  loadSetlistLocalState,
  renumberSongs,
  saveSetlistLocalState,
} from './setlist/local-state.ts'
import { OverviewReorder } from './setlist/overview-reorder.ts'
import { buildRuntimeSongs, parseTempoMetadata, type RuntimeSong } from './setlist/runtime-songs.ts'
import { SectionController } from './setlist/section-controller.ts'
import { getSongUserPrefs, setSongUserPref } from './song-user-prefs.ts'
import { syncsBack } from './space.ts'
import { differsFromOfficial } from './sync/revert.ts'
import { describeSetlistChange } from './sync/setlist-diff.ts'
import { setlistContentHash } from './sync/setlist-hash.ts'
import { toast } from './toast.ts'
import { getAvailableKeys, transposeSong } from './transpose.ts'
import { normalizeCapo } from './utils/capo.ts'
import { formatSetlistDate, setlistTitle } from './utils/date-utils.ts'
import { errorMessage } from './utils/errors.ts'
import { sleep } from './utils/sleep.ts'
import { showStatusMessage } from './utils/status-message.ts'
import type { ViewState } from './views/page-view.ts'

// Configuration constants
/** Whether two entries of a setlist are the same song (a page holds a copy, and the stored setlist may have moved on) */
function sameEntry(
  a: { songId: string; songUuid?: string } | undefined,
  b: { songId: string; songUuid?: string }
): boolean {
  return a?.songId === b.songId && a?.songUuid === b.songUuid
}

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
}

/** What the page keeps of itself for when the user comes back: how far each section was scrolled */
export interface SetlistPageState extends ViewState {
  scrolls?: Record<string, number>
}

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
  root: HTMLElement
  _restoredState: SetlistPageState | undefined
  /** Where a song of this setlist is: the setlist's own route, or a share's */
  _routeFor: (songIndex: number) => Route
  /** A setlist received by link: nothing to edit, and nothing of a space's */
  _readOnly: boolean
  _setlistId: string
  /** The song the route names, until the setlist has been shown (then the page follows the route) */
  _initialSongIndex: number
  _starting = true
  _abort: AbortController
  _disposed: boolean
  db: ChordlessDB | null
  parser: ChordProParser
  /** The song being shown, -1 for the overview; NaN until the setlist has been shown */
  currentSongIndex: number
  songs: RuntimeSong[]
  currentSetlistId: string | null
  currentSetlist: Setlist | undefined
  sections: SectionController
  sectionObserver: IntersectionObserver | null
  overviewEditMode: boolean
  _overviewComponent: SetlistOverview | null
  _capoEnabled: boolean
  _capoChangeHandler: ((event: CapoChangeEvent) => void) | null
  _keyChangeHandler?: (event: KeyChangeEvent) => void
  _setlistDetailsSaveHandler?: (event: SetlistInfoSaveEvent) => void
  _setlistDeleteHandler?: (event: SetlistInfoDeleteEvent) => void
  _currentKeyForCapo: string
  _currentSongForInfo?: RuntimeSong | null
  _shareSetup = false
  _differsSetup = false
  _liveSetup = false
  _editModeSetup?: boolean
  _appHeaderEventsSetup?: boolean
  _lastVisibleSection?: string | null
  _isProgrammaticScroll?: boolean
  _programmaticScrollTimeout?: ReturnType<typeof setTimeout>
  _onSectionDefaultsChanged: () => void
  _onCapoPreferenceChange: () => void
  _onOverviewSongClick: (event: OverviewSongClickEvent) => void
  _onOverviewSongDelete: (event: OverviewSongDeleteEvent) => void
  _onOverviewAddSong: () => void
  _onLiveChange: () => void
  _onOverviewSongKeyChange: (event: OverviewSongKeyChangeEvent) => void
  _onOverviewSongBpmChange: (event: OverviewSongBpmChangeEvent) => void
  _reorder: OverviewReorder
  _addSongModal: AddSongModal

  /**
   * @param options.root the view this page is in: it looks for its elements there
   * @param options.restoredState what captureViewState() gave when the page was left, if it is
   *   being come back to
   * @param options.db the database holding the setlist, if it isn't the space's (a
   *   setlist received by link has a database of its own)
   * @param options.routeFor the route of a song (or the overview, -1) of this setlist; defaults
   *   to the setlist's own
   * @param options.readOnly for a setlist received by link
   */
  constructor({
    root,
    setlistId,
    songIndex = -1,
    restoredState = undefined,
    db = null,
    routeFor = undefined,
    readOnly = false,
  }: {
    root: HTMLElement
    setlistId: string
    songIndex?: number
    restoredState?: SetlistPageState
    db?: ChordlessDB | null
    routeFor?: (songIndex: number) => Route
    readOnly?: boolean
  }) {
    this.root = root
    this._routeFor =
      routeFor ??
      (index => ({ name: 'setlist', setlistId: this.currentSetlistId ?? '', songIndex: index }))
    this._readOnly = readOnly
    this._restoredState = restoredState
    this._setlistId = setlistId
    this._initialSongIndex = songIndex
    // Aborted by dispose(): the listeners that outlive the view are added with its signal
    this._abort = new AbortController()
    this._disposed = false
    this.db = db // Opened in start() unless given
    this.parser = new ChordProParser()
    this.currentSongIndex = Number.NaN
    this.songs = []
    this.currentSetlistId = null
    this.currentSetlist = undefined
    // Track section visibility state: { songIndex: { sectionIndex: { hideMode: 'none'|'section'|'chords'|'lyrics' } } }
    this.sections = new SectionController(this)
    this.sectionObserver = null
    this.overviewEditMode = false // Track whether overview is in edit mode
    this._overviewComponent = null
    this._capoEnabled = getCapoPreference()
    this._capoChangeHandler = null
    this._currentKeyForCapo = ''
    this._onSectionDefaultsChanged = this._handleSectionDefaultsChanged.bind(this)
    this._onCapoPreferenceChange = this._handleCapoPreferenceChange.bind(this)

    // Bind overview component event handlers once
    this._onOverviewSongClick = (event: OverviewSongClickEvent) => {
      const index = event.index
      if (typeof index === 'number') {
        this.navigateTo(index)
      }
    }

    this._onOverviewSongDelete = (event: OverviewSongDeleteEvent) => {
      const index = event.index
      if (typeof index === 'number' && this.songs[index]) {
        this.showDeleteSongConfirmation(index, this.songs[index])
      }
    }

    this._onOverviewAddSong = () => {
      this._addSongModal.open()
    }

    this._onLiveChange = () => this._refreshLiveButton()

    this._reorder = new OverviewReorder({
      root: this.root,
      isEnabled: () => this.overviewEditMode,
      onMove: (from, to) => this.moveSong(from, to),
    })

    this._addSongModal = new AddSongModal({
      root: this.root,
      getDb: () => this._database(),
      onPick: song => this.addSongToSetlist(song),
    })

    this._onOverviewSongKeyChange = (event: OverviewSongKeyChangeEvent) => {
      const { index, key } = event
      if (typeof index === 'number' && key) {
        this.changeSongKeyInSetlist(index, key)
      }
    }
    this._onOverviewSongBpmChange = (event: OverviewSongBpmChangeEvent) => {
      this.changeSongBpmInSetlist(event.index, event.bpm)
    }
  }

  /** The space's database; start() opens it */
  /** The space the setlist is in (a section's song may have preferences of the user's) */
  spaceId(): string {
    return this._database().spaceId
  }

  _database(): ChordlessDB {
    if (!this.db) throw new Error('The setlist page has not been started')
    return this.db
  }

  async start() {
    // Initialize IndexedDB with current space
    this.db ??= await getCurrentDB()

    await this.renderSetlist(this._setlistId, this._initialSongIndex)
    this._starting = false
    if (this._disposed) return

    this.setupKeyboardNavigation()
    this.setupDoubleClickToggle()
    this.setupChangedSetlists()
    this.setupNavigationMenu()

    const { signal } = this._abort
    window.addEventListener('storage', this._onSectionDefaultsChanged, { signal })
    window.addEventListener(SectionDefaultsEvent.type, this._onSectionDefaultsChanged, { signal })
    window.addEventListener('storage', this._onCapoPreferenceChange, { signal })
    window.addEventListener(CapoPreferenceEvent.type, this._onCapoPreferenceChange, { signal })
    window.addEventListener(LiveChangeEvent.type, this._onLiveChange, { signal })
  }

  /** The route changed within this setlist: show the song it names */
  /** How far each song (and the overview) is scrolled, to put back if the user returns */
  captureViewState(): SetlistPageState | undefined {
    const scrolls: Record<string, number> = {}
    for (const section of this.root.querySelectorAll<HTMLElement>('.section')) {
      if (section.scrollTop) scrolls[section.id] = section.scrollTop
    }
    return Object.keys(scrolls).length > 0 ? { scrolls } : undefined
  }

  /** Put the sections back where they were scrolled to (once: a reload of the setlist is a fresh start) */
  _restoreScrolls() {
    const scrolls = this._restoredState?.scrolls
    this._restoredState = undefined
    for (const [id, top] of Object.entries(scrolls ?? {})) {
      const section = this.root.querySelector<HTMLElement>(`#${id}`)
      if (section) section.scrollTop = top
    }
  }

  routeChanged(route: { songIndex: number }) {
    // (back, back: the route can move on while the setlist is still loading, and what is shown
    // when it has loaded is the route as it is then)
    if (this._starting) {
      this._initialSongIndex = route.songIndex
      return
    }
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
  navigateTo(index: number, { replace = false }: { replace?: boolean } = {}) {
    return goTo(buildUrl(this._routeFor(index)), { replace })
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
    const navMenu = document.getElementById('nav-menu') as NavMenu | null
    if (navMenu) {
      navMenu.songs = []
      navMenu.setlistTitle = 'Setlist'
      navMenu.showOverviewLink = false
    }

    // Nothing is current any more (what is playing carries on)
    this.dispatchSongChange(null)
  }

  /**
   * Show the setlist as it is in the database. `songIndex` is the song to show (-1: the overview);
   * `keepSongId` is one to stay on instead, wherever it now is in the setlist, else the overview.
   */
  async renderSetlist(setlistId: string, songIndex = -1, keepSongId?: string) {
    try {
      // Load setlist from IndexedDB
      const setlist = await this._database().getSetlist(setlistId)
      // (the view can be left while this loads: back, back. A page that is gone shows nothing)
      if (this._disposed) return

      if (!setlist) {
        console.error('[ERROR] Setlist not found in IndexedDB:', setlistId)
        const container = this.root.querySelector<HTMLElement>('.song-container')
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
        this._setupShare()
        this._setupDiffers()
        this._setupLive()
        this._setOverviewComponent(null)

        // Update header to show setlist info
        this.updateHeader(null, true)

        // Header buttons (info, edit mode) must work on an empty setlist too.
        // Both are guarded, so the full setup after the first song is added is fine.
        this.setupEditMode()
        this.setupAppHeaderEvents()

        // Clear container (will show Add Song button via overview)
        const container = this._songContainer()
        container.textContent = ''
        container.appendChild(this.renderFullSetlist([]))

        // Show overview immediately
        if (songIndex >= 0) this.navigateTo(-1, { replace: true })
        requestAnimationFrame(() => {
          if (!this._disposed) this.showOverview(true)
        })

        return
      }

      // Parse each song on-demand
      const songs = await buildRuntimeSongs(setlist, {
        db: this._database(),
        parser: this.parser,
        fontSize: CONFIG.DEFAULT_FONT_SIZE,
      })
      if (this._disposed) return

      // Store songs for navigation
      this.songs = songs
      this.currentSetlistId = setlistId
      this.currentSetlist = setlist
      this._setupShare()
      this._setupDiffers()
      this._setupLive()

      // Kick off background pad caching for all keys in this setlist
      preloadPadKeysForSongs(this.songs)

      // Initialize section states (load saved overrides for this setlist)
      this.sections.states = {}
      this.loadState()

      if (keepSongId) {
        songIndex = songs.findIndex(song => song._setlistEntry.songId === keepSongId)
      }
      // Which view to start in comes from the route, as it is now; a song that isn't there means the overview
      if (this._starting) songIndex = this._initialSongIndex
      const shouldShowSongDirectly = songIndex >= 0 && songIndex < songs.length
      if (songIndex >= 0 && !shouldShowSongDirectly) this.navigateTo(-1, { replace: true })

      // Render all songs on one page
      const container = this._songContainer()
      // Clear container and append fragment
      container.textContent = ''
      const fragment = this.renderFullSetlist(songs)
      container.appendChild(fragment)
      this.sections.applyAll(container)

      // If going directly to a song, scroll to it immediately (before layout/paint)
      if (shouldShowSongDirectly) {
        const targetSection = container.querySelector(`#song-${songIndex}`) as HTMLElement
        // Set scroll position immediately, before browser paints
        // scrollTo, not scrollLeft: the stylesheet's smooth scrolling would animate that
        container.scrollTo({ left: targetSection.offsetLeft, behavior: 'instant' })
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
        this.sections.listen()

        // Apply saved state to sections
        this.sections.applyAll()

        // Set up key selector
        this.setupKeySelector()
        this.setupCapoSelector()

        // Set up Intersection Observer to auto-detect current song
        this.setupSectionObserver()

        this._restoreScrolls()
      })
    } catch (error) {
      console.error('Error loading setlist:', error)
      const container = this.root.querySelector<HTMLElement>('.song-container')
      showStatusMessage(container, {
        message: 'Error loading songs. Please check the console.',
        state: 'error',
      })
      this._setOverviewComponent(null)
    }
  }

  _songContainer(): HTMLElement {
    const container = this.root.querySelector<HTMLElement>('.song-container')
    if (!container) throw new Error('The setlist page has no song container')
    return container
  }

  _setOverviewComponent(component: SetlistOverview | null) {
    if (this._overviewComponent) {
      this._overviewComponent.removeEventListener(
        OverviewSongClickEvent.type,
        this._onOverviewSongClick
      )
      this._overviewComponent.removeEventListener(
        OverviewSongDeleteEvent.type,
        this._onOverviewSongDelete
      )
      this._overviewComponent.removeEventListener(
        OverviewAddSongEvent.type,
        this._onOverviewAddSong
      )
      this._overviewComponent.removeEventListener(
        OverviewSongKeyChangeEvent.type,
        this._onOverviewSongKeyChange
      )
      this._overviewComponent.removeEventListener(
        OverviewSongBpmChangeEvent.type,
        this._onOverviewSongBpmChange
      )
    }

    this._overviewComponent = component

    if (component) {
      component.addEventListener(OverviewSongClickEvent.type, this._onOverviewSongClick)
      component.addEventListener(OverviewSongDeleteEvent.type, this._onOverviewSongDelete)
      component.addEventListener(OverviewAddSongEvent.type, this._onOverviewAddSong)
      component.addEventListener(OverviewSongKeyChangeEvent.type, this._onOverviewSongKeyChange)
      component.addEventListener(OverviewSongBpmChangeEvent.type, this._onOverviewSongBpmChange)
    }
  }

  _refreshOverviewComponentSongs() {
    if (this._overviewComponent) {
      this._overviewComponent.songs = [...this.songs]
    }
  }

  /** Where this setlist is live: its URL, and for a share its key, which is in the fragment */
  _liveUrl(): string {
    const route = this._routeFor(-1)
    // biome-ignore lint/plugin: the share key is the link's fragment
    return buildUrl(route) + (route.name === 'share' ? location.hash : '')
  }

  /** The header's live button: red while this setlist is live, and what pressing it does */
  _refreshLiveButton() {
    const button = this.root.querySelector<HTMLElement>('#live-button')
    if (!button) return
    const live = getLive()
    const here = isLiveSetlist(live, buildUrl(this._routeFor(-1)))
    const label = here ? 'Leave live' : live ? 'Take over live here' : 'Go live'
    button.classList.toggle('live', here)
    button.setAttribute('aria-pressed', String(here))
    button.setAttribute('aria-label', label)
    button.title = label
  }

  /** Go live from the header's button, or leave, in the tap: that is the gesture fullscreen needs */
  _setupLive() {
    const button = this.root.querySelector<HTMLElement>('#live-button')
    if (!button) return
    this._refreshLiveButton()
    if (this._liveSetup) return
    this._liveSetup = true
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') {
        leaveLive()
        return
      }
      goLive(this._liveUrl(), this.currentSetlist ? setlistTitle(this.currentSetlist, 'short') : '')
    })
  }

  _refreshOverviewComponentEditMode() {
    if (this._overviewComponent) {
      this._overviewComponent.editMode = this.overviewEditMode
    }
  }

  /** The URL follows a swipe to another song or the overview (not a new history entry) */
  _replaceHistoryForSong(index: number) {
    this.navigateTo(index, { replace: true })
  }

  _replaceHistoryForOverview() {
    this.navigateTo(-1, { replace: true })
  }

  renderFullSetlist(songs: RuntimeSong[]) {
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

  showSong(index: number, instant = false) {
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
      const appHeader = this.root.querySelector<AppHeader>('#app-header')
      const keySelector = this.root.querySelector<KeySelector>('#key-selector')
      const capoSelector = this.root.querySelector<CapoSelector>('#capo-selector')
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
      this.sections.applyAll()

      // Stamp the setlist as modified (each edit saved itself as it was made)
      await this.editSetlist(() => undefined)
    }
  }

  async updateHeader(song: RuntimeSong | null, instant = false) {
    const appHeader = this.root.querySelector<AppHeader>('#app-header')
    const musicalMetadata = this.root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
    const keySelector = this.root.querySelector<KeySelector>('#key-selector')
    const capoSelector = this.root.querySelector<CapoSelector>('#capo-selector')

    // Determine new title
    let newTitle: string
    if (song) {
      newTitle = song.title
    } else {
      if (this.currentSetlist) {
        newTitle = setlistTitle(this.currentSetlist, 'short')
      } else {
        newTitle = 'Setlist'
      }
    }

    if (!appHeader) return

    if (!this._readOnly) appHeader.showEditToggle = true

    // Check if content is actually changing
    const titleChanged = appHeader.heading !== newTitle
    if (!titleChanged && !instant) {
      return // No change needed
    }

    if (instant) {
      // Instant update - no animation
      appHeader.setTitleInstant(newTitle)
      this._updateHeaderContent(song, musicalMetadata, keySelector, capoSelector)
    } else {
      // Animated update - fade out old, swap content, fade in new
      appHeader.heading = newTitle

      await this._animateSlottedContent(async () => {
        this._updateHeaderContent(song, musicalMetadata, keySelector, capoSelector)
      })
    }
  }

  _updateHeaderContent(
    song: RuntimeSong | null,
    musicalMetadata: MusicalMetadataDisplay | null,
    keySelector: KeySelector | null,
    capoSelector: CapoSelector | null
  ) {
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
          this.updateCapoSelector(song.currentCapo, song.currentKey)
        }
      }

      // Update song settings popover
      this.updateSongSettingsPopover()

      // Update musical metadata display
      if (musicalMetadata) {
        musicalMetadata.keyValue = song.currentKey || ''
        musicalMetadata.capoValue = this._capoEnabled ? (song.currentCapo ?? 0) : 0
        musicalMetadata.bpm = song.currentBPM || null
        musicalMetadata.timeSignature = song.metadata?.time || song.metadata?.timeSignature || ''
        musicalMetadata.style.display = ''
      }

      // Store current song for info button handler
      this._currentSongForInfo = song
      this._showHeaderButtons(false)
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
      this._showHeaderButtons(true)
    }
  }

  /** The header's share and live buttons: on the overview only. Share is lit while the setlist is shared */
  _showHeaderButtons(show: boolean) {
    const live = this.root.querySelector<HTMLElement>('#live-button')
    if (live) live.hidden = !show
    const differs = this.root.querySelector<HTMLElement>('#differs-button')
    if (differs) {
      differs.hidden = !(
        show &&
        this.currentSetlist &&
        differsFromOfficial(this.currentSetlist, syncsBack())
      )
    }
    const button = this.root.querySelector<HTMLElement>('#share-button')
    if (!button) return
    button.hidden = !show
    button.classList.toggle('shared', Boolean(this.currentSetlist?.share))
  }

  /** Open the "differs from official" dialog from the header's button, and show the setlist again once reverted */
  _setupDiffers() {
    const button = this.root.querySelector<HTMLElement>('#differs-button')
    const dialog = this.root.querySelector<SetlistDiffers>('#setlist-differs')
    if (!button || !dialog || !this.currentSetlist) return
    dialog.setlist = this.currentSetlist
    dialog.db = this._database()
    if (this._differsSetup) return
    this._differsSetup = true
    button.addEventListener('click', () => {
      dialog.setlist = this.currentSetlist ?? null
      dialog.show()
    })
    dialog.addEventListener(SetlistRevertedEvent.type, () => {
      if (this.currentSetlistId) void this.renderSetlist(this.currentSetlistId)
    })
  }

  /** Hand the share dialog its setlist, and open it from the header's button */
  _setupShare() {
    const button = this.root.querySelector<HTMLElement>('#share-button')
    const dialog = this.root.querySelector<SetlistShare>('#setlist-share')
    if (!button || !dialog || !this.currentSetlist) return
    dialog.setlist = this.currentSetlist
    dialog.db = this._database()
    dialog.songs = this.songs
    dialog.linkable = syncsBack()
    if (this._shareSetup) return
    this._shareSetup = true
    button.addEventListener('click', () => {
      // The page may have a newer copy of the setlist (after its details were edited)
      dialog.setlist = this.currentSetlist ?? null
      dialog.songs = this.songs
      dialog.show()
    })
    dialog.addEventListener(SetlistShareChangeEvent.type, () => {
      button.classList.toggle('shared', Boolean(dialog.setlist?.share))
    })
  }

  dispatchSongChange(song: RuntimeSong | null) {
    // Dispatch custom event for media player to listen to
    const prefs = song ? getSongUserPrefs(song.songId, this._database().spaceId) : null
    const event = new SongChangeEvent(song, {
      doubleClick: prefs?.doubleClick,
      padSetId: prefs?.padSetId,
    })
    SongChangeEvent.latest = event
    document.dispatchEvent(event)
  }

  async showSongInfo(song: RuntimeSong) {
    const dialog = this.root.querySelector<SongInfoDialog>('#song-info-dialog')
    if (!dialog) return
    dialog.db = this._database()
    await dialog.show(song.songId, { title: song.title })
  }

  async showSetlistInfo() {
    const dialog = this.root.querySelector<SetlistInfoDialog>('#setlist-info-dialog')
    if (!dialog || !this.currentSetlist) return
    if (!this._setlistDetailsSaveHandler) {
      this._setlistDetailsSaveHandler = event => this.saveSetlistDetails(event.changes)
      dialog.addEventListener(SetlistInfoSaveEvent.type, this._setlistDetailsSaveHandler)
    }
    if (!this._setlistDeleteHandler) {
      this._setlistDeleteHandler = () => this.deleteSetlist()
      dialog.addEventListener(SetlistInfoDeleteEvent.type, this._setlistDeleteHandler)
    }
    dialog.readonly = this._readOnly
    dialog.people = dialog.readonly ? [] : (await getSpacePeople()).people
    await dialog.show(this.currentSetlist)
  }

  /**
   * Delete this setlist, after asking, and go home. Only for a setlist that is not in
   * Google Drive: the dialog only offers it then, and the database refuses otherwise.
   */
  async deleteSetlist() {
    const setlist = this.currentSetlist
    if (!setlist) return
    const modal = this.root.querySelector<AppModal>('#delete-setlist-modal')
    if (!(await modal?.ask())) return
    try {
      await this._database().deleteUnsyncedSetlist(setlist.id)
    } catch (error) {
      console.error('[SetlistInfo] Failed to delete the setlist:', error)
      toast("Couldn't delete the setlist.", { kind: 'error', details: errorMessage(error) })
      return
    }
    // The section states and capos this device kept for it
    try {
      clearSetlistLocalState(setlist.id)
    } catch {
      // Storage may be unavailable; nothing else refers to it
    }
    this.root.querySelector<SetlistInfoDialog>('#setlist-info-dialog')?.close()
    await goTo(buildUrl({ name: 'home' }))
  }

  /**
   * Change the setlist as it is stored now, and stamp it as modified. The page never saves its own
   * copy back (that would undo what a sync saved since it was loaded: docs/STATE.md); it takes the
   * stored setlist, once changed, as its copy. `change` may return NO_CHANGE (the stored setlist is not as
   * this page showed it) to change nothing.
   * @returns the setlist as stored, or undefined if it is gone or `change` said false
   */
  async editSetlist(change: (setlist: Setlist) => unknown): Promise<Setlist | undefined> {
    const id = this.currentSetlistId
    if (!id) return undefined
    const stored = await this._database().updateSetlist(id, draft => {
      if (change(draft) === NO_CHANGE) return NO_CHANGE
      draft.modifiedDate = new Date().toISOString()
    })
    if (stored && !this._disposed) this.currentSetlist = stored
    return stored
  }

  /**
   * Save edited setlist details (date, time, type, name, leader) from the info
   * dialog. On failure the dialog stays in edit mode with what was typed.
   */
  async saveSetlistDetails(changes: SetlistInfoSaveEvent['changes']) {
    const dialog = this.root.querySelector<SetlistInfoDialog>('#setlist-info-dialog')
    if (!this.currentSetlist) return
    let setlist: Setlist | undefined
    try {
      setlist = await this.editSetlist(stored => void Object.assign(stored, changes))
    } catch (error) {
      console.error('[SetlistInfo] Failed to save setlist details:', error)
      toast("Couldn't save the setlist details. They are as they were.", {
        kind: 'error',
        details: errorMessage(error),
      })
      return
    }
    // (the setlist is gone)
    if (!setlist) return

    const song = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null
    this.updateHeader(song, true)
    // The menu's heading and the window's title say the setlist's date and name
    this.updateNavigationMenu()
    await dialog?.show(setlist)
  }

  scrollToSection(sectionId: string, newIndex: number, instant = false) {
    const section = this.root.querySelector<HTMLElement>(`#${sectionId}`)
    const container = this.root.querySelector<HTMLElement>('.song-container')

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

    const container = this.root.querySelector<HTMLElement>('.song-container')
    if (!container) return

    // (_lastVisibleSection, the section shown so far, is kept: the observer's first report is of
    // that section, and taking it for a scroll would write the song to the URL, over wherever the
    // router has gone since, as with back, back)

    // Observer watches which section is currently in view
    this.sectionObserver = new IntersectionObserver(
      entries => {
        // Skip if this is a programmatic scroll, or the page has gone
        if (this._isProgrammaticScroll || this._disposed) return

        // Find the most visible entry
        let mostVisible: IntersectionObserverEntry | null = null
        let maxRatio = 0

        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            mostVisible = entry
          }
        }

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
    this.root.querySelectorAll<HTMLElement>('.section').forEach(section => {
      this.sectionObserver?.observe(section)
    })
  }

  /** Load this setlist's section states and capos, as this device kept them (local-state.ts) */
  loadState() {
    const { sectionState, capoValues } = loadSetlistLocalState(
      this.currentSetlistId,
      this.songs.map(song => song._setlistEntry)
    )
    this.sections.states = sectionState
    if (this._capoEnabled) {
      for (const [songIndex, capo] of Object.entries(capoValues)) {
        const song = this.songs[Number(songIndex)]
        if (song) song.currentCapo = normalizeCapo(capo)
      }
    }

    // Apply capo defaults from song user prefs (for songs without explicit setlist override)
    this._applyCapoDefaults()
  }

  async _applyCapoDefaults() {
    if (!this._capoEnabled) return

    this.songs.forEach((song, index) => {
      // Skip if capo already set by setlist state (highest priority)
      if (song.currentCapo !== undefined && song.currentCapo !== 0) {
        return
      }

      // Get song user prefs
      const songUserPrefs = getSongUserPrefs(song.songId, this._database().spaceId)
      if (!songUserPrefs || songUserPrefs.capo === undefined) {
        return
      }

      // Only apply song prefs capo if using canonical key
      const setlistSongEntry = this.currentSetlist?.songs?.[index]
      if (!setlistSongEntry) return

      // Check if setlist key matches what the user's prefs are based on
      // We need to compare against the canonical song's current key
      // The song user prefs capo is based on the canonical key at the time they set it
      if (setlistSongEntry.key === song.currentKey) {
        // Key hasn't been changed from canonical, apply user's preferred capo
        song.currentCapo = normalizeCapo(songUserPrefs.capo)
      }
    })
  }

  /** Keep the section states and capos on this device (see loadState) */
  saveState() {
    const capoValues: Record<number, number> = {}
    if (this._capoEnabled) {
      this.songs.forEach((song, index) => {
        if (song.currentCapo !== undefined && song.currentCapo !== 0) {
          capoValues[index] = song.currentCapo
        }
      })
    }
    saveSetlistLocalState(
      this.currentSetlistId,
      { sectionState: this.sections.states, capoValues },
      this.songs.map(song => song._setlistEntry)
    )
  }

  /** The model that saves a song's changes in this setlist (loaded when first needed) */
  async _songModel(song: RuntimeSong) {
    const { createSetlistSongModel } = await import('./song-model-factory.ts')
    return createSetlistSongModel(
      song,
      song._setlistEntry,
      song._canonicalSong,
      this.currentSetlistId as string,
      this._database(),
      this._database().spaceId
    )
  }

  setupEditMode() {
    if (this._editModeSetup) return
    this._editModeSetup = true

    const appHeader = this.root.querySelector<AppHeader>('#app-header')
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
      if (!document.body.classList.contains('edit-mode')) {
        enterEditMode(this.root, appHeader, {
          capoEnabled: this._capoEnabled,
        })
        // Update all sections based on edit mode
        this.sections.applyAll()
      } else {
        // (each edit saved itself as it was made: this stamps the setlist as modified)
        leaveEditMode(this.root, appHeader, async () => {
          await this.editSetlist(() => undefined)
        })
        // Refresh song sections immediately so their controls begin fading out in sync
        this.sections.applyAll()
      }
    })
  }

  setupAppHeaderEvents() {
    if (this._appHeaderEventsSetup) return
    this._appHeaderEventsSetup = true

    const appHeader = this.root.querySelector<AppHeader>('#app-header')
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
    const musicalMetadata = this.root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
    const songSettingsPopover =
      this.root.querySelector<SongSettingsPopover>('#song-settings-popover')
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

      songSettingsPopover.addEventListener(PadSetChoiceEvent.type, e => {
        this.saveSongMediaPref('padSetId', e.value)
      })

      songSettingsPopover.addEventListener(SongResetClickEvent.type, async () => {
        // Close the settings first, so the question is the only thing showing
        songSettingsPopover.close()
        const modal = this.root.querySelector<AppModal>('#reset-confirm-modal')
        if (modal) {
          const confirmed = await modal.ask()
          if (confirmed) {
            await this.resetCurrentSong()
          }
        }
      })
    }
  }

  updateKeySelector(selectedKey: string) {
    const keySelector = this.root.querySelector<KeySelector>('#key-selector')
    if (!keySelector) return

    // Get available keys rotated around the selected key
    const keys = getAvailableKeys(selectedKey)

    // Get original key from current song
    let originalKey: string | null = null
    if (this.currentSongIndex >= 0 && this.songs[this.currentSongIndex]) {
      originalKey = this.songs[this.currentSongIndex].originalKey
    }

    // Update component properties
    keySelector.value = selectedKey
    keySelector.keys = keys
    keySelector.originalKey = originalKey ?? ''
    keySelector.editMode = document.body.classList.contains('edit-mode')
  }

  updateCapoSelector(value: unknown, currentKey: string | null | undefined = null) {
    if (!this._capoEnabled) return
    const capoSelector = this.root.querySelector<CapoSelector>('#capo-selector')
    if (!capoSelector) return
    capoSelector.value = normalizeCapo(value)
    capoSelector.referenceKey = currentKey || this._currentKeyForCapo || ''
    this._currentKeyForCapo = capoSelector.referenceKey
    capoSelector.editMode = document.body.classList.contains('edit-mode')
  }

  setupKeySelector() {
    const keySelector = this.root.querySelector<KeySelector>('#key-selector')
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
    const capoSelector = this.root.querySelector<CapoSelector>('#capo-selector')
    if (!capoSelector) return

    capoSelector.style.display = this._capoEnabled ? '' : 'none'
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

    // (no song is current on the overview: its index is -1)
    const currentSong = this.songs[this.currentSongIndex] as RuntimeSong | undefined
    this.updateCapoSelector(currentSong?.currentCapo, currentSong?.currentKey)
  }

  updateSongSettingsPopover() {
    const songSettingsPopover =
      this.root.querySelector<SongSettingsPopover>('#song-settings-popover')
    if (!songSettingsPopover) return

    const song = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null
    if (!song) return

    // Update BPM value
    songSettingsPopover.bpmValue = song.currentBPM || 120

    // This user's media choices for the song (theirs alone: not in the setlist, so a user who
    // can only read it can make them too). Shown only where the media player is
    songSettingsPopover.mediaAvailable = wantsMediaPlayer()
    if (songSettingsPopover.mediaAvailable) {
      const prefs = getSongUserPrefs(song.songId, this._database().spaceId)
      songSettingsPopover.padSetId = prefs?.padSetId
      listPadSets()
        .then(sets => {
          songSettingsPopover.padSets = sets
        })
        .catch(error => console.warn('[SongSettings] Could not list the pad sets:', error))
    }
  }

  /** Remember this user's choice for the current song, and tell the media player */
  saveSongMediaPref(name: 'doubleClick' | 'padSetId', value: boolean | string | undefined) {
    const song = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null
    if (!song) return
    if (name === 'doubleClick') {
      setSongUserPref(song.songId, this._database().spaceId, name, value as boolean)
    } else {
      setSongUserPref(song.songId, this._database().spaceId, name, value as string)
    }
    this.updateSongSettingsPopover()
    this.dispatchSongChange(song)
  }

  async handleBPMChange(newValue: number) {
    if (this.currentSongIndex < 0) return
    const song = this.songs[this.currentSongIndex]
    if (!song || song.currentBPM === newValue) return

    song.currentBPM = newValue

    // Use SongModel to persist the change
    const model = await this._songModel(song)
    model.setTempo(newValue)
    await model.save()

    // Update the musical metadata display with the new BPM
    const musicalMetadata = this.root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
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

  async handleCapoChange(newValue: unknown) {
    if (!this._capoEnabled || this.currentSongIndex < 0) return
    const normalized = normalizeCapo(newValue)
    const song = this.songs[this.currentSongIndex]
    if (!song || song.currentCapo === normalized) return

    song.currentCapo = normalized

    // Use SongModel to persist the change
    const model = await this._songModel(song)
    model.setCapo(normalized)
    await model.save()

    this.updateCapoSelector(normalized, song.currentKey)
    this._updateSongDisplayCapo(this.currentSongIndex, normalized)

    // Update the musical metadata display with the new capo value
    const musicalMetadata = this.root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
    if (musicalMetadata) {
      musicalMetadata.capoValue = normalized
    }

    // Update the song settings popover
    this.updateSongSettingsPopover()
  }

  async handleKeyChange(newKey: string) {
    if (!newKey || this.currentSongIndex < 0) return

    const song = this.songs[this.currentSongIndex]

    // Update key in runtime song object
    song.currentKey = newKey

    // Use SongModel to persist the change
    const model = await this._songModel(song)
    model.setKey(newKey)
    await model.save()

    // Re-render the song with transposition
    await this.reRenderSong(this.currentSongIndex)

    // Update the key selector with the new key
    this.updateKeySelector(newKey)

    // Update the musical metadata display with the new key
    const musicalMetadata = this.root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
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

  async _animateSlottedContent(updateCallback: () => Promise<void> | void) {
    const controlsSlot = this.root.querySelector<HTMLElement>('.header-controls-slot')

    // Fade out (use the controls slot to fade everything together)
    if (controlsSlot) {
      controlsSlot.style.opacity = '0'
    }

    // Wait for fade-out (300ms to match app-header)
    await sleep(300)

    // Update content (this happens while opacity is 0, so changes are invisible)
    await updateCallback()

    // Small delay to ensure DOM has updated
    await sleep(10)

    // Fade in
    if (controlsSlot) {
      controlsSlot.style.opacity = '1'
    }
  }

  applyFontSize(songIndex: number) {
    if (songIndex < 0 || songIndex >= this.songs.length) return

    const song = this.songs[songIndex]
    const songSection = this.root.querySelector<HTMLElement>(`#song-${songIndex}`)

    if (songSection) {
      const songContainer = songSection.querySelector<HTMLElement>('.song-content')
      if (songContainer) {
        songContainer.style.fontSize = `${song.currentFontSize}rem`
      }
    }
  }

  async resetCurrentSong() {
    if (this.currentSongIndex < 0 || this.currentSongIndex >= this.songs.length) {
      console.warn('[resetCurrentSong] Invalid song index, returning')
      return
    }

    const song = this.songs[this.currentSongIndex]

    const originalKey = song.originalKey

    // Reset BPM to original
    song.currentBPM = song.metadata.tempo

    // Reset font size to default
    song.currentFontSize = CONFIG.DEFAULT_FONT_SIZE

    // Reset capo to 0 (using handleCapoChange to update all displays)
    if (this._capoEnabled && song.currentCapo !== 0) {
      await this.handleCapoChange(0)
    }

    // Reset all section states for this song
    if (this.sections.states[this.currentSongIndex]) {
      delete this.sections.states[this.currentSongIndex]
    }

    // Reapply section states (all back to default)
    this.sections.applyAll()

    // Apply font size
    this.applyFontSize(this.currentSongIndex)

    // Reset key last - this will handle re-rendering and updating all displays
    if (originalKey && song.currentKey !== originalKey) {
      await this.handleKeyChange(originalKey)
    } else if (originalKey) {
      // Key is already correct, just update displays
      const musicalMetadata = this.root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
      if (musicalMetadata) musicalMetadata.keyValue = originalKey
    } else {
      console.warn('[resetCurrentSong] No original key found in metadata!')
    }

    // The tempo was put back above without going through handleBPMChange, so show it (the key
    // reset does not), in the settings too, and tell the media player so the click follows
    const musicalMetadata = this.root.querySelector<MusicalMetadataDisplay>('#musical-metadata')
    if (musicalMetadata) musicalMetadata.bpm = song.currentBPM || null
    this.updateSongSettingsPopover()
    this.dispatchSongChange(song)

    // Save state
    this.saveState()
  }

  /**
   * A song card was dragged to a new place in the overview: move the song, in the
   * setlist and on the page, and save it.
   */
  async moveSong(startIndex: number, newIndex: number) {
    const moving = this.currentSetlist?.songs[startIndex]
    if (!moving) return

    // Reorder songs in the setlist, as it is stored
    const saved = await this.editSetlist(stored => {
      if (!sameEntry(stored.songs[startIndex], moving)) return NO_CHANGE
      stored.songs.splice(newIndex, 0, ...stored.songs.splice(startIndex, 1))
      stored.songs.forEach((song, index) => {
        song.order = index
      })
    })
    if (!saved) {
      // It is not as this page showed it: show it as it is
      if (this.currentSetlistId) await this.renderSetlist(this.currentSetlistId)
      return
    }

    // Reorder runtime songs array
    const movedRuntimeSong = this.songs.splice(startIndex, 1)[0]
    this.songs.splice(newIndex, 0, movedRuntimeSong)

    // What was set for each song (its sections shown, its capo) goes with it
    this.sections.states = renumberSongs(this.sections.states, afterMove(startIndex, newIndex))
    this.saveState()

    // Re-order song sections in the DOM to match new order
    const container = this._songContainer()

    // Get all song sections in their current DOM order
    const songSections = Array.from(
      this.root.querySelectorAll<HTMLElement>('.section[id^="song-"]')
    )

    // The section that was at startIndex moved to newIndex
    // We need to physically move that DOM section
    const sectionToMove = songSections[startIndex]

    if (sectionToMove) {
      // Remove the section from its current position
      sectionToMove.remove()

      // Get a fresh list of sections after removal
      const remainingSections = Array.from(
        this.root.querySelectorAll<HTMLElement>('.section[id^="song-"]')
      )

      // Insert before the section now at the new position (at the end when there is none)
      container.insertBefore(sectionToMove, remainingSections[newIndex] ?? null)

      // Now update all section IDs and data-song-index attributes to match new order
      const updatedSections = Array.from(
        this.root.querySelectorAll<HTMLElement>('.section[id^="song-"]')
      )
      const displays: SongDisplay[] = []
      updatedSections.forEach((section, index) => {
        section.id = `song-${index}`

        // The song display and its sections look songs up by their index
        for (const display of section.querySelectorAll<SongDisplay>('song-display')) {
          display.songIndex = index
          displays.push(display)
        }
      })
      this.songs.forEach((song, index) => {
        song.songIndex = index
      })
      await Promise.all(displays.map(display => display.updateComplete))

      // Re-apply section states with new indices
      this.sections.applyAll()

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

  setOverviewEditMode(enabled: boolean) {
    if (this.overviewEditMode === enabled) {
      return
    }

    this.overviewEditMode = enabled

    // Update button state (use the header edit toggle button)
    const appHeader = this.root.querySelector<AppHeader>('#app-header')
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

    this.sections.applyAll()
  }

  /**
   * Re-render a song after key change or text edits
   */
  async reRenderSong(songIndex: number) {
    if (songIndex < 0 || songIndex >= this.songs.length) return

    const song = this.songs[songIndex]
    const songEntry = this.currentSetlist?.songs[songIndex]
    if (!songEntry) return

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
    let tempoNote = parsedTempoInfo.tempoNote ?? song.metadata?.tempoNote ?? '1/4'
    const timeSignature = parsed.metadata.time || song.metadata?.timeSignature || null

    if (timeSignature && tempoNote === '1/4') {
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
    const songSection = this.root.querySelector<HTMLElement>(`#song-${songIndex}`)
    if (songSection) {
      const songContent = songSection.querySelector<HTMLElement>('.song-content')
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
      this.sections.applyAll(songSection)

      // Re-apply font size
      const songContentEl = songSection.querySelector<HTMLElement>('.song-content')
      if (songContentEl) {
        songContentEl.style.fontSize = `${song.currentFontSize}rem`
      }
    }

    // Update header
    if (this.currentSongIndex === songIndex) {
      this.updateHeader(song)
    }
  }

  _updateSongDisplayCapo(songIndex: number, capoValue: unknown) {
    if (songIndex < 0) return
    const normalized = this._capoEnabled ? normalizeCapo(capoValue) : 0
    const songSection = this.root.querySelector<HTMLElement>(`#song-${songIndex}`)
    const songDisplay = songSection?.querySelector('song-display')
    if (songDisplay) {
      songDisplay.capo = normalized
    }
  }

  /** A write to this page's setlist that it did not make (a sync's, or another tab's) is followed (see applyChangedSetlist) */
  setupChangedSetlists() {
    window.addEventListener(
      DataChangeEvent.type,
      ({ change }) => {
        const id = this.currentSetlistId
        if (!id || change.spaceId !== this._database().spaceId) return
        if ((change.origin === 'sync' || change.remote) && touches(change, 'setlist', id)) {
          void this.applyChangedSetlist()
        }
      },
      { signal: this._abort.signal }
    )
  }

  /**
   * A sync saved this page's setlist: show the new version, staying on the song being viewed and
   * saying what changed. The page works on its own copy of the setlist and saves that whole copy
   * when something changes, so a copy left as it was would overwrite what came in with the next
   * edit. Where this device's own edits and Drive's were both made, Drive's version won, as in any
   * pull. A late song is never held back, live or not.
   */
  async applyChangedSetlist() {
    const before = this.currentSetlist
    if (!before) return
    const id = before.id
    const latest = await this._database().getSetlist(id)
    // (the setlist can be gone, and the view with it)
    if (this._disposed || !latest) return
    if (setlistContentHash(latest) === setlistContentHash(before)) {
      // Nothing to show: only what sync keeps of the file changed, which later saves must carry
      this.currentSetlist = latest
      return
    }

    // (what this device set for each song is kept by song, so it follows the song to its new place)
    this.saveState()

    const titles = new Map(this.songs.map(song => [song._setlistEntry.songId, song.title]))
    const viewing = this.songs[this.currentSongIndex]?._setlistEntry.songId
    await this.renderSetlist(id, -1, viewing)
    if (this._disposed) return
    for (const song of this.songs) titles.set(song._setlistEntry.songId, song.title)
    // The song being viewed is where it now is in the setlist, or it is the overview
    const index = viewing ? this.songs.findIndex(song => song._setlistEntry.songId === viewing) : -1
    this.navigateTo(index, { replace: true })

    const changes = describeSetlistChange(
      before,
      latest,
      entry => titles.get(entry.songId) ?? entry.songId
    )
    toast(
      `${setlistTitle(latest, 'short')} was updated${changes.length ? `: ${changes.join(', ')}` : ''}`
    )
  }

  /** The media player's speed button remembers the choice for the song being viewed */
  setupDoubleClickToggle() {
    document.addEventListener(
      DoubleClickToggleEvent.type,
      e => this.saveSongMediaPref('doubleClick', e.value),
      { signal: this._abort.signal }
    )
  }

  setupKeyboardNavigation() {
    listenForNavigationKeys({
      root: this.root,
      signal: this._abort.signal,
      currentIndex: () => this.currentSongIndex,
      songCount: () => this.songs.length,
      goTo: index => this.navigateTo(index),
      scrollAmount: CONFIG.KEYBOARD_SCROLL_AMOUNT,
      onEscape: () => {
        if (!document.body.classList.contains('edit-mode')) return false
        this.root.querySelector<AppHeader>('#app-header')?.dispatchEvent(new EditModeToggleEvent())
        return true
      },
    })
  }

  setupNavigationMenu() {
    const navMenu = document.getElementById('nav-menu') as NavMenu | null

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
    // The window's title (and the browser tab's) is the setlist's date, and its name if it has one
    if (this.currentSetlist) setPageTitle(setlistTitle(this.currentSetlist, 'short'))

    const navMenu = document.getElementById('nav-menu') as NavMenu | null
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

  async addSongToSetlist(song: SongWithContent) {
    try {
      const id = this.currentSetlistId
      if (!id) {
        console.error('No current setlist')
        return
      }

      // Create new song entry using new schema with explicit snapshot
      // Key and tempo are explicitly set from canonical song (snapshot in time)
      // (A library song has no top-level key or tempo: the chart's are in its metadata)
      const songCurrentKey = song.metadata?.key || song.parsed?.metadata?.key || null
      const songCurrentTempo = (song.metadata?.tempo || null) as number | null

      // Preload pads for the song's current key in the background
      if (songCurrentKey) {
        preloadPadKey(songCurrentKey)
      }

      // Add to the setlist as it is stored (nothing is changed if this cannot be saved)
      const saved = await this.editSetlist(stored => {
        stored.songs.push({
          order: stored.songs.length,
          songId: song.id,
          songUuid: song.uuid,
          key: songCurrentKey, // Explicit snapshot of canonical key
          tempo: songCurrentTempo, // Explicit snapshot of canonical tempo
          notes: '',
        })
      })
      if (!saved) return

      this._addSongModal.close()

      // Reload the setlist to show the new song
      await this.renderSetlist(id)
    } catch (error) {
      console.error('Error adding song to setlist:', error)
      toast("Couldn't add the song to the setlist.", {
        kind: 'error',
        details: errorMessage(error),
        action: { label: 'Try again', run: () => this.addSongToSetlist(song) },
      })
    }
  }

  async showDeleteSongConfirmation(index: number, song: RuntimeSong) {
    const title = this.root.querySelector<HTMLElement>('#delete-song-title')
    if (title) title.textContent = song.title
    // ask() settles on confirm, cancel or close, leaving no listener behind: a
    // confirm handler left by a cancelled ask would delete a second song later
    if (await this.root.querySelector<AppModal>('#delete-song-modal')?.ask()) {
      await this.deleteSongFromSetlist(index)
    }
  }

  async changeSongKeyInSetlist(index: number, newKey: string) {
    await this.#changeEntry(index, entry => {
      entry.key = newKey
    })
  }

  async changeSongBpmInSetlist(index: number, bpm: number) {
    await this.#changeEntry(index, entry => {
      entry.tempo = bpm
    })
  }

  /** Change the song at `index`, in the setlist as it is stored, and show it so */
  async #changeEntry(index: number, change: (entry: SetlistEntry) => void) {
    const shown = this.currentSetlist?.songs?.[index]
    if (!shown) return
    await this.editSetlist(stored => {
      const entry = stored.songs[index]
      if (!entry || !sameEntry(entry, shown)) return NO_CHANGE
      change(entry)
    })
    if (this.currentSetlistId) await this.renderSetlist(this.currentSetlistId)
  }

  async deleteSongFromSetlist(index: number) {
    try {
      const id = this.currentSetlistId
      const shown = this.currentSetlist?.songs[index]
      if (!id || !shown) {
        console.error('No current setlist')
        return
      }

      // Remove the song from the setlist as it is stored
      await this.editSetlist(stored => {
        if (!sameEntry(stored.songs[index], shown)) return NO_CHANGE
        stored.songs.splice(index, 1)
        stored.songs.forEach((entry, i) => {
          entry.order = i
        })
      })

      // (what this device set for the songs after it is kept by song, so it moves up with them)
      // Reload the setlist
      await this.renderSetlist(id)
    } catch (error) {
      console.error('Error deleting song from setlist:', error)
      toast("Couldn't remove the song from the setlist.", {
        kind: 'error',
        details: errorMessage(error),
        action: { label: 'Try again', run: () => this.deleteSongFromSetlist(index) },
      })
    }
  }

  _handleSectionDefaultsChanged() {
    if (Number.isNaN(this.currentSongIndex)) {
      return
    }
    this.sections.applyAll()
  }

  _handleCapoPreferenceChange() {
    const previous = this._capoEnabled
    this._capoEnabled = getCapoPreference()
    if (previous === this._capoEnabled) {
      return
    }
    this._applyCapoPreferenceToDisplays()
  }

  _applyCapoPreferenceToDisplays() {
    const capoSelector = this.root.querySelector<CapoSelector>('#capo-selector')
    const currentSong = this.currentSongIndex >= 0 ? this.songs[this.currentSongIndex] : null
    if (capoSelector) {
      capoSelector.style.display = this._capoEnabled ? '' : 'none'
      if (this._capoEnabled && currentSong) {
        this.updateCapoSelector(currentSong.currentCapo, currentSong.currentKey)
      } else {
        capoSelector.referenceKey = ''
      }
    }

    const songDisplays = this.root.querySelectorAll<SongDisplay>('song-display')
    songDisplays.forEach(display => {
      const song = this.songs[display.songIndex]
      if (this._capoEnabled && song) {
        display.capo = song.currentCapo || 0
      } else {
        display.capo = 0
      }
    })
  }
}
