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
import '../../components/app-header.ts'
import type { AppModal } from '../../components/app-modal.ts'
import '../../components/app-modal.ts'
import type { KeyChangeEvent, KeySelector } from '../../components/key-selector.ts'
import '../../components/key-selector.ts'
import '../../components/song-card.ts'
import '../../components/song-display.ts'
import type { SongInfoDialog } from '../../components/song-info-dialog.ts'
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
import type { HideMode, ParsedChart, SectionState, SongWithContent } from '../data-types.ts'
import { getCurrentDB } from '../db.ts'
import { goTo } from '../navigation.ts'
import {
  addToLibrary,
  getSongFromAnywhere,
  getSongsElsewhere,
  withSongsFromElsewhere,
} from '../other-songs.ts'
import { buildUrl, type Route } from '../router.ts'
import { createLibrarySongModel } from '../song-model-factory.ts'
import { setSongUserPref } from '../song-user-prefs.ts'
import { getLibrarySongs } from '../song-utils.ts'
import * as SongViewManager from '../song-view-manager.ts'
import { getAvailableKeys, transposeSong } from '../transpose.ts'
import { filterSongs } from '../utils/song-filter.ts'
import { PageView, type ViewState } from './page-view.ts'

export class LibraryView extends PageView {
  static override properties = {
    ...PageView.properties,
    _search: { state: true },
    _heading: { state: true },
    _source: { state: true },
  }

  declare _search: string
  declare _heading: string
  /** Where the open song is from, if not this organisation's library */
  declare _source: string

  #libraryList = createRef<HTMLElement>()
  #songView = createRef<HTMLElement>()
  #content = createRef<HTMLElement>()
  #infoDialog = createRef<SongInfoDialog>()
  #resetModal = createRef<AppModal>()

  #scrollObserver: IntersectionObserver | null = null
  #suppressScrollReset = false
  #scrollResetTimeout: ReturnType<typeof setTimeout> | undefined

  // The open song
  #openUuid: string | null = null
  #song: SongWithContent | null = null
  #parsed: ParsedChart | null = null
  #key: string | undefined = undefined
  #syncing = 0

  constructor() {
    super()
    this._search = ''
    this._heading = 'Song Library'
    this._source = ''
  }

