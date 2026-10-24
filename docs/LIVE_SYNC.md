# Live sync

When a leader changes a live setlist, the people following it see the change at once, not after
Drive's 3 to 6 seconds and the 60 second tick. **Status: designed, not built (2026-10-24).** Live
mode itself (the device-local record, wake lock, fullscreen) is in [LIVE_MODE.md](LIVE_MODE.md); the
sync that this speeds up is in [SYNC_ARCHITECTURE.md](SYNC_ARCHITECTURE.md); spaces and roles are in
[SPACES.md](SPACES.md).

## Goals and non-goals

- A leader's change to a live **team** setlist (an added or removed song, the order, a key, a tempo,
  a note) reaches members who are also live within about a second of the leader's save.
- Drive stays the durable source of truth. The live channel is an accelerator: if it is down, the
  60 s tick carries on as it does today, and nothing is lost.
- Opt-in, and it adds to what a lone user can do (CLAUDE.md, "permissive in the moment"). A
  preference turns it off.
- **Not here:** following the leader's current song or section (a follow-on, TODO), live sync for
  share links (below), and personal spaces (no Worker identity, so no channel).

## Decision: a WebSocket relay, not WebRTC

The docs used to say WebRTC. A WebSocket relay in the space's Durable Object is better here:

- It works on any network. Church guest wifi often isolates clients, and mobile carriers sit behind
  CGNAT; both break direct WebRTC without a TURN server, which would be the first paid dependency.
- WebRTC needs a signaling relay anyway, which is the same Durable Object, so it saves no server.
- The Worker already brokers all of a team space's content in transit. A relay adds no new
  exposure; WebRTC's one real gain (the Worker never sees the data) is not a property this product
  has.
- The Durable Object already knows each member's role, so authorisation is free.
- One transport to build and test. The Drive tick is the reliability layer, so a second live
  transport (WebRTC on top) is not worth its cost.

## The copyright rule, and what changed

Chordless never stores copyrighted content. A **setlist is not copyrighted; a chart is.** So the
rule (CLAUDE.md, SPACES.md) now reads: no song or pad content in any KV, R2, Durable Object or Cache
entry; the Durable Object may hold the latest *structure* of a live setlist.

What is relayed and stored is a whitelisted **live setlist**, not the `Setlist` record
(`data-types.ts`):

```
{ id, name, date, time, type, owner, modifiedDate,
  songs: [{ order, songId, songUuid, title, key, tempo, notes, editsHash }] }
```

Left out on purpose:

- `SetlistEntry.chordproEdits`: it is chart text. `editsHash` stands in for it, so a follower who
  sees a different hash asks the normal sync for the edited chart.
- `Setlist.share`: it holds the AES key that makes a public share readable. The Worker caches only
  ciphertext it cannot read, so it must never hold that key.
- `received` and the Drive bookkeeping (`fileRef`, `fileModified`, `fileRev`).

The Worker validates every frame against this shape (unknown keys dropped, strings and `notes`
length-capped, the frame size capped), so a bug or a hostile writer cannot make the object store
chart text or a key. Notes are the leader's own short cues ("repeat 4 times"); they are treated as
setlist, not song, content. A shape check is the guard; tests assert that a frame carrying
`chordproEdits`, `share` or unknown keys reaches neither storage nor other sockets.

## Who leads

- The leader of a setlist is its **`ownerId`**. Only the leader's frames are accepted. Every other
  live member, writers and readers, receives.
- If `ownerId` is empty (a setlist from before leaders were recorded), the **first member to go
  live on it becomes the leader**. The Durable Object records that identity on the setlist's live
  row; it passes on when the row expires.
- A non-leader can still edit a live setlist on their device. While they follow a live leader their
  setlist edits are treated like a reader's: local only, never pushed to Drive (the existing
  `syncsBack` mechanism, `space.ts`), so a second writer cannot overwrite the leader's version in
  Drive. The leader's next change replaces theirs, with the usual diff toast and Undo
  (`sync/setlist-diff.ts`). Friction, not prohibition.

## The server (`worker/src`)

- **Route:** `GET /api/space/<id>/live?setlist=<id>&ticket=<t>` with `Upgrade: websocket`, handled
  by the space's `TeamSpace` Durable Object. `team-routes.ts` rebuilds every answer as
  `new Response(answer.body, ...)`, which would drop the `webSocket` of a 101: the upgrade returns
  before that wrapper.
- **Auth: a ticket.** A browser cannot set `Authorization` on `new WebSocket`, and the Google ID
  token must not go in a URL (they get logged). The client first `POST`s
  `/api/space/<id>/live/ticket` with its bearer token, passing the normal check
  (`createTeamContext().access()`, before any object is touched: SECURITY.md), and gets a signed
  ticket for about 30 s, scoped to the space, the setlist, the identity and the role. It connects
  with `?ticket=`. The ticket is an HMAC (a Worker secret), so nothing is stored; it is not
  single-use, because its scope and lifetime are tiny. The role is read at connect and kept in the
  socket's attachment; a reconnect asks again, so a removed member is dropped at the next
  reconnect, and `removeMember` closes their sockets at once.
- **Durable Object:** the hibernation API (`ctx.acceptWebSocket`, `webSocketMessage`,
  `webSocketClose`, sockets tagged by setlist id). The attachment holds only identity, role and
  setlist id. An accepted leader frame is validated, stamped with a monotonic `rev`, written as the
  setlist's **latest live row** `{ setlistId, rev, hash, modifiedDate, setlist, at }` and forwarded
  to the other sockets of that setlist. A frame from anyone else closes the socket with 1008.
