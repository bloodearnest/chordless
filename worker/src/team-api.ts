/**
 * The storage API (src/js/storage/types.ts) over HTTP, for the members of a team space
 * (docs/SPACES.md, docs/STORAGE_API.md "The team backend"). `TeamStorage` in the app is the client.
 *
 * Everything under `/api/space/<id>/`. A request is checked for who is asking and what role they
 * have in that space, then handed to the space's storage, whatever backs it (the owner's token, a
 * service account, a fake in tests). Nothing is kept here: bodies pass through.
 *
 *   GET  /root                              the space's root, with whether this person may write
 *   GET  /members                           the people the space is shared with
 *   GET  /files?collection=                 list
 *   GET  /inventory                         the refs of every live file
 *   GET  /files/<ref>                       status (404 for a file that does not exist)
 *   GET  /files/<ref>/text                  the file's text
 *   POST /read-many         {refs}          {texts}
 *   POST /files?collection= {input, body}   create
 *   POST /create-many?collection= {items}   {results}
 *   PUT  /files/<ref>       {input, body}   update
 *   POST /update-many       {items}         {results}
 *   POST /files/<ref>/unpublish             writers; not supported yet for team spaces
 *   POST /files/<ref>/trash                 writers
 *
 * Bodies are text. Share links and pad audio are not served yet.
 */
import type { SpaceMember } from '../../src/js/data-types.ts'
import type { Collection, FileInput, SpaceStorage } from '../../src/js/storage/types.ts'
import { isRecord, jsonResponse, message, Refusal, readJson } from './http.ts'

export type Role = 'owner' | 'admin' | 'writer' | 'reader'

/** What a request may do in a space: its role, or why it may do nothing */
export type Access = Role | 'unauthenticated' | 'not-a-member'

const RANK: Record<Role, number> = { reader: 0, writer: 1, admin: 2, owner: 3 }

/** Whether a role is at least another */
export function atLeast(role: Role, needed: Role): boolean {
  return RANK[role] >= RANK[needed]
}

/** What the team space's Durable Object and its credentials provide (src: the next step) */
export interface TeamContext {
  /** Who is asking, and their role in this space: checked before anything else is looked at */
  access(request: Request, spaceId: string): Promise<Access>
  /** The space's files; null if there is no such space */
  space(spaceId: string): Promise<SpaceStorage | null>
  /** The space's root, for `GET /root` */
  root(spaceId: string): Promise<{ ref: string; name: string; trashed: boolean } | null>
  /**
   * Whether a file belongs to the space. Calls are kept inside the space's tree, so a member who
   * knows another file's ref gets nothing of it.
   */
  owns(spaceId: string, ref: string): Promise<boolean>
}

const COLLECTIONS: Collection[] = ['songs', 'setlists', 'shares']

/** The space id and the rest of the path, if this is a team space request */
export function teamSpacePath(path: string): { spaceId: string; rest: string } | null {
  const match = /^\/api\/space\/([^/]+)(\/.*)?$/.exec(path)
  if (!match) return null
  return { spaceId: decodeURIComponent(match[1]), rest: match[2] ?? '/' }
}

function asFileInput(value: unknown): FileInput {
  if (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    isRecord(value.props) &&
    Object.values(value.props).every(prop => typeof prop === 'string' || prop === null)
  ) {
    return value as unknown as FileInput
  }
  throw new Refusal(400, 'Not a file description')
}

interface Write {
  input: FileInput
  body: string
}

function asWrite(value: unknown): Write {
  if (!isRecord(value) || typeof value.body !== 'string') {
    throw new Refusal(400, 'A file needs a text body')
  }
  return { input: asFileInput(value.input), body: value.body }
}

function asList(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Refusal(400, `${what} must be a list`)
  return value
}

function collectionOf(url: URL): Collection {
  const collection = url.searchParams.get('collection')
  const known = COLLECTIONS.find(each => each === collection)
  if (!known) throw new Refusal(400, 'Unknown collection')
  return known
}

/** The status the storage gave an error, if it is one a client may be told */
function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 502
}

