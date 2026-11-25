/** The device's D1 sync: read space data responses, then send durable record edits without Drive's debounce. */
import type { SpaceOutboxRecord } from './data-types.ts'
import type { SpaceDataStore } from './space-data-store.ts'
import type { SpaceData, SpaceOp, SpaceOpResult } from './space-data-types.ts'
import { callWorker, TeamError, type WorkerConnection } from './worker-call.ts'

export type SpaceDataResponse =
  | { moved: false }
  | { unchanged: true }
  | { data: SpaceData; etag: string | null }
export interface SpaceDataTransport {
  read(options: { all: boolean; etag: string | null }): Promise<SpaceDataResponse>
  write(ops: SpaceOp[]): Promise<SpaceOpResult[]>
}

export function spaceDataTransport(
  spaceId: string,
  connection: WorkerConnection,
  churchTeam = false
): SpaceDataTransport {
  const path = `/api/${churchTeam ? 'teams' : 'space'}/${encodeURIComponent(spaceId)}`
  return {
    async read({ all, etag }) {
      try {
        const response = await callWorker(
          {
            path: `${path}/data`,
            query: all ? { all: '1' } : undefined,
            headers: etag ? { 'If-None-Match': etag } : undefined,
            allowNotModified: true,
          },
          connection
        )
        if (response.status === 304) return { unchanged: true }
        return { data: (await response.json()) as SpaceData, etag: response.headers.get('ETag') }
      } catch (error) {
        if (error instanceof TeamError && error.status === 409 && error.message === 'not_moved')
          return { moved: false }
        throw error
      }
    },
    async write(ops) {
      const response = await callWorker(
        { method: 'POST', path: `${path}/batch`, body: { ops } },
        connection
      )
      const { results } = (await response.json()) as { results: SpaceOpResult[] }
      if (!Array.isArray(results) || results.length !== ops.length)
        throw new Error('Invalid space write response')
      return results
    },
  }
}

/**
 * A Personal space's setlists on the server (`/api/account/setlists`, worker/src/personal-setlists.ts): read and
 * written as a Team's are, but only the setlists (its songs are the personal library's, and it has no people or pads
 * there), so the rest of the data is empty.
 */
export function personalDataTransport(connection: WorkerConnection): SpaceDataTransport {
  return {
    async read({ etag }) {
      const response = await callWorker(
        {
          path: '/api/account/setlists',
          headers: etag ? { 'If-None-Match': etag } : undefined,
          allowNotModified: true,
        },
        connection
      )
      if (response.status === 304) return { unchanged: true }
      const { setlists } = (await response.json()) as { setlists: SpaceData['setlists'] }
      return {
        data: { songs: [], setlists, people: [], padSets: [], from: null },
        etag: response.headers.get('ETag'),
      }
    },
    async write(ops) {
      const response = await callWorker(
        { method: 'POST', path: '/api/account/setlists/batch', body: { ops } },
        connection
      )
      const { results } = (await response.json()) as { results: SpaceOpResult[] }
      if (!Array.isArray(results) || results.length !== ops.length)
        throw new Error('Invalid space write response')
      return results
    },
  }
}

export class SpaceDataSync {
  #running: Promise<void> | null = null
  #again = false
  #all = false
  #retry = false
  readonly #store: SpaceDataStore
  readonly #transport: SpaceDataTransport
  readonly #online: () => boolean
  readonly #notify: {
    pushed?: () => void
    conflict?: () => void
    refused?: (reason: string) => void
  }
  readonly #lock: <T>(work: () => Promise<T>) => Promise<T>

  constructor(options: {
    store: SpaceDataStore
    transport: SpaceDataTransport
    online: () => boolean
    lock: <T>(work: () => Promise<T>) => Promise<T>
    pushed?: () => void
    conflict?: () => void
    refused?: (reason: string) => void
  }) {
    this.#store = options.store
    this.#transport = options.transport
    this.#online = options.online
    this.#lock = options.lock
    this.#notify = options
  }

  /** Calls made during an in-flight request get a trailing run, never a parallel sender. */
  sync({
    all = false,
    retryRefused = false,
  }: {
    all?: boolean
    retryRefused?: boolean
  } = {}): Promise<void> {
    this.#all ||= all
    this.#retry ||= retryRefused
    this.#again = true
    if (this.#running) return this.#running
    this.#running = this.#lock(async () => {
      do {
        this.#again = false
        if (!this.#online()) return
        const all = this.#all
        this.#all = false
        const retry = this.#retry
        this.#retry = false
        await this.#sync(all, retry)
      } while (this.#again && this.#online())
    }).finally(() => {
      this.#running = null
    })
    return this.#running
  }

  async #sync(all: boolean, retry: boolean): Promise<void> {
    const state = await this.#store.state()
    if (!state.enabled) {
      await this.#store.probe()
      if (!(await this.#read(true))) return
    }
    if (retry) await this.#store.retryRefused()
    // Bounded work, including conflicts and edits saved during a request; the next tick retries contention.
    for (let pass = 0; pass < 10 && this.#online(); pass++) {
      const pending = (await this.#store.pending()).filter(entry => !entry.refusal).slice(0, 100)
      if (!pending.length) break
      const results = await this.#transport.write(pending.map(entry => entry.change))
      if (results.length !== pending.length) throw new Error('Invalid space write response')
      let pushed = false
      for (let i = 0; i < pending.length; i++) {
        const result = results[i]
        if (!['ok', 'conflict', 'missing', 'forbidden', 'invalid'].includes(result.status))
          throw new Error('Invalid space write result')
        const settled = await this.#store.settle(pending[i] as SpaceOutboxRecord, result)
        if (settled.conflict) this.#notify.conflict?.()
        if (settled.refusal) this.#notify.refused?.(settled.refusal)
        pushed ||= result.status === 'ok'
      }
      if (pushed) this.#notify.pushed?.()
    }
    await this.#read(all)
  }

  async #read(all: boolean): Promise<boolean> {
    const state = await this.#store.state()
    const result = await this.#transport.read({
      all: all || !state.complete,
      etag: all ? null : state.etag,
    })
    if ('moved' in result) {
      if (state.enabled) throw new Error('A D1 space may not revert to Drive')
      await this.#store.notMoved()
      return false
    }
    if ('data' in result) await this.#store.apply(result.data, result.etag)
    else if (!state.enabled) throw new Error('First space data response was not returned')
    return true
  }
}
