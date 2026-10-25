/**
 * The storage API (types.ts) for a team space, as a member sees it: every call goes to the
 * Worker (`worker/src/team-api.ts`), which checks the member's role and passes it on to the
 * space's Drive. Nothing is cached or kept here. See docs/STORAGE_API.md, "The team backend".
 *
 * A team space's root ref is the space's id (issued, not found by name), and bodies are text:
 * share links and pad audio are not served for team spaces yet.
 */
import { jwtClaims } from '../base64url.ts'
import type { SpaceMember } from '../data-types.ts'
import { callWorker, TeamError, type WorkerCall, type WorkerConnection } from '../worker-call.ts'
import {
  type ChangeFeed,
  ChangeTokenLost,
  type Collection,
  type FileBody,
  type FileInput,
  type FileStatus,
  type PadStorage,
  type RootInfo,
  type SpaceStorage,
  type StorageBackend,
  type StoredFile,
  type WriteResult,
} from './types.ts'

/** What a call to the Worker is: its path is from the space's own (`/api/space/<id>`) */
type Call = Omit<WorkerCall, 'method'> & { method?: 'GET' | 'POST' | 'PUT' }

class TeamClient {
  #connection: WorkerConnection
  #refused = 0

  constructor(connection: WorkerConnection) {
    this.#connection = connection
  }

  /** How many writes were refused with a 403, since this was made */
  get refusals(): number {
    return this.#refused
  }

  async #send(spaceId: string, call: Call): Promise<Response> {
    const path = `/api/space/${encodeURIComponent(spaceId)}${call.path}`
    try {
      return await callWorker({ ...call, path }, this.#connection, (reason, status, token) => {
        if (status !== 403 || !/not a member/i.test(reason)) return reason
        // (which account and space were refused: the way to tell a wrong sign-in from a stale space)
        const who = jwtClaims(token)?.email
        return `${reason} (${typeof who === 'string' ? `signed in as ${who}, ` : ''}space ${spaceId})`
      })
    } catch (error) {
      if (error instanceof TeamError && error.status === 403 && (call.method ?? 'GET') !== 'GET') {
        this.#refused++
      }
      throw error
    }
  }

  /** The answer's JSON */
  async json<T>(spaceId: string, call: Call): Promise<T> {
    return (await this.#send(spaceId, call)).json() as Promise<T>
  }

  /** The answer's text */
  async text(spaceId: string, call: Call): Promise<string> {
    return (await this.#send(spaceId, call)).text()
  }

  /** Make the call, and say nothing of the answer */
  async run(spaceId: string, call: Call): Promise<void> {
    await this.#send(spaceId, call)
  }
}

/** Only text goes to a team space for now */
function textOf(body: FileBody): string {
  if (typeof body !== 'string') {
    throw new Error('A team space holds text only for now: this file is not text')
  }
  return body
}

class TeamSpace implements SpaceStorage {
  readonly changes: ChangeFeed
  #client: TeamClient
  #id: string

  constructor(client: TeamClient, id: string) {
    this.#client = client
    this.#id = id
    this.changes = {
      start: async () =>
        (await client.json<{ token: string }>(id, { path: '/changes/start' })).token,
      since: async token => {
        try {
          return await client.json(id, { path: '/changes', query: { token } })
        } catch (error) {
          // (the Worker says 410 when the feed has forgotten the position)
          if (error instanceof TeamError && error.status === 410) throw new ChangeTokenLost()
          throw error
        }
      },
    }
  }

  members(): Promise<SpaceMember[]> {
    return this.#client.json(this.#id, { path: '/members' })
  }

  list(collection: Collection): Promise<StoredFile[]> {
    return this.#client.json(this.#id, { path: '/files', query: { collection } })
  }

  async inventory(): Promise<Set<string>> {
    return new Set(await this.#client.json<string[]>(this.#id, { path: '/inventory' }))
  }

  async status(ref: string): Promise<FileStatus | null> {
    try {
      return await this.#client.json(this.#id, { path: `/files/${encodeURIComponent(ref)}` })
    } catch (error) {
      if (error instanceof TeamError && error.status === 404) return null
      throw error
    }
  }

  readText(ref: string): Promise<string> {
    return this.#client.text(this.#id, { path: `/files/${encodeURIComponent(ref)}/text` })
  }

  async readMany(refs: string[]): Promise<(string | null)[]> {
    if (refs.length === 0) return []
    const { texts } = await this.#client.json<{ texts: (string | null)[] }>(this.#id, {
      method: 'POST',
      path: '/read-many',
      body: { refs },
    })
    return texts
  }

  create(
    collection: Collection,
    input: FileInput,
    body: FileBody,
    options?: { publicLink?: boolean }
  ): Promise<WriteResult> {
    return this.#client.json(this.#id, {
      method: 'POST',
      path: '/files',
      query: { collection },
      body: { input, body: textOf(body), publicLink: options?.publicLink === true },
    })
  }

  async createMany(
    collection: Collection,
    items: { input: FileInput; body: string }[]
  ): Promise<(WriteResult | null)[]> {
    if (items.length === 0) return []
    const { results } = await this.#client.json<{ results: (WriteResult | null)[] }>(this.#id, {
      method: 'POST',
      path: '/create-many',
      query: { collection },
      body: { items },
    })
    return results
  }

  update(ref: string, input: FileInput, body: FileBody): Promise<WriteResult> {
    return this.#client.json(this.#id, {
      method: 'PUT',
      path: `/files/${encodeURIComponent(ref)}`,
      body: { input, body: textOf(body) },
    })
  }

  async updateMany(
    items: { ref: string; input: FileInput; body: string }[]
  ): Promise<(WriteResult | null)[]> {
    if (items.length === 0) return []
    const { results } = await this.#client.json<{ results: (WriteResult | null)[] }>(this.#id, {
      method: 'POST',
      path: '/update-many',
      body: { items },
    })
    return results
  }

  unpublish(ref: string): Promise<void> {
    return this.#client.run(this.#id, {
      method: 'POST',
      path: `/files/${encodeURIComponent(ref)}/unpublish`,
    })
  }

  trash(ref: string): Promise<void> {
    return this.#client.run(this.#id, {
      method: 'POST',
      path: `/files/${encodeURIComponent(ref)}/trash`,
    })
  }
}

/**
 * The backend for a team space. A space is joined, not found or made from here, so there is no
 * root to look up by name; pads follow when they move into the space.
 */
export class TeamStorage implements StorageBackend {
  #client: TeamClient
  #options: WorkerConnection

  constructor(options: WorkerConnection) {
    this.#client = new TeamClient(options)
    this.#options = options
  }

  get pads(): PadStorage {
    throw new Error('Pad sets are not served for team spaces yet')
  }

  async available(): Promise<boolean> {
    try {
      await this.#options.token()
      return true
    } catch {
      return false
    }
  }

  async inspectRoot(ref: string): Promise<RootInfo | null> {
    try {
      return await this.#client.json(ref, { path: '/root' })
    } catch (error) {
      if (error instanceof TeamError && error.status === 404) return null
      throw error
    }
  }

  async findRootByName(): Promise<RootInfo | null> {
    return null
  }

  async ensureRoot(): Promise<{ ref: string; isNew: boolean }> {
    throw new Error('A team space is joined, not made here')
  }

  /** The name belongs to the owner: what a member calls their copy is theirs, and sync goes on */
  async renameRoot(): Promise<void> {
    // (nothing to do)
  }

  space(rootRef: string): SpaceStorage {
    return new TeamSpace(this.#client, rootRef)
  }

  writeRefusals(): number {
    return this.#client.refusals
  }
}
