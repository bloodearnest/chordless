# Song variants

Status: mostly built. The origin fields on a variant, the import choices (compare, keep both, replace),
the versions list and merging are built (below); the chart editor is not. Decisions are the user's,
recorded 2026-10-13.

## Today

A song is a deterministic `id` (`ccli-<n>` or `title-<normalised title>`). Each chart under that
id is a record with its own `uuid`; one has `isDefault`, and `variantOf` names the record a copy
came from (docs/DATA_MODEL.md). A setlist entry points at one `songUuid`. The library shows
the default of each song. There is no UI for variants. They are made by import (`forceNew`), by
receiving a share (the newest chart becomes the default) and by "Add to my library" (the copy is
a variant, not the default). `overwriteSong` replaces a chart in place (an import of a song the
library has); sync sees the changed hash and uploads it.

**A setlist entry plays the version it names** (`versionForEntry`, `songOfEntry` in
`src/js/song-utils.ts`): the setlist page, a shared setlist's bundle, the key and tempo an update
writes into the entries (docs/RANGE.md, "Re-importing a whole library") and the library's "last played" all go by it. If the
version it names is not in the library (or is another song's now) it plays the song's default. Until
2026-11-05 the setlist page and sharing went by the song's id, so an entry that named a version
other than the default showed the default's chart. Last played is per version: a card that is one
version says when that version was played, and says "Not played in this version" when another
version has been; the one card that stands for a song when only the defaults are listed says when
any version was.

## Decisions

1. **Origin on every variant.** Each variant records the space (id and name) and the
   author that imported or created it. `importUser` becomes the author (a name or email); a new
   field holds the space. Both go to Drive in the file's `appProperties` next to
   `variantOf` and `isDefault`. A chart that arrives by share or copy keeps the origin of the
   one who made it: the share bundle carries the sharer's space name and the setlist's
   owner (decided: yes, the space's name may be in a share). Older songs have no origin:
   "unknown".
2. **The default is the space's.** It starts as the earliest import, and changes only
   when someone with write permission marks another variant as the default. "Write permission"
   is write access to the space's Drive folder, the only access control there is. The app
   now knows it: a user who can only read has `readOnly` (docs/SPACES.md, "Read-only: local edits
   are never blocked") and "make default" is not offered. A variant that arrives from a share
   or another space never becomes the default by arriving: today's rule (the newest
   chart wins) goes. Two people setting it at once: the later change wins. In the "Shared with
   me" database there is no space: the default is the earliest there too.
3. **Every variant is a card.** (Decided 2026-10-23, replacing a second "variant step" in the song
   picker.) The library list and the setlist's Add Song picker list each variant of a song as its own
   card, together and the default first, each with what it is called (a song with several variants
   shows "Original" too, to tell it from the others), and a search finds a variant by its name as well
   as its title, artist and words. Choosing a card opens, or adds to the setlist, that variant: the
   entry keeps its `songUuid`, as now. A song with one variant looks as it did.
4. **Versions list** on the song info dialog and in the library: the variants, "make default"
   (write access), rename the label, open one. Deleting a variant waits for the Drive-trash
   design (docs/SYNC_ARCHITECTURE.md): until then a locally deleted synced chart would come back
   at the next sync.
5. **Same hymn, several CCLI numbers.** Each CCLI number is its own song and stays so. When
   choosing, songs with the same normalised title and another id are shown as "other
   arrangements" in the variant step, separate songs and never merged. No change to the data. If
   unrelated songs with one title make this noisy, add an explicit link between song ids later.

## A key change is not a variant

Decided 2026-10-22. A variant is a different arrangement: other words, other sections, other chords.
The same chart in another key is the same song, and so are two charts that differ only in what is
about the song (title, copyright, tempo, the CCLI material). `chartFingerprint` in
`src/js/library-repair.ts` reduces a chart to its words and its chords as numbers from the key, and
two charts with the same fingerprint are one chart.

Copying songs between spaces dedupes by exact text (`contentHash`) only, so a library that holds the
same song twice (an import done twice, a copy of a chart in another key) keeps both. To clean one up
there is a repair, run from the dev page `/dev/library-repair.html` (or the console, `libraryRepair`),
not from the app: it merges each set of records with one fingerprint into the one the setlists use
most, moves the setlist entries to it (an entry with no key or tempo of its own is given the
removed song's, so it shows as it did), deletes the others (their Drive files go in the trash at the
next sync, docs/SYNC_ARCHITECTURE.md "Deleting songs"), and reports the songs that have genuinely
different arrangements, which it leaves. It also gives a song with no known source one: SongSelect
if its chart has the CCLI material, otherwise the person who wrote it. Run on the 278-record
library that prompted it, it leaves the 148 songs; and the 177-record copy of it in a Team, 148.

## Editing a chart

The user can open a song's ChordPro and edit it on the device, for two different reasons:

- **Fix** (a typo, a wrong chord): saved back to the same variant, in place (`overwriteSong`).
  Everyone's copy follows through sync. A setlist that uses the variant shows the fix.
- **Arrangement:** saved as a new variant (`variantOf` = the one edited, a label, the editor as
  author, the space as origin). It is not the default unless marked so.

The editor asks which when saving (default: fix, for the variant's own author; arrangement
otherwise). A song from another database (Shared with me, another space) is first
copied into the library, so editing it always makes a variant, never a change to the other
database. Offline-first: the edit is saved at once and syncs later. Two people fixing one chart
meet the usual Drive conflict rule (docs/SYNC_ARCHITECTURE.md).

docs/DATA_MODEL.md says "Songs are immutable - any edit creates a new variant". That changed: a fix is in place.

### First slice: fix a typo in place (a plan, nothing built, 2026-10-24)

Arrangements (a new variant) come later; this is **fix only**. Entry point and tests are below.

#### Starting point

- `overwriteSong(uuid, content, db)` in `src/js/song-utils.ts` already does the save: the ChordPro,
  hash and modified date, the parse cache, the song's metadata. Sync sees the changed hash and
  uploads it, so other devices follow.
- Check first: does `db.saveChordPro` / `saveSong` announce the change on the change bus
  (`data:change`, `src/js/data-changes.ts`, docs/STATE.md)? Auto-sync listens on it.
- The song info dialog (`src/components/song-info-dialog.ts`, opened by `showSongInfo` in
  `setlist-page.ts` and from the library) holds the Versions list: the home for an "Edit chart" button.

#### Plan

1. **`src/components/chart-editor.ts`**: a Lit element in an `app-modal` (fullscreen) with a native
   `<textarea>` of the raw ChordPro, monospace. Save and Cancel. No live preview yet. It fires a
   `chart-editor:save` event with the new text; the parent saves (as `setlist-info-dialog` does).
   Cancelling a changed edit asks first.
2. **`fixChart(uuid, content, db)`** in `song-utils.ts`, wrapping `overwriteSong`: refuse a chart
   that parses to nothing (an empty textarea must not wipe a song); do nothing if the hash is unchanged.
3. **Wiring.** An "Edit chart" button in the song info dialog, for the variant shown. Available live
   too (CLAUDE.md, "permissive in the moment"): the friction is the dialog and the cancel
   confirmation, not edit mode. A failed save is a `toast()` with "Try again", never `alert()`.
   Read-only spaces keep local edits (sync just does not write back). Hidden for songs from another
   database (Shared with me, another space): those need copying first, which is the arrangement path.
4. **Refresh.** The setlist page (`buildRuntimeSongs`) and the library list show the fix without a
   reload. Preferred: listen for `data:change` on the song/chart ids, as `setupChangedSetlists` does
   for setlists; it also shows a fix that arrives by sync. Fallback: the dialog fires an event and the
   page reloads that one song.
5. **Tests** (docs/TESTING.md). Node: `fixChart` changes text, metadata and hash; rejects empty input;
   keeps `uuid` and `variantOf`. Browser unit: the editor's save and cancel events and the
   confirmation. Playwright: edit a lyric in the dialog, save, see it on the song page and in the library.
6. **Verify** with `just format lint test`; commit in steps: save function, editor, wiring and
   refresh, docs.

#### Open questions

- Entry point: the song info dialog only (proposed), or also a pencil on the song page in edit mode?
- A plain textarea is proposed; anything fancier adds a dependency.

#### Later

- A live preview beside the text.
- Save as an arrangement (a new variant, label, author, origin).
- Editing a song from another space or a share (copy first).
- Chord and section helpers in the editor.

## Importing a chart the library already has (designed 2026-10-22; built 2026-10-23 except item 5)

Built: `compareCharts` and `chart-diff`, Keep both (`keepBoth`) and the fixed Replace (`replaceSong`) in
`song-utils.ts`, and the import page's choices with the suggestion below as the highlighted button (the
same chart again is not asked about). Each side of the comparison says who imported it, when, and its
source. New imports record the signed-in person's name as `importUser` ("Imported by"); songs from
before have it backfilled by the library repair (`planImporters`). Not built: item 5, the repair's preview.

**Today.** Importing a chart looks for an existing song by CCLI number, then by normalised title
(`findExistingSong`, used by `song-import.ts`). A hand-made chart has no CCLI number, so an official
SongSelect chart of the same song is found by its **title**, and the import lists it as "already in
library" with two choices per song: **Update** (replace the existing chart's text in place with the
new one; setlists keep pointing at it) and **Use existing** (keep the old, store nothing). Neither
is right for a hand-made alternate-chords chart, and Update only swaps the text: the song keeps its
title-based id, has no CCLI number, keeps its old source ("Simon Davy") and its old import date, so
an official chart ends up looking hand-made. A hand-made and an official chart of one song are also
two identities (`title ...` and `ccli ...`), so the library repair does not see them as the same song.

