import type { RuntimeSong } from './setlist/runtime-songs.ts'
import type { SongMediaPrefs } from './song-user-prefs.ts'

/**
 * App-level events with no component to own them. Each module that sends an
 * event defines its class; these are sent by app scripts (setlist-page.js),
 * so that listeners need not import them from the page.
 */

/** The setlist page moved to another song (sent on document, for the media player) */
export class SongChangeEvent extends Event {
  static readonly type = 'setlist:song-change'
  readonly song: RuntimeSong | null
  /** This user's media choices for the song (see song-user-prefs.ts) */
  readonly mediaPrefs: SongMediaPrefs
  constructor(song: RuntimeSong | null, mediaPrefs: SongMediaPrefs = {}) {
    super(SongChangeEvent.type)
    this.song = song
    this.mediaPrefs = mediaPrefs
  }
}

/**
 * The double-speed click was toggled for the song being viewed (sent on document by the media
 * player, for the setlist page to remember). value is the user's choice for the song, or
 * undefined to go by its tempo.
 */
export class DoubleClickToggleEvent extends Event {
  static readonly type = 'media-player:double-click-toggle'
  readonly value: boolean | undefined
  constructor(value: boolean | undefined) {
    super(DoubleClickToggleEvent.type, { bubbles: true, composed: true })
    this.value = value
  }
}

declare global {
  interface GlobalEventHandlersEventMap {
    [SongChangeEvent.type]: SongChangeEvent
    [DoubleClickToggleEvent.type]: DoubleClickToggleEvent
  }
}
