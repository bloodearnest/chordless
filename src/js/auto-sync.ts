/**
 * Syncing by itself while the app is open (docs/SYNC_ARCHITECTURE.md, "Pulling while the app is
 * open"): an incremental sync when the app is opened or comes back after a long time, when the
 * device comes back online after a while offline, and every minute while the app is on screen.
 * A timer in the open page, not a browser background task: those are Chromium-only, rare and
 * absent on iPad. Only the space in use is synced; the others have the Sync button on their card.
 *
 * What it does is injected (`AutoSyncDeps`), so the rules are tested without a clock or a network;
 * `startAutoSync` gives it the real ones.
 */

import { DataChangeEvent } from './data-changes.ts'
import { getSignInState } from './google-auth.ts'
import { lastSyncOf, recordSync } from './last-sync.ts'
import { getLive } from './live.ts'
import { getCurrentSpace, getCurrentSpaceFull } from './space.ts'
import { isTeamMember, storageFor } from './storage/space-storage.ts'
import { createSyncOrchestrator } from './sync-orchestrator.ts'

/** How often the app syncs while it is on screen */
export const TICK_MS = 60_000
/** Opening the app, or coming back to it, after this long syncs whatever the storage can do */
export const STALE_AFTER_MS = 15 * 60_000
/** Coming back online after this long syncs as if the app had just been opened */
export const OFFLINE_LONG_MS = 5 * 60_000
/** A change made here is sent after this much quiet, so that a burst of edits is one sync */
export const NUDGE_MS = 2000
/** ...and while the device is live, when a change is wanted elsewhere at once: a burst is still one sync, but a short one (docs/LIVE_SYNC.md) */
export const LIVE_NUDGE_MS = 400

/**
 * A sync that sent changes made here has finished (sent on window): what the live channel waits
 * for before it tells the other devices (docs/LIVE_SYNC.md), so that they find the changes there
 */
export class SyncPushedEvent extends Event {
  static readonly type = 'sync:pushed'
  constructor() {
    super(SyncPushedEvent.type)
  }
}

declare global {
  interface WindowEventMap {
    [SyncPushedEvent.type]: SyncPushedEvent
  }
}

/** What a sync can be done with now */
export type SyncState =
  /** Not signed in, no folder yet, or nothing to sync with */
  | 'unavailable'
  /** The storage has a feed of changes: a sync is cheap, so it is done every minute */
  | 'feed'
  /** It has none: a sync lists everything, so it is done only when the app opens or comes back */
  | 'no-feed'

export interface AutoSyncDeps {
  /** Where its events come from: the window ('online', 'offline') and the document ('visibilitychange') */
  win: EventTarget
  doc: EventTarget
  now(): number
  visible(): boolean
  online(): boolean
  /** When the space last synced on this device (ISO time), or null if it never has */
  lastSync(): string | null
  /** Whether this device is live (live.ts) */
  live(): boolean
  state(): Promise<SyncState>
  /** The sync itself, for the space in use; false if it was skipped because another is running, and throws if it fails */
  run(): Promise<boolean>
  /** Call `fn` every `ms` until the returned function is called */
  every(ms: number, fn: () => void): () => void
  /** Call `fn` once after `ms`, unless the returned function is called first */
  later(ms: number, fn: () => void): () => void
}

export class AutoSync {
  #deps: AutoSyncDeps
  #lastAttempt = Number.NEGATIVE_INFINITY
  #offlineSince: number | null = null
  #stop: (() => void) | null = null
  #cancelNudge: (() => void) | null = null
  #running = false
  /** A change was made here while a sync was running: that sync may not have sent it */
  #changedWhileRunning = false
  /** Changes made here that no finished sync has sent yet */
  #unsent = false
  /** Another device said it changed something while a sync was running: that one may not have seen it */
  #pullAgain = false

  constructor(deps: AutoSyncDeps) {
    this.#deps = deps
  }

