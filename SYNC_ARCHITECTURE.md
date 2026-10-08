# Sync Architecture

How Chordless syncs setlists and songs with Google Drive: what exists today, and
the designs for what's next.

- [Part 1: How sync works today](#part-1-how-sync-works-today)
- [Part 2: Planned work](#part-2-planned-work)
  - [Deleting setlists](#deleting-setlists) (designed, not built)
  - [Immediate background sync](#immediate-background-sync) (designed, not built)
  - [Later](#later)

Last updated 2026-10-08. Supersedes the earlier "Phase 2.5 / Phase 3" version of this
document and SETLIST_DELETION.md.

---

## Part 1: How sync works today

### Where data lives

- **On each device:** IndexedDB, one `ChordlessDB` per organisation (setlists, songs,
  chord charts, per-setlist device state in `setlist_local`). The app works offline
  from this.
- **In Drive:** a `Chordless/` folder with one folder per organisation:

  ```
  Chordless/
    <Organisation name>/
      setlists/  <date>-<leader>-<type>[-<name>].json   one per setlist
      songs/     <title>[-<ccli>].txt                    one chord chart per song variant
    pads/
  ```

  Drive is the shared copy; each device syncs its local database with it.

### Layers

```
UI (main thread)          drive-sync-panel.js (Sync / Reset from Google Drive buttons)
        │
Orchestration             sync-orchestrator.js: wraps the engine, broadcasts progress
        │                 (callback on the main thread, postMessage from a service worker)
Sync engine               drive-sync.js: DriveSyncManager
        │
File metadata             drive-metadata.js: names, MIME types and appProperties
        │
Drive API                 drive-api.js: REST calls via fetch
```

Sync currently runs on the **main thread**, started by the user from the Storage
page. The orchestrator and engine have no DOM dependencies, so they can run in the
service worker too (planned below).

**Auth:** the service worker holds the session (a JWE blob from the worker). Pages
get access tokens by messaging it (`GET_BLOB`), refreshing via the worker's
`/session/refresh` when expired. `drive-api.js` lets the token source be replaced
(`setAccessTokenProvider`), which tests use and a service-worker sync will need.

### A full sync (`DriveSyncManager.sync()`)

1. **Refresh members:** list who the organisation folder is shared with
   (`permissions.list`) and cache it on the organisation record. Feeds the setlist
   Leader dropdown. Failure is logged, not fatal.
2. **Inventory:** list every file in the organisation folder (all pages,
   recursively). If listing fails, the "missing from Drive" checks below are skipped
   rather than treating everything as missing.
3. **Folder guard:** if local records point at Drive files that exist *outside* this
   organisation's folder, stop with `OrganisationFolderMismatchError` instead of
   re-uploading them as duplicates.
4. **Pull** setlists then songs: download what's new or changed in Drive.
5. **Push** setlists then songs: upload what's new or changed locally.

### Finding the organisation folder

- The first sync on a device finds the folder **by name** (so a new device can join
  an existing organisation) and stores its id on the organisation record
  (`driveFolderId`). Later syncs use the id, so renaming an organisation can't point
  sync at a different folder.
- After a rename, sync renames the Drive folder to match, unless another folder has
  that name. If the device has nothing synced yet, it joins that existing folder
  instead.
- An organisation still called "Personal" (the pre-sign-in default) is renamed to the
  Google account's name before any sync or reset.
- If the linked folder is trashed or gone, sync stops with an explanation rather than
  creating a new one.

### Change detection (no clock comparisons)

Each synced record stores, from its last sync:

| Field | Meaning |
|---|---|
| `driveFileId` | its Drive file |
| `syncedContentHash` | hash of its content as last synced |
| `driveChecksum` | Drive's `md5Checksum` of the file as last synced |
| `driveModifiedTime`, `lastSyncedAt` | informational |

- **Changed locally:** the content hash differs from `syncedContentHash`. For
  setlists the hash ignores sync bookkeeping, key order and `modifiedDate` (so an
  undone edit isn't a change); for songs it's the chart text.
- **Changed in Drive:** Drive's listed `md5Checksum` differs from `driveChecksum`.
  Both come from Drive, so device clocks never matter.
- **Both:** a conflict. Currently **Drive wins** and the local edit is dropped (with
  a console warning).
- Records synced before these fields existed fall back to timestamp checks (device
  clock only) until their next sync records the hash and checksum, which needs a
  download but no upload.

### Pull and push rules

| Situation | What happens |
|---|---|
| In Drive, not local | downloaded |
| Local, never synced | uploaded |
| Local and changed, not changed in Drive | uploaded (file updated in place) |
| Changed in Drive only | downloaded |
| Changed both | conflict: Drive wins |
| Synced before, **file now missing from Drive** | **uploaded again**: deletions don't stick (see [Deleting setlists](#deleting-setlists)) |

Uploads of new files are batched (50 setlists / 25 songs at a time, up to 30
concurrent requests); one failed upload leaves just that record unsynced for next
time. Updates run 10 at a time. A failed update is logged and retried next sync;
the sync itself still reports success.

### File metadata (`drive-metadata.js`)

The one place that decides a synced file's name, MIME type and `appProperties`.
Every upload and update goes through it.

- **Setlist** `appProperties`: `organisationId`, `setlistId`, `appVersion` only.
  Everything else (date, leader, name...) lives in the JSON content.
- **Song** `appProperties`: identity (`type`, `songId`, `songUuid`), variant
  relationships (`variantOf`, `isDefault`, `variantLabel`) and import provenance:
  what pull needs that the chart text doesn't contain.
- Updates send name and `appProperties` with the content in one multipart request,
  so file names follow edits; retired properties from older versions are removed.

### Setlist leaders

A setlist's leader is `owner` (name) + `ownerId` (Google account email; empty for a
leader typed in by name with "Other…"). The Leader dropdown lists the organisation
folder's members (cached at sync) plus the signed-in user, who is the default for new
setlists.

### Reset from Google Drive

Storage page, only when sync is set up. Replaces the device's setlists, songs and
charts with Drive's copy. Unlike a normal sync, records whose Drive file is gone are
dropped, not re-uploaded. It refuses, changing nothing, if Drive can't be listed or
if any local record has changes not in Drive. Per-setlist device state is kept.

### Safety rules

- Nothing in sync permanently deletes song or setlist files. (Pad set uploads replace
  their own files.)
- An empty or wiped local database never removes anything from Drive.
- Anything the app removes in future should go to the **Drive trash** (recoverable
  for 30 days), not be permanently deleted.

### Tests

- `tests/fake-drive.js`: in-memory Drive (files, folders, `appProperties` vs
  `properties`, field projection, paging, `md5Checksum`, permissions, a skewable
  server clock, injected failures). Errors on anything it doesn't model.
- `tests/drive-sync.test.js`: the real `DriveSyncManager` for two simulated devices
  sharing one fake Drive: push/pull, conflicts, clock skew, failures part-way,
  paging, organisations and renames, reset, metadata, members.
- `tests/drive-metadata.test.js`, `tests/fake-drive.test.js`.
- Not yet: integration tests against real Drive, using a separate Google test account
  with its refresh token in `.dev.vars`. First things to confirm there: uploads
  return `md5Checksum`, and whether metadata-only updates change `modifiedTime`.
- `public/dev/drive-audit.html`: read-only audit of the setlist files in Drive, with a
  confirmed move-to-trash cleanup for duplicates.

---

## Part 2: Planned work

### Deleting setlists

Status: **designed, not built.** Goal: remove a setlist (e.g. added in error),
restricted to setlists you own, with the deletion reaching Drive and other devices.

**Why it needs sync changes:** today sync undoes deletions in both directions. A
setlist missing from Drive but present locally is re-uploaded (`pushSetlists`, the
"Clearing stale Drive ID for setlist" path), and one in Drive but missing locally is
downloaded (`pullSetlists`).

#### Deleting (UI)

- A **Delete setlist** button in the setlist info dialog's edit view (the pencil),
  so it's behind an explicit edit step, per the app's edit-mode rule for destructive
  actions. Shown only when the setlist is deletable.
- Confirmation via an `app-modal` of `type="confirm"` and `ask()`: "Delete setlist?
  It's moved to the Google Drive trash on the next sync." Confirm label "Delete".
- The dialog fires e.g. `setlist-delete` with `{ setlistId }`; the page
  (`setlist-app.js`, next to `saveSetlistDetails`) deletes it and goes home.

#### Who can delete

- Only when the setlist's `ownerId` matches the signed-in user's email
  (`getCurrentPerson()` in `people.js`, case-insensitive). Not signed in: no button.
- Caveat until edit restrictions exist: anyone can change a setlist's leader to
  themselves first, so this guards against mistakes, not abuse.
- Open question: owner currently means leader. A setlist created in error with
  someone else as leader can't be deleted by its creator without changing the leader
  first. A separate `createdBy` may be worth adding.

#### Local effect

- The setlist record is removed from the local database at once, so lists, song
  history and search don't need to know about deleted setlists.
- If it had been synced, record a **pending deletion** `{ setlistId, driveFileId,
  deletedAt }` in a new object store (e.g. `pending_deletions`, keyPath `setlistId`):
  a `ChordlessDB` version bump from 5 to 6.
- If it was never synced, it's simply gone. Its `setlist_local` entry can go too.

#### Sync

New full sync order: members → inventory + folder guard → **pending deletions** →
pull → push.

1. **Pending deletions run before the pull**, so the setlist isn't downloaded again:
   move each Drive file to the **trash** (`PATCH files/{id}` `{ trashed: true }`).
   On success, 404 or already trashed, remove the pending entry; otherwise keep it
   and retry next sync. Also processed by the immediate background sync (below).
2. **Remote deletion on other devices** (a behaviour change). In `pushSetlists`, for a
   local setlist whose `driveFileId` isn't in the inventory:
   - **Unchanged since last sync** (`setlistHasLocalChanges()` false): the deletion
     wins; remove the local copy instead of re-uploading.
   - **Edited since last sync:** the edit wins; re-upload as today, so unsynced work
     is never lost.
   - This also makes deleting a setlist in the Drive UI stick.
   - Only when the inventory was built (`_driveFileIds` not null). The folder guard
     already stops sync if the file exists elsewhere, so "missing" means deleted or
     trashed.
   - **Needs the user's confirmation when resumed.**
3. **Undo:** restore the file from the Drive trash; each device's next sync sees it in
   Drive but not locally and downloads it.

Scope: setlists only; songs keep re-upload behaviour for now.

#### Tests

Sync (FakeDrive already supports `PATCH { trashed: true }`):

- deleting a synced setlist trashes its file on the next sync, and it isn't
  downloaded again
- another device's next sync removes its unchanged copy
- another device with an unsynced edit keeps and re-uploads it
- deleting a never-synced setlist leaves nothing in Drive and no pending entry
- a failed trash keeps the pending deletion, retries next sync, and the setlist isn't
  re-downloaded in between
- restoring from the trash brings it back on the next sync
- deleting in the Drive UI sticks for an unchanged local copy
- update the existing test "re-uploads a setlist whose Drive file was deleted
  elsewhere" to cover the edited-copy case

Database: the v6 upgrade adds the store and existing data survives. UI: the button
only shows for the owner; Playwright: info → pencil → Delete → confirm → home,
setlist gone, pending deletion recorded.

### Immediate background sync

Status: **designed, not built.** Goal: when the user changes something (adds or
removes a song in a setlist, changes a key, edits setlist details, edits a chart),
push *just that record* to Drive straight away, in the background. Opportunistic: if
it's dropped, the next full sync catches it.

#### Where it runs: the service worker

Network calls don't block the page anyway; the reason is navigation. The app changes
pages with full navigations, so a push started on the setlist page would be killed by
going back home. In the service worker it completes regardless.

- The service worker needs its own access token source: it can't message itself for
  the blob. Use `setAccessTokenProvider` with a provider that reads the blob from
  `AuthDB` and refreshes via the worker's `/session/refresh`.
- `DriveSyncManager` already runs without the DOM (`ChordlessDB` by organisation id
  outside a window). The organisation's folder link and members come from the
  organisations database, available in the service worker.

#### Trigger: one explicit call

- App code that saves a *user's* change calls `syncSoon({ type, id, organisationId })`
  (`type` = `setlist` or `song`), which messages the service worker
  (e.g. `SYNC_RECORD`).
- Deliberately not a hook in `ChordlessDB.saveSetlist`: sync's own saves (after
  pulls and pushes) must not trigger it, or it would loop. About 16 `saveSetlist`
  call sites to review; most are user edits.
- **Debounced per record** (about 2 seconds of quiet), so a burst of reorders or key
  changes becomes one push.

#### Pushing one record

- New engine entry points, e.g. `pushSetlistNow(id)` and `pushSongNow(uuid)`, reusing
  the existing create/update paths and `drive-metadata.js`.
- **No pull first, so guard against overwriting a remote edit:** before updating,
  fetch that file's current `md5Checksum`. If it differs from the record's
  `driveChecksum` (someone else changed it), skip and leave it to the full sync, which
  handles conflicts. New records (no `driveFileId`) are created as usual.
- Also run pending deletions (see above) through this path.
- **Never alongside a full sync:** both take the same Web Lock
  (`navigator.locks.request('chordless-sync', …)`), which works across pages and the
  service worker. If a full sync holds it, the record push is skipped; the full sync
  will include it.
- Skipped silently when offline, not signed in, or sync isn't set up.

#### Why nothing new needs storing

A dropped push leaves the record "changed since last sync" (its content hash differs
from `syncedContentHash`), so the next full sync uploads it. The full sync stays the
backstop.

#### Tests

- Per-record push against FakeDrive: updates just that file; creates a new one; skips
  when Drive's checksum changed; respects the lock.
- Debounce coalescing (unit test).
- Playwright: an edit reaches Drive without pressing Sync (needs the service worker
  pointed at the fake, or a test hook).

### Later

- **Durable offline queue:** keep individual writes queued locally and replay them
  when back online. The service worker's existing operation queue
  (`AuthDB.queueOperation`, `processOperationQueue`, today only for invite/revoke and
  unused) could be generalised. Trigger on the `online` event (and on app start);
  the Background Sync API would be natural but isn't supported in Safari/iPadOS, so
  it can only be a progressive enhancement.
- **Full sync in the service worker / periodic sync:** the orchestrator already
  broadcasts progress via `postMessage` (`listenForSyncProgress`). Periodic
  Background Sync has the same platform limits.
- **Conflict resolution:** today Drive wins. At least surface conflicts to the user;
  ideally merge setlist field changes.
- **Restricting edits to a setlist's owner** (`ownerId`), and an **invite dialog** to
  share the organisation folder as read (musicians) or write (leaders). Shared users'
  devices can't find the folder yet: the app's `drive.file` scope only covers files
  it created for that user, so this needs the Google Picker or a wider scope. See
  SHARING.md and the worker's `/session/invite`.
- **Songs:** deletion and the "deletion wins over an unchanged copy" rule for songs.
- **Real Drive integration tests** (see Tests above).