/** Answer a team space request; `path` was matched by `teamSpacePath` */
export async function handleTeamRequest(
  request: Request,
  { spaceId, rest }: { spaceId: string; rest: string },
  context: TeamContext
): Promise<Response> {
  const access = await context.access(request, spaceId)
  if (access === 'unauthenticated') return jsonResponse({ error: 'Sign in first' }, 401)
  if (access === 'not-a-member') return jsonResponse({ error: 'Not a member of this space' }, 403)
  const role: Role = access

  try {
    const space = await context.space(spaceId)
    if (!space) return jsonResponse({ error: 'No such space' }, 404)
    const url = new URL(request.url)
    const method = request.method
    const write = () => {
      if (!atLeast(role, 'writer')) throw new Refusal(403, 'This role may not change files')
    }
    const owned = async (ref: string) => (await context.owns(spaceId, ref)) === true

    if (method === 'GET' && rest === '/root') {
      const root = await context.root(spaceId)
      if (!root) return jsonResponse({ error: 'No such space' }, 404)
      return jsonResponse({ ...root, canWrite: atLeast(role, 'writer') })
    }
    if (method === 'GET' && rest === '/members') {
      const members: SpaceMember[] = await space.members()
      return jsonResponse(members)
    }
    if (method === 'GET' && rest === '/files') {
      return jsonResponse(await space.list(collectionOf(url)))
    }
    if (method === 'GET' && rest === '/inventory') {
      return jsonResponse([...(await space.inventory())])
    }
    if (method === 'POST' && rest === '/read-many') {
      const refs = asList((await readJson(request)).refs, 'refs')
      const wanted = refs.filter((ref): ref is string => typeof ref === 'string')
      if (wanted.length !== refs.length) throw new Refusal(400, 'A ref is not text')
      const here = await Promise.all(wanted.map(owned))
      const texts = await space.readMany(wanted.filter((_, i) => here[i]))
      let next = 0
      return jsonResponse({ texts: wanted.map((_, i) => (here[i] ? texts[next++] : null)) })
    }
    if (method === 'POST' && rest === '/files') {
      write()
      const collection = collectionOf(url)
      const { input, body } = asWrite(await readJson(request))
      return jsonResponse(await space.create(collection, input, body))
    }
    if (method === 'POST' && rest === '/create-many') {
      write()
      const collection = collectionOf(url)
      const items = asList((await readJson(request)).items, 'items').map(asWrite)
      return jsonResponse({ results: await space.createMany(collection, items) })
    }
    if (method === 'POST' && rest === '/update-many') {
      write()
      const items = asList((await readJson(request)).items, 'items').map(item => {
        if (!isRecord(item) || typeof item.ref !== 'string') throw new Refusal(400, 'No ref')
        return { ref: item.ref, ...asWrite(item) }
      })
      const here = await Promise.all(items.map(item => owned(item.ref)))
      const results = await space.updateMany(items.filter((_, i) => here[i]))
      let next = 0
      return jsonResponse({ results: items.map((_, i) => (here[i] ? results[next++] : null)) })
    }

    const file = /^\/files\/([^/]+)(\/text|\/unpublish|\/trash)?$/.exec(rest)
    if (file) {
      const ref = decodeURIComponent(file[1])
      const action = file[2]
      if (method === 'GET' && action === undefined) {
        const status = (await owned(ref)) ? await space.status(ref) : null
        return status ? jsonResponse(status) : jsonResponse({ error: 'No such file' }, 404)
      }
      if (method === 'GET' && action === '/text') {
        if (!(await owned(ref))) return jsonResponse({ error: 'No such file' }, 404)
        return new Response(await space.readText(ref), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
      if (method === 'PUT' && action === undefined) {
        write()
        const { input, body } = asWrite(await readJson(request))
        if (!(await owned(ref))) return jsonResponse({ error: 'No such file' }, 404)
        return jsonResponse(await space.update(ref, input, body))
      }
      if (method === 'POST' && action === '/trash') {
        write()
        // (a file that is not here is as good as gone, which is fine to bin)
        if (await owned(ref)) await space.trash(ref)
        return new Response(null, { status: 204 })
      }
      if (method === 'POST' && action === '/unpublish') {
        write()
        return jsonResponse({ error: 'Share links are not served for team spaces yet' }, 501)
      }
    }
    return jsonResponse({ error: 'Not found' }, 404)
  } catch (error) {
    if (error instanceof Refusal) return jsonResponse({ error: error.message }, error.status)
    console.error('Team space error:', message(error))
    return jsonResponse({ error: message(error) }, statusOf(error))
  }
}
