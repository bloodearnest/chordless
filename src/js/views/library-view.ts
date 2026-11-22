/**
 * The song library: a searchable list of songs, and the song you open from it.
 * The list and the song sit side by side in a scroll-snap container: opening a
 * song scrolls to it, and swiping back to the list closes it.
 *
 * Which song is open comes from the route (/songs/<uuid>): choosing a song
 * navigates there, and the view shows what the route says. Uses song-view-manager
 * for rendering, and the LibrarySong model for saving.
 */

import { Task } from '@lit/task'
import type { PropertyValues } from 'lit'
import { html, nothing } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import type { AppHeader } from '../../components/app-header.ts'
import { t } from '../text.ts'
import '../../components/app-header.ts'
import type { AppModal } from '../../components/app-modal.ts'
import '../../components/app-modal.ts'
import type { KeyChangeEvent, KeySelector } from '../../components/key-selector.ts'
import '../../components/key-selector.ts'
import type { LeftOutChangeEvent } from '../../components/library-space-filter.ts'
import '../../components/library-space-filter.ts'
import '../../components/song-card.ts'
import '../../components/song-display.ts'
import type { SongInfoDialog, SongRangeChangedEvent } from '../../components/song-info-dialog.ts'
import type { SongVersionsChangedEvent } from '../../components/song-versions.ts'
import '../../components/song-info-dialog.ts'
import type { SongSelectEvent } from '../../components/song-list.ts'
import '../../components/song-list.ts'
import type {
  SectionActionEvent,
  SectionToggleEvent,
  SongSection,
} from '../../components/song-section.ts'
import '../../components/song-section.ts'
import '../../components/status-message.ts'
import { findSong, openDefaultSpace, withSpace } from '../all-spaces.ts'
import type { HideMode, ParsedChart, SectionState, SongWithContent } from '../data-types.ts'
import { watchData } from '../data-watcher.ts'
import { type ChordlessDB, openSpace } from '../db.ts'
import { filterByPlace, loadLeftOut, placesOf, saveLeftOut } from '../library-spaces.ts'
import { goTo } from '../navigation.ts'
import {
  addToLibrary,
  getSharedSongs,
  getSongFromAnywhere,
  withSongsFromElsewhere,
  withSpaceName,
} from '../other-songs.ts'
import { getDevicePitchUp, PitchControlsEvent, PitchPreferenceEvent } from '../preferences.ts'
import { buildUrl, type Route } from '../router.ts'
import { attachCues, scoreWithKey, shownSheet, showScore } from '../score-shown.ts'
import { isEditMode, setBodyEditMode } from '../setlist/edit-mode-ui.ts'
import { createLibrarySongModel } from '../song-model-factory.ts'
import { setSongUserPref } from '../song-user-prefs.ts'
import { getLibrarySongs } from '../song-utils.ts'
import * as SongViewManager from '../song-view-manager.ts'
import { listSpaces } from '../space.ts'
import { getAvailableKeys, transposeKeyName, transposeSong } from '../transpose.ts'
import { filterSongs, warmSearch } from '../utils/song-filter.ts'
import { PageView, type ViewState } from './page-view.ts'

export class LibraryView extends PageView {
  /** The pause in typing before the search goes in the URL (a property for tests to shorten) */
  static searchPauseMs = 250

  static override properties = {
    ...PageView.properties,
    _search: { state: true },
    _heading: { state: true },
    _source: { state: true },
    _leftOut: { state: true },
  }

  declare _search: string
  declare _heading: string
  /** Where the open song is from, if not this space's library */
  declare _source: string
  /** The ids of the spaces whose songs are left out of the list */
  declare _leftOut: string[]

  #libraryList = createRef<HTMLElement>()
  #songView = createRef<HTMLElement>()
  #content = createRef<HTMLElement>()
  #infoDialog = createRef<SongInfoDialog>()
  #resetModal = createRef<AppModal>()

  // The open song
  #openUuid: string | null = null
  #song: SongWithContent | null = null
  #parsed: ParsedChart | null = null
  #key: string | undefined = undefined
  #syncing = 0

