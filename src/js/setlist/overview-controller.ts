/**
 * The setlist page's overview: its <setlist-overview>, and its edit mode, in which the songs are
 * reordered by dragging (OverviewReorder) and their keys and tempos changed, and songs are added
 * and removed. What a change does to the setlist is the page's (OverviewHost); this is where the
 * overview's events are heard, and its edit mode kept.
 */
import type { AppHeader } from '../../components/app-header.ts'
import {
  OverviewAddSongEvent,
  OverviewSongBpmChangeEvent,
  OverviewSongClickEvent,
  OverviewSongDeleteEvent,
  OverviewSongKeyChangeEvent,
  type SetlistOverview,
} from '../../components/setlist-overview.ts'
import { OverviewReorder } from './overview-reorder.ts'
import type { RuntimeSong } from './runtime-songs.ts'

/** What the overview asks of the page it is in */
export interface OverviewHost {
  readonly root: HTMLElement
  readonly songs: RuntimeSong[]
  readonly sections: { applyAll(): void }
  /** Show a song (or the overview, -1) */
  navigateTo(index: number): void
  /** Ask whether to take a song out of the setlist, and do */
  showDeleteSongConfirmation(index: number, song: RuntimeSong): Promise<void>
  /** Offer songs to add */
  addSong(): void
  changeSongKeyInSetlist(index: number, key: string): Promise<void>
  changeSongBpmInSetlist(index: number, bpm: number): Promise<void>
  moveSong(from: number, to: number): Promise<void>
}

export class OverviewController {
  host: OverviewHost
  /** The overview being shown, once the setlist has been */
  component: SetlistOverview | null = null
  /** Whether the overview is in edit mode */
  editMode = false
  reorder: OverviewReorder
  /** Ends the listening to the overview being shown */
  #listening: AbortController | null = null

  constructor(host: OverviewHost) {
    this.host = host
    this.reorder = new OverviewReorder({
      root: host.root,
      isEnabled: () => this.editMode,
      onMove: (from, to) => host.moveSong(from, to),
    })
  }

  /** A new overview for these songs, listened to (in place of the one before) */
  create(songs: RuntimeSong[]): SetlistOverview {
    const component = document.createElement('setlist-overview')
    component.songs = songs
    component.editMode = this.editMode
    this.attach(component)
    return component
  }

  /** Listen to this overview, and no longer to the one before; null when there is none */
  attach(component: SetlistOverview | null) {
    this.#listening?.abort()
    this.#listening = null
    this.component = component
    if (!component) return

    this.#listening = new AbortController()
    const { signal } = this.#listening
    const { host } = this
    component.addEventListener(
      OverviewSongClickEvent.type,
      ({ index }) => {
        if (typeof index === 'number') host.navigateTo(index)
      },
      { signal }
    )
    component.addEventListener(
      OverviewSongDeleteEvent.type,
      ({ index }) => {
        if (typeof index === 'number' && host.songs[index]) {
          void host.showDeleteSongConfirmation(index, host.songs[index])
        }
      },
      { signal }
    )
    component.addEventListener(OverviewAddSongEvent.type, () => host.addSong(), { signal })
    component.addEventListener(
      OverviewSongKeyChangeEvent.type,
      ({ index, key }) => {
        if (typeof index === 'number' && key) void host.changeSongKeyInSetlist(index, key)
      },
      { signal }
    )
    component.addEventListener(
      OverviewSongBpmChangeEvent.type,
      ({ index, bpm }) => void host.changeSongBpmInSetlist(index, bpm),
      { signal }
    )
  }

  /** The songs changed (moved, re-rendered): show them */
  refreshSongs() {
    if (this.component) this.component.songs = [...this.host.songs]
  }

  toggleEditMode() {
    this.setEditMode(!this.editMode)
  }

  /** Turn edit mode on or off: the header's toggle, the overview, dragging, and the sections show it */
  setEditMode(enabled: boolean) {
    if (this.editMode === enabled) return
    this.editMode = enabled

    const appHeader = this.host.root.querySelector<AppHeader>('#app-header')
    if (appHeader) appHeader.editMode = enabled
    if (this.component) this.component.editMode = enabled
    // (songs are dragged only in edit mode)
    if (enabled) this.reorder.enable()
    else this.reorder.disable()

    this.host.sections.applyAll()
  }

  /** The overview was drawn again: dragging works again if it is in edit mode */
  resume() {
    if (this.editMode) this.reorder.enable()
  }

  /** The page is left: stop listening, and any drag in progress */
  dispose() {
    this.reorder.disable()
    this.attach(null)
  }
}
