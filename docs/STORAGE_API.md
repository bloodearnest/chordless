# The storage API

What the sync engine needs of wherever a space's files are kept, as one interface
(`src/js/storage/types.ts`), so that Google Drive is one backend among those that could be: the
Worker broker serves the same calls to team-space members (docs/SPACES.md), and a fake implements
them in memory for tests. A second real backend (Dropbox, OneDrive, WebDAV) is not planned yet; the
interface is shaped so that it would not mean touching the engine.

**Status (2026-10-20):** the interface, the Drive adapter (`src/js/storage/drive-storage.ts`) and
the in-memory backend (`tests/memory-storage.ts`) exist and pass one conformance suite
(`tests/storage-conformance.ts`). The sync engine still calls `drive-api.ts` directly; moving it
onto the interface is the next step (see "Moving the engine over").

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
| `readText(ref)` | a file's text |
| `create`, `createMany`, `update` | write; each says whether the backend stored exactly what was sent (`intact`) |

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
folder, the share-link calls (public permissions), the pad sets. Those stay in `drive-api.ts` until
they move over too.

## Moving the engine over

`DriveSyncManager` takes a `storage` option (default `driveStorage`) beside `db`, `folderLink` and
`memberCache`; the engine tests pass a `MemoryStorage` instead of installing FakeDrive. The Drive
adapter keeps its own tests on FakeDrive (`drive-api-*`, `storage-drive`). The order: the manager
(folder, members, access, inventory), then pull, push and revert, then shares and pads, then the
records' `driveFileId` / `driveChecksum` become `ref` / `rev` in one migration of its own.
