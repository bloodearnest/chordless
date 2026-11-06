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
import { createSyncOrchestrator, type SyncTrigger } from './sync-orchestrator.ts'

/** How often the app syncs while it is on screen, in a team space, where a member has no other way to see a change */
export const TICK_MS = 60_000
/**
 * ...and in a personal space: one person on one device at a time, and opening or coming back to
 * the app already syncs, so the tick is only a backstop
 */
export const PERSONAL_TICK_MS = 5 * 60_000
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
  /** Signed in, but Google refuses the stored sign-in: nothing can sync until it is reconnected */
  | 'expired'
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
  /** How often the tick syncs the space in use: `TICK_MS` or `PERSONAL_TICK_MS` */
  tickMs(): Promise<number>
  /** Tell the person that syncing has stopped because the sign-in expired (called once until a sync can run again) */
  signInExpired(): void
  /** The sync itself, for the space in use; false if it was skipped because another is running, and throws if it fails */
  run(trigger: SyncTrigger): Promise<boolean>
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
  /** The sync running now is carrying changes made here: they are on their way, not yet there */
  #sending = false
  /** Another device said it changed something while a sync was running: that one may not have seen it */
  #pullAgain = false
  /** The person has been told that the sign-in expired; cleared when a sync can run again */
  #toldExpired = false

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
    const stopTimer = every(TICK_MS, () => void this.#tick())
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
    await this.#sync(this.#stale(), 'resume')
  }

  /**
   * The timer fires every `TICK_MS`; the space says how many of those make a sync. (Half a tick
   * of slack, so that a timer a little early is not read as one missed.)
   */
  async #tick(): Promise<void> {
    let every = TICK_MS
    try {
      every = await this.#deps.tickMs()
    } catch {
      // (the space cannot be read: the tick of a team space, the faster)
    }
    if (this.#deps.now() - this.#lastAttempt < every - TICK_MS / 2) return
    await this.#sync(false, 'tick')
  }

  #onVisibility = (): void => {
    if (this.#deps.visible()) {
      if (this.#deps.now() - this.#lastAttempt >= TICK_MS) void this.#catchUp()
    } else if (this.#unsent) {
      // Hidden is as near as a page gets to telling that it is closing (a tab switch, a minimised
      // window, an app switch, a closing lid): send what is waiting now, not after the quiet
      this.#flush()
    }
  }

  /** Send the changes made here at once, even if the page is hidden */
  #flush(): void {
    this.#cancelNudge?.()
    this.#cancelNudge = null
    void this.#sync(false, 'edit', true)
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
    // A hidden page's timers are slowed or stopped, and it may not be there when they fire
    if (!this.#deps.visible()) {
      this.#flush()
      return
    }
    this.#cancelNudge?.()
    this.#cancelNudge = this.#deps.later(this.#deps.live() ? LIVE_NUDGE_MS : NUDGE_MS, () => {
      this.#cancelNudge = null
      void this.#sync(false, 'edit')
    })
  }

  #onOffline = (): void => {
    this.#offlineSince ??= this.#deps.now()
  }

  #onOnline = (): void => {
    const since = this.#offlineSince
    this.#offlineSince = null
    const long = since !== null && this.#deps.now() - since > OFFLINE_LONG_MS
    void this.#sync(long || this.#stale(), 'online')
  }

  /**
   * Sync once if it can be done now. `everything` is for the app opening or coming back after a
   * while: a storage with no feed is synced then too, not on a tick. `hiddenToo` is for sending
   * the changes of a page that is being left.
   */
  async #sync(everything: boolean, trigger: SyncTrigger, hiddenToo = false): Promise<void> {
    if ((!hiddenToo && !this.#deps.visible()) || !this.#deps.online()) return
    // (what this sync carries: put back if it does not finish, so the next one tells of it)
    const carrying = this.#unsent
    let sent = false
    try {
      const state = await this.#deps.state()
      if (state === 'expired') {
        // (nothing is sent, and the edits made here wait: say so once, not on every tick)
        this.#unsent ||= carrying
        if (!this.#toldExpired) {
          this.#toldExpired = true
          this.#deps.signInExpired()
        }
        return
      }
      this.#toldExpired = false
      if (state === 'unavailable' || (state === 'no-feed' && !everything)) return
      this.#lastAttempt = this.#deps.now()
      this.#running = true
      this.#sending = carrying
      this.#changedWhileRunning = false
      this.#unsent = false
      const ran = await this.#deps.run(trigger)
      sent = ran && carrying
      if (!ran) this.#unsent ||= carrying
    } catch (error) {
      // (offline, signed out, a failed request: the next tick tries again)
      this.#unsent ||= carrying
      console.warn('[AutoSync] Sync did not work:', error)
    } finally {
      this.#running = false
      this.#sending = false
    }
    if (sent) this.#deps.win.dispatchEvent(new SyncPushedEvent())
    // A change made while it ran may have missed it: send that too
    if (this.#changedWhileRunning) {
      this.#changedWhileRunning = false
      this.#nudge()
    }
    if (this.#pullAgain) {
      this.#pullAgain = false
      await this.#sync(true, 'live')
    }
  }

  /**
   * Whether changes made in this tab have not reached the storage yet: waiting for the quiet
   * (the nudge), left by a sync that did not finish, or on their way in the sync running now. In
   * memory only: what an earlier visit left is the next sync's to find.
   */
  hasUnsent(): boolean {
    return this.#unsent || this.#sending || this.#changedWhileRunning || this.#cancelNudge !== null
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
    await this.#sync(true, 'live')
  }
}

