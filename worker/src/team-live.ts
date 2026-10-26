/**
 * `GET /api/space/<id>/live` with `Upgrade: websocket`: a device going live joins its space's live
 * channel (live-relay.ts, docs/LIVE_SYNC.md). It is asked as every team route is: the ID token is
 * checked before any Durable Object is touched, then the role, and a stranger and a space that is
 * not there get the same answer (docs/SECURITY.md). The token comes in the subprotocol, since a
 * browser cannot set `Authorization` on a WebSocket and a URL gets logged.
 */

import { LIVE_PROTOCOL } from '../../src/js/live-protocol.ts'
import { jsonResponse } from './http.ts'
import { tokenFromProtocol } from './live-relay.ts'
import { type AdminContext, SPACE_ID } from './team-admin.ts'
import { refusal, teamSpacePath } from './team-api.ts'

/** The space a live path is for, or null if this is not one */
export function livePathSpace(path: string): string | null {
  const team = teamSpacePath(path)
  return team?.rest === '/live' ? team.spaceId : null
}

/**
 * The answer: the Durable Object's 101 with the socket (which must reach the browser as it is: it
 * is not rebuilt as the other routes' answers are), or a refusal
 */
export async function handleLive(
  request: Request,
  spaceId: string,
  admin: AdminContext
): Promise<Response> {
  if (!SPACE_ID.test(spaceId)) return jsonResponse({ error: 'No such space' }, 404)
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return jsonResponse({ error: 'This is a live socket' }, 426)
  }
  const token = tokenFromProtocol(request.headers.get('Sec-WebSocket-Protocol'))
  // (the same request, with the token where identify looks for it)
  const identity =
    token &&
    (await admin.identify(
      new Request(request.url, { headers: { Authorization: `Bearer ${token}` } })
    ))
  if (!identity) return refusal('unauthenticated')
  const room = admin.room(spaceId)
  const role = await room.roleOf(identity)
  if (!role) return refusal('not-a-member')
  if (!room.fetch) return jsonResponse({ error: 'No live channel' }, 503)

  // (fresh headers: only these reach the object, and a browser's request has no way to set them)
  return room.fetch(
    new Request(request.url, {
      headers: {
        Upgrade: 'websocket',
        'X-Live-Identity': JSON.stringify(identity),
        'Sec-WebSocket-Protocol': LIVE_PROTOCOL,
      },
    })
  )
}
