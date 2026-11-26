/**
 * What a person keeps for themselves, on the server (docs/PERSONAL_LAYER.md, docs/CENTRAL_STORAGE.md step 5): their overlay
 * of each setlist and of each song, and the settings that describe them, as one document the account owns. Only the
 * signed-in account reads or writes its own, and nothing of it is kept by a shared cache. The Worker checks the document
 * is of the shape and size it should be and that the settings are known ones; what is in a setlist's or song's overlay
 * is the client's. A write names the version it was made from and is refused, with the current document, if another
 * device wrote first. What the account can no longer reach (a setlist of a church it has left) is left out of what is
 * read and of what is kept: the person's own copy of it stays on their device.
 *
 *   GET /api/account/overlays   { version, body }; version 0 and an empty body for an account that has none
 *   PUT /api/account/overlays   { baseVersion, body } → { version }, or 409 with { current: { version, body } }
 *
 * body: { settings: { <setting>: text }, setlists: { <setlist id>: {…} }, songs: { <song uuid>: {…} } }
 */
import { PERSONAL_PREFERENCE_KEYS } from '../../src/js/personal-preference-keys.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { isRecord, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'

const PATH = /^\/api\/account\/overlays$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
export const isOverlayPath = (path: string) => PATH.test(path)

/** The largest the document may be (a setlist's state with its annotations is a few KB) */
const MAX_BYTES = 1024 * 1024

interface Overlays {
  settings: Record<string, string>
  setlists: Record<string, Record<string, unknown>>
  songs: Record<string, Record<string, unknown>>
}

const empty = (): Overlays => ({ settings: {}, setlists: {}, songs: {} })

/** The document as the client sent it, or the reason it is not one */
function parse(value: unknown): Overlays | string {
  if (!isRecord(value)) return 'The overlays are an object'
  if (JSON.stringify(value).length > MAX_BYTES) return 'The overlays are too large'
  const { settings = {}, setlists = {}, songs = {}, ...rest } = value
  if (Object.keys(rest).length) return `Not part of the overlays: ${Object.keys(rest)[0]}`
  if (!isRecord(settings) || !isRecord(setlists) || !isRecord(songs)) return 'Not overlays'
  const known: readonly string[] = PERSONAL_PREFERENCE_KEYS
  for (const [key, text] of Object.entries(settings))
    if (!known.includes(key) || typeof text !== 'string') return `Not a setting: ${key}`
  for (const [id, overlay] of Object.entries(setlists))
    if (!ID.test(id) || !isRecord(overlay)) return `Not a setlist overlay: ${id}`
  for (const [id, overlay] of Object.entries(songs))
    if (id.length < 1 || id.length > 200 || !isRecord(overlay)) return `Not a song overlay: ${id}`
  return { settings, setlists, songs } as Overlays
}

/** The setlists of these ids that the account may reach: its own, and those of teams of churches it is in */
async function reachableSetlists(db: D1Db, account: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { results } = await db
    .prepare(`SELECT s.setlist_id FROM setlists s WHERE s.setlist_id IN (SELECT value FROM json_each(?)) AND (s.account_id = ?
      OR EXISTS (SELECT 1 FROM teams t JOIN churches c ON c.church_id = t.church_id
        JOIN church_members m ON m.church_id = c.church_id AND m.account_id = ?
        WHERE t.space_id = s.space_id AND c.ended_at IS NULL))`)
    .bind(JSON.stringify(ids), account, account)
    .all<{ setlist_id: string }>()
  return new Set(results.map(row => row.setlist_id))
}

