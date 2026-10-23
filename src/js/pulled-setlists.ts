/**
 * Telling the app's pages that a sync saved setlists, so that one showing such a setlist follows
 * the new version (the setlist page, docs/SYNC_ARCHITECTURE.md, "Pulling while the app is open").
 * The event is sent on `window`, and, as another tab of the app may be showing the setlist, on a
 * BroadcastChannel to the others (a channel does not deliver to its own sender). It carries only
 * the ids: a page reads the setlist again.
 */

/** A sync saved these setlists (sent on window) */
export class SetlistsPulledEvent extends Event {
  static readonly type = 'sync:setlists-pulled'
  readonly ids: string[]
  constructor(ids: string[]) {
    super(SetlistsPulledEvent.type)
    this.ids = ids
  }
}

declare global {
  interface WindowEventMap {
    [SetlistsPulledEvent.type]: SetlistsPulledEvent
  }
}

const CHANNEL = 'chordless-setlists-pulled'

/** Tell this page, and the app's other tabs, that a sync saved these setlists */
export function announceSetlistsPulled(ids: string[]): void {
  if (ids.length === 0) return
  window.dispatchEvent(new SetlistsPulledEvent(ids))
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage(ids)
  channel.close()
}

/** Hear of setlists another tab's sync saved, as if this page's own had */
export function listenForPulledSetlists(): void {
  new BroadcastChannel(CHANNEL).addEventListener('message', event => {
    if (Array.isArray(event.data)) window.dispatchEvent(new SetlistsPulledEvent(event.data))
  })
}
