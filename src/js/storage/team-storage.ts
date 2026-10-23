/**
 * The storage API (types.ts) for a team space, as a member sees it: every call goes to the
 * Worker (`worker/src/team-api.ts`), which checks the member's role and passes it on to the
 * space's Drive. Nothing is cached or kept here. See docs/STORAGE_API.md, "The team backend".
 *
 * A team space's root ref is the space's id (issued, not found by name), and bodies are text:
 * share links and pad audio are not served for team spaces yet.
 */
import type { SpaceMember } from '../data-types.ts'
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

/** An answer from the Worker that was not a success */
export class TeamStorageError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'TeamStorageError'
    this.status = status
  }
}

export interface TeamStorageOptions {
  /** The Worker's session token for this person (docs/SPACES.md, "Setting up and joining") */
  token: () => Promise<string>
  /** Where the Worker is: the page's own origin */
  origin: string
  fetch: typeof fetch
}

/** What a call to the Worker is */
interface Call {
  method?: 'GET' | 'POST' | 'PUT'
  path: string
  query?: Record<string, string>
  body?: unknown
}

class TeamClient {
  #options: TeamStorageOptions
  #refused = 0

  constructor(options: TeamStorageOptions) {
    this.#options = options
  }

  /** How many writes were refused with a 403, since this was made */
  get refusals(): number {
    return this.#refused
  }

  async #send(spaceId: string, { method = 'GET', path, query, body }: Call): Promise<Response> {
    const url = new URL(`/api/space/${encodeURIComponent(spaceId)}${path}`, this.#options.origin)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    const token = await this.#options.token()
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await this.#options.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.ok) return response
    if (response.status === 403 && method !== 'GET') this.#refused++
    let reason = response.statusText
    try {
      reason = ((await response.json()) as { error?: string }).error ?? reason
    } catch {
      // (an answer that was not ours: the status text will do)
    }
    if (response.status === 403 && /not a member/i.test(reason)) {
      // (which account and space were refused: the way to tell a wrong sign-in from a stale space)
      const who = emailIn(token)
      reason = `${reason} (${who ? `signed in as ${who}, ` : ''}space ${spaceId})`
    }
    throw new TeamStorageError(reason || `Error ${response.status}`, response.status)
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

/** The address an ID token is for. Only read, to say who was refused: the Worker is what checks it. */
function emailIn(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const { email } = JSON.parse(atob(payload)) as { email?: unknown }
    return typeof email === 'string' ? email : null
  } catch {
    return null
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
          if (error instanceof TeamStorageError && error.status === 410) throw new ChangeTokenLost()
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
      if (error instanceof TeamStorageError && error.status === 404) return null
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
  #options: TeamStorageOptions

  constructor(options: TeamStorageOptions) {
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
      if (error instanceof TeamStorageError && error.status === 404) return null
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
