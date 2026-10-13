import { type AppModal, ModalCloseEvent } from '../../components/app-modal.ts'
import { SongSelectEvent } from '../../components/song-list.ts'
import type { SongWithContent } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import { addToLibrary, getSongsElsewhere, withSongsFromElsewhere } from '../other-songs.ts'
import { getLibrarySongs } from '../song-utils.ts'
import { filterSongs } from '../utils/song-filter.ts'
import { showStatusMessage } from '../utils/status-message.ts'

/**
 * The "Add song" modal of a setlist: the library's songs, searchable, to choose one. Songs
 * from the device's other databases (received in shared setlists, other organisations) are
 * listed too; choosing one adds it to the library first.
 * Works with the elements the setlist view has for it, found in `root`:
 * #add-song-modal (an <app-modal>), #add-song-search-input and #add-song-results.
 */
export class AddSongModal {
  #root: Element
  #getDb: () => ChordlessDB
  #onPick: (song: SongWithContent) => void
  #getElsewhere: (dbName: string) => Promise<SongWithContent[]>

  /**
   * @param options.root where the modal's elements are
   * @param options.getDb the organisation's database
   * @param options.onPick a song was chosen; the modal stays open until close() is called
   * @param options.getElsewhere the songs of the device's other databases (for tests to replace)
   */
  constructor({
    root,
    getDb,
    onPick,
    getElsewhere = getSongsElsewhere,
  }: {
    root: Element
    getDb: () => ChordlessDB
    onPick: (song: SongWithContent) => void
    getElsewhere?: (dbName: string) => Promise<SongWithContent[]>
  }) {
    this.#root = root
    this.#getDb = getDb
    this.#onPick = onPick
    this.#getElsewhere = getElsewhere
  }

  get #modal(): AppModal | null {
    return this.#root.querySelector<AppModal>('#add-song-modal')
  }

  get #input(): HTMLInputElement | null {
    return this.#root.querySelector<HTMLInputElement>('#add-song-search-input')
  }

  get #results(): HTMLElement | null {
    return this.#root.querySelector<HTMLElement>('#add-song-results')
  }

  /** Show the library to choose from */
  async open(): Promise<void> {
    const modal = this.#modal
    const input = this.#input
    const results = this.#results
    if (!modal || !input || !results) return

    try {
      showStatusMessage(results, { message: 'Loading songs...', state: 'loading' })

      const db = this.#getDb()
      const songs = withSongsFromElsewhere(
        await getLibrarySongs(db),
        await this.#getElsewhere(db.dbName)
      )
      if (songs.length === 0) {
        showStatusMessage(results, {
          message: 'No songs in library',
          detail: 'Import songs from the menu to fill the song library.',
          state: 'empty',
        })
        modal.show()
        return
      }

      input.value = ''
      this.#renderResults(songs)
      modal.show()

      // Focus search input and wire events when modal opens successfully
      setTimeout(() => input.focus(), 100)

      // Filtering lasts as long as the modal is open
      const listening = new AbortController()
      input.addEventListener(
        'input',
        event => this.#renderResults(filterSongs(songs, (event.target as HTMLInputElement).value)),
        {
          signal: listening.signal,
        }
      )
      modal.addEventListener(ModalCloseEvent.type, () => listening.abort(), { once: true })
    } catch (error) {
      console.error('[Add Song Modal] Error loading songs:', error)
      showStatusMessage(results, {
        message: 'Error loading songs. Please try again.',
        state: 'error',
      })
      modal.show()
    }
  }

  close(): void {
    this.#modal?.close()
  }

  async #pick(song: SongWithContent): Promise<void> {
    try {
      this.#onPick(song.source ? await addToLibrary(song, this.#getDb()) : song)
    } catch (error) {
      console.error('[Add Song Modal] Could not add the song to the library:', error)
      const results = this.#results
      if (results)
        showStatusMessage(results, { message: 'Could not add the song.', state: 'error' })
    }
  }

  #renderResults(songs: SongWithContent[]): void {
    const results = this.#results
    if (!results) return
    results.textContent = ''

    const songList = document.createElement('song-list')
    songList.songs = songs
    songList.variant = 'library'
    songList.emptyMessage = 'No songs match your search.'
    songList.dense = true
    songList.addEventListener(SongSelectEvent.type, event => {
      const { song } = event
      if (song) this.#pick(song)
    })
    results.appendChild(songList)
  }
}
