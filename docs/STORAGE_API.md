# The storage API

What the sync engine needs of wherever a space's files are kept, as one interface
(`src/js/storage/types.ts`), so that Google Drive is one backend among those that could be: the
Worker's team service serves the same calls to team-space members (docs/SPACES.md), and a fake implements
them in memory for tests. A second real backend (Dropbox, OneDrive, WebDAV) is not planned yet; the
interface is shaped so that it would not mean touching the engine.

**Status (checked 2026-11-12):** built. The interface, the Drive adapter (`src/js/storage/drive-storage.ts`)
and the in-memory backend (`tests/memory-storage.ts`) pass one conformance suite
(`tests/storage-conformance.ts`). The sync engine (`sync-manager.ts`, `sync/*`) and the share links
(`share-manager.ts`) work through the interface, and so do the pad sets (`pad-set-service.ts`); the engine and pad service tests run on the memory backend. Left:
see "Still on drive-api.ts".

## The shape

A **backend** finds, makes and opens **roots**; a **space storage** (`backend.space(rootRef)`) holds
one space's files in three **collections**, `songs` (charts, and a song's lead sheet beside its chart, told apart by the file's `type` prop), `setlists` and `people` (the space's list of
people who lead setlists, one JSON file each: `docs/IDENTITIES.md`), and the `shares` folder.

| Call | What it is for |
|---|---|
| `backend.available()` | signed in, and the backend answers (the sync panel on a space's page) |
| `inspectRoot(ref)` | the root a space was linked to: its name, whether it is in the bin, whether this person may write; null if it is gone |
| `findRootByName(name)`, `ensureRoot(name, spaceId)` | first sync on a device: find or make the root by name (goes away for team spaces, which are issued an id) |
| `renameRoot(ref, name)` | a renamed space renames its root |
| `writeRefusals()` | how many writes were refused for lack of permission: how a person who can only read is found out |
| `members()` | the people the space is shared with, for choosing leaders |
| `list(collection)` | the live files of a collection |
| `inventory()` | the refs of every live file in the space (finding records whose file has gone) |
| `status(ref)` | a file wherever it is: `{trashed}`, or null if it does not exist |
| `readText(ref)`, `readMany(refs)` | a file's text; many files' texts, one entry each in order, null for one that could not be read |
| `bytes`, `readBytes(ref)`, `readManyBytes(refs)` | whether the space holds bytes as well as text (`create` and `update` take a `Uint8Array`; a team space, text-only for now, refuses one); a file's bytes, one entry each in order, null for one that could not be read. The lead sheet's `.mxl` is the first file that is not text |
| `changes` | the feed of what changed, or null for a backend with none: `start()` gives a position, `since(position)` the files now live in `songs` or `setlists` that changed after it, the refs that are gone (in the bin, deleted, or not in this space), and the next position. A position the backend has forgotten throws `ChangeTokenLost`: the sync then lists everything once. Drive's is `changes.list`; the team service passes it on to members (`/changes/start`, `/changes`), saying only of the space's own files that they are gone (docs/SYNC_ARCHITECTURE.md, "Incremental sync") |
| `create`, `createMany`, `update`, `updateMany` | write; each says whether the backend stored exactly what was sent (`intact`). The `Many` forms give one entry per item in order, null for one that failed. An update may carry `ifRev`, the rev the caller last saw the file with: the team service answers 409 (a batch: null for that file) and writes nothing if it has moved on; Drive cannot check and ignores it |

## Pad sets

A `PadStorage` lists the sets, makes or finds one by name, lists its files, adds a file for a key,
puts a set's files in the bin and reads one file's audio, whole (`read`) or as it arrives
(`readStream`, for the Worker to pass on). Every space has its own, in its own folder:
`backend.padsIn(rootRef)` (`<space folder>/pads/`; docs/SPACES.md, "Pads in team spaces"). There are
none that belong to the account (there was a `Chordless/pads/`, found by the name `Chordless`;
changed 2026-11-11, with no migration). Reading a space's sets makes no folder; adding a set does.
For a team member `TeamStorage.padsIn(spaceId)` calls the Worker (`worker/src/team-pads.ts`).
`pad-set-service.ts` lists from every space on the device at once (the owner, and a personal space,
straight in Drive, a member through the Worker), and a test gives it its own with
`setPadSources(sources)`. Its device-side cache (the service worker cache,
and `padset-cache-state` in localStorage) is the app's own, kept by Drive file id, which is unique
across spaces. The conformance suite for pads (`describePadStorage`) runs on a
space's pads of each backend, and on a team's over the Worker.

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

`SyncManager.open` takes a `storage` option (default `driveStorage`) beside `db`, `folderLink` and
`memberCache`, and opens the space's files with `manager.space`. The engine tests pass a
`MemoryStorage` (docs/TESTING.md). A second backend means an adapter that passes the conformance
suite, and a way to keep `props` (see above).

The Worker's team service (docs/SPACES.md) serves this API over HTTP to team members, so roles and scope
are enforced per collection and ref, and not by walking Drive parents.

## The team backend

Team-space members get a second implementation of the same interface, `TeamStorage`
(`src/js/storage/team-storage.ts`): HTTP calls to `/api/space/<id>/...` carrying Google's ID token
(docs/SPACES.md, "Sign-in model"). The engine, share manager and pad service are unchanged. Which backend a
space is given depends on its kind and on whether this person owns it: the owner of an owner-token space keeps
`DriveStorage` and goes direct (`storageFor(space)`, `storage/space-storage.ts`); everyone else uses `TeamStorage`,
with the team's id as `rootRef`. It passes the same conformance suite, through the Worker's handler over
`fake-drive.ts`.

**On the Worker** (`worker/src/team-api.ts`, with `team-routes.ts`, `team-context.ts`, `team-drive.ts`) each call
is: check the ID token, look up the member's role in the team's state (D1), check it against the collection and
ref, make the Drive call with the team's credential (the owner's token, or Chordless's service account: docs/SPACES.md,
"Credentials") and stream the answer back. Nothing is stored. The Worker reuses `createDriveStorage` with another
token source, so there is one Drive implementation.

