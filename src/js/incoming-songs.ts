import { type Shared, takeShared } from './shared-incoming.ts'

/**
 * Songs arriving at the import page from outside it: a file the system opened with Chordless
 * (the manifest's file_handlers: see launch.ts), or what another app shared to it (share_target:
 * see shared-incoming.ts). The import page takes them when it opens, or at once if it is open.
 */

/** Songs were offered to the import page (sent on window) */
export class IncomingSongsEvent extends Event {
  static readonly type = 'chordless:incoming-songs'
  constructor() {
    super(IncomingSongsEvent.type)
  }
}

let pending: Shared | null = null

/** Offer files or text to the import page, which may not be open yet */
export function offerIncoming(incoming: Shared): void {
  pending = incoming
  window.dispatchEvent(new IncomingSongsEvent())
}

/** Take whatever is waiting: offered here, or kept by the service worker from a share */
export async function takeIncoming(): Promise<Shared | null> {
  if (pending) {
    const incoming = pending
    pending = null
    return incoming
  }
  return await takeShared()
}

declare global {
  interface GlobalEventHandlersEventMap {
    [IncomingSongsEvent.type]: IncomingSongsEvent
  }
}