/* v8 ignore start -- wiring to the real clock, network and sync: the Playwright tests run the app */
async function currentState(): Promise<SyncState> {
  const space = await getCurrentSpaceFull()
  if (!space.rootRef) return 'unavailable'
  const signIn = await getSignInState()
  if (signIn === 'expired') return 'expired'
  const canSync = signIn === 'signed-in' || (signIn === 'no-drive' && isTeamMember(space))
  if (!canSync) return 'unavailable'
  return storageFor(space).space(space.rootRef).changes ? 'feed' : 'no-feed'
}

/** Tell the person that nothing is syncing, with a way to put it right where they are */
async function notifySignInExpired(): Promise<void> {
  const { id } = getCurrentSpace()
  const last = id ? lastSyncOf(id) : null
  const [{ toast }, { authorizeWithGoogle }, { errorMessage }] = await Promise.all([
    import('./toast.ts'),
    import('./google-auth.ts'),
    import('./utils/errors.ts'),
  ])
  toast('Your Google sign-in has expired, so your changes are not syncing.', {
    kind: 'error',
    details: `Reconnect with Google to carry on. Changes made here are kept on this device and will be sent then.${last ? ` Last synced ${new Date(last).toLocaleString()}.` : ''}`,
    action: {
      label: 'Reconnect',
      run: () =>
        void authorizeWithGoogle()
          .then(() => syncSoon())
          .catch(error =>
            toast("Couldn't reconnect with Google.", {
              kind: 'error',
              details: errorMessage(error),
            })
          ),
    },
  })
}

async function runSync(trigger: SyncTrigger): Promise<boolean> {
  const space = await getCurrentSpaceFull()
  const orchestrator = await createSyncOrchestrator(space.name, space.id)
  const ran = await orchestrator.incrementalSync(null, { skipIfBusy: true, trigger })
  if (ran) recordSync(space.id)
  return ran
}

let running: AutoSync | null = null

/** Sync the space in use now, if the app is syncing by itself (see AutoSync.syncSoon) */
export async function syncSoon(): Promise<void> {
  await running?.syncSoon()
}

/** Whether changes made in this tab have not been sent yet (see AutoSync.hasUnsent); false if the app is not syncing by itself */
export function hasUnsentChanges(): boolean {
  return running?.hasUnsent() ?? false
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
    tickMs: async () => ((await getCurrentSpaceFull()).team ? TICK_MS : PERSONAL_TICK_MS),
    signInExpired: () => void notifySignInExpired(),
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
