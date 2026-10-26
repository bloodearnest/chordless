/**
 * The live channel of a team space (docs/LIVE_SYNC.md): a WebSocket per live device, on which a
 * device that has just sent its changes to the space says so, and the others sync at once instead
 * of at the next tick. It carries no setlist, chart or key, only "something changed": the content
 * travels by the sync, as always. The rules are here, apart from the Durable Object
 * (team-space.ts), which only holds the sockets.
 */
import { CHANGED, LIVE_PROTOCOL } from '../../src/js/live-protocol.ts'
import { atLeast, type TeamRole } from '../../src/js/team-roles.ts'
import type { Identity } from './identity.ts'

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

/**
 * What a page asked for on a share's live channel: nothing but ours (a recipient), or ours and the
 * sharer's secret. Null if it is neither. Anyone with the link may listen; only the sharer sends.
 */
export function shareSecretFromProtocol(header: string | null): { secret: string | null } | null {
  const [protocol, secret, ...extra] = (header ?? '').split(',').map(part => part.trim())
  if (protocol !== LIVE_PROTOCOL || extra.length > 0) return null
  return { secret: secret || null }
}

/** What to do with a message from a socket */
export type Verdict = 'relay' | { close: number; reason: string }

/** 1008: a message the socket may not send; 1003: one that is not the frame */
export function judgeSender(canSend: boolean, message: string | ArrayBuffer): Verdict {
  if (!canSend) return { close: 1008, reason: 'Only the sender sends' }
  if (message !== CHANGED) return { close: 1003, reason: 'Not a frame' }
  return 'relay'
}

/** A team space's socket: writers send, readers only listen */
export function judge(role: TeamRole, message: string | ArrayBuffer): Verdict {
  return judgeSender(atLeast(role, 'writer'), message)
}