/** The songs of these uuids that are in a library the account may reach: its own, or its churches' */
async function reachableSongs(db: D1Db, account: string, uuids: string[]): Promise<Set<string>> {
  if (!uuids.length) return new Set()
  const { results } = await db
    .prepare(`SELECT ls.song_uuid FROM library_songs ls JOIN libraries l ON l.library_id = ls.library_id
      WHERE ls.song_uuid IN (SELECT value FROM json_each(?)) AND (l.account_id = ?
      OR EXISTS (SELECT 1 FROM churches c JOIN church_members m ON m.church_id = c.church_id AND m.account_id = ?
        WHERE c.church_id = l.church_id AND c.ended_at IS NULL))`)
    .bind(JSON.stringify(uuids), account, account)
    .all<{ song_uuid: string }>()
  return new Set(results.map(row => row.song_uuid))
}

/** The document without what the account cannot reach */
async function reachable(db: D1Db, account: string, overlays: Overlays): Promise<Overlays> {
  const setlists = await reachableSetlists(db, account, Object.keys(overlays.setlists))
  const songs = await reachableSongs(db, account, Object.keys(overlays.songs))
  const only = (from: Overlays['setlists'], keep: Set<string>) =>
    Object.fromEntries(Object.entries(from).filter(([id]) => keep.has(id)))
  return {
    settings: overlays.settings,
    setlists: only(overlays.setlists, setlists),
    songs: only(overlays.songs, songs),
  }
}

async function current(db: D1Db, account: string): Promise<{ version: number; body: Overlays }> {
  const row = await db
    .prepare('SELECT body, version FROM account_overlays WHERE account_id = ?')
    .bind(account)
    .first<{ body: string; version: number }>()
  if (!row) return { version: 0, body: empty() }
  return { version: row.version, body: await reachable(db, account, JSON.parse(row.body)) }
}

export function handleOverlays(request: Request, env: Env): Promise<Response> {
  const answer = refusing(async () => {
    if (!env.DB) throw new Refusal(503, 'Personal storage is not available')
    const identity = await authenticate(request, [sessionProvider(env)])
    if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
    if (!PATH.test(new URL(request.url).pathname)) throw new Refusal(404, 'Not found')
    const db = env.DB
    const account = identity.sub

    if (request.method === 'GET') {
      const data = await current(db, account)
      const etag = `"${await sha256Hex(JSON.stringify(data))}"`
      const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
      if (request.headers.get('If-None-Match') === etag)
        return new Response(null, { status: 304, headers })
      return Response.json(data, { headers })
    }

    if (request.method === 'PUT') {
      const sent = await readJson(request)
      const base = sent.baseVersion
      if (!Number.isInteger(base) || (base as number) < 0)
        throw new Refusal(400, 'A write needs the version it was made from')
      const overlays = parse(sent.body)
      if (typeof overlays === 'string') throw new Refusal(400, overlays)
      const body = JSON.stringify(await reachable(db, account, overlays))
      const now = new Date().toISOString()
      try {
        const result =
          base === 0
            ? await db
                .prepare(
                  'INSERT INTO account_overlays (account_id, body, version, modified_at) VALUES (?, ?, 1, ?)'
                )
                .bind(account, body, now)
                .run()
            : await db
                .prepare(
                  'UPDATE account_overlays SET body = ?, version = version + 1, modified_at = ? WHERE account_id = ? AND version = ?'
                )
                .bind(body, now, account, base)
                .run()
        if (result.meta.changes) return Response.json({ version: (base as number) + 1 })
      } catch (error) {
        /* v8 ignore next -- an unexpected database failure must propagate to the Worker error handler */
        if (!/UNIQUE constraint failed|PRIMARY KEY/i.test(String(error))) throw error
      }
      // (another device wrote first, or there was nothing to write from: here is what is kept now)
      return Response.json(
        { error: 'The overlays changed', current: await current(db, account) },
        { status: 409 }
      )
    }
    throw new Refusal(404, 'Not found')
  })
  // One person's: whatever is cached must be by who asks, and what has no policy of its own is kept by nobody
  return answer.then(response => {
    const headers = new Headers(response.headers)
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'private, no-store')
    headers.append('Vary', 'Authorization')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  })
}
