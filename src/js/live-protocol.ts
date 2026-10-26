/**
 * What the page and the Worker say to each other on the live channel (docs/LIVE_SYNC.md). Two
 * words only, and no content: "changed" (a device has sent changes to the space, so sync now) and a
 * ping that keeps the socket honest. The Worker relays nothing else.
 */

/** The subprotocol the page asks for; the ID token rides as a second one (a browser cannot set `Authorization` on a WebSocket) */
export const LIVE_PROTOCOL = 'chordless'

/**
 * After a "changed" the update is fetched at once, and again after each of these (ms): Drive shows a
 * change a few seconds late (a share's file is readable about 2.7 s after the upload, measured by
 * `just test-live-share`; the team space's feed, about 5 s, measured once). A fetch that finds nothing
 * new costs little: a share's is a 304 and Drive is asked at most once a second, a sync is a few requests.
 * They are close together because the update is readable about 2.7 s after its upload, and the
 * recipient is told as soon as the upload is done: the sooner after that it is there, the sooner it shows
 */
export const FOLLOW_UPS_MS = [1500, 3000, 4500, 6000]

/** Sent by a device that has just sent its changes to the space, and relayed to the others */
export const CHANGED = '{"type":"changed"}'

/** Sent now and then by the page; the Durable Object answers `PONG` without waking (hibernation) */
export const PING = 'ping'
export const PONG = 'pong'
