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

- **On each device:** IndexedDB, one `ChordlessDB` per space (setlists, songs,
  chord charts, per-setlist device state in `setlist_local`). The app works offline
  from this.
- **In Drive:** a `Chordless/` folder with one folder per space:

  ```
  Chordless/
    <Space name>/
      setlists/  <date>-<leader>-<type>[-<name>].json   one per setlist
      songs/     <title>[-<ccli>].txt                    one chord chart per song variant
    pads/
  ```

  Drive is the shared copy; each device syncs its local database with it.

### Layers

```
UI (main thread)          drive-sync-panel.js (Sync / Reset from Google Drive buttons)
        │
Orchestration             sync-orchestrator.ts: wraps the engine, reports progress
        │                 (to a callback)
Sync engine               drive-sync.ts: DriveSyncManager (folder, inventory, access, reset);
                          sync/pull.ts, sync/push.ts, sync/changes.ts: what it pulls and pushes
        │
File metadata             drive-metadata.ts: names, types and properties of the files
        │
Storage API               storage/types.ts: roots, and a space's files by `ref`, `props` and `rev`
        │                 (docs/STORAGE_API.md)
Backend                   storage/drive-storage.ts → drive-api.ts: REST calls via fetch
```

The engine does not know it is Drive: it takes a `StorageBackend` (`DriveSyncManager`'s `storage`
option, Google Drive unless a test says otherwise). A record keeps the file's `ref` and `rev`
as `fileRef` and `fileRev`.

Sync currently runs on the **main thread**, started by the user from the Storage
page. The orchestrator and engine have no DOM dependencies, so they could run in the
service worker too (planned below).

**Auth:** the service worker holds the session (a JWE blob from the worker). Pages
get access tokens by messaging it (`GET_BLOB`), refreshing via the worker's
`/session/refresh` when expired. `drive-api.js` lets the token source be replaced (`drive-client.ts` makes a Drive client for any source: the Worker makes one per team space)
(`setAccessTokenProvider`), which tests use and a service-worker sync will need.

### A full sync (`DriveSyncManager.sync()`)

1. **Refresh members:** list who the space folder is shared with
   (`permissions.list`) and cache it on the space record. Feeds the setlist
   Leader dropdown. Failure is logged, not fatal.
2. **Inventory:** list every file in the space folder (all pages,
   recursively). If listing fails, the "missing from Drive" checks below are skipped
   rather than treating everything as missing.
3. **Folder guard:** if local records point at Drive files that exist *outside* this
   space's folder, stop with `SpaceFolderMismatchError` instead of
   re-uploading them as duplicates.
4. **Pull** setlists then songs: download what's new or changed in Drive. A local setlist
   whose own Drive file is gone from the folder (e.g. duplicates were cleaned up, leaving
   another file for it), or that has no Drive file, **adopts** the live file for its id
   instead of being uploaded again: same content, it just points at the live file; edited
   here, it keeps its edits and the push updates the live file; unchanged here but newer in
   Drive, Drive's content is taken. Without this, every such setlist was uploaded as a copy.
5. **Removal of setlists deleted in Drive:** a setlist whose Drive file is still gone after
   the pull (which adopts live files where it can) and that hasn't been edited here since its
   last sync is removed locally: its content is what Drive had, so Drive's removal wins, as in
   a reset. One edited here is kept and uploaded again, so no edit is lost. This device's state
   for a removed setlist (`setlist_local`) is kept, and a file restored from the Drive trash
   comes back as it was. Without this, trashing or cleaning up files made devices upload
   their setlists again: three times in June–October 2026. Songs are not removed this way
   (setlists refer to them); a song whose file is gone is still uploaded again.
