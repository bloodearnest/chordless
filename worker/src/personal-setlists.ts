/**
 * A person's own library and setlists on the server (docs/CENTRAL_STORAGE.md, step 5): the personal space, kept
 * beside the Drive sync until the cutover. Only the signed-in account reads or writes its own; there is no
 * team, church or role in it. Setlists are rows of `setlists` with `account_id` set and no `space_id`, and are
 * written as Team setlists are (a version to write from, and a result for each change), with these rules:
 * every song must be in the person's own library, and the leader is nobody or the person.
 *
 *   PUT  /api/account/library          makes the personal library if there is none, and says its id
 *   GET  /api/account/library          what the account holds: { libraryId or null, songs, setlists } (makes nothing)
 *   GET  /api/account/setlists         every one of them
 *   POST /api/account/setlists/batch   { ops: [{ kind: 'setlist', op: 'put' | 'delete', id, baseVersion, record }] }
 */
import type { SpaceOp, SpaceOpResult, SpaceSetlist } from '../../src/js/space-data-types.ts'
import { ulid } from '../../src/js/ulid.ts'
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { isRecord, jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'
import { changedSetlists, notifySetlistShares } from './share-notify.ts'
import { Invalid, parseSetlist } from './space-data.ts'
import { fromRow, type SetlistRow } from './team-setlists.ts'

const PATH = /^\/api\/account\/(library|setlists)(?:\/(batch))?$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
export const isPersonalSetlistPath = (path: string) => PATH.test(path)

/** The songs of a setlist are all in the person's own library (a library with no songs in it holds none) */
const OWN_SONGS = `NOT EXISTS (SELECT 1 FROM json_each(?) s WHERE NOT EXISTS (
  SELECT 1 FROM library_songs ls JOIN libraries l ON l.library_id = ls.library_id
  WHERE l.account_id = ? AND ls.song_uuid = json_extract(s.value, '$.songUuid')))`

async function mine(db: D1Db, account: string, id: string): Promise<SpaceSetlist | null> {
  const row = await db
    .prepare('SELECT * FROM setlists WHERE account_id = ? AND setlist_id = ?')
    .bind(account, id)
    .first<SetlistRow>()
  return row ? fromRow(row) : null
}

async function apply(db: D1Db, account: string, value: unknown): Promise<SpaceOpResult> {
  if (
    !isRecord(value) ||
    value.kind !== 'setlist' ||
    typeof value.id !== 'string' ||
    !ID.test(value.id)
  )
    return { status: 'invalid', error: 'Not a setlist or an id' }
  const op = value as unknown as SpaceOp
  const base = op.baseVersion
  if (base !== undefined && base !== null && (!Number.isInteger(base) || base < 1))
    return { status: 'invalid', error: 'Invalid version' }

  if (op.op === 'delete') {
    const result = await db
      .prepare(
        'DELETE FROM setlists WHERE account_id = ? AND setlist_id = ? AND (? IS NULL OR version = ?)'
      )
      .bind(account, op.id, base ?? null, base ?? null)
      .run()
    if (result.meta.changes) return { status: 'ok', version: 0 }
    const row = await mine(db, account, op.id)
    return row ? { status: 'conflict', current: row } : { status: 'ok', version: 0 }
  }

  if (op.op !== 'put' || base === undefined)
    return { status: 'invalid', error: 'A write needs a base version' }
  let record: ReturnType<typeof parseSetlist>
  try {
    record = parseSetlist(op.record, op.id)
  } catch (error) {
    /* v8 ignore next 3 -- parseSetlist throws only Invalid; anything else is a bug and must reach the Worker's error handler */
    if (error instanceof Invalid) return { status: 'invalid', error: error.message }
    throw error
  }
  if (record.leaderId !== null && record.leaderId !== account)
    return { status: 'invalid', error: 'The leader of your own setlist is you, or a name' }
  if (record.leaderId !== null && record.leaderName)
    return { status: 'invalid', error: 'The leader is you or a name, not both' }
  const songs = JSON.stringify(record.songs)
  const values = [
    record.date,
    record.time,
    record.type,
    record.name,
    record.leaderId,
    record.leaderName,
    record.createdBy,
    record.createdAt,
    JSON.stringify(record.body),
    songs,
  ]
  const now = new Date().toISOString()
  try {
    const result =
      base === null
        ? await db
            .prepare(`INSERT INTO setlists (account_id, setlist_id, date, time, type, name, leader_id, leader_name, created_by, created_at, body, songs, version, modified_at)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ? WHERE ${OWN_SONGS}`)
            .bind(account, op.id, ...values, now, songs, account)
            .run()
        : await db
            .prepare(`UPDATE setlists SET date = ?, time = ?, type = ?, name = ?, leader_id = ?, leader_name = ?, created_by = ?, created_at = ?, body = ?, songs = ?, version = version + 1, modified_at = ?
              WHERE account_id = ? AND setlist_id = ? AND version = ? AND ${OWN_SONGS}`)
            .bind(...values, now, account, op.id, base, songs, account)
            .run()
    if (result.meta.changes) return { status: 'ok', version: base === null ? 1 : base + 1 }
  } catch (error) {
    /* v8 ignore next -- an unexpected database failure must propagate to the Worker error handler */
    if (!/UNIQUE constraint failed|PRIMARY KEY/i.test(String(error))) throw error
    // (the id is taken: by one of ours, which is what to go on from, or by somebody else's, which is not ours to describe)
    return { status: 'conflict', current: await mine(db, account, op.id) }
  }
  const existing = await mine(db, account, op.id)
  if (existing && (base === null || existing.version !== base))
    return { status: 'conflict', current: existing }
  if (!existing && base !== null) return { status: 'missing' }
  return { status: 'invalid', error: 'A song is not in your library' }
}

export function handlePersonalSetlists(request: Request, env: Env): Promise<Response> {
  const answer = refusing(async () => {
    if (!env.DB) throw new Refusal(503, 'Personal storage is not available')
    const identity = await authenticate(request, [sessionProvider(env)])
    if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
    const match = PATH.exec(new URL(request.url).pathname)
    if (!match) throw new Refusal(404, 'Not found')
    const [, resource, batch] = match
    const db = env.DB
    const account = identity.sub

    if (resource === 'library' && request.method === 'PUT') {
      await db
        .prepare(
          'INSERT OR IGNORE INTO libraries (library_id, account_id, created_at) VALUES (?, ?, ?)'
        )
        .bind(ulid(), account, new Date().toISOString())
        .run()
      const library = await db
        .prepare('SELECT library_id FROM libraries WHERE account_id = ?')
        .bind(account)
        .first<{ library_id: string }>()
      return jsonResponse({ libraryId: library?.library_id })
    }
    if (resource === 'library' && request.method === 'GET') {
      // What the account has on the server, without making a library: a device with a Personal space still on Drive asks, to learn
      // that another device has moved it (docs/CENTRAL_STORAGE.md, step 5)
      const held = await db
        .prepare(`SELECT l.library_id AS libraryId,
          (SELECT count(*) FROM library_songs s WHERE s.library_id = l.library_id) AS songs,
          (SELECT count(*) FROM setlists t WHERE t.account_id = l.account_id) AS setlists
          FROM libraries l WHERE l.account_id = ?`)
        .bind(account)
        .first<{ libraryId: string; songs: number; setlists: number }>()
      return jsonResponse(held ?? { libraryId: null, songs: 0, setlists: 0 })
    }
    if (resource === 'setlists' && !batch && request.method === 'GET') {
      const { results } = await db
        .prepare('SELECT * FROM setlists WHERE account_id = ? ORDER BY date, setlist_id')
        .bind(account)
        .all<SetlistRow>()
      // Kept by the browser and the service worker, and asked again each time (a 304 if nothing changed), as the
      // Team data is. Private: it is one person's, so a shared cache must not keep it for anyone else
      const data = { setlists: results.map(fromRow) }
      const etag = `"${await sha256Hex(JSON.stringify(data))}"`
      const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' }
      if (request.headers.get('If-None-Match') === etag)
        return new Response(null, { status: 304, headers })
      return Response.json(data, { headers })
    }
    if (resource === 'setlists' && batch && request.method === 'POST') {
      const body = await readJson(request)
      if (!Array.isArray(body.ops) || body.ops.length > 100) throw new Refusal(400, 'Invalid batch')
      const results: SpaceOpResult[] = []
      for (const op of body.ops) results.push(await apply(db, account, op))
      await notifySetlistShares(env, changedSetlists(body.ops, results))
      return jsonResponse({ results })
    }
    throw new Refusal(404, 'Not found')
  })
  // The answer depends on who asks (the Authorization header), whatever is cached; what has no policy of its
  // own (the other calls and every refusal) is kept by nobody
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
