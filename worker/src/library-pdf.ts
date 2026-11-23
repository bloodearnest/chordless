/**
 * The source PDF of a library song (docs/CENTRAL_STORAGE.md, step 4), kept as it came in private R2.
 * Every import is kept, under a key that sorts newest first, and the newest is the song's PDF: nothing
 * is overwritten, so a mistaken import can be undone, and two at once are two objects, not a clash.
 * Who imported it, how and when are the object's own metadata: there is no table. The Worker reads
 * the lead sheet from it and answers with the MusicXML, for the song's bundle.
 * Private like the song bundles: every call rechecks the account's membership of the library.
 */
import type { Env } from './env.ts'
import { jsonResponse, Refusal, refusing } from './http.ts'
import { authorizeLibrary, canWrite } from './library-songs.ts'

const PATH =
  /^\/api\/(libraries|teams)\/([A-Za-z0-9_-]{1,64})\/(?:library\/)?songs\/([A-Za-z0-9_-]{1,64})\/pdf$/

/** A lead sheet is about 125 KB, and the largest of 137 was 211 KB */
const MAX_PDF_BYTES = 1024 * 1024

/**
 * A key that sorts before every earlier one (R2 lists in key order): the time counted down, then a
 * random part so that two imports in the same millisecond are two objects
 */
const newKey = (prefix: string) =>
  `${prefix}${String(9_999_999_999_999 - Date.now()).padStart(13, '0')}-${crypto.randomUUID().slice(0, 8)}.pdf`

export const isLibraryPdfPath = (path: string) => PATH.test(path)

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

export function handleLibraryPdf(request: Request, env: Env): Promise<Response> {
  const answer = refusing(async () => {
    const url = new URL(request.url)
    const match = PATH.exec(url.pathname)
    if (!match) throw new Refusal(404, 'Not found')
    const [, scope, scopeId, songId] = match
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
    const prefix = `library/${libraryId}/songs/${songId}/pdf/`

    if (request.method === 'GET') {
      const [newest] = (await bucket.list({ prefix, limit: 1 })).objects
      const object = newest && (await bucket.get(newest.key))
      if (!object) throw new Refusal(404, 'This song has no source PDF')
      return new Response(await object.arrayBuffer(), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="source.pdf"',
        },
      })
    }

    if (request.method === 'PUT') {
      if (!canWrite(permitted))
        throw new Refusal(403, 'Only a worship leader or admin can change this library')
      if (!/^application\/pdf\b/i.test(request.headers.get('Content-Type') ?? ''))
        throw new Refusal(415, 'A source must be a PDF')
      if (Number(request.headers.get('Content-Length')) > MAX_PDF_BYTES)
        throw new Refusal(413, 'The PDF is too large')
      const pdf = await request.arrayBuffer()
      if (pdf.byteLength > MAX_PDF_BYTES) throw new Refusal(413, 'The PDF is too large')
      if (new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-')
        throw new Refusal(400, 'That is not a PDF')
      const origin = url.searchParams.get('origin') ?? 'file'
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(origin)) throw new Refusal(400, 'Invalid origin')
      const name = url.searchParams.get('name')
      if (name !== null && (name.length < 1 || name.length > 200))
        throw new Refusal(400, 'Invalid file name')

      await bucket.put(newKey(prefix), pdf, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: {
          origin,
          ...(name === null ? {} : { name }),
          importedBy: accountId,
          importedAt: new Date().toISOString(),
        },
      })
      // (a copy: the reader may take the bytes it is given)
      return jsonResponse({
        sizeBytes: pdf.byteLength,
        musicxml: await readLeadSheet(pdf.slice(0)),
      })
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