6. **Push** setlists then songs: upload what's new or changed locally. Creating a file is
   the step that can duplicate a setlist, so for setlists it holds back in three cases, each
   logged and retried next sync:
   - **The pull could not read every file** (a download failed): nothing new is created, because
     this device may not know a twin. Updates to known files go ahead.
   - **Drive has a live file for the record's id** that the pull did not adopt (its download
     failed): the record waits for a pull to adopt it.
   - **The same setlist under another id.** A never-uploaded record is not uploaded while
     another record for the same date, time, leader, type and name holds a live file (or is
     being uploaded again because its file is gone): it is that setlist stored twice, e.g. two
     devices each made their own record of it. The pull has already made a local record of every
     file in Drive, so this compares local records. Resetting the device from Drive replaces the
     held-back record with the one in Drive. Two never-uploaded records made on one device are
     the user's own doing and are both uploaded.

### Which folder, who may write

Finding a space's Drive folder (by name on the first sync, by `rootRef` after), the setlist
leaders list and read-only access are per-space matters: see [SPACES.md](SPACES.md).
In short: a read-only user pulls but does not push, and edits locally; a pull leaves a record they
changed (SPACES.md, "Read-only: local edits are never blocked"). Today the flag comes from
Drive's folder capabilities, later from the Worker role.

### Change detection (no clock comparisons)

Each synced record stores, from its last sync:

| Field | Meaning |
|---|---|
| `fileRef` | its file in the storage (a Drive file id) |
| `syncedContentHash` | hash of its content as last synced |
| `fileRev` | the storage's rev of the file as last synced (Drive's `md5Checksum`) |
| `fileModified`, `lastSyncedAt` | informational |

- **Changed locally:** the content hash differs from `syncedContentHash`. For
  setlists the hash ignores sync bookkeeping, key order and `modifiedDate` (so an
  undone edit isn't a change); for songs it's the chart text.
- **Changed in Drive:** Drive's listed `md5Checksum` differs from `fileRev`.
  Both come from Drive, so device clocks never matter.
- **Upload check:** after every upload or update, the `md5Checksum` Drive reports must be the
  MD5 of the bytes we sent (`utils/md5.ts`: WebCrypto has no MD5). If it is not, Drive stored
  something else: the record is kept as changed here, and the next push uploads it again over
  the same file. (Local change detection does not use MD5: setlists are compared by a hash of
  their content without `modifiedDate`, key order or sync fields, which the uploaded bytes
  include.)
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
| Synced before, **file now missing from Drive** | setlist: **removed here** if unedited since its last sync, **uploaded again** if edited; song: uploaded again |

Uploads of new files are batched (50 setlists / 25 songs at a time, up to 30
concurrent requests); one failed upload leaves just that record unsynced for next
time. Updates run 10 at a time. A failed update is logged and retried next sync;
the sync itself still reports success.

### File metadata (`drive-metadata.js`)

The one place that decides a synced file's name, MIME type and `appProperties`.
Every upload and update goes through it.

- **Setlist** `appProperties`: `spaceId`, `setlistId`, `appVersion` only.
  Everything else (date, leader, name...) lives in the JSON content.
- **Song** `appProperties`: identity (`type`, `songId`, `songUuid`), variant
  relationships (`variantOf`, `isDefault`, `variantLabel`) and import provenance:
  what pull needs that the chart text doesn't contain.
- Updates send name and `appProperties` with the content in one multipart request,
  so file names follow edits; retired properties from older versions are removed.

### Several people editing a setlist (design, not built)

Written 2026-10-16. Today a setlist is one JSON file, whoever edits it writes the whole file, and
a conflict (changed on this device and in Drive) is **Drive wins, the local edit silently
dropped**. That was fine with one editor. It is a data-loss path for the case that matters most,
a last-minute change on a band member's tablet that the next sync reverts. The principle behind
the design is in CLAUDE.md, "be permissive in the moment": nobody is stopped from changing what
they see; rights only decide **what reaches the shared setlist**.

**Shared base plus a device layer.** A setlist the device shows is the *base* (what syncs) with
the device's own changes applied over it:
- The *layer* keeps this device's changes as changes (a song's key, BPM or notes, a song added
  or removed, the order), not a copy of the setlist. It lives next to `setlist_local`, which
  already holds the device-only capo and section state, so a pull never touches it.
- A pull updates the base. What the person changed stays as they set it; anything they did not
  touch follows the leader. Nothing is dropped silently.
