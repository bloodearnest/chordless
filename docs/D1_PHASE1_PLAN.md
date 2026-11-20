# Build plan: phase 1 of storage in D1 (Teams)

**Status (2026-11-20): steps 0 and 1 are built, merged and applied in production (migrations `0011`, `0012`; `0013` merged in #278, applied by its deploy). Step 2a (ULIDs, people included) is built (#281). Step 2b (device schema and metadata) is built (#285). Step 2c (device sync) is implemented on the current branch; 2d onward is not built. No Team is switched to D1 until the owner runs the move.** Written against the design in
[CENTRAL_STORAGE.md](CENTRAL_STORAGE.md) (an old name: it is only "central" because the app began distributed) as updated on `codex/beta-stable-release-design` (song index
in D1, preferences later). The Beta and Stable release channels are only a plan, so this one does not wait
for them. The schema it ends in is drawn in [D1_SCHEMA.md](D1_SCHEMA.md).

Phase 1 puts a **Team space's setlists, people, song index and pad-set metadata in D1** and gives them
**a sync of their own** (the word "central" is not used in the code or the API: this is just where a space's
data is kept, now that it is no longer distributed), and, as the first thing that needs it, makes **every space sync, not only the
current one**, which is what lets the current space be deleted.

**Decided with the owner (2026-11-20):**
- There are two Teams, both the owner's, from one church. The move is done once, by hand, by the owner: no
  per-team rollout, no export back to Drive, no grace period for other people's old builds.
- A space's data in D1 is **not** shaped by the Drive sync. Drive's sync is built around a change list because
  listing Drive was slow; D1 is not, so a space's data is read whole.
- Typed tables, one per kind of record. Every new id is a ULID; existing uuids stay.
- On a conflict the later write is refused and the device re-applies its change on the fresh row.
- The live channel is one socket per Team space. The song index carries `isDefault` and `variantOf`.

## Two syncs, side by side

| | The space's data (new) | Song files and pad audio (as now) |
|---|---|---|
| What | setlists, their songs, people, the song index, pad-set metadata | ChordPro, MusicXML, pad audio |
| Kept in | D1 (the Worker) | the space's Drive (or the Worker's pass-through) |
| How it syncs | read whole, write by record | the existing engine: change feed, files, batches |
| Offline | local copy plus an outbox of pending edits | local copy, as now |

The existing sync engine (`src/js/sync/`, `sync-manager.ts`) keeps doing songs and pads and stops
handling `setlists` and `people` for a space that has moved. It is not reshaped to serve D1: it is made
smaller.

## Space data and its sync

**Reading.** `GET /api/space/<id>/data` answers with the space's whole data in one response
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
- **Every space in one call.** `POST /api/spaces/data` (`GET /api/spaces` is the list of spaces, which already
  existed) answers for all the account's spaces at once: the body says `{all?, etags?}`, and each space is answered with
  its data, `{unchanged: true}` where its ETag is still right, or `{moved: false}` where it is still on Drive. This is what
  syncing every space needs.

**Writing.** Plain record operations, not file writes: `PUT /api/space/<id>/setlists/<id>`
with the `version` the edit was based on (`DELETE` likewise, `POST` to create, `POST /api/space/<id>/batch` for replaying
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

**Built (2026-11-20, step 2a).** `src/js/ulid.ts` (monotonic within a millisecond, steady if the clock steps back) and the places that made
record ids now use it: a setlist, a song's `uuid` and its fallback `songId`, a chart's file id, a copied setlist, an annotation,
a personal space, and the Worker's team space id, and a new person (an id made from an address would be taken by whoever
next has it, once it is removed from the first person). Two devices that each make the person for one address make two, and
`dedupePeople` joins them on the shared address, the same way on every device (the id that is not a ULID, else the earliest, is
kept; the setlists they led follow). Only the conversion of a legacy record keeps its derived id (`personFromLegacy`), so
devices converting apart agree. Telemetry, message and tab ids are not records and stay
uuids. Two places read the shape of an id and were fixed: `setlistCode()` (a ULID has a code from its random end) and the
file names in a space export and a person's Drive file, which took the first eight characters of an id (the time, for a ULID)
and now use `shortId()`.

## Steps

Each is its own pull request, in this order (step 0 first), and each passes the whole of `just ci` alone (Biome, `tsc -b`,
knip, node tests, browser unit tests, coverage-check, Playwright). Each ships by the ordinary merge;
nothing is turned on for a team until step 4.

