/** Current-space wiring; account-wide polling and sockets remain step 5 of the D1 plan. */
import { SyncPushedEvent } from './auto-sync.ts'
import { DataChangeEvent } from './data-changes.ts'
import { openSpace } from './db.ts'
import { getIdentityToken, isAuthenticated } from './google-auth.ts'
import { syncLibrarySongs } from './library-song-sync.ts'
import { getCurrentSpace, getSpaceById, listSpaces, SpaceChangeEvent } from './space.ts'
import { SpaceDataSync, spaceDataTransport } from './space-data.ts'
import { SpaceDataStore, SpaceOutboxChangedEvent } from './space-data-store.ts'
import { t } from './text.ts'
import { toast } from './toast.ts'
import { errorMessage } from './utils/errors.ts'

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

/* v8 ignore start -- wiring to the real account, database, Web Locks, window and clock; the lifecycle is tested above */
const controllers = new Map<string, Promise<SpaceDataSync>>()
const failures = new Map<string, string>()

/** Manual syncs may name any space. Automatic ticks still follow the current space until step 5. */
export async function syncSpaceDataFor(
  spaceId: string,
  options: { all?: boolean; retryRefused?: boolean } = {}
): Promise<void> {
  if (!navigator.onLine) return
  const space = await getSpaceById(spaceId)
  if (!space?.team || !(await isAuthenticated())) return
  const teamId = space.team.id
  let creating = controllers.get(spaceId)
  if (!creating) {
    creating = (async () => {
      const db = await openSpace(spaceId, 'sync')
      return new SpaceDataSync({
        store: new SpaceDataStore(
          db,
          space.team?.churchId ? { readKinds: ['setlist', 'person'], writeKinds: ['setlist'] } : {}
        ),
        online: () => navigator.onLine,
        transport: spaceDataTransport(
          teamId,
          {
            token: getIdentityToken,
            origin: location.origin,
            fetch: (input, init) => window.fetch(input, init),
          },
          Boolean(space.team?.churchId)
        ),
        lock: work => navigator.locks.request(`chordless-space-data-${spaceId}`, work),
        pushed: () => window.dispatchEvent(new SyncPushedEvent(teamId)),
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
    controllers.set(spaceId, creating)
    void creating.catch(() => controllers.delete(spaceId))
  }
  const sync = await creating
  if (space.team.churchId) {
    const db = await openSpace(spaceId, 'sync')
    await syncLibrarySongs(teamId, db, {
      token: getIdentityToken,
      origin: location.origin,
      fetch: (input, init) => window.fetch(input, init),
    })
  }
  await sync.sync(options)
  failures.delete(spaceId)
}

export async function syncCurrentSpaceData(): Promise<void> {
  const { id } = getCurrentSpace()
  if (id) await syncSpaceDataFor(id)
}

/** Network failures retain the outbox; ticks, reconnect, and an explicit retry can send it later. */
function send(spaceId = getCurrentSpace().id ?? undefined): void {
  if (!spaceId) return
  void syncSpaceDataFor(spaceId).catch(error => {
    const reason = errorMessage(error)
    if (failures.get(spaceId) === reason) return
    failures.set(spaceId, reason)
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
