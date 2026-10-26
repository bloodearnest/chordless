/**
 * Live sync (docs/LIVE_SYNC.md): while this device is live on a team space, its live channel is
 * up. When this device has sent its changes to the space it tells the others, and when another
 * device says it did, this one syncs at once instead of at the next tick. The channel carries no
 * content; the sync is what moves it, so all of the sync's rules (conflicts, undo, the diff toast)
 * apply as ever.
 *
 * The rules are here with everything injected (`LiveSyncDeps`); `startLiveSync` gives them the real
 * ones. The page shows the channel's state on the live button (live-sync-status.ts).
 */
import { SyncPushedEvent, syncSoon } from './auto-sync.ts'
import type { Space } from './data-types.ts'
import { getIdentityToken } from './google-auth.ts'
import { getLive, LiveChangeEvent } from './live.ts'
import { LiveChannel, type LiveChannelEvents, type LiveStatus } from './live-channel.ts'
import { announceLiveSyncStatus } from './live-sync-status.ts'
import { getCurrentSpaceFull, SpaceChangeEvent } from './space.ts'
import { atLeast } from './team-roles.ts'

/** How long after a "changed" the space is read once more: Drive's feed shows a change a few seconds late */
export const FEED_LAG_MS = 5000

/** The team space whose channel this device would join, if it is live */
export interface LiveSpace {
  /** The space's id at the Worker */
  teamId: string
  /** Whether this person may tell the others (a reader only listens) */
  canWrite: boolean
}

/** What the live channel of a space is made of: one object per connection of this device */
export interface LiveChannelLike {
  readonly status: LiveStatus
  start(): void
  stop(): void
  retryNow(): void
  notify(): boolean
}

export interface LiveSyncDeps {
  win: EventTarget
  doc: EventTarget
  /** Whether this device is live */
  isLive(): boolean
  /** The team space in use, or null if it is not one (or this person cannot join its channel) */
  space(): Promise<LiveSpace | null>
  channel(teamId: string, events: LiveChannelEvents): LiveChannelLike
  /** Sync the space in use now */
  syncSoon(): Promise<void>
  visible(): boolean
  later(ms: number, fn: () => void): () => void
}

export class LiveSync {
  #deps: LiveSyncDeps
  #channel: LiveChannelLike | null = null
  #teamId: string | null = null
  #canWrite = false
  #cancelFollowUp: (() => void) | null = null
  /** Counts the refreshes, so that a slow answer about the space does not undo a later one */
  #refreshes = 0

  constructor(deps: LiveSyncDeps) {
    this.#deps = deps
  }

  start(): void {
    const { win, doc } = this.#deps
    win.addEventListener(LiveChangeEvent.type, this.#refresh)
    win.addEventListener(SpaceChangeEvent.type, this.#refresh)
    win.addEventListener(SyncPushedEvent.type, this.#onPushed)
    win.addEventListener('online', this.#retry)
    doc.addEventListener('visibilitychange', this.#retry)
    void this.#refresh()
  }

  stop(): void {
    const { win, doc } = this.#deps
    win.removeEventListener(LiveChangeEvent.type, this.#refresh)
    win.removeEventListener(SpaceChangeEvent.type, this.#refresh)
    win.removeEventListener(SyncPushedEvent.type, this.#onPushed)
    win.removeEventListener('online', this.#retry)
    doc.removeEventListener('visibilitychange', this.#retry)
    this.#refreshes++
    this.#close()
  }

  /** Be connected to the space in use if this device is live on a team space, and to nothing if it is not */
  #refresh = async (): Promise<void> => {
    const refresh = ++this.#refreshes
    const space = this.#deps.isLive() ? await this.#deps.space() : null
    // (a later change of mind while the space was being read)
    if (refresh !== this.#refreshes) return
    this.#canWrite = space?.canWrite ?? false
    if (space?.teamId === this.#teamId) return
    this.#close()
    if (!space) return
    this.#teamId = space.teamId
    this.#channel = this.#deps.channel(space.teamId, {
      status: status => this.#tell(status),
      changed: () => this.#onChanged(),
      // (what happened while it was down is found the same way: by a sync)
      connected: () => void this.#deps.syncSoon(),
    })
    this.#channel.start()
  }

  #close(): void {
    this.#cancelFollowUp?.()
    this.#cancelFollowUp = null
    this.#channel?.stop()
    this.#channel = null
    this.#teamId = null
    this.#tell(null)
  }

  #tell(status: LiveStatus | null): void {
    announceLiveSyncStatus(this.#deps.win, status)
  }

  /** Another device sent changes to the space: read them now, and once more when Drive's feed has caught up */
  #onChanged(): void {
    void this.#deps.syncSoon()
    this.#cancelFollowUp?.()
    this.#cancelFollowUp = this.#deps.later(FEED_LAG_MS, () => {
      this.#cancelFollowUp = null
      void this.#deps.syncSoon()
    })
  }

  /** This device's changes are in the space: tell the others, if this person may (a reader's edits stay on the device) */
  #onPushed = (): void => {
    if (this.#canWrite) this.#channel?.notify()
  }

  #retry = (): void => {
    if (this.#deps.visible()) this.#channel?.retryNow()
  }
}

/* v8 ignore start -- wiring to the real socket, clock and sign-in: the Playwright tests run the app */
async function currentTeamSpace(): Promise<LiveSpace | null> {
  const space: Space = await getCurrentSpaceFull()
  if (!space.team) return null
  return {
    teamId: space.team.id,
    canWrite: atLeast(space.team.role, 'writer') && !space.readOnly,
  }
}

/** Start the live channel for as long as this device is live on a team space */
export function startLiveSync(): LiveSync {
  const sync = new LiveSync({
    win: window,
    doc: document,
    isLive: () => getLive() !== null,
    space: currentTeamSpace,
    channel: (teamId, events) =>
      new LiveChannel(
        {
          open: protocols => {
            const url = new URL(`/api/space/${encodeURIComponent(teamId)}/live`, location.href)
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
            return new WebSocket(url, protocols)
          },
          token: getIdentityToken,
          later: (ms, fn) => {
            const id = setTimeout(fn, ms)
            return () => clearTimeout(id)
          },
          random: Math.random,
        },
        events
      ),
    syncSoon,
    visible: () => document.visibilityState === 'visible',
    later: (ms, fn) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
  })
  sync.start()
  return sync
}
/* v8 ignore stop */