  start(): void {
    const { win, doc, online, now, every } = this.#deps
    if (!online()) this.#offlineSince = now()
    doc.addEventListener('visibilitychange', this.#onVisibility)
    win.addEventListener('online', this.#onOnline)
    win.addEventListener('offline', this.#onOffline)
    win.addEventListener(DataChangeEvent.type, this.#onDataChange)
    const stopTimer = every(TICK_MS, () => void this.#sync(false))
    this.#stop = () => {
      doc.removeEventListener('visibilitychange', this.#onVisibility)
      win.removeEventListener('online', this.#onOnline)
      win.removeEventListener('offline', this.#onOffline)
      win.removeEventListener(DataChangeEvent.type, this.#onDataChange)
      this.#cancelNudge?.()
      stopTimer()
    }
    void this.#catchUp()
  }

  stop(): void {
    this.#stop?.()
    this.#stop = null
  }

  /** Whether the space has gone too long without a sync for a quick one to do */
  #stale(): boolean {
    const last = this.#deps.lastSync()
    return !last || this.#deps.now() - Date.parse(last) > STALE_AFTER_MS
  }

  /** The app opened or came back: a sync that does all it can if the last was long ago, else a tick */
  async #catchUp(): Promise<void> {
    await this.#sync(this.#stale())
  }

  #onVisibility = (): void => {
    if (this.#deps.visible() && this.#deps.now() - this.#lastAttempt >= TICK_MS) {
      void this.#catchUp()
    }
  }

  /**
   * Something was saved here by the user: sync soon, once the edits stop for a moment. What a sync
   * saved is not to be sent, and another tab's edit is sent by that tab (it is not sent twice)
   */
  #onDataChange = (event: Event): void => {
    const { change } = event as DataChangeEvent
    if (change.origin !== 'local' || change.remote) return
    this.#unsent = true
    this.#nudge()
  }

  #nudge(): void {
    if (this.#running) this.#changedWhileRunning = true
    this.#cancelNudge?.()
    this.#cancelNudge = this.#deps.later(this.#deps.live() ? LIVE_NUDGE_MS : NUDGE_MS, () => {
      this.#cancelNudge = null
      void this.#sync(false)
    })
  }

  #onOffline = (): void => {
    this.#offlineSince ??= this.#deps.now()
  }

  #onOnline = (): void => {
    const since = this.#offlineSince
    this.#offlineSince = null
    const long = since !== null && this.#deps.now() - since > OFFLINE_LONG_MS
    void this.#sync(long || this.#stale())
  }

  /**
   * Sync once if it can be done now. `everything` is for the app opening or coming back after a
   * while: a storage with no feed is synced then too, not on a tick.
   */
  async #sync(everything: boolean): Promise<void> {
    if (!this.#deps.visible() || !this.#deps.online()) return
    // (what this sync carries: put back if it does not finish, so the next one tells of it)
    const carrying = this.#unsent
    let sent = false
    try {
      const state = await this.#deps.state()
      if (state === 'unavailable' || (state === 'no-feed' && !everything)) return
      this.#lastAttempt = this.#deps.now()
      this.#running = true
      this.#changedWhileRunning = false
      this.#unsent = false
      const ran = await this.#deps.run()
      sent = ran && carrying
      if (!ran) this.#unsent ||= carrying
    } catch (error) {
      // (offline, signed out, a failed request: the next tick tries again)
      this.#unsent ||= carrying
      console.warn('[AutoSync] Sync did not work:', error)
    } finally {
      this.#running = false
    }
    if (sent) this.#deps.win.dispatchEvent(new SyncPushedEvent())
    // A change made while it ran may have missed it: send that too
    if (this.#changedWhileRunning) {
      this.#changedWhileRunning = false
      this.#nudge()
    }
    if (this.#pullAgain) {
      this.#pullAgain = false
      await this.#sync(true)
    }
  }

  /**
   * Sync now, because another device says it changed something (the live channel): not at the next
   * tick. One that is running may have read before that change, so it is followed by another.
   */
  async syncSoon(): Promise<void> {
    if (this.#running) {
      this.#pullAgain = true
      return
    }
    await this.#sync(true)
  }
}

/* v8 ignore start -- wiring to the real clock, network and sync: the Playwright tests run the app */
async function currentState(): Promise<SyncState> {
  const space = await getCurrentSpaceFull()
  if (!space.rootRef) return 'unavailable'
  const signIn = await getSignInState()
  const canSync = signIn === 'signed-in' || (signIn === 'no-drive' && isTeamMember(space))
  if (!canSync) return 'unavailable'
  return storageFor(space).space(space.rootRef).changes ? 'feed' : 'no-feed'
}

async function runSync(): Promise<boolean> {
  const space = await getCurrentSpaceFull()
  const orchestrator = await createSyncOrchestrator(space.name, space.id)
  const ran = await orchestrator.incrementalSync(null, { skipIfBusy: true })
  if (ran) recordSync(space.id)
  return ran
}

let running: AutoSync | null = null

/** Sync the space in use now, if the app is syncing by itself (see AutoSync.syncSoon) */
export async function syncSoon(): Promise<void> {
  await running?.syncSoon()
}

/** Start syncing the space in use while the app is open */
export function startAutoSync(): AutoSync {
  const auto = new AutoSync({
    win: window,
    doc: document,
    now: () => Date.now(),
    visible: () => document.visibilityState === 'visible',
    online: () => navigator.onLine,
    lastSync: () => {
      const { id } = getCurrentSpace()
      return id ? lastSyncOf(id) : null
    },
    live: () => getLive() !== null,
    state: currentState,
    run: runSync,
    every: (ms, fn) => {
      const id = setInterval(fn, ms)
      return () => clearInterval(id)
    },
    later: (ms, fn) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
  })
  auto.start()
  running = auto
  return auto
}
/* v8 ignore stop */
