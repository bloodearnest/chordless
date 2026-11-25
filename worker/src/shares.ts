/**
 * Anonymous setlist shares (docs/CENTRAL_STORAGE.md, "Anonymous sharing"): a link that lets anyone who holds it read
 * one real setlist and its songs, with no account, until it expires or its leader stops it. It is no copy: the Worker
 * reads the setlist and its songs from where they are kept, so the link always shows their current state (a key
 * changed, a chart fixed) and is never updated. `shares` in D1 only says whether the link may still be served, and the
 * Worker checks it on every read, so expiry and stopping hold whenever the daily cleanup last ran.
 *
 *   POST   /api/shares            { setlistId }  a leader makes a share → { shareId, expiresAt }
 *   GET    /api/shares?setlistId  the leader's live share of a setlist → { shareId, expiresAt }, or 404
 *   DELETE /api/shares/<id>       a leader stops it
 *   GET    /api/shares/<id>       anyone with the link: the setlist and its songs (see `read`); 304 for the copy they
 *                                  hold, 404 for a link that never was, 410 for one that ended
 *
 * A leader is whoever may write the setlist: its owner (a personal setlist), or a writer or admin of the church of its
 * team. What a reader is given leaves out what is the church's own: who made the setlist, accounts, the rest of its record.
 */
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'

const PATH = /^\/api\/shares(?:\/(sh_[A-Za-z0-9_-]{22}))?$/
const SETLIST_ID = /^[A-Za-z0-9_-]{1,64}$/
export const isSharePath = (path: string) => PATH.test(path)

const DAY = 24 * 60 * 60 * 1000
/** A share lasts two weeks after its setlist's date */
const LIFETIME_DAYS = 14

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

interface SetlistRead {
  setlist_id: string
  date: string
  time: string
  type: string
  name: string
  leader_name: string | null
  leader_account_name: string | null
  songs: string
  version: number
  library_id: string
}

interface SongRead {
  song_uuid: string
  song_id: string
  title: string
  ccli: string | null
  song_key: string | null
  licence: string | null
  is_default: number
  variant_of: string | null
  variant_label: string
  bundle_ref: string | null
  version: number
}

/** What a share shows: the setlist, with its leader's name, and each of its songs with its chart */
async function read(db: D1Db, bucket: NonNullable<Env['SONG_BUCKET']>, setlistId: string) {
  const setlist = await db
    .prepare(`SELECT s.setlist_id, s.date, s.time, s.type, s.name, s.leader_name, a.name AS leader_account_name,
      s.songs, s.version, l.library_id
      FROM setlists s LEFT JOIN accounts a ON a.account_id = s.leader_id
      JOIN libraries l ON l.account_id = s.account_id OR l.church_id = (
        SELECT t.church_id FROM teams t WHERE t.space_id = s.space_id)
      WHERE s.setlist_id = ?`)
    .bind(setlistId)
    .first<SetlistRead>()
  if (!setlist) return null
  const entries = JSON.parse(setlist.songs) as Record<string, unknown>[]
  const uuids = [...new Set(entries.map(entry => String(entry.songUuid)))]
  const { results } = uuids.length
    ? await db
        .prepare(`SELECT song_uuid, song_id, title, ccli, song_key, licence, is_default, variant_of, variant_label, bundle_ref, version
          FROM library_songs WHERE library_id = ? AND song_uuid IN (SELECT value FROM json_each(?))`)
        .bind(setlist.library_id, JSON.stringify(uuids))
        .all<SongRead>()
    : { results: [] }
  const songs = await Promise.all(
    results.map(async row => {
      const object = row.bundle_ref ? await bucket.get(row.bundle_ref) : null
      return {
        songUuid: row.song_uuid,
        songId: row.song_id,
        title: row.title,
        ccli: row.ccli,
        key: row.song_key,
        licence: row.licence,
        isDefault: row.is_default === 1,
        variantOf: row.variant_of,
        variantLabel: row.variant_label,
        version: row.version,
        // (a song with no chart yet is a title)
        bundle: object ? JSON.parse(await object.text()) : null,
      }
    })
  )
  return {
    setlist: {
      setlistId: setlist.setlist_id,
      date: setlist.date,
      time: setlist.time,
      type: setlist.type,
      name: setlist.name,
      leader: setlist.leader_account_name ?? setlist.leader_name,
      songs: entries,
    },
    songs,
    // (what a device holding a copy asks if it is current)
    fingerprint: `${setlist.version}:${songs
      .map(song => `${song.songUuid}.${song.version}`)
      .sort()
      .join(',')}`,
  }
}