**Wanted.**

1. **Say what differs before asking.** `compareCharts(a, b)` (pure, next to `chartFingerprint`)
   gives a verdict, built on the same fingerprint as the repair so a change of key does not mark every
   line:
   - *identical*: the same text; nothing to ask, the existing one is used;
   - *same chart, other key*: only the key differs (G to A); the same song;
   - *same words, different chords*: the alternate-chords case;
   - *different words*: another version or arrangement.

   It also gives the two keys and the lines of the two charts aligned section by section, each marked
   only where its normalised form differs.
2. **A side-by-side view** of the two charts (`chart-diff`, stacked on a narrow screen), under a
   **Compare** disclosure that is open by default when the words or the chords differ. The differing
   chords or words are highlighted inside a marked line; the two keys are shown above the columns.
3. **A third choice, Keep both.** The chart being imported becomes the song's default (with its CCLI
   number and id, source SongSelect, its own import date) and the existing chart becomes a variant of
   it (source and import date unchanged, label "Alternate chords" unless the person gives one).
   Setlists that used the old chart keep using it.
4. **Replace is fixed** to take the incoming chart's CCLI number, id, source and import date as well
   as its text (every variant of the song gets the new id, and a setlist entry keeps its `songUuid`).
5. The repair's preview shows the same comparison for the groups it merges.

