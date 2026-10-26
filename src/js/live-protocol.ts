/**
 * What the page and the Worker say to each other on the live channel (docs/LIVE_SYNC.md). Two
 * words only, and no content: "changed" (a device has sent changes to the space, so sync now) and a
 * ping that keeps the socket honest. The Worker relays nothing else.
 */

/** The subprotocol the page asks for; the ID token rides as a second one (a browser cannot set `Authorization` on a WebSocket) */
export const LIVE_PROTOCOL = 'chordless'

/**
 * After a "changed" the update is fetched at once, and again after each of these (ms), for a change
 * that was not there yet. A share's new version is readable 0.5 to 0.7 s after its upload (40 updates
 * against the real Drive, `just test-live-share`; the 95th percentile 0.71 s), and the recipient is told
 * when the upload is done, so the first fetch usually has it: the rest are for a slow day, and for the
 * team space, whose feed lagged about 5 s when measured once. A fetch that finds nothing new costs
 * little: a share's is a 304 and Drive is asked once at a time per file, a sync is a few requests.
 */
export const FOLLOW_UPS_MS = [1500, 3000, 4500, 6000]

/** Sent by a device that has just sent its changes to the space, and relayed to the others */
export const CHANGED = '{"type":"changed"}'

/** Sent now and then by the page; the Durable Object answers `PONG` without waking (hibernation) */
export const PING = 'ping'
export const PONG = 'pong'
