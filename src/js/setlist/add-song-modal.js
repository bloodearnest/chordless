import { ModalCloseEvent } from '../../components/app-modal.js'
import { SongSelectEvent } from '../../components/song-list.js'
import { getLibrarySongs } from '../song-utils.js'
import { filterSongs } from '../utils/song-filter.ts'
import { showStatusMessage } from '../utils/status-message.ts'

/**
 * The "Add song" modal of a setlist: the library's songs, searchable, to choose one.
 * Works with the elements the setlist view has for it, found in `root`:
 * #add-song-modal (an <app-modal>), #add-song-search-input and #add-song-results.
 */
export class AddSongModal {
  #root
  #getDb
  #onPick

  /**
   * @param {object} options
   * @param {Element} options.root where the modal's elements are
   * @param {() => object} options.getDb the organisation's database
   * @param {(song: object) => void} options.onPick a song was chosen; the modal stays
   *   open until close() is called
   */
  constructor({ root, getDb, onPick }) {
    this.#root = root
    this.#getDb = getDb
    this.#onPick = onPick
  }

  get #modal() {
    return this.#root.querySelector('#add-song-modal')
  }

  get #input() {
    return this.#root.querySelector('#add-song-search-input')
  }

  get #results() {
    return this.#root.querySelector('#add-song-results')
  }

  /** Show the library to choose from */
  async open() {
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
        event => this.#renderResults(filterSongs(songs, event.target.value)),
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

  close() {
    this.#modal?.close()
  }

  #renderResults(songs) {
    const results = this.#results
    results.textContent = ''

    const songList = document.createElement('song-list')
    songList.songs = songs
    songList.variant = 'library'
    songList.emptyMessage = 'No songs match your search.'
    songList.dense = true
    songList.addEventListener(SongSelectEvent.type, event => {
      if (event.song) this.#onPick(event.song)
    })
    results.appendChild(songList)
  }
}