- **It must show, and no more than that.** An indication that something here differs from the
  official version, and an option to view what. One small indicator on the setlist (nothing on
  each row, nothing on a song page, nothing over the lyrics); opening it lists the differences
  (yours, the official value, and whether the official one has changed since) with a way to
  reset. A conflict is one more line in that list, not another look for the indicator. For
  someone who is not allowed to write the setlist the indicator stays, because their changes
  never become official.
- A writer's layer is **promoted into the base** when it syncs. A reader's, or a non-owner's
  (below), never is. So the same mechanism serves the read-only TODO (local key change for a
  reader), unsynced offline edits and conflicts.
- Merge by field and by song id. Per-song changes merge cleanly. The order is the hard part (two
  people reordering): start from "base order, plus your additions and removals" and decide the
  rest when it is built.

**Ownership. First step: block the sync of writes from non-owners.** A setlist has an owner, and
only the owner's edits to it are uploaded. Everyone else can still edit it on their device (the
layer above), and nothing of theirs is pushed.
- **Who may write:** both `createdBy` (who made it in Chordless) and `ownerId` (the leader), when
  they differ, have edit rights: the leader who did not create the setlist is not shut out.
  (`createdBy` is only a trace today: "nothing decides by it yet", data-types.ts.) Later an
  **space admin** role can edit any setlist of the space (roles come with the
  Worker team service, SPACES.md). The `editors` list below adds named people.
- It needs the layer first. Without it, a non-owner's edit would be dropped by the next pull, the
  same reason a reader's edits are blocked now. So until the layer exists a non-owner is treated
  as a reader of that setlist (no setlist edits).
- Later, in this order: an optional `editors` list the owner grants (whether everyone in the
  space may edit by default, or only the people above, is undecided); then **suggestions**, where a non-owner's layer is offered to the owner, who accepts or
  rejects each change; accepted changes are applied to the base.
- Drive's permissions are per folder, so an owner or editors rule inside the setlist file is
  only advice to a client that follows it: anyone who can write the folder can write the file.
  Real enforcement needs the Worker (below), so the client check comes first and is advisory.

**With immediate sync** (the changed record is pushed at once when online, the expected normal
case) conflicts get rare: the window shrinks from "since the last sync" to seconds, and edits can
travel as small changes ("song 3 key to D") that merge by field. They do not go away: a tablet
opened every few weeks on poor wifi is offline when it edits, and Drive has no compare-and-set
(to check), so two pushes a moment apart can overwrite each other.

**The Worker, when it serves space writes** (SPACES.md, "Why the Worker serves members"). Every member's Drive call goes through it, so for a space
it is the one place that can:
1. **Enforce roles and ownership.** It already enforces reader or writer; it can reject a write
   to a setlist by someone who is not its owner or an editor, so the rule stops being advice.
2. **Detect conflicts.** The client sends the checksum it last saw (it records `fileRev`
   already); if Drive's differs the Worker answers 409 and nothing is overwritten.
3. **Make that atomic.** Check-then-write is not atomic, so writes go through one Durable Object
   per space, which serialises them. A new Cloudflare piece (wrangler.toml has none).

The Worker detects and the client resolves: after a 409 the client fetches the current setlist,
merges it with its layer by a three-way merge (it keeps the last-synced copy as the base) and
tries again. The merge is a shared, tested TypeScript module, run on the device because an
offline device has to merge there anyway (it is where the "your change" marker lives); the Worker
could run the same module later. A solo user syncing straight to their own Drive (no Worker) has
no server check, but the same layer and merge stop their phone and tablet dropping each other's
edits.

Order of work: (1) never drop a losing local edit silently (a conflict copy is the cheap first
step, see the TODO); (2) the device layer and merge module; (3) block the sync of non-owners'
writes, on the client; (4) the Worker's roles and conflict check, with the team service; (5) editors,
then suggestions.

### Reset from Google Drive

Account and Teams page, only when sync is set up. Replaces the device's setlists, songs and
charts with Drive's copy. Unlike a normal sync, records whose Drive file is gone are
dropped, not re-uploaded. It refuses, changing nothing, if Drive can't be listed or
if any local record has changes not in Drive. Per-setlist device state is kept.