  constructor() {
    super()
    this._search = ''
    this._heading = t('menu-library')
    this._source = ''
    this._leftOut = loadLeftOut()
    // Songs, their charts or the setlists using them were written (by the page, a sync, another
    // tab): the list is as it is now (the old one stays until then)
    watchData(this, ['song', 'chart', 'setlist'], () => void this.#songs.run())
  }

  /**
   * The library, by title, each song with when it was last used; and the songs of the device's
   * other databases (shared setlists, other spaces) that it doesn't have
   */
  #songs = new Task(this, {
    task: async () => {
      // Every space's songs, each in its own space; what was received in shared setlists comes after,
      // for the ones no space has
      const spaces = await listSpaces()
      const own = (
        await Promise.all(
          spaces.map(async space =>
            withSpaceName(
              await withSpace(space.id, db =>
                getLibrarySongs(db, { withLastUsage: true, allVariants: true })
              ),
              spaces.length,
              space.name,
              space.id
            )
          )
        )
      ).flat()
      const songs = withSongsFromElsewhere(own, await getSharedSongs())
      this.#spaceNames = new Map(spaces.map(space => [space.id, space.name]))
      warmSearch(songs)
      return songs
    },
    args: () => [],
  })

  /** The names of the spaces, for the filter bar (kept as the list is loaded) */
  #spaceNames: ReadonlyMap<string, string> = new Map()

  /**
   * The database a song is in: its own space's. A song received in a shared setlist is in none:
   * it is the default space's library that adds it (the library it is copied into)
   */
  async #dbFor(song: SongWithContent): Promise<ChordlessDB> {
    return song.spaceId && !song.source ? openSpace(song.spaceId) : this.#libraryDB()
  }

  /** The default space's database (or the first one that can be written to) */
  async #libraryDB(): Promise<ChordlessDB> {
    return openDefaultSpace()
  }

  // ==================== Lifecycle ====================

  /** How far down the list was scrolled (what was searched for is in the URL) */
  override captureViewState(): ViewState {
    return { scroll: this.#libraryList.value?.scrollTop }
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('route')) this.#searchFromRoute()
  }

  override firstUpdated(): void {
    // Opened on a song: show it straight away, without sliding in from the list
    if (this.#route.songUuid) {
      this.#scrollTo(this.#songView.value, 'instant')
    }
    this.#observeScrollBack()
    this.restoreScroll(this.#libraryList.value, this.restoredState?.scroll)
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has('route')) {
      void this.#syncSong()
      this.#melodyFromRoute()
    }
  }

  // ==================== Melody ====================

  /** The open song is shown as its melody sheet and not its lyrics: `?melody` in the URL */
  #melodyOn = false

  /** A route that asks for the other mode (the button, a link, back) changes it, for the song that is open */
  #melodyFromRoute(): void {
    const on = Boolean(this.#route.melody)
    if (!this.#route.songUuid || on === this.#melodyOn || !this.#song) return
    this.#melodyOn = on
    void this.#applyMelody()
  }

  #toggleMelody(): void {
    const route = this.#route
    if (!route.songUuid) return
    this.#melodyOn = !this.#melodyOn
    void this.#applyMelody()
    const { melody: _was, ...rest } = route
    goTo(buildUrl(this.#melodyOn ? { ...rest, melody: true } : rest), { replace: true })
  }

  /** Show the open song as what its mode says: the lyrics, or the melody sheet in the key it is shown in; and the button for it */
  async #applyMelody(): Promise<void> {
    const song = this.#song
    const header = this.querySelector<AppHeader>('#library-app-header')
    const content = this.#content.value?.querySelector<HTMLElement>('.song-content')
    if (!song || !header) return
    const found = scoreWithKey(
      await (await this.#dbFor(song)).getScore(song.uuid),
      song.originalKey
    )
    // (the song may have changed while this was read)
    if (this.#song !== song) return
    if (this.#content.value) attachCues(this.#content.value, found)
    header.showMelodyToggle = true
    header.melodyUnavailable = !found
    if (!found) this.#melodyOn = false
    header.melodyMode = this.#melodyOn
    if (!content) return
    // (a horn player reads the notes at their pitch: the device's, docs/PERSONAL_LAYER.md)
    await showScore(
      content,
      this.#melodyOn && found
        ? { ...found, songKey: transposeKeyName(this.#key || found.key, getDevicePitchUp()) }
        : null
    )
  }

  override connectedCallback(): void {
    super.connectedCallback()
    // The device's instrument pitch changed: a lead sheet that is shown is engraved again at it
    window.addEventListener(PitchPreferenceEvent.type, this.#onPitch)
    window.addEventListener(PitchControlsEvent.type, this.#onPitch)
  }

  #onPitch = (): void => {
    if (this.#melodyOn) void this.#applyMelody()
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    window.removeEventListener(PitchPreferenceEvent.type, this.#onPitch)
    window.removeEventListener(PitchControlsEvent.type, this.#onPitch)
    clearTimeout(this.#searchTimeout)
    this.#syncing++
    // Edit mode is on <body>, which outlives this view
    this.#setEditMode(false)
  }

  // ==================== Route ====================

  /** The route it is shown for (the router only gives this view its own) */
  get #route(): Extract<Route, { name: 'songs' }> {
    return this.route as Extract<Route, { name: 'songs' }>
  }

  /**
   * What is searched for is in the URL (/songs?q=...), so it survives a reload, can be
   * linked to, and comes back with the back button. Typing replaces the entry, after a
   * pause (browsers limit how often the history can be changed).
   */
  #searchTimeout: ReturnType<typeof setTimeout> | undefined
  // The search this view has just put in the URL: the route that follows is its own echo
  #searchEcho: string | null = null

  #typed(value: string): void {
    this._search = value
    clearTimeout(this.#searchTimeout)
    this.#searchTimeout = setTimeout(() => {
      const search = value.trim()
      const route = this.#route
      if (route.songUuid || (route.search ?? '') === search) return
      this.#searchEcho = search
      goTo(buildUrl({ name: 'songs', search }), { replace: true })
    }, LibraryView.searchPauseMs)
  }

  /** A route that names a search other than one this view put there (a link, reload, back) sets the box */
  #searchFromRoute(): void {
    const route = this.#route
    if (route.songUuid) return
    const search = route.search ?? ''
    const echo = this.#searchEcho
    this.#searchEcho = null
    if (search === echo) return
    this._search = search
  }

  /** Show the song the route names, or the list if it names none */
  async #syncSong(): Promise<void> {
    const uuid = this.#route.songUuid ?? null
    if (uuid === this.#openUuid) return
    const sync = ++this.#syncing

    if (!uuid) {
      this.#closeSong()
      return
    }
    this.#openUuid = uuid
    try {
      const inSpace = await findSong(uuid)
      const song = inSpace
        ? { ...inSpace.song, spaceId: inSpace.space.id }
        : await getSongFromAnywhere(uuid, await this.#libraryDB())
      if (sync !== this.#syncing) return
      await this.#viewSong(song)
    } catch (error) {
      console.error('Song not found:', uuid, error)
      this.#openUuid = null
      if (sync === this.#syncing) await goTo(buildUrl({ name: 'songs' }), { replace: true })
    }
  }

  #openSong(song: SongWithContent): void {
    goTo(buildUrl({ name: 'songs', songUuid: song.uuid }))
  }

  // ==================== Scrolling between the list and the song ====================

  #scrollTo(element: Element | null | undefined, behavior: ScrollBehavior = 'smooth'): void {
    element?.scrollIntoView({ behavior, block: 'nearest', inline: 'start' })
  }

  /**
   * Swiping back to the list closes the song. `scrollend` fires once a scroll has come to rest,
   * wherever it came from; a scroll of our own ends on the song, so only a swipe ends on the list.
   */
  #observeScrollBack(): void {
    const container = this.querySelector<HTMLElement>('#songs-content-container')
    /* v8 ignore next -- the view always renders its scroll container before observing it */
    if (!container) return
    const closeOnList = () => {
      if (this.#route.songUuid && container.scrollLeft < container.clientWidth / 2) {
        goTo(buildUrl({ name: 'songs' }))
      }
    }
    if ('onscrollend' in window) {
      container.addEventListener('scrollend', closeOnList)
    } else {
      let timer: ReturnType<typeof setTimeout>
      container.addEventListener('scroll', () => {
        clearTimeout(timer)
        timer = setTimeout(closeOnList, 150)
      })
    }
  }

  // ==================== Header controls ====================

  /** The header's controls for a song, which are hidden until one is open */
  #control<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return this.querySelector<T>(`#${id}`)
  }

  #display(id: string, value: string): void {
    const element = this.#control(id)
    if (element) element.style.display = value
  }

  #showSongControls(show: boolean): void {
    this.#display('library-key-selector', show ? '' : 'none')
    this.#display('library-song-meta-header', show ? 'flex' : 'none')
    this.#showResetButton(show && this.#editMode)
  }

  /** The reset button is for edit mode, with a song open: it fades in with the page's CSS */
  #showResetButton(show: boolean): void {
    this.#display('library-reset-button', show ? '' : 'none')
    this.#control('library-reset-button')?.classList.toggle('fade-in', show)
  }

  // ==================== Single song ====================

  async #viewSong(song: SongWithContent): Promise<void> {
    this.#song = song
    this.#melodyOn = Boolean(this.#route.melody)
    this._source = song.source?.label ?? ''
    // Not the library's: nothing here changes it
    if (song.source) this.#setEditMode(false)
    if (!song.chordpro) {
      console.error('Song has no ChordPro content!', song)
      throw new Error('Song has no ChordPro content')
    }

    const { parsed } = song
    this.#parsed = parsed
    this.#key = parsed.metadata.key
    this._heading = parsed.metadata.title || 'Untitled'

    this.#showSongControls(true)
    if (parsed.metadata.key) this.#updateKeySelector(parsed.metadata.key)

    const meta: string[] = []
    if (parsed.metadata.tempo) meta.push(`${parsed.metadata.tempo} BPM`)
    if (parsed.metadata.time) meta.push(parsed.metadata.time)
    const metaHeader = this.#control('library-song-meta-header')
    if (metaHeader) metaHeader.textContent = meta.join(' • ')

    await this.#renderSong(parsed, song)

    this.#scrollTo(this.#songView.value)
  }

  #closeSong(): void {
    this.#openUuid = null
    this.#scrollTo(this.#libraryList.value)
    this.#showSongControls(false)
    this._heading = t('menu-library')
    this.#setEditMode(false)
    this.#song = null
    this.#melodyOn = false
    const header = this.querySelector<AppHeader>('#library-app-header')
    if (header) {
      header.showMelodyToggle = false
      header.melodyUnavailable = false
      header.melodyMode = false
    }
    this._source = ''
  }

  /** Render a (possibly transposed) chart into the song view, and set its sections up */
  async #renderSong(parsed: ParsedChart, song: SongWithContent): Promise<void> {
    const content = this.#content.value as HTMLElement
    // (a song shown as its lead sheet keeps it through being drawn again: its lyrics are not seen meanwhile)
    const sheet = this.#melodyOn ? shownSheet(content) : null
    // Load state before exposing interactive sections: initialization must not overwrite a
    // section change made while the database is opening.
    const db = await this.#dbFor(song)
    const model = createLibrarySongModel(song, db, db.spaceId)
    await SongViewManager.renderSongView(parsed, content, { songIndex: 0, sheet })
    SongViewManager.initializeSongSections(content, model, { editMode: this.#editMode })
    // (a song the library holds of another space has none of its melodies here, so none is shown)
    await this.#applyMelody()
  }

  // ==================== Edit mode ====================

  get #editMode(): boolean {
    return isEditMode()
  }

  #setEditMode(on: boolean): void {
    const header = this.querySelector<AppHeader>('#library-app-header')
    setBodyEditMode(on)
    if (header) header.editMode = on
    const keySelector = this.#control<KeySelector>('library-key-selector')
    if (keySelector) keySelector.editMode = on
    this.#showResetButton(on && this.#song !== null)
    this.#sections().forEach(section => {
      section.editMode = on
    })
  }

  #toggleEditMode(): void {
    if (this.#song?.source) {
      this.#setEditMode(false)
    } else if (this.#editMode) {
      this.#setEditMode(false)
      this.#saveSong()
    } else {
      this.#setEditMode(true)
    }
  }

  #sections(): SongSection[] {
    const songDisplay = this.#content.value?.querySelector('song-display')
    return [...(songDisplay?.shadowRoot?.querySelectorAll('song-section') ?? [])]
  }

  #section(index: number): SongSection | undefined {
    return this.#sections().find(section => section.getAttribute('section-index') === String(index))
  }

  async #saveSong(): Promise<void> {
    if (!this.#song) return
    try {
      const db = await this.#dbFor(this.#song)
      const model = createLibrarySongModel(this.#song, db, db.spaceId)

      if (this.#key && this.#key !== model.getKey()) {
        model.setKey(this.#key)
      }

      for (const [index, state] of Object.entries(this.#sectionDefaults())) {
        model.setSectionState(Number(index), state)
      }

      await model.save()
    } catch (error) {
      console.error('Error saving library song:', error)
    }
  }

  /** The sections not in their default state, by section index */
  #sectionDefaults(): Record<string, SectionState> {
    const defaults: Record<string, SectionState> = {}
    for (const section of this.#sections()) {
      const index = Number(section.getAttribute('section-index'))
      const { hideMode, isCollapsed, isHidden } = section
      if (hideMode !== 'none' || isCollapsed || isHidden) {
        defaults[index.toString()] = { hideMode, isCollapsed, isHidden }
      }
    }
    return defaults
  }

  // ==================== Key ====================

  #updateKeySelector(selectedKey: string): void {
    const keySelector = this.#control<KeySelector>('library-key-selector') as KeySelector
    keySelector.value = selectedKey
    keySelector.keys = getAvailableKeys(selectedKey)
    keySelector.originalKey = (this.#song?.originalKey || this.#parsed?.metadata?.key) as string
    // (the chart's range, in its own key, or the melody's when it has none)
    // (a key is only shown for the song that is open)
    const song = this.#song as SongWithContent
    const metadata = this.#parsed?.metadata
    keySelector.showRangeOf(metadata, metadata?.key as string, async () =>
      (await this.#dbFor(song)).getScore(song.uuid)
    )
    // The key is saved with the song, which a user who can only read can't change
    keySelector.editMode = this.#editMode
  }

  async #changeKey(newKey: string): Promise<void> {
    if (!newKey) return
    // Drawing the song again starts its sections from what is saved: put back what is set now
    const states = this.#sections().map(({ hideMode, isCollapsed, isHidden }) => ({
      hideMode,
      isCollapsed,
      isHidden,
    }))
    await this.#renderInKey(newKey)
    // (the song may have been closed while it was drawn again: someone changed the key and went back to the list)
    if (!this.#song) return
    this.#sections().forEach((section, index) => {
      if (states[index]) Object.assign(section, states[index])
    })
    this.#updateKeySelector(newKey)
  }

  async #renderInKey(targetKey: string | undefined): Promise<void> {
    // Transpose a copy from the song's own key: transposeSong changes the chart
    // in place, and the stored one (shared with the parse cache) must stay as is
    const parsed = structuredClone(this.#parsed as ParsedChart)
    const originalKey = parsed.metadata.key
    if (originalKey && targetKey && targetKey !== originalKey) {
      transposeSong(parsed, originalKey, targetKey)
    }
    parsed.metadata.key = targetKey
    this.#key = targetKey

    await this.#renderSong(parsed, this.#song as SongWithContent)
  }

  // ==================== Sections ====================

  #onSectionAction(event: SectionActionEvent): void {
    this.#setSectionHideMode(event.sectionIndex, event.action)
  }

  #onSectionToggle(event: SectionToggleEvent): void {
    const section = this.#section(event.sectionIndex)
    const details = section?.getDetailsElement()
    if (section && details) this.#toggleSection(section, details)
  }

  #setSectionHideMode(sectionIndex: number, mode: string): void {
    const component = this.#section(sectionIndex)
    if (!component) return

    if (mode === 'collapse') {
      const details = component.getDetailsElement()
      if (details) this.#toggleSection(component, details)
      return
    }

    const explicitShowMap: Record<string, HideMode> = {
      'show-all': 'none',
      'show-lyrics': 'chords',
      'show-chords': 'lyrics',
      'show-melody': 'melody',
      'show-none': 'hide',
    }
    const mappedMode = explicitShowMap[mode] || (mode as HideMode)
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

  #toggleSection(component: SongSection, detailsElement: HTMLDetailsElement): void {
    const closing = detailsElement.open
    component.isCollapsed = closing
    detailsElement.open = !closing
  }

  // ==================== Reset, and info ====================

  async #reset(): Promise<void> {
    if (!(await this.#resetModal.value?.ask())) return
    if (!this.#parsed || !this.#song) return

    // Back to the key it was imported in. Drawing the song starts its
    // sections from what is saved, so forget that first: they start as the defaults
    const db = await this.#dbFor(this.#song)
    setSongUserPref(this.#song.id, db.spaceId, 'sectionDefaults', undefined)
    const originalKey = this.#song.originalKey || this.#parsed.metadata.key
    await this.#renderInKey(originalKey || undefined)
    if (originalKey) this.#updateKeySelector(originalKey)
    await this.#saveSong()
  }

  /** Copy the open song, from another database, into this space's library, and open that */
  async #addToLibrary(): Promise<void> {
    // (the button is there only for a song from another database)
    const song = this.#song as SongWithContent
    try {
      const added = await addToLibrary(song, await this.#libraryDB())
      await goTo(buildUrl({ name: 'songs', songUuid: added.uuid }), { replace: true })
    } catch (error) {
      console.error('Could not add the song to the library:', error)
    }
  }

  /** The versions of a song changed (the list follows the writes): and the song may be gone, so back to the list */
  #versionsChanged(event: SongVersionsChangedEvent): void {
    if (event.songDeleted) void goTo(buildUrl({ name: 'songs' }), { replace: true })
  }

  /** The song's melody range was set in the info dialog: the key picker is given the new one */
  #rangeChanged(event: SongRangeChangedEvent): void {
    const metadata = this.#parsed?.metadata
    if (!metadata || this.#song?.id !== event.songId) return
    if (event.value) metadata.x_chordless_range = event.value
    else delete metadata.x_chordless_range
    const keySelector = this.#control<KeySelector>('library-key-selector')
    if (keySelector?.value && keySelector.value !== '-') this.#updateKeySelector(keySelector.value)
  }

  async #showInfo(): Promise<void> {
    if (!this.#parsed || !this.#song || this.#song.source) return
    const dialog = this.#infoDialog.value as SongInfoDialog
    dialog.db = await this.#dbFor(this.#song)
    await dialog.show(this.#song.id, { title: this.#parsed.metadata.title })
  }

  // ==================== Template ====================

  #leftOutChanged(event: LeftOutChangeEvent): void {
    this._leftOut = event.leftOut
    saveLeftOut(event.leftOut)
  }

  #renderList(songs: SongWithContent[]) {
    if (songs.length === 0) {
      return html`<status-message
        state="empty"
        message=${t('status-library-empty')}
        detail=${t('status-library-empty-detail')}
      ></status-message>`
    }
    const names = this.#spaceNames
    return html`<library-space-filter
        .places=${placesOf(songs, names)}
        .leftOut=${this._leftOut}
        @library-space-filter:change=${(event: LeftOutChangeEvent) => this.#leftOutChanged(event)}
      ></library-space-filter>
      <song-list
      variant="library"
      empty-message=${t('status-songs-no-match')}
      .songs=${filterSongs(filterByPlace(songs, this._leftOut, names), this._search)}
      .search=${this._search}
      @song-list:select=${(event: SongSelectEvent) => event.song && this.#openSong(event.song)}
    ></song-list>`
  }

  override render() {
    return html`
      <app-header
        id="library-app-header"
        .heading=${this._heading}
        show-edit-toggle
        show-info-button
        @app-header:edit-mode-toggle=${() => this.#toggleEditMode()}
        @app-header:melody-toggle=${() => this.#toggleMelody()}
        @app-header:info-click=${() => this.#showInfo()}
      >
        <div slot="controls" class="header-controls-slot">
          <button
            class="reset-button edit-mode-control"
            id="library-reset-button"
            aria-label=${t('settings-reset-label')}
            style="display: none"
            @click=${() => this.#reset()}
          >
            ↺
          </button>
          <key-selector
            id="library-key-selector"
            label=${t('selector-key')}
            style="display: none"
            @key-selector:change=${(event: KeyChangeEvent) => this.#changeKey(event.value)}
          ></key-selector>
          <div class="song-meta-compact" id="library-song-meta-header" style="display: none"></div>
        </div>
      </app-header>

      <main class="songs-main">
        <div class="songs-content-container" id="songs-content-container">
          <!-- The list (slides left when viewing a song) -->
          <div class="library-view" ${ref(this.#libraryList)}>
            <div class="song-library-header">
              <input
                type="search"
                id="song-search"
                class="song-search-input"
                placeholder=${t('songs-search')}
                .value=${this._search}
                @input=${(event: Event) => this.#typed((event.target as HTMLInputElement).value)}
              />
            </div>
            <div id="song-library-list" class="song-library-list">
              ${this.#songs.render({
                pending: () =>
                  this.#songs.value
                    ? this.#renderList(this.#songs.value)
                    : html`<status-message state="loading" message=${t('status-songs-loading')}></status-message>`,
                complete: songs => this.#renderList(songs),
                error: error => {
                  console.error('Error loading songs:', error)
                  return html`<status-message
                    state="error"
                    message=${t('status-songs-failed')}
                  ></status-message>`
                },
              })}
            </div>
          </div>

          <!-- The song (slides in from the right) -->
          <div id="library-song-view" class="library-song-view" ${ref(this.#songView)}>
            ${
              this._source
                ? html`<div class="song-source" id="library-song-source">
                  <span>${t('library-source-from', { source: this._source })}</span>
                  <button type="button" id="add-to-library" @click=${() => this.#addToLibrary()}>
                        ${t('library-add')}
                      </button>
                </div>`
                : nothing
            }
            <div
              id="library-song-content"
              class="library-song-content"
              ${ref(this.#content)}
              @song-section:action=${(event: SectionActionEvent) => this.#onSectionAction(event)}
              @song-section:toggle=${(event: SectionToggleEvent) => this.#onSectionToggle(event)}
            >
              <p>${t('library-select')}</p>
            </div>
          </div>
        </div>
      </main>

      <song-info-dialog
        id="library-song-info-dialog"
        ${ref(this.#infoDialog)}
        @song-versions:changed=${(event: SongVersionsChangedEvent) => this.#versionsChanged(event)}
        @song-info-dialog:range-changed=${(event: SongRangeChangedEvent) => this.#rangeChanged(event)}
      ></song-info-dialog>

      <app-modal
        id="library-reset-confirm-modal"
        type="confirm"
        heading=${t('confirm-song-reset-heading')}
        message=${t('confirm-song-reset-message-library')}
        confirm-label=${t('confirm-song-reset-button')}
        ${ref(this.#resetModal)}
      ></app-modal>
    `
  }
}
customElements.define('library-view', LibraryView)

declare global {
  interface HTMLElementTagNameMap {
    'library-view': LibraryView
  }
}