- **Late joiners and reconnects** get the stored live setlist as a `state` frame the moment they
  connect. This is also what covers a leader whose Drive push has not landed (offline, or failed):
  followers still have the change. It is a cache; dropping it loses nothing Drive does not have.
- **Expiry:** a row is deleted about 48 hours after its last write (a Durable Object alarm), and
  with the space (`destroy()`).
- Frames are never logged (`[observability.logs]` is on). `wrangler.toml` needs no binding change;
  `/api/space/*` already runs the Worker first. The plan's WebSocket and request limits still have
  to be checked (STORAGE_API.md).
- Presence (`hello` and `bye` with a display name and role) is made by the object from the
  attachments, and not stored.

## The client (`src/js`)

A thin abstraction, shaped like `storageFor(space)` (`storage/space-storage.ts`). A setlist's kind
comes from where it lives (its space, `share`, `received`), not from the record, so there are no
`TeamSetlist` or `ShareSetlist` classes. New folder `src/js/live/`:

```ts
interface LiveSession {
  readonly role: 'leader' | 'follower'
  readonly status: 'connecting' | 'connected' | 'offline'  // for the indicator
  start(): void
  stop(): void
  publish(setlist: Setlist): void   // the leader only; a no-op for a follower
}
```

- `liveSessionsFor(space, setlist)` returns an **array** of sessions, because a leader's team setlist
  can also be shared by link. A personal space returns none.
- `TeamLiveSession` is the WebSocket one. It starts when the device goes live on a team setlist
  (`live.ts`, `LiveChangeEvent`) and stops when live ends. It reconnects with backoff and asks for a
  new ticket each time (which also handles the hour-long ID token). While it is down nothing
  breaks; the tick carries on.
- **Receive** is the same for every session: validate, skip if the hash equals the local
  `setlistContentHash`, save it through a database handle opened with origin `'sync'` (so the follower does not push it
  to Drive); the database announces the write on the change bus (`data-changes.ts`, docs/STATE.md).
  The setlist page already follows that: `applyChangedSetlist` re-reads, keeps the current song by its id, and toasts the
  `describeSetlistChange` summary with Undo. The page knows nothing of transports.
- **Send:** the leader's own `DataChangeEvent` (origin `'local'`, `data-changes.ts`) for the live setlist publishes after a
  short coalesce (about 300 ms, so a burst of reorders is one frame), not the 2 s Drive nudge. Readers
  and non-leaders never send.
- **Connect:** on a `state` frame the client applies it if its `modifiedDate` is later than the local
  setlist's and the hash differs; a leader whose local copy is newer sends its own. Every
  (re)connect also nudges `AutoSync`, to pick up charts and anything Drive has that the relay lacks.
- **Conflict:** the leader's version wins; the later Drive sync of the same change is a hash-equal
  no-op. No new merge logic.
- **UI:** a small connected/offline dot by the live button (`setlist-page.ts`, `_setupLive`) and a
  member count; failures are `toast()`s, never `alert()`. A preference "Live sync with team"
  (default on for team spaces) turns it off.
- CSP: `public/_headers` `connect-src 'self'` must allow same-origin `wss:` on the oldest target
  (iOS and Safari 17); check it when building.

## Share links (phase 2, a separate plan)

Anonymous recipients have no space and no Worker identity, and a share bundle includes the chart
text, so the live setlist above cannot carry it: a share's update must come through the encrypted
share file. Shares already update in place (same Drive file id and key, `share-manager.ts`), and
recipients fetch `GET /api/share/<fileId>` with an ETag (`worker/src/share.ts`, edge cache 60 s). The
sharer is the leader.

- **Step A, no new channel.** While live, the sharer uploads right after the debounce, live
  recipients re-check the ETag every 5 to 10 s, and the shares' edge cache drops to a few seconds.
  The cache keeps Drive to about one request per file per interval however many people watch.
  Check first whether recipients re-check at all today; I found only a check when a link is opened.
- **Step B, only if A is too slow.** A WebSocket room keyed by `fileId` that carries only a nudge
  (`{ etag }`), never content. The sharer publishes after uploading; recipients fetch at once. The
  publisher proves itself with a random secret kept in `setlist.share` (private to the space), whose
  hash the room records on first use; recipients need only the file id. It reuses the team session's
  socket client, as a `ShareLiveSession` behind the same interface.

## Order of work

1. Define the live setlist (a pure projection and validator shared by client and Worker, e.g.
   `src/js/sync/live-setlist.ts`).
2. The Durable Object relay, the ticket route and the stored row, with workerd tests
   (`worker.node.test.ts`): leader to others, a reader and a non-leader refused, spaces and setlists
   kept apart, a bad or expired ticket, a late joiner gets `state`, expiry, `destroy()` clears the
   rows, and a frame with `chordproEdits`, `share` or unknown keys never reaches storage or others.
3. `TeamLiveSession` with a fake socket (browser unit tests): coalescing, hash skip, a non-leader
   never sends, backoff, the quiet save.
4. Wire into the setlist page: sessions, indicator, preference.
5. Playwright with two browser contexts on the dev server (a test-only identity provider, since a real
   Google token cannot be made): the leader reorders and changes a key, the follower follows within
   about a second, on the same song. Then two real devices on different networks, and wifi dropped
   mid-service.

## Still to decide when building

- The Worker secret for tickets (a new `wrangler secret`).
- The plan's WebSocket and request limits for the Durable Object.
- Whether a follower's pending local edit is better kept than replaced when the leader's frame
  arrives (today: replaced, with Undo, as for any pulled setlist).
