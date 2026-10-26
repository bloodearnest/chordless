/**
 * What the page and the Worker say to each other on the live channel (docs/LIVE_SYNC.md). Two
 * words only, and no content: "changed" (a device has sent changes to the space, so sync now) and a
 * ping that keeps the socket honest. The Worker relays nothing else.
 */

/** The subprotocol the page asks for; the ID token rides as a second one (a browser cannot set `Authorization` on a WebSocket) */
export const LIVE_PROTOCOL = 'chordless'

/** Sent by a device that has just sent its changes to the space, and relayed to the others */
export const CHANGED = '{"type":"changed"}'

/** Sent now and then by the page; the Durable Object answers `PONG` without waking (hibernation) */
export const PING = 'ping'
export const PONG = 'pong'