  /**
   * The library, by title, each song with when it was last used; and the songs of the device's
   * other databases (shared setlists, other organisations) that it doesn't have
   */
  #songs = new Task(this, {
    task: async () => {
      const db = await getCurrentDB()
      return withSongsFromElsewhere(
        await getLibrarySongs(db, { withLastUsage: true }),
        await getSongsElsewhere(db.dbName)
      )
    },
    args: () => [],
  })

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
    if (changed.has('route')) this.#syncSong()
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    this.#scrollObserver?.disconnect()
    clearTimeout(this.#scrollResetTimeout)
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
    }, 250)
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
      const song = await getSongFromAnywhere(uuid, await getCurrentDB())
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

  /** Swiping back to the list closes the song */
  #observeScrollBack(): void {
    const list = this.#libraryList.value as HTMLElement
    this.#scrollObserver = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (this.#suppressScrollReset) continue
          if (entry.isIntersecting && entry.intersectionRatio > 0.5 && this.#route.songUuid) {
            goTo(buildUrl({ name: 'songs' }))
          }
        }
      },
      { threshold: [0.5, 1.0] }
    )
    this.#scrollObserver.observe(list)
  }

  /** Scrolling to the song passes through the list: don't take that for a swipe back */
  #suppressScrollResetTemporarily(duration = 600): void {
    this.#suppressScrollReset = true
    clearTimeout(this.#scrollResetTimeout)
    this.#scrollResetTimeout = setTimeout(() => {
      this.#suppressScrollReset = false
    }, duration)
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

    this.#suppressScrollResetTemporarily()
    this.#scrollTo(this.#songView.value)
  }

  #closeSong(): void {
    this.#openUuid = null
    this.#scrollTo(this.#libraryList.value)
    this.#showSongControls(false)
    this._heading = 'Song Library'
    this.#setEditMode(false)
    this.#song = null
    this._source = ''
  }

  /** Render a (possibly transposed) chart into the song view, and set its sections up */
  async #renderSong(parsed: ParsedChart, song: SongWithContent): Promise<void> {
    const content = this.#content.value as HTMLElement
    await SongViewManager.renderSongView(parsed, content, { songIndex: 0 })
    const db = await getCurrentDB()
    const model = createLibrarySongModel(song, db, db.organisationId)
    SongViewManager.initializeSongSections(content, model, { editMode: this.#editMode })
  }

  // ==================== Edit mode ====================

  get #editMode(): boolean {
    return document.body.classList.contains('edit-mode')
  }

  #setEditMode(on: boolean): void {
    const header = this.querySelector<AppHeader>('#library-app-header')
    document.body.classList.toggle('edit-mode', on)
    if (on) document.body.setAttribute('data-edit-mode', '')
    else document.body.removeAttribute('data-edit-mode')
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
      const db = await getCurrentDB()
      const model = createLibrarySongModel(this.#song, db, db.organisationId)

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
    const db = await getCurrentDB()
    setSongUserPref(this.#song.id, db.organisationId, 'sectionDefaults', undefined)
    const originalKey = this.#song.originalKey || this.#parsed.metadata.key
    await this.#renderInKey(originalKey || undefined)
    if (originalKey) this.#updateKeySelector(originalKey)
    await this.#saveSong()
  }

  /** Copy the open song, from another database, into this organisation's library, and open that */
  async #addToLibrary(): Promise<void> {
    // (the button is there only for a song from another database)
    const song = this.#song as SongWithContent
    try {
      const added = await addToLibrary(song, await getCurrentDB())
      await goTo(buildUrl({ name: 'songs', songUuid: added.uuid }), { replace: true })
    } catch (error) {
      console.error('Could not add the song to the library:', error)
    }
  }

  async #showInfo(): Promise<void> {
    if (!this.#parsed || !this.#song || this.#song.source) return
    const dialog = this.#infoDialog.value as SongInfoDialog
    dialog.db = await getCurrentDB()
    await dialog.show(this.#song.id, { title: this.#parsed.metadata.title })
  }

  // ==================== Template ====================

  #renderList(songs: SongWithContent[]) {
    if (songs.length === 0) {
      return html`<status-message
        state="empty"
        message="No songs in library."
        detail="Import setlists to populate the song library."
      ></status-message>`
    }
    return html`<song-list
      variant="library"
      empty-message="No songs match your search."
      .songs=${filterSongs(songs, this._search)}
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
        @app-header:info-click=${() => this.#showInfo()}
      >
        <div slot="controls" class="header-controls-slot">
          <button
            class="reset-button edit-mode-control"
            id="library-reset-button"
            aria-label="Reset song"
            style="display: none"
            @click=${() => this.#reset()}
          >
            ↺
          </button>
          <key-selector
            id="library-key-selector"
            label="Key"
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
                placeholder="Search songs by title, artist, or lyrics..."
                .value=${this._search}
                @input=${(event: Event) => this.#typed((event.target as HTMLInputElement).value)}
              />
            </div>
            <div id="song-library-list" class="song-library-list">
              ${this.#songs.render({
                pending: () =>
                  html`<status-message state="loading" message="Loading songs..."></status-message>`,
                complete: songs => this.#renderList(songs),
                error: error => {
                  console.error('Error loading songs:', error)
                  return html`<status-message
                    state="error"
                    message="Error loading songs. Please check the console."
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
                  <span>From ${this._source}: not in your library.</span>
                  <button type="button" id="add-to-library" @click=${() => this.#addToLibrary()}>
                        Add to my library
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
              <p>Select a song to view</p>
            </div>
          </div>
        </div>
      </main>

      <song-info-dialog id="library-song-info-dialog" ${ref(this.#infoDialog)}></song-info-dialog>

      <app-modal
        id="library-reset-confirm-modal"
        type="confirm"
        heading="Reset Song?"
        message="This will reset the key and all section states back to defaults. This cannot be undone."
        confirm-label="Reset"
        cancel-label="Cancel"
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
