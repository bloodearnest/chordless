# The storage API

What the sync engine needs of wherever a space's files are kept, as one interface
(`src/js/storage/types.ts`), so that Google Drive is one backend among those that could be: the
Worker's team service serves the same calls to team-space members (docs/SPACES.md), and a fake implements
them in memory for tests. A second real backend (Dropbox, OneDrive, WebDAV) is not planned yet; the
interface is shaped so that it would not mean touching the engine.

**Status (2026-10-20):** built. The interface, the Drive adapter (`src/js/storage/drive-storage.ts`)
and the in-memory backend (`tests/memory-storage.ts`) pass one conformance suite
(`tests/storage-conformance.ts`). The sync engine (`drive-sync.ts`, `sync/*`) and the share links
(`share-manager.ts`) work through the interface, and so do the pad sets (`pad-set-service.ts`); the engine and pad service tests run on the memory backend. Left:
see "Still on drive-api.ts".

## The shape

A **backend** finds, makes and opens **roots**; a **space storage** (`backend.space(rootRef)`) holds
one space's files in two **collections**, `songs` and `setlists`.

| Call | What it is for |
|---|---|
| `backend.available()` | signed in, and the backend answers (the Storage page's sync panel) |
| `inspectRoot(ref)` | the root a space was linked to: its name, whether it is in the bin, whether this person may write; null if it is gone |
| `findRootByName(name)`, `ensureRoot(name, spaceId)` | first sync on a device: find or make the root by name (goes away for team spaces, which are issued an id) |
| `renameRoot(ref, name)` | a renamed space renames its root |
| `writeRefusals()` | how many writes were refused for lack of permission: how a person who can only read is found out |
| `members()` | the people the space is shared with, for choosing leaders |
| `list(collection)` | the live files of a collection |
| `inventory()` | the refs of every live file in the space (finding records whose file has gone) |
| `status(ref)` | a file wherever it is: `{trashed}`, or null if it does not exist |
| `readText(ref)`, `readMany(refs)` | a file's text; many files' texts, one entry each in order, null for one that could not be read |
| `create`, `createMany`, `update`, `updateMany` | write; each says whether the backend stored exactly what was sent (`intact`). The `Many` forms give one entry per item in order, null for one that failed |

## Pad sets

`backend.pads` (a `PadStorage`) lists the sets, makes or finds one by name, lists its files, adds
a file for a key, puts a set's files in the bin and reads one file's audio. The pad sets are still
the account's, not a space's, so they hang off the backend, not a `SpaceStorage`; when they move
into the space (docs/SPACES.md, "Pads in team spaces") `pads` moves to `SpaceStorage` and the
Worker serves it to members, streaming the audio. `pad-set-service.ts` takes its storage from
`setPadStorage` (Drive's by default), as the engine takes `storage`. Its device-side cache (the
service worker cache, and `padset-cache-state` in localStorage) is the app's own and unchanged.

## Why refs and props, not paths

The files in Drive already have readable names (`2026-10-11-pat-church-service.json`,
`amazing-grace-4779.txt`) and identity in appProperties (`setlistId`, a song's variant links). So a
file is known by an opaque **`ref`** the backend chose (a Drive file id), and told apart by its
**`props`**, a small string map. Records keep the `ref` of their file and the `rev` they last synced;
`rev` changes whenever the content does and only then (Drive's `md5Checksum`).

A backend with no file properties would keep `props` another way (a sidecar file, or a header in
the file). That is that backend's business, and the one real cost of the design; a path-based API
(`songs/<id>.cho`) would have avoided it at the price of a migration of everything in Drive.

A null prop on a write removes that key and the others are kept; this is how retired properties
leave old files (`forUpdate` in `drive-metadata.ts`).

## What a backend must do

The conformance suite is the specification: roots (find, make once, rename, a root it did not
make is null), files (create, list with name, props and times, collections and spaces kept apart,
non-ASCII text, update in place with a new rev, the same rev for the same content, a 404 for a file
that is gone, many files, more than a page of them), and what has gone (a trashed file is not listed
or in the inventory but its status says trashed, a deleted one has no status, a file outside the
space has one but is not in the inventory). Run it on any new backend first.

Not in the interface, because only Drive has them: shared-drive flags, the `Chordless/` parent
folder and how a root is found by name, the md5 check that Drive stored what was sent (it answers
`intact`), the filters of the song and setlist listings.

**Share links** are in it: the `shares` collection, `create(..., { publicLink: true })` for a file
anyone with its ref can read (the Worker's `/api/share/<id>` still reads it with a Drive file id, so
a share link is Drive-specific until that is generalised), and `unpublish` then `trash` to end one.

## Using it

`DriveSyncManager` takes a `storage` option (default `driveStorage`) beside `db`, `folderLink` and
`memberCache`, and opens the space's files with `manager.space`. The engine tests pass a
`MemoryStorage` (docs/TESTING.md). A second backend means an adapter that passes the conformance
suite, and a way to keep `props` (see above).

The Worker's team service (docs/SPACES.md) serves this API over HTTP to team members, so roles and scope
are enforced per collection and ref, and not by walking Drive parents.

## The team backend (client and API built; sign-in, Durable Object and Drive credentials not)

Team-space members get a second implementation of the same interface, `TeamStorage`
(`src/js/storage/team-storage.ts`): HTTP calls to `/api/space/<id>/...` carrying the Worker's
session token (docs/SPACES.md). The engine, share manager and pad service are unchanged; which
backend a space is given depends on its kind and on whether this person is its owner (the owner
keeps `DriveStorage`, direct). `TeamStorage` has to pass `tests/storage-conformance.ts` against
the Worker running over `fake-drive.ts`.

**Built (2026-10-20):** `TeamStorage` and the API it calls, `worker/src/team-api.ts`
(`handleTeamRequest`; the routes are listed at the top of that file). The API is a function of
the request and a `TeamContext`: who is asking and their role (`access`), the space's
`SpaceStorage` (`space`), its root (`root`) and whether a file is in its tree (`owns`). Tests
give it the in-memory storage; the real context is the Durable Object and the owner's token or
service account, and the route is not in `router.ts` yet. Roles are enforced in the handler
(reader reads, writer writes and bins, `canWrite` in the root), a file outside the space is
404 (null in a batch), bodies are text only, and share links (`publicLink`, `unpublish`) and
pads answer "not yet". The space-level conformance suite (`describeSpaceStorage`, split from the
backend suite) runs over `TeamStorage` through the handler, and `team-api.node.test.ts` covers
the roles, the refusals and the scoping. `owns` is the part that needs care in the real context:
it must include binned files, and be cheap (the Durable Object keeping the refs, not a walk of
Drive per call). A team space's root ref is the space id.

On the Worker each call is: check the session token, look up the member's role in the space's
Durable Object, check it against the collection and ref, make the Drive call with the owner's token
(later the service account's) and stream the answer back. Nothing is stored. The Worker may reuse
`drive-storage.ts` with another token provider, so there stays one Drive implementation.

How each call maps:
- `list`, `inventory`, `status`, `readText`, `create`, `createMany`, `update`: straight through;
  writes need writer or above.
- `members()`: from the Durable Object, not Drive permissions.
- `inspectRoot`: answers with the member's role as `canWrite`, which replaces `writeRefusals()`
  and the Drive-capabilities guess (the "role from the Worker" to-do in SPACES.md).
- `findRootByName`, `ensureRoot`, `renameRoot`: first-sync-on-a-device calls that do not apply to
  a member, whose space is issued an id and `rootRef`. Open question: a small "join an issued
  space" call in the interface, so a team backend is not left with stubs. Rename is admin-only.
- Pads: `PadStorage` must first move from the backend to `SpaceStorage` ("Pad sets"), then the
  Worker streams audio: any member uploads, admin and up deletes.
- Share links: `publicLink` and `/api/share/<id>` are Drive-specific. Sharing from a team space
  needs that generalised, or to go through the owner's direct path. Not settled.

**Request volume and batching.** Each storage call is one Worker request plus one Drive
subrequest. A steady-state sync is a few list calls plus one read or write per changed file, so
roughly 5 to 15 requests; a first sync on a device is one read per file (hundreds for a big
library). For a team of 30 that sync a few times a month this is thousands of requests a month,
far inside Workers' limits (checked against the plan's numbers when the team service is built); quota
is not the concern. The cost is latency: about 1.1 to 1.4 s per call was measured, and the proxy
adds a hop to every call the direct path makes, so it cannot be faster than direct.

Batching is therefore in the interface (built 2026-10-20): `readMany`, `createMany` and
`updateMany`. The engine hands a backend a batch of 50 (`BATCH_SIZE`, `sync/session.ts`) and
does not say how it is done. `DriveStorage` keeps what it had: 10 reads or updates in flight,
30 uploads in flight (Google's Batch API cannot carry file content). `TeamStorage` sends a
batch as one request, which the Worker fans out to Drive, with one Durable Object role check for
the whole batch. A batch call is still partial-failure tolerant (null in a slot), and a batch that
throws is retried one record at a time on a push and counted as unread on a pull. Not batched:
`trash` and `unpublish` (rare, small). "Send the revs I know, get back what changed" would be a
pull-level operation, not a primitive: left out until a measurement on a deployed Worker says the
primitives are not enough.

## What is left

- **Share links** are Drive-specific on the Worker's side: `/api/share/<id>` reads a Drive file id
  with the sharing key, so a share link works only for Drive-backed spaces until that is
  generalised.
- **Pad sets** are the account's, not a space's: they move into `SpaceStorage` with the team spaces.
- **Names**: `drive-sync.ts`, `DriveSyncManager`, `driveStorage` and some messages still say Drive.
  They are accurate while Drive is the only backend.
- **`driveClientId`** on the space record is still Drive's (which Google client linked the folder).

`drive-api.ts` is now only the Drive adapter's: nothing else in the app calls it (the dev pages
under `src/dev/` still do, for inspecting Drive).

Records keep what they know of their file as `fileRef`, `fileRev`, `fileModified` and (songs)
`fileProps`; the space record keeps its root as `rootRef`. Before 2026-10-20 these were
`driveFileId`, `driveChecksum`, `driveModifiedTime`, `driveProperties` and `driveFolderId`. Each
space's database is brought over when it next opens (version 7, `migrateRecords` in `db.ts`),
and the spaces database moves to its new name the same way (`SpaceDB.init`).
