# Build plan: phase 1 of central storage (Teams)

**Status: plan, nothing built (2026-11-20).** Written against the design in
[CENTRAL_STORAGE.md](CENTRAL_STORAGE.md) as updated on `codex/beta-stable-release-design` (song index
in D1, preferences later), and against the code as it is: the storage seam in `src/js/storage/`, the
Worker's team API in `worker/src/team-api.ts`. The Beta and Stable release channels are only a plan, so
this one does not wait for them or follow their rules. The schema it ends in is drawn in
[D1_SCHEMA.svg](D1_SCHEMA.svg).

**Decided with the owner (2026-11-20):** there are two Teams, both the owner's, from one church, so the
move is done once, by hand, by the owner: no per-team switch, no export back to Drive, no grace period for
other people's old builds. The live channel is one socket per Team space. The song index carries
`isDefault` and `variantOf`.

Phase 1 puts a **Team space's setlists, people and song index in D1**, and, as the first thing that
needs it, makes **every space sync, not only the current one**, which is what lets the current space be
deleted (the list at the end).

## What the code already gives us

- The sync engine talks to a space only through `SpaceStorage` (`types.ts`): list, read, create,
  update (with `ifRev`, which the team service already answers 409 to), trash, a change feed, batches.
  A file is an opaque `ref` with `props`, a `rev` and a `modified` time. Nothing is Drive-shaped.
- A Team **member** already reaches a space through the Worker (`TeamStorage` over
  `/api/space/<id>/…`); the **owner** goes straight to Drive (`storageFor`, `space-storage.ts`).
- On the Worker, `TeamContext.space(spaceId)` hands each request a `SpaceStorage`. Role checks
  (`team-api.ts`, `team-leaders.ts`) read through that object, so they work on any backend.
- `tests/storage-conformance.ts` is the suite every backend passes (Drive, memory, the team service over a
  fake Drive). A D1 backend is one more entry in it.

So phase 1 is a new `SpaceStorage` plus routing, not a new sync engine.

## Design decisions the plan takes