### Start over in Drive (the linked folder is gone)

A space's linked folder can stop being there to find: deleted, in the Drive trash, or never
visible to the Google account or app now signed in. Drive answers 404 for all of them, and under
the `drive.file` scope a different Google app (a new OAuth client, as in
[CLOUD_MIGRATION.md](CLOUD_MIGRATION.md)) cannot see what the first one made. `resolveDriveFolder`
throws `DriveFolderGoneError` (reason `missing` or `trashed`), changing nothing.

It is told early, not at the first sync: `refreshSpaceAccess` (app start and sign-in) asks
Drive about the linked folder and shows a toast with "Open Drive sync", and the sync panel shows the
same message with **Start over in Drive**. The space record keeps `driveClientId`, the Google
app that linked the folder, so the message can say it was an earlier version of the app.

Start over (`DriveSyncManager.startOver`, via `SyncOrchestrator.startOverInDrive`) asks Drive nothing
and changes nothing in it: it clears every setlist's and song's Drive markers and a setlist's share
link (`ChordlessDB.clearFileLinks`), then the folder link, then the orchestrator syncs. Content stays
on the device and is uploaded as new files to a folder found or made by name. The markers must go
first: a setlist with a `fileRef` that is not in the folder, and no changes, is read as deleted in
Drive and removed here. An old folder that can still be seen is left alone, for the user to delete.

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
- `tests/drive-sync.test.ts`: the real `DriveSyncManager` for two simulated devices
  sharing one fake Drive: push/pull, conflicts, clock skew, failures part-way,
  paging, spaces and renames, reset, metadata, members.
- `tests/drive-metadata.test.ts`, `tests/fake-drive.test.ts`.
- Not yet: integration tests against real Drive, using a separate Google test account
  with its refresh token in `.dev.vars`. First things to confirm there: uploads
  return `md5Checksum`, and whether metadata-only updates change `modifiedTime`.
- `src/dev/drive-audit.html`: read-only audit of the setlist files in Drive, with a
  confirmed move-to-trash cleanup for duplicates.

---

## Part 2: Planned work

### Deleting songs

**Built 2026-10-22** (for the library cleanup in docs/ACCOUNT.md; setlists below are still to do).
`ChordlessDB.deleteSong(uuid)` removes the song and its chart (unless another song uses it). A song that
has a file in Drive is noted in a `pending_deletions` store (database version 9, `PendingDeletion`).
At the next sync, before anything is pulled, `trashPendingDeletions()` puts each such file in the
Drive trash (restorable) and stops noting it; one that cannot be trashed (a user who can only read,
no network) stays noted, and the pull does not bring its file back meanwhile
(`SyncSession.pendingDeletedRefs`). On another device, after the pull, `removeSongsDeletedInDrive()`
deletes a song whose file is gone from Drive when it has no other live file there
(`liveSongUuids`) and has no change that Drive lacks; a song changed there goes back to Drive. This
also makes deleting a song's file in the Drive web page stick, where a sync used to upload it again.
A deletion not yet in the trash counts as an unsynced change, so "Reset from Drive" says so first.
A change to a song other than its chart (its source, say) is sent by setting `metadataChangedAt`
on the record.
A change another device made to those properties (which variant is the default, a variant's name, who
imported it, its song id: `sync/song-metadata.ts`) does not change the file's checksum, so a pull used
to miss it. Each song now keeps what they were when last synced (`syncedMetadata`, written by a push and
by a download), and a pull takes, field by field, what Drive changed since then and this device did
not. A field changed on both is left: the change here is sent, and wins. A song with no such record
(synced before it was kept) has only its empty fields filled from Drive. Who may delete songs in a Team (admin and up) is not yet checked by the Worker.

### Deleting setlists

