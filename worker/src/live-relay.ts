/**
 * The live channel of a team space (docs/LIVE_SYNC.md): a WebSocket per live device, on which a
 * device that has just sent its changes to the space says so, and the others sync at once instead
 * of at the next tick. It carries no setlist, chart or key, only "something changed": the content
 * travels by the sync, as always. The rules are here, apart from the Durable Object
 * (team-space.ts), which only holds the sockets.
 */
import { atLeast, type TeamRole } from '../../src/js/team-roles.ts'
import type { Identity } from './identity.ts'

/** The one frame there is: sent by a writer, relayed as it is to every other socket of the space */
export const CHANGED = '{"type":"changed"}'

/** The subprotocol the page asks for; the ID token rides as a second one (see `tokenFromProtocol`) */
export const LIVE_PROTOCOL = 'chordless'

/** What the Durable Object keeps with each socket (its attachment): who it is, and nothing else */
export type LiveAttachment = Identity

/**
 * The ID token a page sent, from `Sec-WebSocket-Protocol: chordless, <token>`. A browser cannot set
 * `Authorization` on `new WebSocket`, and the token must not be in the URL (they get logged); a
 * subprotocol is a request header. Null if the first is not ours or there is no second.
 */
export function tokenFromProtocol(header: string | null): string | null {
  const [protocol, token, ...extra] = (header ?? '').split(',').map(part => part.trim())
  return protocol === LIVE_PROTOCOL && token && extra.length === 0 ? token : null
}

/** What to do with a message from a socket */
export type Verdict = 'relay' | { close: number; reason: string }

/** 1008: a message the socket may not send; 1003: one that is not the frame */
export function judge(role: TeamRole, message: string | ArrayBuffer): Verdict {
  if (!atLeast(role, 'writer')) return { close: 1008, reason: 'Readers only listen' }
  if (message !== CHANGED) return { close: 1003, reason: 'Not a frame' }
  return 'relay'
}
