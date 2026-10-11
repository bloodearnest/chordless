import { type AppModal, ModalCloseEvent } from '../../components/app-modal.ts'
import { SongSelectEvent } from '../../components/song-list.ts'
import type { SongWithContent } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import { getLibrarySongs } from '../song-utils.ts'
import { filterSongs } from '../utils/song-filter.ts'
import { showStatusMessage } from '../utils/status-message.ts'

/**
 * The "Add song" modal of a setlist: the library's songs, searchable, to choose one.
 * Works with the elements the setlist view has for it, found in `root`:
 * #add-song-modal (an <app-modal>), #add-song-search-input and #add-song-results.
 */
export class AddSongModal {
  #root: Element
  #getDb: () => ChordlessDB
  #onPick: (song: SongWithContent) => void

  /**
   * @param options.root where the modal's elements are
   * @param options.getDb the organisation's database
   * @param options.onPick a song was chosen; the modal stays open until close() is called
   */
  constructor({
    root,
    getDb,
    onPick,
  }: {
    root: Element
    getDb: () => ChordlessDB
    onPick: (song: SongWithContent) => void
  }) {
    this.#root = root
    this.#getDb = getDb
    this.#onPick = onPick
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

      const songs = await getLibrarySongs(this.#getDb())
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
      if (song) this.#onPick(song)
    })
    results.appendChild(songList)
  }
}
