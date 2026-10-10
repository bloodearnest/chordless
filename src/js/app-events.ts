import type { RuntimeSong } from './setlist/runtime-songs.ts'

/**
 * App-level events with no component to own them. Each module that sends an
 * event defines its class; these are sent by app scripts (setlist-page.js),
 * so that listeners need not import them from the page.
 */

/** The setlist page moved to another song (sent on document, for the media player) */
export class SongChangeEvent extends Event {
  static type = 'setlist:song-change'
  readonly song: RuntimeSong | null
  constructor(song: RuntimeSong | null) {
    super(SongChangeEvent.type)
    this.song = song
  }
}
