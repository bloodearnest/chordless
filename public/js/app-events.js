/**
 * App-level events with no component to own them. Each module that sends an
 * event defines its class; these are sent by app scripts (setlist-app.js),
 * which listeners can't import, as importing them starts the app.
 */

/** The setlist page moved to another song (sent on document, for the media player) */
export class SongChangeEvent extends Event {
  static type = 'setlist:song-change'
  constructor(song) {
    super(SongChangeEvent.type)
    this.song = song
  }
}
