# Live sync

When someone changes a live setlist, the other people live on it see the change in seconds, not at
the next 60 second tick. **Status: built (2026-10-26), not yet tried on real devices, so the speed
below is an estimate.** Live mode itself (the device-local record, wake lock) is in
[LIVE_MODE.md](LIVE_MODE.md); the sync this speeds up is in [SYNC_ARCHITECTURE.md](SYNC_ARCHITECTURE.md);
spaces and roles are in [SPACES.md](SPACES.md); share links are in [SHARING.md](SHARING.md).

## The idea: a trigger, not a channel for content

The live channel carries **one word**: `changed`. A device that has just sent its changes to the
space says it, and the other devices that are live run a sync *now* instead of at the next tick.
The content moves the way it always does (Drive, or the team service, through the sync), so:

- Everything the sync already does applies unchanged: conflicts, the diff toast with Undo, a
  late song, charts for songs the device has never seen. There is no second way for a setlist to
  arrive, no merging, and no "who is the leader" rule: whoever has pushed, tells.
- The Worker holds nothing. No setlist, chart or key crosses the socket, so the copyright rule
  (CLAUDE.md) is not stretched. The only thing a Durable Object keeps for the channel is, for a
  share's room, the hash of the secret its sender proved.
- If the channel is down, nothing is lost: the tick carries on, and a reconnect syncs once to
  catch up. The channel is an accelerator.

**What it costs.** It is as fast as the sync, not faster: the sender's push, then Drive's feed of
changes (about 5 s behind a change, measured 2026-10-19), then the follower's pull. Expect 5 to
10 s from an edit to a follower's screen (a minute before). A follower therefore fetches at once
after a `changed`, and again 3 s and 6 s after it (`FOLLOW_UPS_MS`), for a change that Drive had not
shown yet. If that turns out
too slow, the way to faster is relaying the setlist itself, which needs a design for merging it
(the first design of this document did; see "Decisions"). It also needs the sender to reach Drive:
a leader who is offline tells no one, where a relay would still have worked.

## The protocol (`src/js/live-protocol.ts`)

- A page opens a WebSocket to `/api/space/<id>/live` (a team space) or `/api/share/<fileId>/live`
  (a share), asking for the subprotocols `chordless` and, after it, a proof of who it is: a team
  member's Google ID token, or a share sender's secret. A browser cannot set `Authorization` on
  `new WebSocket`, and a URL gets logged, so the proof rides in `Sec-WebSocket-Protocol`, a request
  header. The Worker answers with `chordless` alone (the proof is never echoed). A recipient of a
  share asks for `chordless` only.
- `{"type":"changed"}`: sent by a device that may send, relayed as it is to every other socket.
  Anything else from a sender closes its socket (1003); from a device that may not send, 1008.
- `ping` / `pong`: the page pings every 25 s and takes no answer in 10 s for a dead socket (a phone
  that changed network says nothing). The Durable Object answers with the runtime's auto-response,
  without waking.

## A team space (`worker/src`)

- **Route** (`team-live.ts`, before the wrapper in `team-routes.ts` that rebuilds every answer as a
  new `Response`, which would drop a 101's socket): the ID token is checked, then the role, before any
  object is touched. A stranger and a space that is not there get the same answer (SECURITY.md).
  The router's cross-origin check covers the upgrade. The Worker passes the object a fresh header
  with who the device is, which a browser's request cannot reach it with.
- **The object** (`team-space.ts`, the hibernation API): `ctx.acceptWebSocket` and the handler
  methods, so a quiet space is out of memory and costs nothing. The socket's attachment is the
  identity, and nothing else is known of it between messages. **Writers send, readers only listen**
  (`live-relay.ts`), and the role is the space's *now* (looked up on every message), so a member who
  was removed or demoted is refused at once. Their sockets are also closed when their membership
  changes. (The test harness does not tell a client of a close made outside a message, so that
  close is not directly seen in a test: `worker.node.test.ts` says so.)
- Frames are never logged (`[observability.logs]` is on).

## A share, for people with no account (`share-live.ts`, `share-room.ts`)

Recipients of a share link have no space and no Worker identity, and the share is an encrypted
bundle the Worker cannot read, so only a trigger can reach them. A share has a room of its own: a
Durable Object named by the share file's id (`SHARE_ROOM`, migration v2).

- **Listening** needs only the file id, which is in the link, as downloading does.
- **Sending** needs a secret, `SetlistShare.liveSecret`, made on the sharer's device the first time
  the setlist is live while shared, and kept on the setlist beside the key (so it is private to the
  space, and the sharer's other devices have it). The room keeps its hash from the first use; a
  different secret later is refused (403), and the claim is forgotten 48 h after the sharer last
  connected. A recipient who got in first can therefore lock the sharer out of a room, but only
  with the file id, and only for 48 h, and a ping carries nothing: the cost of a squat is that the
  recipients wait for the tick.
- A share room takes 500 sockets, then answers 503.
- **The sharer** says `changed` after the sync that uploaded the update (`syncShares` runs inside
  it) is done. A personal space can do this too: the room needs no account.
- **A recipient** live on the link fetches the share again, as it is now: `GET
  /api/share/<id>?fresh=1`. The edge cache keeps Drive quiet for a congregation (one request a
  minute per file); `fresh` takes a cached answer only if it is under 3 s old, so Drive is asked at
  most that often per file in a data centre, however many ask or what they send. The result is
  saved as a sync would (`reloadShare`, origin `sync`), so the page showing the share follows it and
  says what changed. Nothing happens for a share the device has no copy of.

## The client (`src/js`)

- **`AutoSync`** (`auto-sync.ts`) gains `syncSoon()`, which syncs now (and once more after a sync
  that was running, which may have read before the change), and `SyncPushedEvent`, sent on `window`
  when a finished sync carried changes made on this device. A failed or skipped sync leaves the
  change to the next one. That is what the channel waits for before it tells the others.
- **`LiveChannel`** (`live-channel.ts`): one socket, with a new token for each connection (which also
  handles the hour-long ID token), backoff from 1 s up to 30 s, and the ping. It is told to retry at
  once when the device comes back online or the app is shown.
- **`LiveSync`** (`live-sync.ts`, started by `app.ts`): it lives with the app, not a page, so
  moving about while live keeps the channels. `liveTargets` says which are wanted, from the live
  record's URL and the space in use:
  - `/setlist/<id>` in a team space: the space's channel.
  - the same setlist if it is shared: also the share's room, as its sender (not from a space the user
    can only read, which pushes nothing).
  - `/s/<fileId>` (received by link): the share's room, as a listener.
  - anything else, or nothing live: none.

  It tells the others after a `SyncPushedEvent` (a team reader does not: only writers send); on a
  `changed` it syncs, or fetches the share, at once and again after each of `FOLLOW_UPS_MS`; and on every
  (re)connect it does so once, to catch up on what it missed.
- **The dot** on the live button (`data-sync`, `live-sync-status.ts`): green when every channel is up,
  amber while connecting, hollow when not. Hollow loses nothing. It is shown on the live setlist only.

## Decisions

- **A trigger, not the setlist.** The first design relayed a projection of the leader's setlist and
  stored the latest one in the Durable Object for late joiners. Checking it against the code found
  holes: `setlistContentHash` includes `share` and `chordproEdits`, so a projection never hashes as
  the local record; replacing a record needs merging device-only fields; the push decides by that
  hash, so a replaced setlist would be pushed to Drive by every follower, colliding with the leader's;
  `syncsBack` is per space, not per setlist; a leader needed one-device-at-a-time rules. All of it
  disappears if the channel only says "sync".
- **A WebSocket in the space's Durable Object, not WebRTC.** It works on any network (church guest
  wifi isolates clients; carriers sit behind CGNAT), the object already knows each member's role, and
  the Worker already brokers a team space's content. One transport.
