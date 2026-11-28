/** Current-space wiring; account-wide polling and sockets remain step 5 of the D1 plan. */

import { SyncPushedEvent } from './auto-sync.ts'
import { DataChangeEvent } from './data-changes.ts'
import { type ChordlessDB, openSpace } from './db.ts'
import { getIdentityToken, isAuthenticated } from './google-auth.ts'
import { syncLibrarySongs, syncPersonalLibrarySongs } from './library-song-sync.ts'
import { personFor } from './people.ts'
import {
  getCurrentSpace,
  getSpaceById,
  listSpaces,
  SpaceChangeEvent,
  updateSpace,
} from './space.ts'
import {
  type LeaderNames,
  personalDataTransport,
  SpaceDataSync,
  spaceDataTransport,
} from './space-data.ts'
import { SpaceDataStore, SpaceOutboxChangedEvent } from './space-data-store.ts'
import type { SpaceRecordKind } from './space-data-types.ts'
import { moveToServer, serverSteps } from './space-move.ts'
import { t } from './text.ts'
import { toast } from './toast.ts'
import { errorMessage } from './utils/errors.ts'
import type { WorkerConnection } from './worker-call.ts'

export class SpaceDataAutoSync {
  readonly #deps: {
    win: EventTarget
    doc: EventTarget
    current: () => string | null
    visible: () => boolean
    run: (spaceId: string) => void
    followed?: () => Promise<string[]>
    every: (fn: () => void) => () => void
  }
  #cancel: (() => void) | null = null
  constructor(deps: {
    win: EventTarget
    doc: EventTarget
    current: () => string | null
    visible: () => boolean
    run: (spaceId: string) => void
    followed?: () => Promise<string[]>
    every: (fn: () => void) => () => void
  }) {
    this.#deps = deps
  }
  #send = () => {
    const id = this.#deps.current()
    if (id) this.#deps.run(id)
    void this.#deps
      .followed?.()
      .then(ids => {
        for (const followed of ids) if (followed !== id) this.#deps.run(followed)
      })
      .catch(error => console.warn('[Team sync] Could not list followed teams:', error))
  }
  #resume = () => {
    if (this.#deps.visible()) this.#send()
  }
  #queued = (event: Event) => this.#deps.run((event as SpaceOutboxChangedEvent).spaceId)
  #edited = (event: Event) => {
    const { change } = event as DataChangeEvent
    if (
      change.origin === 'local' &&
      ['setlist', 'person', 'song', 'chart', 'score', 'pad-set'].includes(change.kind)
    )
      this.#deps.run(change.spaceId)
  }
  start(): void {
    const { win, doc } = this.#deps
    win.addEventListener(DataChangeEvent.type, this.#edited)
    win.addEventListener(SpaceOutboxChangedEvent.type, this.#queued)
    win.addEventListener('online', this.#send)
    win.addEventListener(SpaceChangeEvent.type, this.#send)
    doc.addEventListener('visibilitychange', this.#resume)
    this.#cancel = this.#deps.every(this.#resume)
    this.#send()
  }
  stop(): void {
    const { win, doc } = this.#deps
    win.removeEventListener(DataChangeEvent.type, this.#edited)
    win.removeEventListener(SpaceOutboxChangedEvent.type, this.#queued)
    win.removeEventListener('online', this.#send)
    win.removeEventListener(SpaceChangeEvent.type, this.#send)
    doc.removeEventListener('visibilitychange', this.#resume)
    this.#cancel?.()
    this.#cancel = null
  }
}

/** How many automatic attempts in a row fail to reach the server before it is worth telling the person */
export const NETWORK_FAILURES_BEFORE_TOAST = 3
/**
 * ... over at least this long: a phone's page coming back from the background has no network for a moment, and
 * what that starts (the resume, an online event, an edit) can fail three times in as many seconds
 */
export const NETWORK_FAILURES_SPAN_MS = 2 * 60 * 1000

/** The browser's wording for a request that did not get to the server (Chrome, Safari, Firefox) */
export function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /failed to fetch|load failed|networkerror|network request/i.test(error.message)
  )
}

/**
 * Which failures of the automatic sync are told to the person. The changes are on the device either
 * way, and the next tick, coming back online or opening the app tries again, so a request that did
 * not reach the server (a wifi that is waking, a page going to the background) is told only if it
 * keeps happening. Anything else is told at once, once for each reason until a sync works.
 */
export class BackgroundSyncFailures {
  #unreachable = new Map<string, { count: number; since: number }>()
  #told = new Map<string, string>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  /** The reason to tell the person of, or null to say nothing now */
  failed(spaceId: string, error: unknown): string | null {
    if (isNetworkFailure(error)) {
      const now = this.#now()
      const streak = this.#unreachable.get(spaceId) ?? { count: 0, since: now }
      streak.count++
      this.#unreachable.set(spaceId, streak)
      if (
        streak.count < NETWORK_FAILURES_BEFORE_TOAST ||
        now - streak.since < NETWORK_FAILURES_SPAN_MS
      )
        return null
    }
    const reason = errorMessage(error)
    if (this.#told.get(spaceId) === reason) return null
    this.#told.set(spaceId, reason)
    return reason
  }

  succeeded(spaceId: string): void {
    this.#unreachable.delete(spaceId)
    this.#told.delete(spaceId)
  }
}

/* v8 ignore start -- wiring to the real account, database, Web Locks, window and clock; the lifecycle is tested above */
/** What a Personal space on the server holds there: its setlists (its songs are the library's) */
const PERSONAL: { readKinds: SpaceRecordKind[]; writeKinds: SpaceRecordKind[] } = {
  readKinds: ['setlist'],
  writeKinds: ['setlist'],
}
/** A Personal space's leaders, for the server, which names them: the space's people (people.ts) */
function leadersOf(db: ChordlessDB): LeaderNames {
  return {
    names: async () => new Map((await db.getAllPeople()).map(person => [person.id, person.name])),
    idFor: async name => {
      const made = personFor(await db.getAllPeople(), { name })
      if (!made) throw new Error('A leader needs a name')
      await db.savePeople(made.changed)
      return made.person.id
    },
  }
}
const controllers = new Map<string, Promise<SpaceDataSync>>()
const failures = new BackgroundSyncFailures()

/** Manual syncs may name any space. Automatic ticks still follow the current space until step 5. */
export async function syncSpaceDataFor(
  spaceId: string,
  options: {
    all?: boolean
    retryRefused?: boolean
    /** Told how many songs have been sent, as a move sends them */
    progress?: (sent: number, total: number) => void
  } = {}
): Promise<void> {
  if (!navigator.onLine) return
  const space = await getSpaceById(spaceId)
  // A Team's, or a Personal space's that has moved to the server (space.server)
  if (!(space?.team || space?.server) || !(await isAuthenticated())) return
  const connection = {
    token: getIdentityToken,
    origin: location.origin,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => window.fetch(input, init),
  }
  const personal = !space.team
  const teamId = space.team?.id ?? space.id
  // (a team that has become a church's is synced another way: a controller made for it before is not the one for it now)
  const mode = `${spaceId}:${space.team?.churchId ?? (space.server ? 'server' : '')}`
  let creating = controllers.get(mode)
  if (!creating) {
    creating = (async () => {
      const db = await openSpace(spaceId, 'sync')
      return new SpaceDataSync({
        store: new SpaceDataStore(
          db,
          personal
            ? PERSONAL
            : space.team?.churchId
              ? { readKinds: ['setlist', 'person'], writeKinds: ['setlist'] }
              : {}
        ),
        online: () => navigator.onLine,
        transport: personal
          ? personalDataTransport(connection, leadersOf(db))
          : spaceDataTransport(teamId, connection, Boolean(space.team?.churchId)),
        lock: work => navigator.locks.request(`chordless-space-data-${spaceId}`, work),
        // (a Personal space has no live room: nothing tells other devices, which find it at their next sync)
        pushed: personal ? undefined : () => window.dispatchEvent(new SyncPushedEvent(teamId)),
        conflict: () => toast(t('space-data-conflict')),
        refused: reason =>
          toast(t('space-data-refused'), {
            kind: 'error',
            details: reason,
            action: {
              label: t('action-try-again'),
              run: () => syncSpaceDataFor(spaceId, { retryRefused: true }),
            },
          }),
      })
    })()
    controllers.set(mode, creating)
    void creating.catch(() => controllers.delete(mode))
  }
  const sync = await creating
  // (the songs go first: a setlist is refused for a song the library does not have)
  if (space.server) {
    await syncPersonalLibrarySongs(
      space.server.libraryId,
      await openSpace(spaceId, 'sync'),
      connection,
      { progress: options.progress }
    )
  } else if (space.team?.churchId) {
    await syncLibrarySongs(teamId, await openSpace(spaceId, 'sync'), connection)
  }
  await sync.sync(options)
  failures.succeeded(spaceId)
  if (space.server) await syncOverlaysOf(spaceId, connection)
}

/** What the person keeps for themselves goes with their space: a failure here is not one of the space's data */
async function syncOverlaysOf(spaceId: string, connection: WorkerConnection): Promise<void> {
  try {
    const { syncOverlays } = await import('./overlay-sync.ts')
    await syncOverlays({ db: await openSpace(spaceId, 'sync'), connection })
  } catch (error) {
    console.warn('[Overlays] Could not sync what you keep for yourself:', errorMessage(error))
  }
}

/**
 * Move a Personal space to the server, once and for good (space-move.ts): its songs and setlists are sent, and Drive is not
 * synced again. A space that is not a Personal one still on Drive does not move.
 */
export async function moveSpaceToServerNow(
  spaceId: string,
  combine = false,
  progress?: (sent: number, total: number) => void
): Promise<void> {
  const space = await getSpaceById(spaceId)
  if (!space || space.team || space.server)
    throw new Error('Only a Personal space on Drive can move')
  const server = serverSteps({
    token: getIdentityToken,
    origin: location.origin,
    fetch: (input, init) => window.fetch(input, init),
  })
  await moveToServer(
    {
      ...server,
      seed: async () =>
        new SpaceDataStore(await openSpace(spaceId, 'sync'), PERSONAL).seedPersonalMove(),
      mark: async (libraryId, movedAt) => {
        await updateSpace(spaceId, { server: { libraryId, movedAt } })
      },
      sync: () => syncSpaceDataFor(spaceId, { all: true, progress }),
      now: () => new Date().toISOString(),
    },
    combine
  )
}

export async function syncCurrentSpaceData(): Promise<void> {
  const { id } = getCurrentSpace()
  if (id) await syncSpaceDataFor(id)
}

/** Network failures retain the outbox; ticks, reconnect, and an explicit retry can send it later. */
function send(spaceId = getCurrentSpace().id ?? undefined): void {
  if (!spaceId) return
  void syncSpaceDataFor(spaceId).catch(error => {
    const reason = failures.failed(spaceId, error)
    if (reason === null) return
    toast(t('space-data-refused'), {
      kind: 'error',
      details: reason,
      action: {
        label: t('action-try-again'),
        run: () => syncSpaceDataFor(spaceId, { retryRefused: true }),
      },
    })
  })
}

export function startSpaceDataSync(): () => void {
  const auto = new SpaceDataAutoSync({
    win: window,
    doc: document,
    current: () => getCurrentSpace().id,
    visible: () => document.visibilityState === 'visible',
    run: id => send(id),
    followed: async () =>
      (await listSpaces())
        .filter(space => space.team?.churchId && space.team.followed)
        .map(space => space.id),
    every: fn => {
      const timer = setInterval(fn, 60_000)
      return () => clearInterval(timer)
    },
  })
  auto.start()
  return () => auto.stop()
}
/* v8 ignore stop */
