/**
 * What a person keeps for themselves, on the server (docs/PERSONAL_LAYER.md, docs/CENTRAL_STORAGE.md step 5): their
 * overlay of each setlist, of each song, and the settings that describe them. Only the signed-in account reads or
 * writes its own, and nothing of it is kept by a shared cache. A document is the client's to shape (the Worker
 * checks it is an object of a sane size, and that the settings are known ones); a write names the version it was
 * made from, and is refused with the current one if another device wrote first.
 *
 *   GET  /api/account/overlays         everything the account keeps, for the setlists and libraries it can still reach
 *   POST /api/account/overlays/batch   { ops: [{ kind, op: 'put' | 'delete', …ids, baseVersion, body }] }
 *     kind 'setlist'     setlistId
 *     kind 'song'        libraryId, songUuid
 *     kind 'preferences'
 */
import { PERSONAL_PREFERENCE_KEYS } from '../../src/js/personal-preference-keys.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { isRecord, jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'

const PATH = /^\/api\/account\/overlays(?:\/(batch))?$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
export const isOverlayPath = (path: string) => PATH.test(path)

const LIMIT = { setlist: 256 * 1024, song: 64 * 1024, preferences: 16 * 1024 }

type OverlayResult =
  | { status: 'ok'; version: number }
  | { status: 'conflict'; current: { body: unknown; version: number } | null }
  | { status: 'missing' }
  | { status: 'forbidden' }
  | { status: 'invalid'; error: string }

/** The setlists the account may still reach: its own, and those of the teams of churches it is in */
const SETLIST_REACH = `(EXISTS (SELECT 1 FROM setlists s WHERE s.setlist_id = o.setlist_id AND s.account_id = o.account_id)
  OR EXISTS (SELECT 1 FROM setlists s JOIN teams t ON t.space_id = s.space_id JOIN churches c ON c.church_id = t.church_id
    JOIN church_members m ON m.church_id = c.church_id AND m.account_id = o.account_id
    WHERE s.setlist_id = o.setlist_id AND c.ended_at IS NULL))`

/** The libraries the account may still reach: its own, and its churches' */
const LIBRARY_REACH = `(EXISTS (SELECT 1 FROM libraries l WHERE l.library_id = o.library_id AND l.account_id = o.account_id AND l.church_id IS NULL)
  OR EXISTS (SELECT 1 FROM libraries l JOIN churches c ON c.church_id = l.church_id JOIN church_members m ON m.church_id = c.church_id AND m.account_id = o.account_id
    WHERE l.library_id = o.library_id AND c.ended_at IS NULL))`

interface Target {
  table: 'setlist_overlays' | 'song_overlays' | 'account_preferences'
  /** The columns after account_id that name the row */
  keys: string[]
  ids: string[]
  limit: number
  reach: string | null
  alias: string
}

function target(op: Record<string, unknown>): Target | string {
  if (op.kind === 'setlist') {
    if (typeof op.setlistId !== 'string' || !ID.test(op.setlistId)) return 'Not a setlist'
    return {
      table: 'setlist_overlays',
      keys: ['setlist_id'],
      ids: [op.setlistId],
      limit: LIMIT.setlist,
      reach: SETLIST_REACH,
      alias: 'o',
    }
  }
  if (op.kind === 'song') {
    if (
      typeof op.libraryId !== 'string' ||
      !ID.test(op.libraryId) ||
      typeof op.songUuid !== 'string' ||
      op.songUuid === '' ||
      op.songUuid.length > 200
    )
      return 'Not a song'
    return {
      table: 'song_overlays',
      keys: ['library_id', 'song_uuid'],
      ids: [op.libraryId, op.songUuid],
      limit: LIMIT.song,
      reach: LIBRARY_REACH,
      alias: 'o',
    }
  }
  if (op.kind === 'preferences')
    return {
      table: 'account_preferences',
      keys: [],
      ids: [],
      limit: LIMIT.preferences,
      reach: null,
      alias: 'o',
    }
  return 'Not an overlay'
}

const where = (t: Target) =>
  ['o.account_id = ?', ...t.keys.map(key => `o.${key} = ?`)].join(' AND ')

async function currentOf(db: D1Db, account: string, t: Target) {
  const row = await db
    .prepare(`SELECT o.body, o.version FROM ${t.table} o WHERE ${where(t)}`)
    .bind(account, ...t.ids)
    .first<{ body: string; version: number }>()
  return row ? { body: JSON.parse(row.body) as unknown, version: row.version } : null
}

function bodyProblem(kind: unknown, body: unknown, limit: number): string | null {
  if (!isRecord(body)) return 'An overlay is an object'
  if (JSON.stringify(body).length > limit) return 'The overlay is too large'
  if (kind === 'preferences') {
    const known: readonly string[] = PERSONAL_PREFERENCE_KEYS
    for (const [key, value] of Object.entries(body))
      if (!known.includes(key) || typeof value !== 'string') return `Not a setting: ${key}`
  }
  return null
}

