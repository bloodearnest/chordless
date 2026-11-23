/**
 * The source PDFs of library songs (docs/CENTRAL_STORAGE.md, step 4). A PDF is immutable: it is kept
 * as it came, under its SHA-256, and a different PDF of the song is another source. The Worker reads
 * the lead sheet from it and keeps that too (MusicXML, with the version of the reader), so the
 * browser need not. Private, like the song bundles: every call rechecks the account's membership of
 * the library, and an object key is never authorization.
 */
import { sha256HexOfBytes } from '../../src/js/utils/bytes.ts'
import type { D1Db } from './d1.ts'
import type { Env } from './env.ts'
import { jsonResponse, Refusal, refusing } from './http.ts'
import { authorizeLibrary, canWrite } from './library-songs.ts'

const PATH =
  /^\/api\/(libraries|teams)\/([A-Za-z0-9_-]{1,64})\/(?:library\/)?songs\/([A-Za-z0-9_-]{1,64})\/sources(?:\/([0-9a-f]{64})(?:\/(pdf|musicxml))?)?$/

/** A lead sheet is about 125 KB, and the largest of 137 was 211 KB */
const MAX_PDF_BYTES = 1024 * 1024

/**
 * The version of what reads a PDF (src/js/score-pdf.ts and what it calls): raised when a change
 * makes it read differently, so that what an older one read can be found and read again
 */
export const SHEET_READER_VERSION = 1

export const isLibrarySourcePath = (path: string) => PATH.test(path)

interface SourceRow {
  sha256: string
  size_bytes: number
  pdf_ref: string
  origin: string
  file_name: string | null
  imported_at: string
  parse_ref: string | null
  parse_reader: number | null
}

function source(row: SourceRow) {
  return {
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    origin: row.origin,
    fileName: row.file_name,
    importedAt: row.imported_at,
    parsed: row.parse_ref !== null,
    parseReader: row.parse_reader,
  }
}

/** The lead sheet in a PDF as MusicXML, or null when it is not one that can be read */
async function readLeadSheet(pdf: ArrayBuffer): Promise<string | null> {
  // (loaded only now: it is large, and most of what the Worker does never reads a PDF)
  const [{ readScorePdf }, { writeMusicXml }] = await Promise.all([
    import('../../src/js/score-pdfjs.ts'),
    import('../../src/js/score-musicxml.ts'),
  ])
  const score = await readScorePdf(pdf)
  return score ? writeMusicXml(score) : null
}

const find = (db: D1Db, library: string, song: string, sha256: string) =>
  db
    .prepare(
      'SELECT * FROM library_song_sources WHERE library_id = ? AND song_uuid = ? AND sha256 = ?'
    )
    .bind(library, song, sha256)
    .first<SourceRow>()

