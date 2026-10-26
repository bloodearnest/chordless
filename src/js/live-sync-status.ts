/**
 * What the pages show of the live channel (docs/LIVE_SYNC.md): a dot on the live button. Apart from
 * live-sync.ts, which needs the sync and the sign-in, so that a page need not load them to listen.
 */
import type { LiveStatus } from './live-channel.ts'

/** The live channel's state changed (sent on window); null when this device is not live on a team space */
export class LiveSyncStatusEvent extends Event {
  static readonly type = 'live-sync:status'
  readonly status: LiveStatus | null
  constructor(status: LiveStatus | null) {
    super(LiveSyncStatusEvent.type)
    this.status = status
  }
}

declare global {
  interface WindowEventMap {
    [LiveSyncStatusEvent.type]: LiveSyncStatusEvent
  }
}

let current: LiveStatus | null = null

/** The live channel's state now, for a page made after it changed; null when there is none */
export function getLiveSyncStatus(): LiveStatus | null {
  return current
}

/** Record the live channel's state, and tell the pages */
export function announceLiveSyncStatus(win: EventTarget, status: LiveStatus | null): void {
  current = status
  win.dispatchEvent(new LiveSyncStatusEvent(status))
}