- **Roles** are enforced in the handler: a reader reads, a writer writes and bins, with the finer rules for pads and
  for deleting a setlist (docs/SPACES.md, "Roles").
- **Scoping.** A file is reachable only if the team's tree holds it. The D1 table `team_refs`
  (`worker/src/team-state.ts`, `team-refs.ts`) keeps the refs, and a ref stays noted when its file is binned. A listing,
  an inventory or a create notes the refs it shows, so a ref no listing has shown is unknown (404) until the next one;
  there is no fallback that walks a file's parents. The owner syncs straight to Drive, so the Worker never sees the
  files they make, but a member lists before reading.
- **Bodies** are text only, but for pad audio, so `TeamStorage.bytes` is false.
- **Share links** work for a team space unchanged, because its refs are Drive file ids: `publicLink` is accepted for
  the `shares` collection only and `unpublish` is passed through; the Worker's `/api/share/<id>` serves ciphertext only.
- **Pads** (`team-pads.ts`): `/api/space/<id>/pads…` streams a file's audio out as Drive sends it. An upload (MP3, up to
  20 MB a file) is held in the Worker's memory while it is sent on, never stored. Any member uploads, but below an admin
  an upload only adds (a set or a key that is there is refused with 409); admin and up bins a set's files to replace them.
- **What does not apply to a member:** `findRootByName`, `ensureRoot` and `renameRoot` are first-sync calls for a space
  that is found or made; a member's space is issued an id. A member's local rename is theirs (`renameRoot` does
  nothing). `inspectRoot` answers with the member's role as `canWrite`, and `members()` comes from D1, not from Drive
  permissions.
- **On the device** a space shared with a team has `team: {id, role}` on its record (`Space.team`). `team-client.ts`
  is the page's end of the Worker's routes, and `team-spaces.ts` has `shareSpace` and `joinSpace`.

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
batch as one request, which the Worker fans out to Drive, with one role check (D1) for
the whole batch. A batch call is still partial-failure tolerant (null in a slot), and a batch that
throws is retried one record at a time on a push and counted as unread on a pull. Not batched:
`trash` and `unpublish` (rare, small). "Send the revs I know, get back what changed" would be a
pull-level operation, not a primitive: left out until a measurement on a deployed Worker says the
primitives are not enough.

## What is left

- **Share links** are Drive-specific on the Worker's side: `/api/share/<id>` reads a Drive file id
  with the sharing key, so a share link works only for Drive-backed spaces (team spaces included,
  as their refs are Drive ids) until that is generalised.
- **Names**: `sync-manager.ts`, `SyncManager`, `driveStorage` and some messages still say Drive.
  They are accurate while Drive is the only backend.
- **`driveClientId`** on the space record is still Drive's (which Google client linked the folder).

The Drive calls are `createDriveApi` (`drive-client.ts`), given a source of access tokens, so the browser
and the Worker each make their own: `drive-api.ts` is the browser's (the signed-in user's token) and
`createDriveStorage(api)` (`storage/drive-storage.ts`) is the adapter over any of them
(`storage/browser-drive.ts` makes the browser's `driveStorage`). Nothing else in the app calls
`drive-api.ts` (the dev pages
under `src/dev/` still do, for inspecting Drive).

Records keep what they know of their file as `fileRef`, `fileRev`, `fileModified` and (songs)
`fileProps`; the space record keeps its root as `rootRef`. Before 2026-10-20 these were
`driveFileId`, `driveChecksum`, `driveModifiedTime`, `driveProperties` and `driveFolderId`. Each
space's database is brought over when it next opens (version 7, `migrateRecords` in `db.ts`),
and the spaces database moves to its new name the same way (`SpaceDB.init`).
