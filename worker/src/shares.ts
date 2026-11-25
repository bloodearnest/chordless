/**
 * Anonymous setlist shares kept in the Worker's own storage (docs/CENTRAL_STORAGE.md, "Anonymous sharing"): a link anyone
 * who holds it can open, with no account, until it expires or the leader stops it. The share's bundle (the setlist and
 * its charts, as the leader's device made it) is one private R2 object, replaced on each update so the link stays the
 * same. `shares` in D1 says whether it may still be served: the Worker checks it on every read, so expiry and stopping
 * hold whenever the daily cleanup (`removeEndedShares`) last ran. There is no encryption: the bundle is private to R2
 * and reached only through the Worker.
 *
 *   POST   /api/shares            { setlistId, bundle }   a leader makes a share → { shareId, expiresAt, version }
 *   GET    /api/shares?setlistId  the leader's live share of a setlist → { shareId, expiresAt, version }, or 404
 *   PUT    /api/shares/<id>       { bundle }              a leader updates it in place → { expiresAt, version }
 *   DELETE /api/shares/<id>                               a leader stops it
 *   GET    /api/shares/<id>       anyone with the link: { shareId, version, expiresAt, bundle }; 304 for the version
 *                                  they hold; 404 for a link that never was, 410 for one that ended
 *
 * A leader is whoever may write the setlist: its owner (a personal setlist), or a writer or admin of the church of its team.
 */
import type { D1Db } from './d1.ts'
import type { Env, SongBucket } from './env.ts'
import { isRecord, jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'

const PATH = /^\/api\/shares(?:\/(sh_[A-Za-z0-9_-]{22}))?$/
const SETLIST_ID = /^[A-Za-z0-9_-]{1,64}$/
export const isSharePath = (path: string) => PATH.test(path)

/** A bundle is a setlist and its charts: a few hundred KB at most */
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024
const DAY = 24 * 60 * 60 * 1000
/** A share lasts two weeks after its setlist's date */
const LIFETIME_DAYS = 14

const keyOf = (shareId: string) => `shares/${shareId}/bundle.json`

/** `sh_` and 128 random bits: no one finds it by trying */
function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `sh_${btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')}`
}

/**
 * When a share ends: two weeks after the setlist's date (the end of that day), but never less than a day from now, so a
 * link made for a setlist whose date has long passed is not dead when it is given out. (A setlist always has a date.)
 */
function expiryFor(date: string, now: Date): string {
  const end = Date.parse(`${date}T23:59:59.999Z`) + LIFETIME_DAYS * DAY
  return new Date(Math.max(end, now.getTime() + DAY)).toISOString()
}

interface ShareRow {
  share_id: string
  setlist_id: string
  expires_at: string
  stopped_at: string | null
  version: number
}

async function writableSetlist(
  db: D1Db,
  account: string,
  setlistId: string
): Promise<{ date: string } | null> {
  return db
    .prepare(`SELECT s.date FROM setlists s WHERE s.setlist_id = ? AND (s.account_id = ? OR EXISTS (
      SELECT 1 FROM teams t JOIN churches c ON c.church_id = t.church_id
      JOIN church_members m ON m.church_id = c.church_id
      WHERE t.space_id = s.space_id AND t.ended_at IS NULL AND c.ended_at IS NULL
        AND m.account_id = ? AND m.role IN ('admin', 'writer')))`)
    .bind(setlistId, account, account)
    .first<{ date: string }>()
}

/** The bundle of a request, as the text to keep: an object, of a size a share can be */
function bundleOf(body: Record<string, unknown>): string {
  if (!isRecord(body.bundle)) throw new Refusal(400, 'A share needs its bundle')
  const text = JSON.stringify(body.bundle)
  if (text.length > MAX_BUNDLE_BYTES) throw new Refusal(413, 'That share is too large')
  return text
}

const answer = (row: ShareRow) => ({
  shareId: row.share_id,
  expiresAt: row.expires_at,
  version: row.version,
})

