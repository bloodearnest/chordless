# Song variants

Status: a plan (nothing here is built yet, except what "Today" says). Decisions are the
user's, recorded 2026-10-13.

## Today

A song is a deterministic `id` (`ccli-<n>` or `title-<normalised title>`). Each chart under that
id is a record with its own `uuid`; one has `isDefault`, and `variantOf` names the record a copy
came from (docs/DATA_MODEL.md). A setlist entry points at one `songUuid`. The library shows
the default of each song. There is no UI for variants. They are made by import (`forceNew`), by
receiving a share (the newest chart becomes the default) and by "Add to my library" (the copy is
a variant, not the default). `overwriteSong` replaces a chart in place (an import of a song the
library has); sync sees the changed hash and uploads it.

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
3. **The song picker chooses a variant.** Choosing a song that has more than one variant opens a
   second step: the variants, each with its author, space, date and label, the default
   marked and first. A song with one variant stays one tap. The entry keeps `songUuid`, as now.
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

docs/DATA_MODEL.md says "Songs are immutable - any edit creates a new variant". That changes:
a fix is in place.

## Order of work

1. Data: origin fields and their Drive properties, the default rule (earliest import; share and
   copy never displace), the bundle's origin.
2. The picker's variant step, and "other arrangements".
3. The versions list, "make default", labels.
4. The chart editor: fix and arrangement.