export function handleLibrarySources(request: Request, env: Env): Promise<Response> {
  const answer = refusing(async () => {
    const url = new URL(request.url)
    const match = PATH.exec(url.pathname)
    if (!match) throw new Refusal(404, 'Not found')
    const [, scope, scopeId, songId, sha256, resource] = match
    const { db, bucket, accountId, libraryId, permitted } = await authorizeLibrary(
      request,
      env,
      scope,
      scopeId
    )
    const song = await db
      .prepare('SELECT 1 AS found FROM library_songs WHERE library_id = ? AND song_uuid = ?')
      .bind(libraryId, songId)
      .first<{ found: number }>()
    if (!song) throw new Refusal(404, 'No such song')

    if (!sha256 && request.method === 'GET') {
      const rows = await db
        .prepare(
          'SELECT * FROM library_song_sources WHERE library_id = ? AND song_uuid = ? ORDER BY imported_at, sha256'
        )
        .bind(libraryId, songId)
        .all<SourceRow>()
      return jsonResponse({ sources: rows.results.map(source) })
    }

    if (sha256 && request.method === 'GET') {
      const row = await find(db, libraryId, songId, sha256)
      if (!row) throw new Refusal(404, 'No such source')
      if (resource === undefined) return jsonResponse({ source: source(row) })
      const ref = resource === 'pdf' ? row.pdf_ref : row.parse_ref
      if (!ref) throw new Refusal(404, 'Nothing was read from this source')
      const object = await bucket.get(ref)
      if (!object) throw new Refusal(503, 'Source content is temporarily unavailable')
      if (resource === 'musicxml') {
        return new Response(await object.text(), {
          headers: { 'Content-Type': 'application/vnd.recordare.musicxml+xml; charset=utf-8' },
        })
      }
      const bytes = await object.arrayBuffer()
      if ((await sha256HexOfBytes(bytes)) !== sha256)
        throw new Refusal(503, 'Source content is temporarily unavailable')
      return new Response(bytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="source.pdf"',
        },
      })
    }

    if (!sha256 && request.method === 'POST') {
      if (!canWrite(permitted))
        throw new Refusal(403, 'Only a worship leader or admin can change this library')
      if (!/^application\/pdf\b/i.test(request.headers.get('Content-Type') ?? ''))
        throw new Refusal(415, 'A source must be a PDF')
      const declared = Number(request.headers.get('Content-Length'))
      if (declared > MAX_PDF_BYTES) throw new Refusal(413, 'The PDF is too large')
      const pdf = await request.arrayBuffer()
      if (pdf.byteLength > MAX_PDF_BYTES) throw new Refusal(413, 'The PDF is too large')
      if (new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-')
        throw new Refusal(400, 'That is not a PDF')
      const origin = url.searchParams.get('origin') ?? 'file'
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(origin)) throw new Refusal(400, 'Invalid origin')
      const name = url.searchParams.get('name')
      if (name !== null && (name.length < 1 || name.length > 200))
        throw new Refusal(400, 'Invalid file name')

      const hash = await sha256HexOfBytes(pdf)
      // The same PDF of the same song is already kept: nothing to write
      const existing = await find(db, libraryId, songId, hash)
      if (existing) return jsonResponse({ source: source(existing) })

      const base = `library/${libraryId}/songs/${songId}/sources/${hash}`
      await bucket.put(`${base}.pdf`, pdf, { httpMetadata: { contentType: 'application/pdf' } })
      // (a copy: the reader may take the bytes it is given)
      const xml = await readLeadSheet(pdf.slice(0))
      const parseRef = xml === null ? null : `${base}/reader-${SHEET_READER_VERSION}.musicxml`
      if (xml !== null && parseRef !== null) {
        await bucket.put(parseRef, xml, {
          httpMetadata: { contentType: 'application/vnd.recordare.musicxml+xml; charset=utf-8' },
        })
      }
      const now = new Date().toISOString()
      const role =
        permitted.account_id !== null
          ? 'l.account_id = ?'
          : "EXISTS (SELECT 1 FROM church_members m JOIN churches c ON c.church_id = m.church_id WHERE m.church_id = l.church_id AND m.account_id = ? AND m.role IN ('writer','admin') AND c.ended_at IS NULL)"
      // (checked again as it is written, as the song bundle is: access may have ended meanwhile)
      const written = await db
        .prepare(`INSERT INTO library_song_sources (library_id, song_uuid, sha256, size_bytes, pdf_ref, origin, file_name, imported_at, imported_by, parse_ref, parse_reader, parsed_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM libraries l WHERE l.library_id = ? AND ${role})
        ON CONFLICT (library_id, song_uuid, sha256) DO NOTHING`)
        .bind(
          libraryId,
          songId,
          hash,
          pdf.byteLength,
          `${base}.pdf`,
          origin,
          name,
          now,
          accountId,
          parseRef,
          parseRef === null ? null : SHEET_READER_VERSION,
          parseRef === null ? null : now,
          libraryId,
          accountId
        )
        .run()
      const saved = await find(db, libraryId, songId, hash)
      // (none: access ended before the write; or an identical upload got there first, and is the answer)
      if (!saved) throw new Refusal(403, 'Access changed')
      return jsonResponse({ source: source(saved) }, written.meta.changes ? 201 : 200)
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
