import { Task } from '@lit/task'
import { html, LitElement } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import './app-modal.js'
import './song-info.js'
import './status-message.js'

/**
 * SongInfoDialog Component
 *
 * Modal dialog showing a song's details and where it has been played. Loads the
 * song and its usage history itself, given the song's ID.
 *
 * Usage:
 *   <song-info-dialog id="song-info-dialog"></song-info-dialog>
 *   dialog.show(songId, { title })
 *
 * The song is loaded from the current organisation's database unless `db` is
 * set. showData() shows already-loaded data (used by the dev page).
 */
export class SongInfoDialog extends LitElement {
  static properties = {
    db: { attribute: false },
    _title: { state: true },
    _data: { state: true }, // {song, appearances, loading} given to showData()
  }

  constructor() {
    super()
    this._modal = createRef()
    this.db = null
    this._title = ''
    this._data = null
    // Loads the song shown by show(). A newer run supersedes an older one, so a
    // slow load can't overwrite a newer song's details.
    this._load = new Task(this, {
      autoRun: false,
      task: async ([songId, title], { signal }) => {
        const db = this.db ?? (await (await import('../js/db.ts')).getCurrentDB())
        const { getSongById } = await import('../js/song-utils.js')
        const [song, usage] = await Promise.all([
          getSongById(songId, db),
          db.getSongUsageFromSetlists(songId),
        ])
        signal.throwIfAborted()
        return {
          song: { ...song, title: title || song.title },
          appearances: usage.map(entry => ({
            setlistId: entry.setlistId,
            date: entry.setlistDate,
            playedInKey: entry.playedInKey,
            leader: entry.leader,
            setlistName: entry.setlistName,
          })),
        }
      },
      // Only called for the latest run
      onComplete: ({ song }) => {
        this._title = song.title
      },
      onError: error => console.error('[SongInfoDialog] Could not load song:', error),
    })
  }

  /**
   * Open the dialog for a song, then load its details.
   * @param {string} songId - The song's ID (not a variant's uuid)
   * @param {object} [options]
   * @param {string} [options.title] - Title to show, e.g. the setlist's version of
   *   it. Defaults to the stored song's. Key and tempo always come from the song
   *   itself (its original), with the keys it was played in listed in its history.
   */
  async show(songId, { title = '' } = {}) {
    this._title = title
    this._data = null
    this._load.run([songId, title])
    await this._open()
  }

  /** Open the dialog with already-loaded data (dev pages) */
  async showData({ song, appearances = [], loading = false }) {
    this._load.abort()
    this._title = song?.title ?? ''
    this._data = { song, appearances, loading }
    await this._open()
  }

  close() {
    this._modal.value?.close()
  }

  async _open() {
    await this.updateComplete
    this._modal.value.show()
  }

  _renderInfo({ song = null, appearances = [], loading = false }) {
    return html`
      <song-info .song=${song} .appearances=${appearances} .loading=${loading}></song-info>
    `
  }

  render() {
    return html`
      <app-modal ${ref(this._modal)} size="fullscreen" heading=${this._title || 'Song info'}>
        ${
          this._data
            ? this._renderInfo(this._data)
            : this._load.render({
                initial: () => this._renderInfo({ loading: true }),
                pending: () => this._renderInfo({ loading: true }),
                complete: data => this._renderInfo(data),
                error: error => html`
                  <status-message
                    state="error"
                    message="Couldn't load this song"
                    .detail=${error?.message ?? ''}
                  ></status-message>
                `,
              })
        }
      </app-modal>
    `
  }
}

customElements.define('song-info-dialog', SongInfoDialog)
