/**
 * GET /api/share/<fileId>: the download behind a share link (docs/SHARING.md).
 *
 * Share files are encrypted and public in the church's Drive. A recipient's browser doesn't
 * fetch from Google itself: Google needs an API key for anonymous downloads and rate-limits
 * them per IP (a room of people on one wifi looks like abuse). The worker fetches it with the
 * key, a secret that never reaches a browser, and caches it at the edge, so Drive sees about
 * one request per file a minute however many people open the link.
 *
 * The worker only ever handles ciphertext: the key is in the link's `#` and never gets here.
 */

import { toHex } from '../../src/js/utils/bytes.ts'

/** A file id as Drive makes them, and nothing that could change the URL we fetch */
const FILE_ID = /^[\w-]{10,100}$/

/** Shares are a few KB. Anything much bigger isn't one: don't relay it */
const MAX_BYTES = 1024 * 1024

/** How long an answer is reused before asking Drive again */
const FOUND_SECONDS = 60
const GONE_SECONDS = 30

/** The part of the Workers Cache API used here */
export interface ShareCache {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

export interface ShareEnv {
  /** Public Google API key, restricted to the Drive API (a secret here, not in the client) */
  GOOGLE_API_KEY?: string
}

interface ShareDeps {
  /** Defaults to the global fetch */
  fetchDrive?: typeof fetch
  cache?: ShareCache
  waitUntil?: (promise: Promise<unknown>) => void
}

const text = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...headers } })

async function etagOf(bytes: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `"${toHex(digest.subarray(0, 16))}"`
}

/** The id from /api/share/<id>, or null if this isn't a share download path */
export function shareFileId(pathname: string) {
  const match = /^\/api\/share\/([^/]+)$/.exec(pathname)
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * 200 with the ciphertext and an ETag (honours If-None-Match with a 304); 404 when the share
 * is gone (Drive says 404 once its public permission is revoked, or the file deleted); 502
 * when Drive couldn't say, so a recipient keeps their copy instead of deleting it.
 */
export async function handleShareDownload(
  request: Request,
  fileId: string,
  env: ShareEnv,
  { fetchDrive = fetch, cache, waitUntil }: ShareDeps = {}
) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return text('Method not allowed', 405, { Allow: 'GET, HEAD' })
  }
  if (!FILE_ID.test(fileId)) return text('Not found', 404)
  if (!env.GOOGLE_API_KEY) return text('Sharing is not set up on this server', 503)

  // Cached by id alone: the same answer for everyone, whatever else is on the URL
  const cacheKey = new Request(new URL(`/api/share/${fileId}`, request.url).href)
  let answer = await cache?.match(cacheKey)

  if (!answer) {
    let drive: Response
    try {
      drive = await fetchDrive(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(env.GOOGLE_API_KEY)}`
      )
    } catch {
      return text('Could not reach Drive', 502)
    }

    if (drive.status === 404) {
      answer = text('This share has ended', 404, {
        'Cache-Control': `public, max-age=${GONE_SECONDS}`,
      })
    } else if (drive.ok) {
      const declared = Number(drive.headers.get('Content-Length'))
      if (declared > MAX_BYTES) return text('Too large to be a share', 502)
      const bytes = await drive.arrayBuffer()
      if (bytes.byteLength > MAX_BYTES) return text('Too large to be a share', 502)
      answer = new Response(bytes, {
        headers: {
          'Content-Type': 'application/octet-stream',
          ETag: await etagOf(bytes),
          'Cache-Control': `public, max-age=${FOUND_SECONDS}`,
        },
      })
    } else {
      // Rate-limited, a Google error page, anything else: nothing to say about the share
      return text('Drive could not be read', 502)
    }
    if (cache) {
      const put = cache.put(cacheKey, answer.clone())
      if (waitUntil) waitUntil(put)
      else await put
    }
  }

  const etag = answer.headers.get('ETag')
  // Revalidate each time: the worker's cache is what keeps Drive quiet, not the browser's
  const headers = new Headers({ 'Cache-Control': 'no-cache' })
  if (etag) headers.set('ETag', etag)
  if (answer.status === 200 && etag && request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers })
  }
  headers.set('Content-Type', answer.headers.get('Content-Type') ?? 'text/plain')
  return new Response(request.method === 'HEAD' ? null : answer.body, {
    status: answer.status,
    headers,
  })
}
