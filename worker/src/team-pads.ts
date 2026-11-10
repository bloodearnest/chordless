/**
 * A team space's pad sets, for its members (docs/SPACES.md, "Pads in team spaces"): the audio in
 * the space's own `pads/` folder, passed through and never kept. Everything under
 * `/api/space/<id>/pads`:
 *
 *   GET  /pads                         the sets
 *   POST /pads             {name}      {ref}: the set of that name, made if there is none
 *   GET  /pads/<set>/files             the set's files
 *   PUT  /pads/<set>/files/<key>       a key's audio (audio/mpeg, up to MAX_PAD_BYTES)
 *   POST /pads/<set>/trash             admins: put the set's files in the bin, to fill it again
 *   GET  /pads/files/<ref>             a file's audio, streamed as Drive sends it
 *
 * Roles (docs/SPACES.md, "Roles"): any member may read and upload, readers too, but an upload only
 * adds: a set that is already there, or a key the set has, is replaced only by an admin (who bins
 * the old files first). So a team member cannot wipe the team's pads by mistake; they give the set
 * another name. Only sets and files the space's tree holds are reached.
 */
import { normalizePadKey, PAD_FILE_KEYS } from '../../src/js/pad-keys.ts'
import type { PadStorage } from '../../src/js/storage/types.ts'
import { atLeast, type TeamRole } from '../../src/js/team-roles.ts'
import { jsonResponse, Refusal, readJson } from './http.ts'

/** The largest pad file taken: a pad is a few MB, and the Worker holds an upload while it sends it */
export const MAX_PAD_BYTES = 20 * 1024 * 1024

/** The longest name a pad set is given */
const MAX_SET_NAME = 100

/** What the pad routes need of the space */
export interface PadContext {
  pads: PadStorage
  role: TeamRole
  /** Whether the ref is in the space's tree */
  owned(ref: string): Promise<boolean>
}

const notFound = () => jsonResponse({ error: 'No such pad set' }, 404)

function setName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > MAX_SET_NAME || /\p{Cc}/u.test(name)) {
    throw new Refusal(400, 'A pad set’s name is one line of text, up to 100 characters')
  }
  return name
}

/** The audio of an upload, refused if it is not a pad or is too big */
async function padAudio(request: Request): Promise<Blob> {
  const type = request.headers.get('Content-Type')?.split(';')[0].trim()
  if (type !== 'audio/mpeg') throw new Refusal(415, 'A pad is an MP3 file (audio/mpeg)')
  const declared = Number(request.headers.get('Content-Length'))
  if (declared > MAX_PAD_BYTES) throw new Refusal(413, 'That pad file is too big')
  const audio = await request.blob()
  if (audio.size > MAX_PAD_BYTES) throw new Refusal(413, 'That pad file is too big')
  if (audio.size === 0) throw new Refusal(400, 'That pad file is empty')
  return new Blob([audio], { type: 'audio/mpeg' })
}

/** Answer a request under `/pads`, or null if it is none of these */
export async function handlePadRequest(
  request: Request,
  rest: string,
  { pads, role, owned }: PadContext
): Promise<Response | null> {
  const method = request.method
  const admin = atLeast(role, 'admin')

  if (rest === '/pads' && method === 'GET') return jsonResponse(await pads.listSets())
  if (rest === '/pads' && method === 'POST') {
    const name = setName((await readJson(request)).name)
    const there = (await pads.listSets()).find(set => set.name === name)
    if (there && !admin) {
      throw new Refusal(
        409,
        `There is already a pad set called “${name}” here: give yours another name (only an admin can replace one)`
      )
    }
    return jsonResponse({ ref: await pads.ensureSet(name) })
  }

  const file = /^\/pads\/files\/([^/]+)$/.exec(rest)
  if (file && method === 'GET') {
    const ref = decodeURIComponent(file[1])
    if (!(await owned(ref))) return jsonResponse({ error: 'No such file' }, 404)
    return new Response(await pads.readStream(ref), {
      // (the page keeps the audio itself, in its own cache: nothing on the way may keep it)
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    })
  }

  const set = /^\/pads\/([^/]+)(\/files|\/files\/[^/]+|\/trash)$/.exec(rest)
  if (!set) return null
  const setRef = decodeURIComponent(set[1])
  const action = set[2]

  if (action === '/files' && method === 'GET') {
    if (!(await owned(setRef))) return notFound()
    return jsonResponse(await pads.listFiles(setRef))
  }
  if (action === '/trash' && method === 'POST') {
    if (!admin) throw new Refusal(403, 'Only an admin can replace or remove a pad set')
    if (!(await owned(setRef))) return notFound()
    await pads.trashFiles(setRef)
    return new Response(null, { status: 204 })
  }
  if (action.startsWith('/files/') && method === 'PUT') {
    const key = normalizePadKey(decodeURIComponent(action.slice('/files/'.length)))
    if (!key || !PAD_FILE_KEYS.some(each => each === key)) {
      throw new Refusal(400, 'Not a pad key')
    }
    const audio = await padAudio(request)
    if (!(await owned(setRef))) return notFound()
    if (!admin && (await pads.listFiles(setRef)).some(each => each.padKey === key)) {
      throw new Refusal(409, `This pad set already has ${key}: only an admin can replace it`)
    }
    await pads.addFile(setRef, key, audio)
    return new Response(null, { status: 204 })
  }
  return null
}
