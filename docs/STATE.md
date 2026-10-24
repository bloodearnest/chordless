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
  (`recordSync`), so a page cannot drop a link and a sync cannot undo an edit.
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
already does this for a pulled setlist, `applyPulledSetlist`), whatever the origin.

## The steps

Each is shippable, and tested on its own. Earlier steps change nothing the user sees except where
a view used to be stale.

1. **The bus.** `DataChangeEvent`, sent by `ChordlessDB` from every committed write; the origin
   replaces `quiet`. Replaces `LocalChangeEvent`, `SetlistsPulledEvent` and the sync's
   `pulledSetlistIds`.
2. **`watchData`** on the home list, the library and the add-song modal.
3. **Mutations.** `updateSetlist`, `updateSong`, `recordSync`; the setlist page's eight save sites,
   the other callers and the sync's push use them; saving a copy of a record is for import and
   tests only (a lint rule says so).
4. **The setlist page** reads through the stored setlist and applies external changes of any origin
   (this tab's other views, another tab, a sync).
5. **Device-local state** (capo, sections) on the bus.

A test for each step, and a random-history test of the whole: interleaved page edits, syncs and
writes from another tab, then "what each view shows is what is stored".
