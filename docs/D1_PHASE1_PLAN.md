# Build plan: phase 1 of central storage (Teams)

**Status: plan, nothing built (2026-11-20).** Written against the design in
[CENTRAL_STORAGE.md](CENTRAL_STORAGE.md) as updated on `codex/beta-stable-release-design` (song index
in D1, preferences later). The Beta and Stable release channels are only a plan, so this one does not wait
for them. The schema it ends in is drawn in [D1_SCHEMA.md](D1_SCHEMA.md).

Phase 1 puts a **Team space's setlists, people, song index and pad-set metadata in D1** and gives them
**a sync of their own**, and, as the first thing that needs it, makes **every space sync, not only the
current one**, which is what lets the current space be deleted.

**Decided with the owner (2026-11-20):**
- There are two Teams, both the owner's, from one church. The move is done once, by hand, by the owner: no
  per-team rollout, no export back to Drive, no grace period for other people's old builds.
- The central data is **not** shaped by the Drive sync. Drive's sync is built around a change list because
  listing Drive was slow; D1 is not, so a space's central data is read whole.
- Typed tables, one per kind of record. Every new id is a ULID; existing uuids stay.
- On a conflict the later write is refused and the device re-applies its change on the fresh row.
- The live channel is one socket per Team space. The song index carries `isDefault` and `variantOf`.

## Two syncs, side by side

| | Central data (new) | Song files and pad audio (as now) |
|---|---|---|
| What | setlists, their songs, people, the song index, pad-set metadata | ChordPro, MusicXML, pad audio |
| Kept in | D1 (the Worker) | the space's Drive (or the Worker's pass-through) |
| How it syncs | read whole, write by record | the existing engine: change feed, files, batches |
| Offline | local copy plus an outbox of pending edits | local copy, as now |

The existing sync engine (`src/js/sync/`, `sync-manager.ts`) keeps doing songs and pads and stops
handling `setlists` and `people` for a space that has moved. It is not reshaped to serve D1: it is made
smaller.

## The central sync

**Reading.** `GET /api/space/<id>/central` answers with the space's whole central data in one response
(five arrays, JSON, gzipped by the platform): about a hundred kilobytes for a busy Team, and it is one
query per table. The device replaces its copy of the server-owned records with it. Nothing is listed, diffed
or fetched file by file, and a record missing from the answer is deleted, so there are **no tombstones**.

- **An ETag** (count, latest `modified_at` and sum of versions over the space's rows) lets the periodic
  tick send `If-None-Match` and get a 304 for an unchanged space. The live channel still says one word,
  "changed", and the device then reads the snapshot.
- **History is windowed.** The default answer holds setlists dated in the last 12 months and any later,
  and everything else (every song, person and pad set). `?all=1` adds the older setlists: a **first sync on a
  device asks for everything**, and a "show older setlists" action asks later. The device remembers which
  it holds, so a window never deletes an older setlist it already has.
- **Every space in one call.** `GET /api/central` answers for all the account's spaces at once (an ETag per
  space), which is what syncing every space needs.

**Writing.** Plain record operations, not file writes: `PUT /api/space/<id>/central/setlists/<id>`
with the `version` the edit was based on (`DELETE` likewise, `POST` to create, a batch route for replaying
an outbox). The row's `version` is bumped in the same statement (`UPDATE … WHERE version = ?`); no row
changed is a **409 with the row as it now is**.

**The outbox.** An edit is applied locally at once and queued, with the base version, in a new store of the
device's database. It is sent when online and removed when accepted. A record with a pending edit is not
overwritten by a snapshot until the edit is settled, and a record created offline is not mistaken for one
the server deleted.

