# State: what is kept where, and how a change reaches everything that shows it

Written 2026-10-24, after the sync work found the same defect five times over: a copy of a record,
held somewhere for a while, was saved back over a newer one (or never heard that a newer one
existed). This is the rule that stops that, and the plan for moving the code to it.

## Where state lives

1. **The space's IndexedDB** (`ChordlessDB`, one database per space): setlists, songs, charts. This
   is the authority for what the user sees. Sync's own bookkeeping (`fileRef`, `fileRev`,
   `syncedContentHash`, `lastSyncedAt`, …) is kept on the same records.
2. **This device's own state** (localStorage; `setlist/local-state.ts`, `song-user-prefs.ts`): capo,
   which sections are shown, preferences. Never synced.
3. **A view's own state**: where it is (current song, scroll, edit mode). Thrown away with the view.

## The rule

> Stored state (1, 2) is the only authority. A view renders from it and from its own state (3). It
> never keeps a copy of a stored record that it later writes back.

Three things follow:

- **A write is a change to what is stored, not a save of a copy.** An edit reads the record, changes
  it and writes it in one IndexedDB transaction (`updateSetlist(id, draft => …)`), so it cannot
  undo a change made since the view loaded. Sync's own markers are written by sync alone
  (`saveSetlistsSent`), so a page cannot drop a link and a sync cannot undo an edit.
- **Every committed write says so, once, from the database.** Whoever made it (a page, an import, a
  sync, another tab), the same event is sent, saying what kind of record, which ones, and where the
  change came from. No writer announces for itself, and none can stay silent.
- **A view that shows stored state listens, and reads again.** Not "the sync tells the page": the
  database tells whoever shows the data.

## The change bus (`src/js/data-changes.ts`)

```ts
interface DataChange {
  spaceId: string
  kind: 'setlist' | 'song' | 'chart'      // device-local state joins it later
  ids: string[] | null                     // null: everything of that kind (a reset)
  origin: 'local' | 'sync'                 // local: made here by the user, so it may need sending
  remote: boolean                          // came from another tab of the app
}
```

- Sent as a `DataChangeEvent` on `window`, and on a `BroadcastChannel` to the other tabs, which
  send it on their own `window` with `remote: true`.
- `ChordlessDB` is opened with an `origin` (`'local'` by default; a sync opens it as `'sync'`).
  The origin is a fact about who is writing; nothing is silenced by it. What listens decides:
  auto-sync nudges on `origin === 'local' && !remote` (its own tab's edits: another tab's own
  auto-sync sends its edits), a view reads again on anything that is not its own write.
- A view's own writes need no special case: they are `origin: 'local'`, not `remote`, and a view
  that has just written compares the stored record with what it shows (the content hash), and does
  nothing if it is the same.

## Listening: `watchData`

A Lit `ReactiveController` that runs a loader and runs it again when a change of a kind the page
shows arrives for its space. The home list, the library and the add-song modal use it, so a page
is one declaration of "what I show" and not a load plus a hand-wired refresh.

The setlist page keeps its parsed songs (they are costly to build), but not the record they came
from: it reads the setlist again on a change and applies the difference to what it shows (it
already does this for a changed setlist, `applyChangedSetlist`), whatever the origin.

## The steps

Each is shippable, and tested on its own. Earlier steps change nothing the user sees except where
a view used to be stale.

1. **The bus.** `DataChangeEvent`, sent by `ChordlessDB` from every committed write; the origin
   replaces `quiet`. Replaces `LocalChangeEvent`, `SetlistsPulledEvent` and the sync's
   `pulledSetlistIds`.
2. **`watchData`** on the home list, the library and the add-song modal.
3. **Mutations (built).** `db.updateSetlist(id, change)` and `db.updateSong(uuid, change)` read,
   change and write in one transaction (`change` returns `NO_CHANGE` to leave the record). The setlist
   page's edits (`editSetlist`: details, add, remove, move, key, tempo, leaving edit mode), the
   key and tempo of `SetlistSong` and `LibrarySong`, sharing, import into a setlist and the one-off
   leader claim use them; the page takes the stored result as its copy, and an edit that names a
   song at a place checks it is still that song there. Sync's own writer of the link and markers is
   `saveSetlistsSent` / `saveSongsSent` (they write only those fields, on the record as stored). A
   lint rule (`lint/no-whole-record-save.grit`) bans `saveSetlist` / `saveSong` in the components,
   views, models, the setlist page, `people.ts` and `share-manager.ts`; a new record says so with a
   `biome-ignore`. Left as they are: the library maintenance in `song-versions.ts`,
   `library-repair.ts` and `song-utils.ts`, which read a record and write it straight back (no
   network or user between), and import, samples, transfer and the sync's pull, which write records
   that came from elsewhere. `saveSetlist` / `saveSong` also keep a stored link when a copy with
   none is saved from a page's handle, as a net under what is not converted.
4. **The setlist page (built, in effect).** Every edit it makes is a mutation of the stored setlist
   and its copy is replaced by what was stored, so the copy is only for showing and is never written
   back; it follows a write of a sync or another tab (`applyChangedSetlist`, which compares content
   hashes, keeps the song being viewed and says what changed). Not done: the copy is still a field
   (`currentSetlist`), read by the header, menu and dialogs, and the page does not follow a write
   made in the same tab by something else (the key and tempo `SetlistSong` saves are the page's own
   by sharing its entry objects, so following every local write would show them as external edits).
5. **Device-local state (accepted, not on the bus).** Capo and the sections shown are in
   localStorage, written whole by the page that owns them, for this person on this device and never
   synced. The one other writer is a second tab of the same setlist, and last write wins on a capo
   is harmless, so there is no event for it. What does matter is that it is keyed by a song's place
   in the setlist: a change made by someone else (a pull, another tab) renumbers it with the song
   (`afterSetlistChange`, as the page's own move and remove do).

## How it is held

`tests/db-state-random.test.ts` runs seeded histories of a page's edits, a sync recording a send, a
pull and a page saving an old copy, against a model: each writer keeps its part (content, or the
link to the file), whatever the order. Taking out the link-keeping or the markers-only writer fails
it. The sync's own random histories (`tests/drive-sync-random.test.ts`) run the whole engine.

