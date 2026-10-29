/**
 * `GET /api/share/<fileId>/live` with `Upgrade: websocket`: a device joining a share's live room
 * (share-room.ts, docs/LIVE_SYNC.md). Anyone with the file id may listen, as anyone with it may
 * download the share; the sharer's device also gives a secret, which the room holds the hash of
 * and nothing else, so only it can send. The secret rides as a subprotocol, as a team member's
 * token does, since a URL gets logged.
 */
import { toHex } from '../../src/js/utils/bytes.ts'
import type { Env } from './env.ts'
import { jsonResponse } from './http.ts'
import { shareSecretFromProtocol } from './live-relay.ts'
import { isShareFileId } from './share.ts'
import { tracedStub } from './trace.ts'

/** The id from /api/share/<id>/live, or null if this isn't a share's live path */
export function shareLiveId(pathname: string): string | null {
  const match = /^\/api\/share\/([^/]+)\/live$/.exec(pathname)
  return match ? decodeURIComponent(match[1]) : null
}

/** What the sharer's device makes its secret from: long enough to be unguessable, and nothing that could change the header */
const SECRET = /^[\w-]{20,100}$/

async function hashOf(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return toHex(new Uint8Array(digest))
}

export async function handleShareLive(
  request: Request,
  fileId: string,
  env: Env
): Promise<Response> {
  if (!isShareFileId(fileId)) return jsonResponse({ error: 'Not found' }, 404)
  if (!env.SHARE_ROOM) return jsonResponse({ error: 'Live shares are not available' }, 503)
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return jsonResponse({ error: 'This is a live socket' }, 426)
  }
  const asked = shareSecretFromProtocol(request.headers.get('Sec-WebSocket-Protocol'))
  if (!asked || (asked.secret !== null && !SECRET.test(asked.secret))) {
    return jsonResponse({ error: 'Not a live request' }, 400)
  }

  // (fresh headers: only these reach the room, and a browser's request has no way to set them)
  const headers: Record<string, string> = { Upgrade: 'websocket' }
  if (asked.secret) headers['X-Share-Publisher'] = await hashOf(asked.secret)
  const room = tracedStub(env.SHARE_ROOM.get(env.SHARE_ROOM.idFromName(fileId)), 'ShareRoom')
  return room.fetch(new Request(request.url, { headers }))
}