export function handleShares(request: Request, env: Env): Promise<Response> {
  return refusing(async () => {
    const url = new URL(request.url)
    const match = PATH.exec(url.pathname)
    if (!match) throw new Refusal(404, 'Not found')
    const shareId = match[1]
    if (!env.DB || !env.SONG_BUCKET) throw new Refusal(503, 'Sharing is not available')
    const db = env.DB
    const bucket: SongBucket = env.SONG_BUCKET

    // Anyone with the link
    if (shareId && request.method === 'GET') {
      const row = await db
        .prepare('SELECT * FROM shares WHERE share_id = ?')
        .bind(shareId)
        .first<ShareRow>()
      if (!row) throw new Refusal(404, 'No such share')
      if (row.stopped_at !== null || row.expires_at <= new Date().toISOString())
        throw new Refusal(410, 'This share has ended')
      const headers = {
        ETag: `"${row.version}"`,
        'Cache-Control': 'no-cache',
        'X-Robots-Tag': 'noindex, nofollow',
      }
      if (request.headers.get('If-None-Match') === headers.ETag)
        return new Response(null, { status: 304, headers })
      const object = await bucket.get(keyOf(shareId))
      if (!object) throw new Refusal(404, 'No such share')
      return Response.json({ ...answer(row), bundle: JSON.parse(await object.text()) }, { headers })
    }

    // A leader
    const identity = await authenticate(request, [sessionProvider(env)])
    if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
    const account = identity.sub
    const now = new Date()

    if (!shareId && request.method === 'GET') {
      const setlistId = url.searchParams.get('setlistId') ?? ''
      if (!SETLIST_ID.test(setlistId) || !(await writableSetlist(db, account, setlistId)))
        throw new Refusal(404, 'No such setlist')
      const row = await db
        .prepare(
          'SELECT * FROM shares WHERE setlist_id = ? AND stopped_at IS NULL AND expires_at > ?'
        )
        .bind(setlistId, now.toISOString())
        .first<ShareRow>()
      if (!row) throw new Refusal(404, 'This setlist is not shared')
      return jsonResponse(answer(row))
    }

    if (!shareId && request.method === 'POST') {
      const body = await readJson(request)
      const setlistId = typeof body.setlistId === 'string' ? body.setlistId : ''
      const setlist = SETLIST_ID.test(setlistId)
        ? await writableSetlist(db, account, setlistId)
        : null
      if (!setlist) throw new Refusal(404, 'No such setlist')
      const bundle = bundleOf(body)
      const id = newShareId()
      const expiresAt = expiryFor(setlist.date, now)
      try {
        await db
          .prepare(`INSERT INTO shares (share_id, setlist_id, created_by, created_at, expires_at, version, modified_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)`)
          .bind(id, setlistId, account, now.toISOString(), expiresAt, now.toISOString())
          .run()
      } catch (error) {
        /* v8 ignore next -- an unexpected database failure must propagate to the Worker error handler */
        if (!/UNIQUE constraint failed/i.test(String(error))) throw error
        // (one live share a setlist: the one there is, which the leader may update or stop)
        const existing = await db
          .prepare('SELECT * FROM shares WHERE setlist_id = ? AND stopped_at IS NULL')
          .bind(setlistId)
          .first<ShareRow>()
        return jsonResponse(
          { error: 'This setlist is already shared', ...answer(existing as ShareRow) },
          409
        )
      }
      await bucket.put(keyOf(id), bundle, { httpMetadata: { contentType: 'application/json' } })
      return jsonResponse({ shareId: id, expiresAt, version: 1 }, 201)
    }

    const row = shareId
      ? await db.prepare('SELECT * FROM shares WHERE share_id = ?').bind(shareId).first<ShareRow>()
      : null
    // (a share is not described to someone who may not write its setlist)
    const setlist = row ? await writableSetlist(db, account, row.setlist_id) : null
    if (!row || !setlist) throw new Refusal(404, 'No such share')

    if (request.method === 'PUT') {
      if (row.stopped_at !== null || row.expires_at <= now.toISOString())
        throw new Refusal(410, 'This share has ended')
      const bundle = bundleOf(await readJson(request))
      // (a setlist moved to another date moves the end)
      const expiresAt = expiryFor(setlist.date, now)
      await bucket.put(keyOf(row.share_id), bundle, {
        httpMetadata: { contentType: 'application/json' },
      })
      await db
        .prepare(
          'UPDATE shares SET version = version + 1, expires_at = ?, modified_at = ? WHERE share_id = ?'
        )
        .bind(expiresAt, now.toISOString(), row.share_id)
        .run()
      return jsonResponse({ shareId: row.share_id, expiresAt, version: row.version + 1 })
    }
    if (request.method === 'DELETE') {
      await db
        .prepare(
          'UPDATE shares SET stopped_at = ?, version = version + 1, modified_at = ? WHERE share_id = ? AND stopped_at IS NULL'
        )
        .bind(now.toISOString(), now.toISOString(), row.share_id)
        .run()
      await bucket.delete([keyOf(row.share_id)])
      return new Response(null, { status: 204 })
    }
    throw new Refusal(404, 'Not found')
  }).then(response => {
    // Whoever asks, what is said is for that ask alone: nothing on the way keeps it (a stopped share must stop)
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

/**
 * The daily cleanup: the objects of shares that ended (expired or stopped) are removed, and so are their rows a week
 * later. Reads already refuse an ended share whether or not this has run; this only frees the storage.
 */
export async function removeEndedShares(
  db: D1Db,
  bucket: SongBucket,
  now = new Date()
): Promise<{ objects: number; rows: number }> {
  const at = now.toISOString()
  const { results } = await db
    .prepare('SELECT share_id FROM shares WHERE stopped_at IS NOT NULL OR expires_at <= ?')
    .bind(at)
    .all<{ share_id: string }>()
  let objects = 0
  for (const { share_id } of results) {
    const { objects: found } = await bucket.list({ prefix: `shares/${share_id}/` })
    if (found.length) await bucket.delete(found.map(each => each.key))
    objects += found.length
  }
  const old = new Date(now.getTime() - 7 * DAY).toISOString()
  const removed = await db
    .prepare(
      'DELETE FROM shares WHERE (stopped_at IS NOT NULL AND stopped_at <= ?) OR expires_at <= ?'
    )
    .bind(old, old)
    .run()
  return { objects, rows: removed.meta.changes }
}
