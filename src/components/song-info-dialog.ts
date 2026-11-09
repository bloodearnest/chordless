import { Task } from '@lit/task'
import { html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { formatRange } from '../js/chart-range.ts'
import type { SongWithContent } from '../js/data-types.ts'
import type { ChordlessDB } from '../js/db.ts'
import type { SongMelody } from '../js/melody-analysis.ts'
import { toast } from '../js/toast.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import type { Appearance, SongRangeChangeEvent } from './song-info.ts'
import './song-info.ts'
import type { SongVersionsChangedEvent } from './song-versions.ts'
import './song-versions.ts'
import './status-message.ts'

/**
 * A song's melody range was saved (or taken away: value null), as the chart says it, in the
 * chart's key. The page the dialog is in updates what it shows from it, such as the key picker.
 */
export class SongRangeChangedEvent extends Event {
  static readonly type = 'song-info-dialog:range-changed'
  readonly songId: string
  readonly value: string | null
  constructor(songId: string, value: string | null) {
    super(SongRangeChangedEvent.type, { bubbles: true, composed: true })
    this.songId = songId
    this.value = value
  }
}

/** What the dialog shows: a song and where it has been played */
interface InfoData {
  song: SongWithContent | null
  appearances: Appearance[]
  loading: boolean
  /** The range and the beats on its ends, worked out from the song's melody */
  melody?: SongMelody | null
}

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
 * The song is loaded from the current space's database unless `db` is
 * set. showData() shows already-loaded data (used by the dev page).
 */
export class SongInfoDialog extends LitElement {
  static override properties = {
    db: { attribute: false },
    _title: { state: true },
    _data: { state: true }, // {song, appearances, loading} given to showData()
  }

  declare db: ChordlessDB | null
  declare _title: string
  declare _data: InfoData | null

  _modal: Ref<AppModal>
  /** What show() was asked for, to load the song again after a change */
  _shown: [string, string] | null = null
  _load: Task<
    [string, string],
    { song: SongWithContent; appearances: Appearance[]; melody: SongMelody | null }
  >

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
        const { getSongById } = await import('../js/song-utils.ts')
        const [song, usage] = await Promise.all([
          getSongById(songId, db),
          db.getSongUsageFromSetlists(songId),
        ])
        const { songMelody } = await import('../js/melody-analysis.ts')
        const record = await db.getScore(song.uuid)
        signal.throwIfAborted()
        return {
          melody: songMelody(song.parsed?.metadata, record),
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
   * @param songId - The song's ID (not a variant's uuid)
   * @param options.title - Title to show, e.g. the setlist's version of
   *   it. Defaults to the stored song's. Key and tempo always come from the song
   *   itself (its original), with the keys it was played in listed in its history.
   */
  async show(songId: string, { title = '' }: { title?: string } = {}): Promise<void> {
    this._title = title
    this._data = null
    this._shown = [songId, title]
    this._load.run([songId, title])
    await this._open()
  }

  /** Save a melody range the person set (or took away), and show the song as it is now */
  async _saveRange(event: SongRangeChangeEvent): Promise<void> {
    try {
      const { setSongRange } = await import('../js/song-utils.ts')
      const db = this.db ?? (await (await import('../js/db.ts')).getCurrentDB())
      await setSongRange(event.songUuid, event.range, db)
    } catch (error) {
      console.error('[SongInfoDialog] Could not save the range:', error)
      toast("Couldn't save the melody range.", {
        kind: 'error',
        details: errorMessage(error),
        action: { label: 'Try again', run: () => void this._saveRange(event) },
      })
      return
    }
    // (the song again, with its chart as saved)
    if (this._shown) this._load.run(this._shown)
    const songId = this._shown?.[0] ?? ''
    this.dispatchEvent(
      new SongRangeChangedEvent(songId, event.range && formatRange(event.range, event.key))
    )
  }

  /** Open the dialog with already-loaded data (dev pages) */
  async showData({
    song,
    appearances = [],
    loading = false,
  }: {
    song: SongWithContent | null
    appearances?: Appearance[]
    loading?: boolean
  }): Promise<void> {
    this._load.abort()
    this._title = song?.title ?? ''
    this._data = { song, appearances, loading }
    await this._open()
  }

  close(): void {
    this._modal.value?.close()
  }

  async _open(): Promise<void> {
    await this.updateComplete
    this._modal.value?.show()
  }

  _renderInfo({
    song = null,
    appearances = [],
    loading = false,
    melody = null,
  }: Partial<InfoData>) {
    return html`
      <song-info
        .song=${song}
        .appearances=${appearances}
        .loading=${loading}
        .melody=${melody}
        @song-info:range-change=${(event: SongRangeChangeEvent) => this._saveRange(event)}
      ></song-info>
      ${
        song
          ? html`<song-versions
              .songId=${song.id}
              .db=${this.db}
              @song-versions:changed=${(event: SongVersionsChangedEvent) => {
                // (the song is gone: so is what the dialog shows)
                if (event.songDeleted) this.close()
              }}
            ></song-versions>`
          : ''
      }
    `
  }

  override render() {
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
                    .detail=${error instanceof Error ? error.message : ''}
                  ></status-message>
                `,
              })
        }
      </app-modal>
    `
  }
}

customElements.define('song-info-dialog', SongInfoDialog)

declare global {
  interface HTMLElementTagNameMap {
    'song-info-dialog': SongInfoDialog
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [SongRangeChangedEvent.type]: SongRangeChangedEvent
  }
}
