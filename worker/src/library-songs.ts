/** Library song bundles: D1 owns the current pointer and version; private R2 holds immutable bytes. */
import { sha256Hex } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'
import type { Env, SongBucket } from './env.ts'
import { isRecord, jsonResponse, Refusal, readJson, refusing } from './http.ts'
import { authenticate, SESSION_PROVIDER, sessionProvider } from './identity.ts'

const PATH =
  /^\/api\/(libraries|teams)\/([A-Za-z0-9_-]{1,64})\/(?:library\/)?songs(?:\/([A-Za-z0-9_-]{1,64})(?:\/(bundle))?)?$/
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024

export const isLibrarySongPath = (path: string) => PATH.test(path)

export interface LibraryAccess {
  library_id: string
  church_id: string | null
  account_id: string | null
  role: string | null
}
interface SongRow {
  song_uuid: string
  song_id: string
  title: string
  ccli: string | null
  song_key: string | null
  licence: string | null
  is_default: number
  variant_of: string | null
  variant_label: string
  content_hash: string | null
  bundle_ref: string | null
  version: number
  modified_at: string
}
interface SongMeta {
  songId: string
  title: string
  ccli: string | null
  key: string | null
  licence: string | null
  isDefault: boolean
  variantOf: string | null
  variantLabel: string
}
interface SongBundle {
  format: 1
  chordpro: string
  musicxml: string | null
}

function song(row: SongRow) {
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
    contentHash: row.content_hash,
    fileRef: null,
    version: row.version,
    modifiedAt: row.modified_at,
  }
}

function parseMeta(value: unknown): SongMeta {
  if (
    !isRecord(value) ||
    typeof value.songId !== 'string' ||
    value.songId.length < 1 ||
    value.songId.length > 200 ||
    typeof value.title !== 'string' ||
    value.title.length > 2000 ||
    !(value.ccli === null || typeof value.ccli === 'string') ||
    !(value.key === null || typeof value.key === 'string') ||
    !(value.licence === null || typeof value.licence === 'string') ||
    typeof value.isDefault !== 'boolean' ||
    !(value.variantOf === null || typeof value.variantOf === 'string') ||
    typeof value.variantLabel !== 'string' ||
    value.variantLabel.length > 200
  )
    throw new Refusal(400, 'Invalid song metadata')
  return value as unknown as SongMeta
}

function parseBundle(value: unknown): SongBundle {
  if (
    !isRecord(value) ||
    value.format !== 1 ||
    typeof value.chordpro !== 'string' ||
    !(value.musicxml === null || typeof value.musicxml === 'string')
  )
    throw new Refusal(400, 'Invalid song bundle')
  const bundle = value as unknown as SongBundle
  if (new TextEncoder().encode(JSON.stringify(bundle)).byteLength > MAX_BUNDLE_BYTES)
    throw new Refusal(413, 'Song bundle is too large')
  return bundle
}

export function canWrite(access: LibraryAccess): boolean {
  return access.account_id !== null ? true : access.role === 'writer' || access.role === 'admin'
}

async function access(db: D1Db, library: string, account: string): Promise<LibraryAccess | null> {
  return db
    .prepare(`SELECT l.library_id, l.church_id, l.account_id, m.role
    FROM libraries l
    LEFT JOIN churches c ON c.church_id = l.church_id AND c.ended_at IS NULL
    LEFT JOIN church_members m ON m.church_id = l.church_id AND m.account_id = ?
    WHERE l.library_id = ? AND ((l.account_id = ? AND l.church_id IS NULL) OR
      (l.church_id IS NOT NULL AND c.church_id IS NOT NULL AND m.account_id IS NOT NULL))`)
    .bind(account, library, account)
    .first<LibraryAccess>()
}

/** A signed-in account's access to a library, named by its id or by a team of its church: a refusal if it has none */
export async function authorizeLibrary(
  request: Request,
  env: Env,
  scope: string,
  scopeId: string
): Promise<{
  db: D1Db
  bucket: SongBucket
  accountId: string
  libraryId: string
  permitted: LibraryAccess
}> {
  const bucket = env.SONG_BUCKET
  if (!env.DB || !bucket) throw new Refusal(503, 'Song storage is not available')
  const identity = await authenticate(request, [sessionProvider(env)])
  if (!identity || identity.provider !== SESSION_PROVIDER) throw new Refusal(401, 'Sign in first')
  const db = env.DB
  const libraryId =
    scope === 'teams'
      ? (
          await db
            .prepare(`SELECT l.library_id FROM teams t JOIN churches c ON c.church_id = t.church_id
          JOIN libraries l ON l.church_id = c.church_id JOIN church_members m ON m.church_id = c.church_id
          WHERE t.space_id = ? AND t.ended_at IS NULL AND c.ended_at IS NULL AND m.account_id = ?`)
            .bind(scopeId, identity.sub)
            .first<{ library_id: string }>()
        )?.library_id
      : scopeId
  if (!libraryId) throw new Refusal(404, 'No such library')
  const permitted = await access(db, libraryId, identity.sub)
  if (!permitted) throw new Refusal(404, 'No such library')
  return { db, bucket, accountId: identity.sub, libraryId, permitted }
}

