/**
 * Telling the sync that this device changed something it may have to send: a setlist, a song or
 * a chart saved or deleted (the database says so, db.ts; what a sync saves itself does not).
 * Sent on `window`; the app's sync by itself (auto-sync.ts) hears it and syncs soon, so a change
 * does not wait for the next tick.
 */

/** A setlist, song or chart was saved or deleted here (sent on window) */
export class LocalChangeEvent extends Event {
  static readonly type = 'db:local-change'
  constructor() {
    super(LocalChangeEvent.type)
  }
}

/** Tell the app that something to send was saved or deleted */
export function noteLocalChange(): void {
  window.dispatchEvent(new LocalChangeEvent())
}