**Built: setlists that are not in Drive.** The setlist info dialog's edit view (the pencil)
has a **Delete setlist** button when the setlist has no `fileRef`, i.e. it has never been
synced (or sync is not set up). It asks first (`#delete-setlist-modal`), then
`ChordlessDB.deleteUnsyncedSetlist()` removes the setlist and this device's `setlist_local`
state, and the page goes home. The database refuses a setlist with a `fileRef`, so the rule
does not depend on the button. For a setlist that is in Drive the edit view says why it cannot
be deleted. Because the rule is the local `fileRef`, a setlist another device has already
uploaded, but this device has not yet synced, can be deleted here and will come back at the
next sync (nothing in Drive is touched). The rest of this section is the design for setlists
that are in Drive.

Status of the rest: **designed, not built.** Goal: remove a setlist (e.g. added in error),
restricted to setlists you own, with the deletion reaching Drive and other devices.

**Why it needs sync changes:** a deletion made here is undone by the next sync, because a
setlist in Drive but missing locally is downloaded (`pullSetlists`). (A setlist removed in
Drive is already removed from devices that haven't edited it; see step 5 of a full sync.)

#### Deleting (UI)

- A **Delete setlist** button in the setlist info dialog's edit view (the pencil),
  so it's behind an explicit edit step, per the app's edit-mode rule for destructive
  actions. Shown only when the setlist is deletable.
- Confirmation via an `app-modal` of `type="confirm"` and `ask()`: "Delete setlist?
  It's moved to the Google Drive trash on the next sync." Confirm label "Delete".
- The dialog fires e.g. `setlist-delete` with `{ setlistId }`; the page
  (`setlist-page.js`, next to `saveSetlistDetails`) deletes it and goes home.

#### Who can delete

Decided 2026-10-22 (replacing the owner-only rule this section had, which guarded against
mistakes and not abuse, since anyone could make themselves the leader first):

- **Team space: a writer may delete a setlist they lead** (`ownerId` is their email), **an admin or
  the owner any setlist.** A writer cannot delete one someone else leads; the button is shown but
  says why. Deleting songs is admin and up. The Worker checks it on the server from the file's
  `ownerId` property and collection (docs/SPACES.md, "Roles"), so the rule does not depend on the
  page.
- **Personal space:** the person using it, anything (implicitly an admin; the export is the backup).
- **A confirmation always**, in every case.
- Not signed in, or a space with no Drive: nothing in Drive to trash, so the existing local rule
  applies (a setlist that was never synced is simply removed).
- `Setlist.createdBy` (kept, recorded at creation) no longer decides anything here.
- **Friction, not prohibition.** It stays behind the edit step (the pencil). The confirmation
  names the effect and is danger-styled: "Deletes this setlist for everyone in *<space>*. It goes
  to the Google Drive trash and can be restored from there." After it, a toast offers **Undo**
  for fifteen seconds (CLAUDE.md, toasts), which restores the file from the trash.
- A move into a team space (the wizard in SPACES.md) uses this to remove the source's setlists
  that are in Drive, after a confirmation that says how many.

#### Local effect

- The setlist record is removed from the local database at once, so lists, song
  history and search don't need to know about deleted setlists.
- If it had been synced, record a **pending deletion** `{ setlistId, fileRef,
  deletedAt }` in a new object store (e.g. `pending_deletions`, keyPath `setlistId`):
  a `ChordlessDB` version bump (the database is at version 7; this is 8).
- If it was never synced, it's simply gone. Its `setlist_local` entry can go too.

#### Sync

New full sync order: members → inventory + folder guard → **pending deletions** →
pull → push.

1. **Pending deletions run before the pull**, so the setlist isn't downloaded again:
   move each Drive file to the **trash** (`PATCH files/{id}` `{ trashed: true }`).
   On success, 404 or already trashed, remove the pending entry; otherwise keep it
   and retry next sync. Also processed by the immediate background sync (below).
2. **Remote deletion on other devices** (a behaviour change). In `pushSetlists`, for a
   local setlist whose `fileRef` isn't in the inventory:
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
- `DriveSyncManager` already runs without the DOM (`ChordlessDB` by space id
  outside a window). The space's folder link and members come from the
  spaces database, available in the service worker.

#### Trigger: one explicit call

- App code that saves a *user's* change calls `syncSoon({ type, id, spaceId })`
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
  `fileRev` (someone else changed it), skip and leave it to the full sync, which
  handles conflicts. New records (no `fileRef`) are created as usual.
- Also run pending deletions (see above) through this path.
- **Never alongside a full sync:** both take the same Web Lock
  (`navigator.locks.request('chordless-sync', …)`), which works across pages and the
  service worker. If a full sync holds it, the record push is skipped; the full sync
  will include it.
- Skipped silently when offline, not signed in, or sync isn't set up.

#### Pulling while the app is open (designed 2026-10-19, not built)

Immediate push is only half of it: the leader's late song reaches Drive at once, but a follower
only sees it if their device pulls. Once pushes are immediate, the Storage-page sync will rarely
be pressed, so pulls must come on their own. The pull is a **timer in the open page** (or the
service worker while a page is open), not a browser background task: Periodic Background Sync is
Chromium-only, for installed apps, with an interval the browser picks (hours), and absent on iPad.
It can be an optional extra for a closed, installed app.

| State | Pull |
|---|---|
| App open | about every 60 s |
| A setlist is **live** | about every 15 s, and at once when the tab becomes visible or the device comes back online |
| Tab hidden | stopped (live mode holds a wake lock, so it carries on) |
| A WebRTC session is up (later) | the leader's changes are pushed to followers; the poll stays as the fallback, back at 60 s |

The intervals are named constants, not preferences.

- **Cheap:** a live setlist polls its own file (`files.get` with `md5Checksum,modifiedTime`) and
  pulls only if it differs. The general poll can use Drive's `changes.list` from a stored page
  token (one request returns every file changed since, charts included) instead of listing the
  folders. Checked on a real My Drive under `drive.file` (2026-10-19, with the shared-drive probe page, since deleted):
  it works, and a change shows in the feed after about 5 s, so a tick can be that far behind (fine
  at 60 s; the live 15 s tick checks the one file directly instead). Not yet checked on a shared
  drive or through the Worker's team service. Via the Worker's team service (docs/SPACES.md) the same
  call is a Worker route.
- **A live tick is for one setlist, not a sync.** One `files.get` of the live setlist's file for its
  `md5Checksum`, compared with the record's `fileRev`; only if it differs, `pullSetlistNow(id)`
  (the pull-side twin of `pushSetlistNow`: the same conflict rule as the full pull, nothing else is
  listed or touched). The setlist may now use a song this device has never had, so that pull also
  fetches the charts the setlist needs and the device lacks, found by their `songUuid` property
  (`files.list` with `appProperties has { key='songUuid' and value='…' }`), as there is no Drive
  file id for them yet. A chart already in the setlist that the leader fixed does not change the
  setlist's file: the 60 s general poll picks that up.
- **Same lock and guards as the push:** the Web Lock `chordless-sync`, skipped when offline or
  signed out; never alongside a full sync.
- **A pull that changes the open setlist applies in place:** the page follows its setlist record.
  It stays on the current song by song id, says what changed with the same summary as the reader's
  toast (`sync/setlist-diff.ts`), and a reader whose changes were replaced can Undo. A leader's
  late song must never be held back, in or out of live mode (CLAUDE.md, "permissive in the
  moment"). WebRTC pushes feed the same step.

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
- **Full sync in the service worker / periodic sync:** the orchestrator would have to
  broadcast its progress to the pages with `postMessage` (today it calls a callback).
  Periodic Background Sync has the same platform limits.
- **Conflict resolution:** today Drive wins. At least surface conflicts to the user;
  ideally merge setlist field changes. Designed above, "Several people editing a setlist".
- **Restricting edits to a setlist's owner** (`createdBy` and `ownerId` both write; admins later): designed above,
  first by blocking the sync of non-owners' writes.
- **Inviting people to a team space:** shared users can't see the folder under
  `drive.file`; the design (the Worker acts with the owner's access) is in SPACES.md.
- **Songs:** deletion and the "deletion wins over an unchanged copy" rule for songs.
- **Real Drive integration tests** (see Tests above).