**On a 409** the device takes the fresh row and re-applies its own change to it: for a setlist, a three-way
merge against the base it edited (a scalar field the person changed takes their value, one they did not takes
the server's; entries they added, removed or moved are applied by song id), and where both changed the same
field the later write, theirs, wins and a toast says so. People and the song index merge by field the same way.

**Roles** are enforced as today (`team-api.ts`, `team-leaders.ts`): a reader reads, a worship leader writes
setlists and people, a writer may delete only a setlist they lead, an admin or owner any. The leader rule
reads the setlist row instead of a file.

**Personal spaces** (phase 3) use the same routes with the account as the authority, so none of this is
rebuilt then.

## Ids

From now on every new id is a **ULID** (time-ordered, so inserts stay at the end of an index; 26
characters): setlists, songs, people, pad sets, devices, invites and the like. **Existing uuids stay**: they
are in every device's database and every link, and the two kinds sit side by side as opaque strings. The code
needs `src/js/ulid.ts` (written here, not a package: monotonic within a millisecond, from
`crypto.getRandomValues`) and one fix: `setlistCode()` in `share-crypto.ts` builds a share link's short code
from a setlist id's first hex digits and returns nothing for an id that is not a uuid, so it must learn the
random tail of a ULID or links from new setlists lose it. The ids made by `crypto.randomUUID()` today
(`db.ts`, `song-utils.ts`, `space-db.ts`, `space-transfer.ts`, `annotations-controller.ts`, the Worker's
`newSpaceId`) change to it, one place at a time, in step 2.

## Steps

Each is its own pull request, in this order, and each passes the whole of `just ci` alone (Biome, `tsc -b`,
knip, node tests, browser unit tests, coverage-check, Playwright). Each ships by the ordinary merge;
nothing is turned on for a team until step 4.

**1. The tables and the central API on the Worker (no client change).**
Migration `0011_space_content.sql`: the five typed tables of [D1_SCHEMA.md](D1_SCHEMA.md) (`space_songs`,
`space_setlists`, `space_setlist_songs`, `space_people`, `space_pad_sets`), the unique setlist id, and
`teams.central` (only for the move: default 0, deleted afterwards). `worker/src/central.ts` with the routes
above, the role checks and the ETag. Tests (`team-api.node.test.ts` style): roles; a stale write is a 409
with the current row; the ETag and 304; the window and `?all=1`; deletes; the setlist id unique across spaces;
an unmoved team still answers from Drive.

**2. The device's central sync, ids and entry fields.**
`src/js/central-sync.ts`: snapshot apply, the outbox, the 409 merge, the live "changed" trigger. A
database version bump (see [MIGRATIONS.md](MIGRATIONS.md): roll forward only) adds the outbox store,
`version` on the central records, a song-index record (uuid, `songId`, title, CCLI number, default key,
`isDefault`, `variantOf`, the licence it came in under, content hash, `fileRef`) written when a song is added,
changed or removed and read on a device whose song file is not there ("Get this song"), and `title` and
`ccli` on a setlist entry, filled when it is made and refreshed when the song is opened. `ulid.ts` and the
`setlistCode()` fix. The Drive engine learns to skip `setlists` and `people` for a space the Worker says has
moved (`GET /root` gains the flag). Nothing uses it yet, so behaviour is unchanged.

**3. Seeding.**
The owner runs the move by hand (a button on the Account page only an owner sees, or a script): from the
owner's device, which has the complete local copy, push the space's setlists, people and index through the
central API, then set `teams.central`. Other devices read the snapshot on their next sync. Tests: a
Drive-only space seeded; the index from a song whose file is absent; a second device reading it all; an
offline edit that meets a 409 on reconnect.

**4. Run the move.**
The owner seeds and switches the two Teams, watching the existing traces (a span per central request). The
privacy page says the index keeps titles and CCLI numbers, and CLAUDE.md's rule is reworded in the same
step, as the design says. Drive's copies of setlists and people stay as an archive. Then `teams.central` and
the Drive path for those two collections are deleted.

**5. Sync every space.**
The sync and live-sync code stops reading "the current space". A `SyncOrchestrator` keeps what each space
needs: the central read (one call for all spaces) and, for a space with song files, a Drive session as
`sync-orchestrator.ts` already does for one; the tick per space (`auto-sync.ts`), the last-sync record keyed
by space (`last-sync.ts`) and the data watcher telling which space a change was in (`data-watcher.ts`).
**Live channel:** one socket per Team space the device is in (decided), because the rooms are per space
already (`team-room.ts`). A space that cannot be reached is skipped and retried, never blocking the others.
Tests: two spaces syncing at once, one offline; a change in a space that is not in view reaches the server.

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
- A device that has not updated after the move keeps reading Drive's archive of setlists and people, which
  no longer changes: it should be told to update. A minimum client version on the central routes, and a
  refusal on the Drive path for a moved space, would do it, and is cheap to add in step 1.

## What this does not do

Personal spaces (phase 3: they need an account registered with the server), share-link ciphertext,
preferences and overlays (phase 4), and the CCLI usage report (phase 2: a join of `space_setlists` and
`space_setlist_songs` once this is in).
