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
| `changes` | the feed of what changed, or null for a backend with none: `start()` gives a position, `since(position)` the files now live in `songs` or `setlists` that changed after it, the refs that are gone (in the bin, deleted, or not in this space), and the next position. A position the backend has forgotten throws `ChangeTokenLost`: the sync then lists everything once. Drive's is `changes.list`; the team service passes it on to members (`/changes/start`, `/changes`), saying only of the space's own files that they are gone (docs/SYNC_ARCHITECTURE.md, "Incremental sync") |
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

## The team backend (built end to end for an owner-token space, in the Worker; no page for it yet, and no service account)

Team-space members get a second implementation of the same interface, `TeamStorage`
(`src/js/storage/team-storage.ts`): HTTP calls to `/api/space/<id>/...` carrying the Worker's
ID token (docs/SPACES.md). The engine, share manager and pad service are unchanged; which
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
404 (null in a batch), bodies are text only, and pads answer "not yet". Share links work (2026-10-22): `publicLink` is
accepted for the `shares` collection only and `unpublish` is passed through, and because a team
space's refs are Drive file ids, the Worker's `/api/share/<id>` serves a share from a team space
unchanged (ciphertext only, as ever). The space-level conformance suite (`describeSpaceStorage`, split from the
backend suite) runs over `TeamStorage` through the handler, and `team-api.node.test.ts` covers
the roles, the refusals and the scoping. `owns` is the part that needs care in the real context:
it must include binned files, and be cheap (the Durable Object keeping the refs, not a walk of
Drive per call): `TeamSpaceState.addRefs` and `owns` (`worker/src/team-state.ts`) keep them, and
a ref stays noted when its file is binned.
`notingRefs` (`worker/src/team-refs.ts`) fills it: it wraps the space's storage and notes the refs a
listing, an inventory or a create shows. The owner syncs straight to Drive, so the Worker never
sees their files made, but a member lists before reading and a listing is scoped to the space's
root. A ref no listing has shown is unknown (a 404) until the next one; there is no fallback
that walks a file's parents. A team space's root ref is the space id. The client's `token` option is `getIdentityToken()` (`google-auth.ts`), Google's ID token, which the Worker checks (`worker/src/identity.ts`; docs/SPACES.md, "Sign-in model").

On the Worker each call is: check the ID token, look up the member's role in the space's
Durable Object, check it against the collection and ref, make the Drive call with the owner's token
(later the service account's) and stream the answer back. Nothing is stored. The Worker reuses
`createDriveStorage` with another token source (`worker/src/team-drive.ts`, built 2026-10-21), so there
stays one Drive implementation: `ownerAccessToken` opens the owner's blob from the space's Durable
Object, checks it is the owner's (`owner_sub`), refreshes an access token for it (kept in the
isolate's memory for its hour, made once for a whole batch) and says "sharing is not set up" (no
blob) or "the owner needs to reconnect Google Drive" (`invalid_grant`, or a blob it can no longer
decrypt) as a 409. A service account
would be another source. Wired into the route (`worker/src/router.ts`, `team-context.ts`, 2026-10-21): the ID token is checked first, then the role from the Durable Object, then Drive with the owner's token, with the refs each listing shows noted. Spaces are made and joined through `team-admin.ts` (docs/SPACES.md), not through this API.

**On the device (built 2026-10-21):** a space shared with a team has `team: {id, role}` on its
record (`Space.team`). `storageFor(space)` (`storage/space-storage.ts`) gives the backend: Drive for
a space of one's own and for the owner of a team space, `TeamStorage` for anyone else, whose
`rootRef` is the team space id. `createSyncManager`, `isSyncAvailable` and the folder check
(`space-access.ts`) use it, so a member's sync, availability and read-only state (the role's
`canWrite`) come from the Worker. `team-client.ts` is the page's end of the Worker's routes
(`teamApi`), and `team-spaces.ts` has `shareSpace` (the owner: the space keeps its folder and files
and gets an id) and `joinSpace` (a member: a space named as the team calls it, rooted at the team
id). A member's local rename is theirs: `TeamStorage.renameRoot` does nothing. No page uses these
yet.

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
- Share links: `/api/share/<id>` is Drive-specific. Team spaces work today because their refs are
  Drive file ids; a backend with other refs (a service account on another store) would need it
  generalised.

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
  with the sharing key, so a share link works only for Drive-backed spaces (team spaces included,
  as their refs are Drive ids) until that is generalised.
- **Pad sets** are the account's, not a space's: they move into `SpaceStorage` with the team spaces.
- **Names**: `drive-sync.ts`, `DriveSyncManager`, `driveStorage` and some messages still say Drive.
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
