# Build plan: phase 1 of central storage (Teams)

**Status: plan, nothing built (2026-11-20).** Written against the design in
[CENTRAL_STORAGE.md](CENTRAL_STORAGE.md) as updated on `codex/beta-stable-release-design` (song index
in D1, preferences later, the [Beta/Stable rules](BETA_CHANNEL.md) for rolling out), and against the
code as it is: the storage seam in `src/js/storage/`, the Worker's team API in `worker/src/team-api.ts`.

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
7. **Gated per team on the server.** A column on the register (`teams.storage_v2`, default 0) turns D1 storage
   on for one team. A team on it is read through D1; one off is Drive as today. This is the "server-side
   feature gate for a Beta trial" of the release design, and the rollback.
8. **Beta and Stable.** The Worker is one deployment for both channels, so every Worker change in this plan is
   additive (expand), and the client that uses it follows (migrate); the Drive path for these collections is
   retired no sooner than 30 days after the first Stable promotion of the client that stops using it
   ([BETA_CHANNEL.md](BETA_CHANNEL.md#worker-api-support)). Each build declares an API version from the first
   step, so the later floor can be raised.

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

**3. Seeding and the grace period.**
On the first sync of a space the Worker says is `storage_v2`, the device **pushes its own setlists, people and
index** to D1 as creates (the local copy is primary); a collision on a `doc_id` is an ordinary conflict, so
two devices seeding at once converge by the engine's existing rules. The Worker records that the space is
seeded (a flag on the register, not a file in Drive). For the grace period the owner's new builds also list
the Drive `setlists` and `people` files and import any changed after the seeding, so an old owner build's
late writes are not lost; the end of the period is set from the deployed versions and the support policy.
Tests: a Drive-only space seeded; two devices seeding at once; a late Drive write imported; an
index record from a song whose file is absent.

**4. Turn it on, team by team.**
`storage_v2` is set for one real team (this project's own) on Beta, watched through the existing traces (a
span per D1 call, by build and channel), then widened. Release notes and the privacy page say the index keeps
titles and CCLI numbers (CLAUDE.md's rule is reworded in the same step, as the design says). Nothing is
retired: Drive's copies stay as the archive.

**5. Sync every space.**
The sync and live-sync code stops reading "the current space". A small `SyncOrchestrator` keeps one sync
session per space on the device (as `sync-orchestrator.ts` already does for one), with the tick per space
(`auto-sync.ts`), the last-sync record keyed by space (`last-sync.ts`) and the data watcher telling which
space a change was in (`data-watcher.ts`). Drive-backed spaces (Personal, still phase 3) sync as before, so
the orchestrator is correct for mixed backends. **Live channel:** one socket per Team space the device is
in (usually one to three), not per account, because the rooms are per space already (`team-room.ts`) and an
account-wide room would be a new Durable Object; revisit if the number of teams per person grows. A space that
cannot be reached is skipped and retried, never blocking the others. Tests: two spaces syncing at once, one
offline; a change in a space that is not in view reaches its backend.

**6. Remove the current space.**
What is left of it: sync, live sync and the register of last syncs (done by step 5); the Team join and
create switches, which become a plain `goTo('/')`; `getCurrentDB` and `ensureCurrentSpace` give way to
`openDefaultSpace`; then `space.ts`'s `current-space-*` keys, `getCurrentSpace`, `setCurrentSpace`,
`switchSpace` and `SpaceChangeEvent` are deleted, the tests that set a current space are rewritten, and the
docs are updated. By then nothing reads it, so the compiler and knip say when it is done.

## Rollout and rollback

- Steps 1 to 3 change nothing a person sees. Step 4 is the first visible one and is per team.
- **Rollback** is clearing `storage_v2`: the team reads Drive again. Setlists changed in D1 since the
  seeding would be missing from Drive, so before widening past the first team there is a one-way
  **export back** (D1 to Drive files) in the Worker, tested; it is also how a team leaves. Decide whether to
  build it before step 4 or accept that the first team is a trial with a manual repair.
- A device that is offline across the grace period meets the API floor (`CLIENT_UPDATE_REQUIRED`) and the
  recovery controls the release design requires before the first retirement.

## Open questions for the owner

1. **Export back before the first team, or a trial with manual repair?** (Rollback, above.) I would build it:
   it is small and removes the fear.
2. **Which team goes first?** The one this project uses, on Beta.
3. **Live channel**: one socket per Team space (the plan) or one per account.
4. **Whether the song index carries `isDefault` and `variantOf`** (what the variants view needs) or only the
   identity and the title. I would carry them: a device with only the index should show variants.
5. **Tombstone life** for a deleted setlist or song record (open in the design): I would keep them 180 days,
   longer than the grace period and a device that is offline for a season.

## What this does not do

Personal spaces (phase 3: they need an account registered with the server), share-link ciphertext,
preferences and overlays (phase 4), and the CCLI usage report (phase 2, a query once this is in).