**0. Clean up the existing schema first (decided with the owner, 2026-11-20). Built and applied (2026-11-20, #275).**
[SCHEMA_AUDIT.md](SCHEMA_AUDIT.md) found no foreign keys on any of the 13 tables, team members keyed by a login
instead of an account, nullable columns that should be required, empty-string sentinels, no `CHECK`s and a few
missing indexes. One migration (`0011_schema_cleanup.sql`) rebuilds the tables with proper keys, `NOT NULL`,
`CHECK`s and `ON DELETE` rules, in the same pull request as the Worker code that uses them, rehearsed on a copy of
production's data and run by the owner with a backup taken. Nothing below starts until it is merged. The tables
in the steps after it are written the same way, so the new migration is `0012_space_data.sql`.

**1. The tables and the space-data API on the Worker (no client change). Built and applied (2026-11-20, #277, #278).**
Migration `0012_space_data.sql`: the five typed tables of [D1_SCHEMA.md](D1_SCHEMA.md) (`space_songs`,
`space_setlists`, `space_setlist_songs`, `space_people`, `space_pad_sets`), the unique setlist id, and
`teams.storage` (`'drive'` by default, `'d1'` once moved: only for the move, deleted afterwards). `worker/src/space-data.ts` with the routes
above, the role checks and the ETag, and the types both sides share (`src/js/space-data-types.ts`). As built:
- **The table refuses a stale write, and the batch undoes itself.** A trigger on each table (`0013_space_data_versions.sql`: `RAISE(ABORT,
  'stale_version')`) refuses an update whose `version` is not the old one plus one, so a change made from a version the row
  has left aborts, and D1 undoes the whole batch (a setlist's songs included). A write names the version it expects plus one;
  the rule is in the schema, so no code path can forget it. A create that finds the id taken, in this space
  or another, is a 409 (another space's record is never shown: `current` is null). A change to a record that has since been
  deleted is a 404 `missing`.
- **Roles are the Drive-backed API's:** a reader reads; a writer changes setlists, songs and people; a writer deletes a
  setlist they lead (through a merged person, or by the legacy owner address) or made when it has no leader, an admin or the
  owner any; any member adds a pad set, an admin changes or deletes one; any member names the person who is them.
- **Records are checked** (ids, a `YYYY-MM-DD` date, lengths, at most 300 songs a setlist, a whole-number tempo, JSON
  in a field at most 64 KB) and a record that is not right is a 400 with what is wrong, and nothing is written.
- **A team that has not moved** (`teams.storage = 'drive'`) is told `409 not_moved`; its files API goes on as it was.
- **The batch** (`POST /batch`) applies up to 100 changes one at a time, each with its own answer
  (`ok | conflict | missing | forbidden | invalid`).
Tests (`tests/space-data.node.test.ts`, through the router with real tokens): all of the above, 44 cases.

**2. The device's side of it, ids and entry fields.** In four parts, each its own pull request:
**2a (ULIDs; built, #281):** new ids are ULIDs (a new person too), people who share an address are joined on every device
(`dedupePeople`), and the code that read an id's shape is fixed. **2b:** the database version bump (below). **2c:** `space-data.ts`
and the sync. **2d:** the Drive engine skips the moved collections. The whole of it:
`src/js/space-data.ts` (`space-sync.ts` is taken, by the Account page's Sync button): snapshot apply, the outbox, the 409 merge, the live "changed" trigger. A
database version bump (see [MIGRATIONS.md](MIGRATIONS.md): roll forward only) adds the outbox store,
`version` on these records, a song-index record (uuid, `songId`, title, CCLI number, default key,
`isDefault`, `variantOf`, the licence it came in under, content hash, `fileRef`) written when a song is added,
changed or removed and read on a device whose song file is not there ("Get this song"), and `title` and
`ccli` on a setlist entry, filled when it is made and refreshed when the song is opened. (`ulid.ts` and the
`setlistCode()` fix are 2a.) The Drive engine learns to skip `setlists` and `people` for a space the Worker says has
moved (`GET /root` gains the flag). Nothing uses it yet, so behaviour is unchanged.

**2b implementation.** Device database v16 adds `song_index` (keyed by song UUID, indexed by
`songId`), `space_outbox` (keyed by monotonic edit ULID) and `pad_sets` (keyed by `padSetId`).
An outbox entry retains the operation, base version and base record for the merge in 2c; this step
creates no queued edits. Existing song, setlist and person records gain a nullable D1 `version`;
null or absent means not yet synced to D1. The index uses the shared API's song fields, with a
nullable revision until first sync. It is seeded from existing songs, including those whose chart
is absent, and maintained atomically with song saves, updates, batches, Drive acknowledgements
and deletions. A chart's CCLI licence is extracted where available; no chart text enters the index.
Setlist entries gain optional `title` and `ccli`, filled from the index on save and refreshed on
opening the setlist. Entries whose songs are missing retain their labels. The chart/content stores,
Drive links, existing IDs and personal setlist layer remain intact. Snapshot application, outbox
replay and displaying songs known only to the index follow in 2c.

**2c implementation.** `space-data.ts` reads conditional snapshots and replays record operations;
`space-data-store.ts` applies them atomically and owns the durable outbox. Database v17 adds
`space_data` (the moved/probing state, ETag and complete-history checkpoint) and an outbox index
by record. Existing records and queued operations are retained; v16 gains no rewritten records.

A local setlist/person/index/pad-metadata edit and its queued operation commit together. Edits of
one record coalesce, retaining the original merge base, with a fresh operation id on each edit so
an acknowledgement cannot remove a newer edit. Delivery starts immediately after the commit when
online: there is no debounce or wait for the tick. Reconnect, visible-page resume, manual Sync and
the minute tick retry it. Web Locks serialize senders of the same space across tabs. Drive-written
song file links update the index and queue its metadata too; chart text never enters the outbox.

The first request fetches all history. Later conditional requests use the saved ETag and the
window, retaining older local history. Snapshots protect queued creations, updates and deletions,
preserve personal additions and local state, and validate their shape before replacing anything.
A Team opened offline provisionally queues edits before its mode is known, and probing also queues edits made during the very first request; `not_moved` drops only this temporary
queue and keeps the Drive-backed records. A space already on D1 cannot silently revert to Drive.

A conflict reapplies edited scalar/body/entry fields and entry additions/removals/moves by song
id, retaining independent server changes. A shared-field collision keeps the later local change
and says so with a toast. Lost acknowledgements reconcile against the returned row instead of
creating duplicates. Permanent refusals retain local edits and stop automatic retries; the toast
explains the refusal and offers an explicit retry. Further snapshots merge shared changes into
these retained local edits, so a reader's key change does not freeze the rest of a setlist.

`space-data-runtime.ts` starts delivery from committed edits and routes live “changed” messages
to the snapshot sync. Polling remains current-space scoped until step 5; explicit edits/manual
syncs can name their own space. Indexed songs without charts appear with their title, key and CCLI
number and a “Get this song” link; pad-set metadata is read from D1 for a moved Team. The reader's
self-name route accepts the D1 response without expecting a Drive file. Nothing switches a Team's
storage, seeds the server, or excludes Drive collections yet: those are 2d, 3 and 4.

**3. Seeding.**
The owner runs the move by hand (a button on the Account page only an owner sees, or a script): from the
owner's device, which has the complete local copy, push the space's setlists, people (after `dedupePeople`, so a person two devices made twice is one) and index through the
API, then set `teams.storage` to `'d1'`. Other devices read the snapshot on their next sync. Tests: a
Drive-only space seeded; the index from a song whose file is absent; a second device reading it all; an
offline edit that meets a 409 on reconnect.

**4. Run the move.**
The owner seeds and switches the two Teams, watching the existing traces (a span per request). The
privacy page says the index keeps titles and CCLI numbers, and CLAUDE.md's rule is reworded in the same
step, as the design says. Drive's copies of setlists and people stay as an archive. Then `teams.storage` and
the Drive path for those two collections are deleted.

**5. Sync every space.**
The sync and live-sync code stops reading "the current space". A `SyncOrchestrator` keeps what each space
needs: the read of space data (one call for all spaces) and, for a space with song files, a Drive session as
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
  no longer changes: it should be told to update. A minimum client version on the space-data routes, and a
  refusal on the Drive path for a moved space, would do it, and is cheap to add in step 1.

## What this does not do

Personal spaces (phase 3: they need an account registered with the server), share-link ciphertext,
preferences and overlays (phase 4), and the CCLI usage report (phase 2: a join of `space_setlists` and
`space_setlist_songs` once this is in).
