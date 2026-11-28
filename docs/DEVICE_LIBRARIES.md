# One database per library on the device

**Status (2026-11-28): design, for approval. Nothing is built.**

The device keeps one IndexedDB database per **space**: the Personal space, and one for each team. Since the move to
Chordless (docs/CENTRAL_STORAGE.md), a church has **one** library that all its teams share, but each team's database
syncs that library on its own (`/api/teams/<team>/library/songs`, `library-song-sync.ts`). A church with two teams is
two copies of its library on the device: downloaded twice, synced twice, listed twice in the library, and an edit in
one reaches the other only by way of the server.

This changes the device to keep what the server keeps: **one database per library**, with each setlist marked with
the team it belongs to. A team is no longer a database, only a label on setlists (and a name, and who is in it).
"Space" then names nothing in the code; **Personal Space** stays as what the person's own library is called on screen.

## Now and after

```
Now                                              After
───                                              ─────
spaces DB      Space records (one per space)     chordless DB   libraries, teams (what the device knows)
<space id> DB  Personal: songs + setlists        personal DB    personal library: songs + setlists
<team A id> DB library copy 1 + A's setlists     church-<id> DB the church's library, once, + every team's
<team B id> DB library copy 2 + B's setlists                    setlists, each with its teamId
shared DBs     received shares (unchanged)       shared DBs     unchanged
```

A database's name says what it is (`personal`, `church-<church id>`) rather than being an opaque space id. Being new
databases, they start at version 1, with none of the old databases' upgrade steps.

## The stores of a library database

| Store | Key | What | Change from a space's database |
|---|---|---|---|
| `songs`, `chordpro`, `scores`, `song_index`, `pad_sets` | as now | the library | none, except Drive fields go |
| `setlists` | `id` | setlists | **`teamId`** (a church's; absent in the personal library), with an index on it |
| `setlist_local` | `setlistId` | this device's state of a setlist | none |
| `people` | `id` | who leads setlists: the church's members, and historical names | one list for the church, not one per team |
| `outbox` | `id` | edits waiting to be sent | was `space_outbox`; a setlist's change says its team |
| `sync_state` | `id` | where each sync stands | was `space_data`; one row per stream: `library`, `team:<id>`, `personal-setlists` |

Dropped: `pending_deletions` (Drive's bin) and the Drive fields of records (`fileRef`, `fileModified`, `fileRev`,
`lastSyncedAt`, `syncedContentHash`).

The device's own record of what it holds, the `chordless` database (replacing the `spaces` database):

- `libraries`: `{ id: 'personal' | 'church-<id>', kind, churchId?, libraryId?, name, role? }`. `libraryId` is the
  server's, absent for a Personal Space that has never been signed in (it is made at its first sync).
- `teams`: `{ id, churchId, name, archivedAt? }`, as the church lists them.

The Worker's API is not changed by this: the device syncs each team's setlists with `/api/teams/<team>/setlists` and
the library once, into the one database.

## What changes for the rest of the app

- **The current space goes; the default stays.** The home page and the library already show everything, so nothing is
  "switched to". The default is the person's choice of where new things go (a new setlist, an import, an added song): the
  Personal Space, or one team of a church (its library, for songs). It is kept as `{ library, team? }`, in place of a
  space id, and a library or team that has gone falls back to the Personal Space. A song belongs to its library, a
  setlist to its library and team.
- `/setlist/<id>` finds the setlist in whichever library database has it (there are a few).
- Every team of a church syncs, not only the ones followed (today an unfollowed team is not synced by itself at all).
  Following goes, as agreed for the home page, which gets a team filter in the UI rework.
- Changes are announced with `libraryId` (and `teamId` for a setlist) in place of `spaceId`.
- Overlays are keyed by setlist and song id, so they need no change.

## Moving each device

On first start after the update, once for each library, on the device alone:

1. Make the new database. For a church: from each of its teams' databases copy the setlists (with `teamId`),
   `setlist_local`, the waiting edits and the people; and the library once. A song in more than one team's database
   with the same uuid is the same song: take the one with a waiting edit, or the newer if both have one (and record
   it). The people are combined by id; a historical name in one team's database is kept.
2. Check it: every setlist, song, waiting edit and local state of the old databases is in the new one.
3. Only then record that the library has moved, and use it. The old databases are left as they are until a later
   version deletes them, so nothing can be lost by a move that fails or is cut off: it starts again from the beginning.

The Personal space's database is copied to `personal` in the same way. Received shares are not touched.

## Before it: Drive goes from the sync

Moving a database that Drive still syncs would mean carrying the Drive engine across. All teams are on Chordless now,
so first (one PR, before this one):

- A Personal space still on Drive moves to Chordless by itself when its person is signed in (the move of 5e, without
  waiting for another device to go first). Signed-out personal use stays local, as it is.
- The Drive sync, the Drive team service paths of the client, and the Drive records' fields go. "Delete Google
  Drive files" stays until the clean-up.

## Order

1. Drive out of the sync (above).
2. The new databases and the move, behind the database API the app uses now (`ChordlessDB`), so the pages change little.
3. The app on libraries and teams: the current space and following go, the default names a library and team; `spaceId` becomes `libraryId` or
   `teamId`; the code's "space" names go.
4. The D1 schema: `space_id` becomes `team_id`, and the unused `space_*` tables are dropped (a diagram first).
5. A later version deletes the old databases.

## Open

- A device signed in to two different accounts, one after the other, has one `personal` database, as it has one Personal
  space now. Unchanged.