- **The proof in a subprotocol, not a ticket.** A ticket would need a Worker secret and a route; the
  header is as private as `Authorization` is on every other request.
- **Per space, not per setlist.** A sync reads everything that changed anyway.
- **Not a preference.** The channel opens only while the device is live on a setlist that has one,
  and it only makes a sync happen sooner. A preference can be added if people want it.
- **`chordproEdits`** (a per-entry override of a chart's text, still read by the setlist and the share
  bundle but written by nothing) is no longer in the way. If it comes back, as a formal variant
  edited in the setlist's UI, it is a song and syncs as one.

## Tests

- `live-relay.node.test.ts`: the subprotocol, who may send what.
- `team-routes.node.test.ts` ("the live route"), `share-live.node.test.ts`: the order of checks (a
  token before any object, then the role), what reaches the object (only what the Worker settled), the
  refusals.
- `worker.node.test.ts`, in workerd: sockets on the real objects. A writer's frame reaches the others
  and not back; a reader's or a malformed frame closes the sender and reaches no one; spaces and
  shares are kept apart; a removed or demoted member sends nothing; the ping is answered; a share's
  first secret is its sender's and another is refused.
- `share-proxy.node.test.ts`: `?fresh=1`.
- Browser unit tests: `live-channel.test.ts` (backoff, ping, dead socket), `live-sync.test.ts` (which
  channels, what each does), `auto-sync.test.ts` (`syncSoon`, `SyncPushedEvent`),
  `share-receiver.test.ts` (`reloadShare`), `setlist-page-edges.test.ts` (the dot).
- `just test-live-share` (`tests/drive/live-share.drive.node.test.ts`, not in CI): a share file in the
  test account's real Drive, the real Worker, real WebSockets. A recipient is told of an update (a few
  ms locally) and finds it in the share **about 2.7 s after the sharer's upload finished** (five runs,
  2.6 to 2.8 s, by polling): the fetch right after the upload misses it, which is why the app fetches
  again. With the schedule of `FOLLOW_UPS_MS` the 3 s fetch has it (three runs), 3.6 to 3.8 s after the
  upload, the fetch's own time with it. So for a share, an edit reaches a recipient in about the sharer's
  sync plus 4 s. The team space's feed is not measured (it needs two accounts).
- **Not covered: two real browsers.** A Playwright test of a leader and a follower needs a team space,
  which needs Drive and a Google token a test cannot make, so it would need a test identity provider
  and a fake Drive in the Worker (a design of its own). Until then: two real devices on different
  networks, then wifi dropped mid-service, are the test.

## Running it locally

`just serve` (Vite with the Cloudflare plugin, 1.64) does not pass WebSocket upgrades to the Worker:
the page's attempt hangs up, the dot stays hollow, and the tick carries on. **`just serve-live`** does:
the Worker is `wrangler dev` in its own process and Vite proxies to it (BUILD.md). Checked: an upgrade
through Vite's port reaches the Worker's route (a bad token gets its 401). A deploy passes them too.

## Not done

- Following the leader's current song or section (it would be a second word on the channel).
- Revoking a share closes no sockets: its room is only idle (a ping carries nothing).
- A non-leader writer who edits a live setlist pushes to Drive on the tick, as today.
- A test identity provider and fake Drive for a two-browser end-to-end test.
- Measuring the real latency, and deciding whether it is enough.