export function handleShares(request: Request, env: Env): Promise<Response> {
  return refusing(async () => {
    const url = new URL(request.url)
    const match = PATH.exec(url.pathname)
    if (!match) throw new Refusal(404, 'Not found')
    const shareId = match[1]
    if (!env.DB || !env.SONG_BUCKET) throw new Refusal(503, 'Sharing is not available')
    const db = env.DB
    const now = new Date()

    // Anyone with the link
    if (shareId && request.method === 'GET') {
      const row = await db
        .prepare(`SELECT sh.*, s.date AS setlist_date FROM shares sh
          JOIN setlists s ON s.setlist_id = sh.setlist_id WHERE sh.share_id = ?`)
        .bind(shareId)
        .first<ShareRow & { setlist_date: string }>()
      if (!row) throw new Refusal(404, 'No such share')
      // (a setlist moved to a later date moves the end with it)
      const ends = [row.expires_at, expiryFor(row.setlist_date, new Date(0))].sort().at(-1)
      if (row.stopped_at !== null || (ends as string) <= now.toISOString())
        throw new Refusal(410, 'This share has ended')
      const shown = await read(db, env.SONG_BUCKET, row.setlist_id)
      if (!shown) throw new Refusal(404, 'No such share')
      const { fingerprint, ...body } = shown
      const etag = `"${(await sha256Hex(fingerprint)).slice(0, 32)}"`
      const headers = {
        ETag: etag,
        'Cache-Control': 'no-cache',
        'X-Robots-Tag': 'noindex, nofollow',
      }
      if (request.headers.get('If-None-Match') === etag)
        return new Response(null, { status: 304, headers })
      return Response.json({ shareId, expiresAt: ends, ...body }, { headers })
    }

    // A leader
    const identity = await authenticate(request, [sessionProvider(env)])
    if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
    const account = identity.sub

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
      return jsonResponse({ shareId: row.share_id, expiresAt: row.expires_at })
    }

    if (!shareId && request.method === 'POST') {
      const body = await readJson(request)
      const setlistId = typeof body.setlistId === 'string' ? body.setlistId : ''
      const setlist = SETLIST_ID.test(setlistId)
        ? await writableSetlist(db, account, setlistId)
        : null
      if (!setlist) throw new Refusal(404, 'No such setlist')
      const id = newShareId()
      const expiresAt = expiryFor(setlist.date, now)
      try {
        await db
          .prepare(
            'INSERT INTO shares (share_id, setlist_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
          )
          .bind(id, setlistId, account, now.toISOString(), expiresAt)
          .run()
      } catch (error) {
        /* v8 ignore next -- an unexpected database failure must propagate to the Worker error handler */
        if (!/UNIQUE constraint failed/i.test(String(error))) throw error
        // (one live share a setlist: the one there is, which the leader may stop)
        const existing = (await db
          .prepare('SELECT * FROM shares WHERE setlist_id = ? AND stopped_at IS NULL')
          .bind(setlistId)
          .first<ShareRow>()) as ShareRow
        return jsonResponse(
          {
            error: 'This setlist is already shared',
            shareId: existing.share_id,
            expiresAt: existing.expires_at,
          },
          409
        )
      }
      return jsonResponse({ shareId: id, expiresAt }, 201)
    }

    const row = shareId
      ? await db.prepare('SELECT * FROM shares WHERE share_id = ?').bind(shareId).first<ShareRow>()
      : null
    // (a share is not described to someone who may not write its setlist)
    if (!row || !(await writableSetlist(db, account, row.setlist_id)))
      throw new Refusal(404, 'No such share')
    if (request.method === 'DELETE') {
      await db
        .prepare('UPDATE shares SET stopped_at = ? WHERE share_id = ? AND stopped_at IS NULL')
        .bind(now.toISOString(), row.share_id)
        .run()
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
 * The daily cleanup: the rows of shares that ended (expired or stopped) a week ago. Reads already refuse an ended
 * share whether or not this has run, and a share keeps no objects, so this only tidies the table.
 */
export async function removeEndedShares(db: D1Db, now = new Date()): Promise<number> {
  const old = new Date(now.getTime() - 7 * DAY).toISOString()
  const removed = await db
    .prepare('DELETE FROM shares WHERE stopped_at <= ? OR expires_at <= ?')
    .bind(old, old)
    .run()
  return removed.meta.changes
}
