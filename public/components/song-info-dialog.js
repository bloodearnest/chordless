import { html, LitElement } from 'lit'
import './app-modal.js'
import './song-info.js'

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
    _song: { state: true },
    _appearances: { state: true },
    _loading: { state: true },
  }

  constructor() {
    super()
    this.db = null
    this._title = ''
    this._song = null
    this._appearances = []
    this._loading = false
    this._requestId = 0
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
    const requestId = ++this._requestId
    this._title = title
    this._song = null
    this._appearances = []
    this._loading = true
    await this._open()

    try {
      const db = this.db ?? (await (await import('../js/db.js')).getCurrentDB())
      const { getSongById } = await import('../js/song-utils.js')
      const [song, usage] = await Promise.all([
        getSongById(songId, db),
        db.getSongUsageFromSetlists(songId),
      ])
      if (requestId !== this._requestId) return // superseded by another show()

      this._song = { ...song, title: title || song.title }
      this._title = this._song.title
      this._appearances = usage.map(entry => ({
        setlistId: entry.setlistId,
        date: entry.setlistDate,
        playedInKey: entry.playedInKey,
        leader: entry.leader,
        setlistName: entry.setlistName,
      }))
    } catch (error) {
      console.error('[SongInfoDialog] Could not load song:', songId, error)
    } finally {
      if (requestId === this._requestId) this._loading = false
    }
  }

  /** Open the dialog with already-loaded data */
  async showData({ song, appearances = [], loading = false }) {
    this._requestId++
    this._title = song?.title ?? ''
    this._song = song
    this._appearances = appearances
    this._loading = loading
    await this._open()
  }

  close() {
    this.renderRoot?.querySelector('app-modal')?.close()
  }

  async _open() {
    await this.updateComplete
    this.renderRoot.querySelector('app-modal').show()
  }

  render() {
    return html`
      <app-modal size="fullscreen" heading=${this._title || 'Song info'}>
        <song-info
          .song=${this._song}
          .appearances=${this._appearances}
          .loading=${this._loading}
        ></song-info>
      </app-modal>
    `
  }
}

customElements.define('song-info-dialog', SongInfoDialog)