1. **A `D1SpaceStorage` on the Worker** serves the collections `setlists`, `people` and `song-index`.
   `TeamContext.space()` returns a **composite** that sends those three to D1 and `songs`, `shares` and pads
   to what the space uses now (the owner's Drive token or the service account). Calls by `ref` are routed by
   the ref's prefix (`d1:<collection>:<doc_id>`); everything else is Drive's.
2. **The owner goes through the Worker for those three collections too.** `storageFor(space)` becomes a
   composite on the device: the three D1 collections to `TeamStorage`, the rest as today (direct Drive for the
   owner, the Worker for a member). This is the one structural change on the client.
3. **A member needs no migration path.** The HTTP contract is the same and refs are opaque, so an old
   build talking to the Worker sees D1-backed setlists as files. Only an **owner on an old build**, who
   writes Drive directly, can diverge: that is what the grace-period import below is for.
4. **`rev` is the row's `version`.** A write names the version it was made from (`ifRev`); no row changed is a
   409, which the engine already resolves. A delete is a tombstone (`deleted_at`) so a device that was
   offline hears of it.
5. **The change feed is a per-space sequence.** Each write takes the next `seq` for its space (a counter row,
   not `modified_at`, which can tie). The feed token is `{drive, d1}`: the composite asks each half for what
   changed after its own position and merges the answers, so the engine sees one feed.
6. **Setlist ids are unique across spaces**, enforced by a unique index on `(doc_id)` for the setlists
   collection (the lookup in `all-spaces.ts` relies on it). A create that collides with another space's id is
   refused, which only a move or a joined share can cause, and the move already deletes before it adds.
7. **One switch for all, then none.** D1 storage is turned on for a Team by a column on the register
   (`teams.storage_v2`, default 0) only so that the owner can run the move when ready; once both Teams are
   moved the column and the Drive path for these three collections are deleted. The final schema has no flag.
8. **Old builds.** Every Worker change is additive until the move, so a device that has not updated keeps
   working. After the move the Drive copies of setlists and people are an archive and are not read again.

## Steps

Each is its own pull request, in this order, and each passes `just ci` alone. A step ships to Beta by the
ordinary merge; nothing is turned on for a team until step 4.

**1. The D1 storage on the Worker (no client change).**
Migration `0011_space_docs.sql`: `space_docs` (as sketched in CENTRAL_STORAGE.md, plus `seq`), a
`space_seq` counter, the unique setlist-id index, `teams.storage_v2`. `worker/src/d1-space-storage.ts`
implements `SpaceStorage` (list, read, create/update with `ifRev`, trash as tombstone, batches in a
single `db.batch`, inventory, `status`, change feed by `seq`). The composite in `team-context.ts` routes by
collection and ref prefix, and is used only for a team with `storage_v2` set. Role rules and `leadsSetlist`
carry over because they read through the composite. Tests: `D1SpaceStorage` through the conformance suite;
`team-api.node.test.ts` cases for roles, 409 on a stale `ifRev`, tombstones, the feed after a gap; the
setlist-id uniqueness; a team without the flag still goes to Drive.

**2. The client's routing, the index record and the entry fields.**
`storageFor(space)` returns the composite for a space whose record says `storageV2` (learned from
`GET /root`, which gains the flag). The engine gains a **`song-index`** collection: an index record is
written when a song is added, changed or removed (uuid, `songId`, title, CCLI number, default key, the licence
it came in under, content hash, `fileRef`), and read on pull to show songs whose files are not on this
device ("Get this song"). `SetlistEntry` gains `title` and `ccli`, filled when an entry is made and
refreshed when the song is opened. `DB_VERSION` goes up for the new fields and store; this is a Beta
migration under [MIGRATIONS.md](MIGRATIONS.md): roll forward only, with a repair path tested on a device that
took the build and one that skipped it. No team uses it yet, so behaviour is unchanged.

**3. Seeding.**
The owner runs the move by hand (a script or a button on the Account page that only the owner of a Team
sees): from the owner's device, which has the complete local copy, push the space's **setlists, people and
index** to D1 as creates, then set `storage_v2`. Other devices pull from D1 on their next sync, and a
collision on a `doc_id` is an ordinary conflict. The index is built from the local songs (uuid, `songId`,
title, CCLI number, default key, `isDefault`, `variantOf`, the licence, content hash, `fileRef`). Tests: a
Drive-only space seeded; the index from a song whose file is absent; a second device pulling it all.

**4. Run the move.**
The owner seeds and switches the two Teams, watching the existing traces (a span per D1 call). The privacy
page says the index keeps titles and CCLI numbers, and CLAUDE.md's rule is reworded in the same step, as the
design says. Drive's copies of setlists and people stay as an archive. Then `storage_v2` and the Drive path
for the three collections are deleted.

**5. Sync every space.**
The sync and live-sync code stops reading "the current space". A small `SyncOrchestrator` keeps one sync
session per space on the device (as `sync-orchestrator.ts` already does for one), with the tick per space
(`auto-sync.ts`), the last-sync record keyed by space (`last-sync.ts`) and the data watcher telling which
space a change was in (`data-watcher.ts`). Drive-backed spaces (Personal, still phase 3) sync as before, so
the orchestrator is correct for mixed backends. **Live channel:** one socket per Team space the device is
in (decided), because the rooms are per space already (`team-room.ts`). A space that
cannot be reached is skipped and retried, never blocking the others. Tests: two spaces syncing at once, one
offline; a change in a space that is not in view reaches its backend.

**6. Remove the current space.**
What is left of it: sync, live sync and the register of last syncs (done by step 5); the Team join and
create switches, which become a plain `goTo('/')`; `getCurrentDB` and `ensureCurrentSpace` give way to
`openDefaultSpace`; then `space.ts`'s `current-space-*` keys, `getCurrentSpace`, `setCurrentSpace`,
`switchSpace` and `SpaceChangeEvent` are deleted, the tests that set a current space are rewritten, and the
docs are updated. By then nothing reads it, so the compiler and knip say when it is done.

## Rollout

- Steps 1 to 3 change nothing a person sees. Step 4 is the one visible change, and the owner makes it.
- **Rollback:** there is none built. Before step 4 the owner takes a zip export of each space
  (`space-export.ts`), which already holds setlists, people and songs, and Drive keeps its own copies of
  setlists and people as they were at the move.
- Tombstones of deleted records are kept 180 days, longer than any device is likely to be offline.

## What this does not do

Personal spaces (phase 3: they need an account registered with the server), share-link ciphertext,
preferences and overlays (phase 4), and the CCLI usage report (phase 2, a query once this is in).
