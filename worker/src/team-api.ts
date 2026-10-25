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
 *   GET  /changes/start                     {token}: where the feed of changes stands now
 *   GET  /changes?token=                    what changed since: {token, changed, gone} (410: forgotten)
 *   GET  /files/<ref>                       status (404 for a file that does not exist)
 *   GET  /files/<ref>/text                  the file's text
 *   POST /read-many         {refs}          {texts}
 *   POST /files?collection= {input, body, publicLink?}  create (publicLink: shares only)
 *   POST /create-many?collection= {items}   {results}
 *   PUT  /files/<ref>       {input, body}   update
 *   POST /update-many       {items}         {results}
 *   POST /files/<ref>/unpublish             writers; ends a share link
 *   POST /files/<ref>/trash                 writers
 *
 * Bodies are text. Share links and pad audio are not served yet.
 */
import type { SpaceMember } from '../../src/js/data-types.ts'
import {
  ChangeTokenLost,
  type Collection,
  type FileInput,
  type SpaceStorage,
} from '../../src/js/storage/types.ts'
import { atLeast, type TeamRole } from '../../src/js/team-roles.ts'
import { answering, isRecord, jsonResponse, Refusal, readJson } from './http.ts'

/** Why a request may do nothing in a space */
export type NoAccess = 'unauthenticated' | 'not-a-member'

/** What the team space's Durable Object and its credentials provide (src: the next step) */
export interface TeamContext {
  /** The space's files; null if there is no such space */
  space(spaceId: string): Promise<SpaceStorage | null>
  /** The space's root, for `GET /root` */
  root(spaceId: string): Promise<{ ref: string; name: string; trashed: boolean } | null>
  /**
   * Whether a file belongs to the space. Calls are kept inside the space's tree, so a member who
   * knows another file's ref gets nothing of it.
   */
  owns(spaceId: string, ref: string): Promise<boolean>
  /** Those of these refs that belong to the space: one question for a batch */
  ownedAmong(spaceId: string, refs: string[]): Promise<string[]>
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

/** The answer for a request that may do nothing in the space */
export function refusal(why: NoAccess): Response {
  return why === 'unauthenticated'
    ? jsonResponse({ error: 'Sign in first' }, 401)
    : jsonResponse({ error: 'Not a member of this space' }, 403)
}

/**
 * Answer a team space request; `path` was matched by `teamSpacePath`, and `role` is the role in
 * the space of whoever is asking (team-routes.ts settles it first)
 */
export async function handleTeamRequest(
  request: Request,
  { spaceId, rest }: { spaceId: string; rest: string },
  context: TeamContext,
  role: TeamRole
): Promise<Response> {
  return answering('Team space', async () => {
    const space = await context.space(spaceId)
    if (!space) return jsonResponse({ error: 'No such space' }, 404)
    const url = new URL(request.url)
    const method = request.method
    const write = () => {
      if (!atLeast(role, 'writer')) throw new Refusal(403, 'This role may not change files')
    }
    const owned = async (ref: string) => (await context.owns(spaceId, ref)) === true
    const ownedOf = async (refs: string[]) => new Set(await context.ownedAmong(spaceId, refs))

    if (method === 'GET' && rest === '/root') {
      const root = await context.root(spaceId)
      if (!root) return jsonResponse({ error: 'No such space' }, 404)
      // (the ref a member knows the space by is the space's id: the folder behind it is the
      // owner's business, and every later call is made to the id a root names)
      return jsonResponse({ ...root, ref: spaceId, canWrite: atLeast(role, 'writer') })
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
    if (method === 'GET' && (rest === '/changes/start' || rest === '/changes')) {
      const feed = space.changes
      if (!feed) return jsonResponse({ error: 'This space has no feed of changes' }, 404)
      if (rest === '/changes/start') return jsonResponse({ token: await feed.start() })
      const token = url.searchParams.get('token')
      if (!token) throw new Refusal(400, 'A feed position is needed')
      try {
        return jsonResponse(await feed.since(token))
      } catch (error) {
        if (error instanceof ChangeTokenLost) {
          return jsonResponse({ error: 'That position in the feed is forgotten' }, 410)
        }
        throw error
      }
    }
    if (method === 'POST' && rest === '/read-many') {
      const refs = asList((await readJson(request)).refs, 'refs')
      const wanted = refs.filter((ref): ref is string => typeof ref === 'string')
      if (wanted.length !== refs.length) throw new Refusal(400, 'A ref is not text')
      const here = await ownedOf(wanted)
      const texts = await space.readMany(wanted.filter(ref => here.has(ref)))
      let next = 0
      return jsonResponse({ texts: wanted.map(ref => (here.has(ref) ? texts[next++] : null)) })
    }
    if (method === 'POST' && rest === '/files') {
      write()
      const collection = collectionOf(url)
      const json = await readJson(request)
      const { input, body } = asWrite(json)
      // (only a share is made readable by anyone: its body is ciphertext; a chart never is)
      const publicLink = json.publicLink === true
      if (publicLink && collection !== 'shares') {
        throw new Refusal(400, 'Only a share can have a public link')
      }
      return jsonResponse(await space.create(collection, input, body, { publicLink }))
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
      const here = await ownedOf(items.map(item => item.ref))
      const results = await space.updateMany(items.filter(item => here.has(item.ref)))
      let next = 0
      return jsonResponse({
        results: items.map(item => (here.has(item.ref) ? results[next++] : null)),
      })
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
        if (!(await owned(ref))) return jsonResponse({ error: 'No such file' }, 404)
        await space.unpublish(ref)
        return new Response(null, { status: 204 })
      }
    }
    return jsonResponse({ error: 'Not found' }, 404)
  })
}