/** The URL and key are private; every list, read and write rechecks account or church membership. */
export function handleLibrarySongs(request: Request, env: Env): Promise<Response> {
  const answer = refusing(async () => {
    const match = PATH.exec(new URL(request.url).pathname)
    if (!match) throw new Refusal(404, 'Not found')
    const [, scope, scopeId, songId, resource] = match
    const { db, bucket, accountId, libraryId, permitted } = await authorizeLibrary(
      request,
      env,
      scope,
      scopeId
    )
    const identity = { sub: accountId }

    if (!songId && resource === undefined && request.method === 'GET') {
      const rows = await db
        .prepare('SELECT * FROM library_songs WHERE library_id = ? ORDER BY title, song_uuid')
        .bind(libraryId)
        .all<SongRow>()
      return jsonResponse({ songs: rows.results.map(song) }, 200)
    }

    if (songId && resource === 'bundle' && request.method === 'GET') {
      const row = await db
        .prepare('SELECT * FROM library_songs WHERE library_id = ? AND song_uuid = ?')
        .bind(libraryId, songId)
        .first<SongRow>()
      if (!row?.bundle_ref) throw new Refusal(404, 'Song content is not available')
      const object = await bucket.get(row.bundle_ref)
      if (!object) throw new Refusal(503, 'Song content is temporarily unavailable')
      let bundle: unknown
      const serialized = await object.text()
      if ((await sha256Hex(serialized)) !== row.content_hash)
        throw new Refusal(503, 'Song content is temporarily unavailable')
      try {
        bundle = JSON.parse(serialized)
      } catch {
        throw new Refusal(503, 'Song content is temporarily unavailable')
      }
      return jsonResponse({ song: song(row), bundle })
    }

    if (songId && resource === undefined && request.method === 'PUT') {
      if (!canWrite(permitted))
        throw new Refusal(403, 'Only a worship leader or admin can change this library')
      const body = await readJson(request)
      const base = body.baseVersion
      if (!(base === null || (Number.isInteger(base) && (base as number) >= 1)))
        throw new Refusal(400, 'Invalid base version')
      const meta = parseMeta(body.song)
      const bundle = parseBundle(body.bundle)
      const serialized = JSON.stringify(bundle)
      const hash = await sha256Hex(serialized)
      const now = new Date().toISOString()
      const current = await db
        .prepare('SELECT * FROM library_songs WHERE library_id = ? AND song_uuid = ?')
        .bind(libraryId, songId)
        .first<SongRow>()
      if (current && current.version !== base)
        return jsonResponse({ error: 'Song changed elsewhere', current: song(current) }, 409)
      if (!current && base !== null)
        return jsonResponse({ error: 'Song no longer exists', current: null }, 409)
      const sameMetadata =
        current &&
        current.song_id === meta.songId &&
        current.title === meta.title &&
        current.ccli === meta.ccli &&
        current.song_key === meta.key &&
        current.licence === meta.licence &&
        current.is_default === (meta.isDefault ? 1 : 0) &&
        current.variant_of === meta.variantOf &&
        current.variant_label === meta.variantLabel
      if (current && sameMetadata && current.content_hash === hash)
        return jsonResponse({ song: song(current) }, 200)
      const key =
        current?.content_hash === hash && current.bundle_ref
          ? current.bundle_ref
          : `library/${libraryId}/songs/${songId}/${hash}.json`
      if (current?.content_hash !== hash || !current.bundle_ref) {
        await bucket.put(key, serialized, {
          httpMetadata: { contentType: 'application/json; charset=utf-8' },
        })
      }
      const role =
        permitted.account_id !== null
          ? 'l.account_id = ?'
          : "EXISTS (SELECT 1 FROM church_members m JOIN churches c ON c.church_id = m.church_id WHERE m.church_id = l.church_id AND m.account_id = ? AND m.role IN ('writer','admin') AND c.ended_at IS NULL)"
      const auth = permitted.account_id !== null ? [identity.sub] : [identity.sub]
      const result = current
        ? await db
            .prepare(`UPDATE library_songs SET song_id = ?, title = ?, ccli = ?, song_key = ?, licence = ?, is_default = ?, variant_of = ?, variant_label = ?, content_hash = ?, bundle_ref = ?, version = version + 1, modified_at = ?
            WHERE library_id = ? AND song_uuid = ? AND version = ? AND EXISTS (SELECT 1 FROM libraries l WHERE l.library_id = library_songs.library_id AND ${role})`)
            .bind(
              meta.songId,
              meta.title,
              meta.ccli,
              meta.key,
              meta.licence,
              meta.isDefault ? 1 : 0,
              meta.variantOf,
              meta.variantLabel,
              hash,
              key,
              now,
              libraryId,
              songId,
              base,
              ...auth
            )
            .run()
        : await db
            .prepare(`INSERT INTO library_songs (library_id, song_uuid, song_id, title, ccli, song_key, licence, is_default, variant_of, variant_label, content_hash, bundle_ref, version, modified_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ? WHERE EXISTS (SELECT 1 FROM libraries l WHERE l.library_id = ? AND ${role})`)
            .bind(
              libraryId,
              songId,
              meta.songId,
              meta.title,
              meta.ccli,
              meta.key,
              meta.licence,
              meta.isDefault ? 1 : 0,
              meta.variantOf,
              meta.variantLabel,
              hash,
              key,
              now,
              libraryId,
              ...auth
            )
            .run()
      if (!result.meta.changes) {
        const fresh = await db
          .prepare('SELECT * FROM library_songs WHERE library_id = ? AND song_uuid = ?')
          .bind(libraryId, songId)
          .first<SongRow>()
        if (fresh)
          return jsonResponse({ error: 'Song changed elsewhere', current: song(fresh) }, 409)
        throw new Refusal(403, 'Access changed')
      }
      const saved = await db
        .prepare('SELECT * FROM library_songs WHERE library_id = ? AND song_uuid = ?')
        .bind(libraryId, songId)
        .first<SongRow>()
      /* v8 ignore next -- a successful conditional D1 write must be readable in the same database */
      if (!saved) throw new Refusal(503, 'Song could not be saved')
      return jsonResponse({ song: song(saved) }, current ? 200 : 201)
    }
    throw new Refusal(404, 'Not found')
  })
  return answer.then(response => {
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'private, no-store')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  })
}