**Open question: what is pre-selected.** Proposed: *Keep both* when the words match and the chords
differ (nothing is lost, and the official chart is the obvious default), *Keep mine* when it is only
a change of key (the same song), nothing pre-selected when the words differ.

## Versions and merging (built 2026-10-23)

The song info dialog has a **Versions** list (`song-versions.ts`, logic in `src/js/song-versions.ts`):
each variant with who imported it, when, its source and key; **Make default**, **Rename** and
**Delete** (a second tap; setlists that used it use the default, keeping the key and tempo they
showed). A song's only version is deleted as the song ("Delete song": the confirmation says how many
setlists have it, and it is taken out of them); a team's admins are meant to be the only ones who may
delete songs (docs/SPACES.md, "Roles"), which the page checks and the Worker does not, on purpose (docs/SPACES.md, "Roles"). **Merge another song into this one** folds a song
into this one as a variant (`linkSong`): every variant of it takes this song's id, CCLI number and
title, and the one that was its default becomes a variant of this default. The library repair does
the same by itself for a song with no CCLI number whose title is exactly one CCLI song's
(`planLinks`; a title shared by several CCLI songs is left alone, decision 5). Each change marks
the songs changed for the next sync. A merge also shares the details of the two default charts (artist, copyright, tempo, time, as
directives in the chart text), unless unticked: each fills what the other lacks and changes none it
has; but SongSelect is the authority on them, so a chart from SongSelect is never changed, and the
other is given its details, replacing any that differ. The repair's links do it too. Not done: asking about such a song at import (the repair and
the merge cover it afterwards); a variant's origin space is not recorded (decision 1).

## Order of work

(Steps 2 and 3 below are built: the picker is the cards in decision 3, and the versions list is above.)

1. Data: origin fields and their Drive properties, the default rule (earliest import; share and
   copy never displace), the bundle's origin.
2. The picker's variant step, and "other arrangements".
3. The versions list, "make default", labels.
4. The chart editor: fix and arrangement.