async function applyOverlay(db: D1Db, account: string, value: unknown): Promise<OverlayResult> {
  if (!isRecord(value)) return { status: 'invalid', error: 'Not an overlay' }
  const t = target(value)
  if (typeof t === 'string') return { status: 'invalid', error: t }
  const base = value.baseVersion
  if (base !== null && (!Number.isInteger(base) || (base as number) < 1))
    return { status: 'invalid', error: 'A write needs a base version' }
  const baseVersion = base as number | null
  const names = ['account_id', ...t.keys]
  const holds = (alias: string) => t.reach?.replaceAll('o.', `${alias}.`) ?? '1'

  if (value.op === 'delete') {
    const result = await db
      .prepare(`DELETE FROM ${t.table} AS o WHERE ${where(t)} AND (? IS NULL OR o.version = ?)`)
      .bind(account, ...t.ids, baseVersion, baseVersion)
      .run()
    if (result.meta.changes) return { status: 'ok', version: 0 }
    const row = await currentOf(db, account, t)
    return row ? { status: 'conflict', current: row } : { status: 'ok', version: 0 }
  }
  if (value.op !== 'put') return { status: 'invalid', error: 'Not a change' }
  const problem = bodyProblem(value.kind, value.body, t.limit)
  if (problem) return { status: 'invalid', error: problem }
  const body = JSON.stringify(value.body)
  const now = new Date().toISOString()

  if (baseVersion === null) {
    // a new row, only for something the account can reach (the foreign key refuses what does not exist)
    const reach = t.reach
      ? `AND EXISTS (SELECT 1 FROM (SELECT ? AS account_id, ${t.keys.map(key => `? AS ${key}`).join(', ')}) o WHERE ${t.reach})`
      : ''
    const extra = t.reach ? [account, ...t.ids] : []
    try {
      const result = await db
        .prepare(
          `INSERT INTO ${t.table} (${names.join(', ')}, body, version, modified_at)
           SELECT ${names.map(() => '?').join(', ')}, ?, 1, ? WHERE 1 ${reach}`
        )
        .bind(account, ...t.ids, body, now, ...extra)
        .run()
      if (result.meta.changes) return { status: 'ok', version: 1 }
    } catch (error) {
      // (a song that is not in the library is the foreign key's to refuse)
      if (/FOREIGN KEY/i.test(String(error))) return { status: 'forbidden' }
      /* v8 ignore next -- an unexpected database failure must propagate to the Worker error handler */
      if (!/UNIQUE constraint failed|PRIMARY KEY/i.test(String(error))) throw error
      return { status: 'conflict', current: await currentOf(db, account, t) }
    }
    // (nothing was made, and nothing was there to be in the way: it is not the account's to reach)
    return { status: 'forbidden' }
  }

  const result = await db
    .prepare(
      `UPDATE ${t.table} AS o SET body = ?, version = version + 1, modified_at = ?
       WHERE ${where(t)} AND o.version = ? AND ${holds('o')}`
    )
    .bind(body, now, account, ...t.ids, baseVersion)
    .run()
  if (result.meta.changes) return { status: 'ok', version: baseVersion + 1 }
  const existing = await currentOf(db, account, t)
  if (!existing) return { status: 'missing' }
  return existing.version === baseVersion
    ? { status: 'forbidden' }
    : { status: 'conflict', current: existing }
}

export function handleOverlays(request: Request, env: Env): Promise<Response> {
  const answer = refusing(async () => {
    if (!env.DB) throw new Refusal(503, 'Personal storage is not available')
    const identity = await authenticate(request, [sessionProvider(env)])
    if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
    const match = PATH.exec(new URL(request.url).pathname)
    if (!match) throw new Refusal(404, 'Not found')
    const db = env.DB
    const account = identity.sub

    if (!match[1] && request.method === 'GET') {
      const [setlists, songs, preferences] = await Promise.all([
        db
          .prepare(
            `SELECT o.setlist_id, o.body, o.version FROM setlist_overlays o WHERE o.account_id = ? AND ${SETLIST_REACH} ORDER BY o.setlist_id`
          )
          .bind(account)
          .all<{ setlist_id: string; body: string; version: number }>(),
        db
          .prepare(
            `SELECT o.library_id, o.song_uuid, o.body, o.version FROM song_overlays o WHERE o.account_id = ? AND ${LIBRARY_REACH} ORDER BY o.library_id, o.song_uuid`
          )
          .bind(account)
          .all<{ library_id: string; song_uuid: string; body: string; version: number }>(),
        db
          .prepare('SELECT body, version FROM account_preferences WHERE account_id = ?')
          .bind(account)
          .first<{ body: string; version: number }>(),
      ])
      const data = {
        preferences: preferences
          ? { body: JSON.parse(preferences.body), version: preferences.version }
          : null,
        setlists: setlists.results.map(row => ({
          setlistId: row.setlist_id,
          body: JSON.parse(row.body),
          version: row.version,
        })),
        songs: songs.results.map(row => ({
          libraryId: row.library_id,
          songUuid: row.song_uuid,
          body: JSON.parse(row.body),
          version: row.version,
        })),
      }
      const etag = `"${await sha256Hex(JSON.stringify(data))}"`
      const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
      if (request.headers.get('If-None-Match') === etag)
        return new Response(null, { status: 304, headers })
      return Response.json(data, { headers })
    }
    if (match[1] && request.method === 'POST') {
      const body = await readJson(request)
      if (!Array.isArray(body.ops) || body.ops.length > 100) throw new Refusal(400, 'Invalid batch')
      const results: OverlayResult[] = []
      for (const op of body.ops) results.push(await applyOverlay(db, account, op))
      return jsonResponse({ results })
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
