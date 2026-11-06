# ANNOTATIONS

Typed annotations on a chart: dynamics, stops, "repeat 4 times", "drop out here". ("Note" is
confusing in a musical context, so these are annotations.) Status: built in #97, reworked since.

## What an annotation is

An annotation belongs to **one song in one setlist**: it is for a specific arrangement on a given
day, so it is never kept for the song as a whole or shown in another setlist. It has a body, an
anchor (where on the song it sits), and one choice: who sees it.

- **Just me** (the default): kept on this device, in the setlist's local state.
- **Everyone**: kept in the setlist's entry for the song (`SetlistEntry.annotations`), so it syncs, is
  hashed and is exported with the setlist, and everyone who has the setlist sees it.

Anyone who can write the setlist can share one (`atLeast(role, 'writer') && !readOnly`); a reader, or
someone looking at a received share, can only keep their own. Private annotations are never blocked
by a role: a last-minute annotation must work for everyone. The display merges both, by id.
(`SetlistEntry.notes`, a string that already existed, is the older note of a song in a setlist.)

## Anchors

An annotation is attached to the song's *structure*, never to a pixel, so it lands in the right place on
any width, zoom or device.

- `song`: the whole song.
- `section`: a section title, by label and which occurrence of that label (`nth`), and the section's
  first line of lyrics (`sectionHead`).
- `text`: a spot in a lyric line: section, line index, character offset into the line's lyrics
  (chords stripped), about 12 characters of text either side, and a **snapshot** of the line: the whole
  line (`lineText`), the lines just above and below it (`prevLine`, `nextLine`), which of several
  identical lines it is (`occ`), and the section's first line. All are cut short and optional.

Anchors do not use chords, so transposing, Nashville numbers, a capo or hidden chords cannot move an
annotation. The snapshot holds a line of lyrics: it is kept only where the annotation is kept (the
user's browser, their own Drive, a share link), never by Chordless's own servers.

## Following edits to the chart

A chart is **fixed in place** (`overwriteSong`, `CHART_EDITOR.md`), and the fix reaches other devices
by sync, with no record of what it was before; and a song's setlists each have their own annotations,
some shared and some on other devices. So an annotation cannot be moved by hooking the edit. It finds
its place again from what it keeps and the chart as it is (`annotations/anchor.ts`):

1. The line most like the kept `lineText`, in any section: exact, else by how alike the words are
   (a reworded line, a word added or taken away, a line moved, split or joined). Ties go to the one
   whose neighbours match `prevLine`/`nextLine`, then which of the identical lines it was (`occ`),
   then the nearest to where it was. A section renamed or renumbered is found by its lines.
2. Within the line: the same place if the line is unchanged; else the text either side of the spot; else
   the word it was at; else the same word by number.
3. If its line is gone, its section (a guess); if that is gone too, it is **orphaned** and shown in the
   strip of annotations with no place, marked. Never dropped.

**Healing.** When it is found for sure somewhere other than where it is kept, or is kept without a
snapshot (annotations made before they were kept), its anchor is rebuilt from the chart as it is, so
the next edit starts from here and a run of small edits does not wear the match away. A guess is
never kept: undoing the edit finds the line again.
- The user's own are healed when the setlist is drawn (this device only, so nothing is sent).
- Those shared with everyone are in the setlist, so they are healed by someone who can write it, when
  they finish editing, and not by every device that sees the fix; the others find their place the same
  way from what is kept, without writing. A reader never writes.
- The setlist page draws the setlist again when it loads and when a sync changes the setlist; it does
  not yet watch the chart for a fix made while it is open.

## Layout

Annotations are laid out with the chords, not on top of them.

- A section annotation sits in the slot right of the section title; the row wraps rather than colliding
  with the show/hide controls.
- A line annotation is a row at the top of the chord-segment column at its anchor, above the chord, with
  no width of its own (it spills like a chord does). Units align at their bottoms, so only the visual
  line that holds an annotation grows taller, and it works when a line wraps.
- After layout, a small pass measures the annotations on each line and pushes them back inside the right
  edge and apart from each other (re-run on resize, font scale, hide mode and transposition). The
  floor is Safari 17.4 / Chrome 120, so there is no CSS anchor positioning.
- Hidden and collapsed sections hide their annotations. Annotations are shown in lyrics-only and chords-only modes.

Typed annotations use a bundled handwriting font. Private annotations are in a pencil colour, shared ones in a
warm ink with a bullet.

## Making annotations

Annotations are made and edited in **edit mode** only, with no separate mode. Long-press (about half a
second; mouse: long-press or right-click; keyboard: Enter or the context-menu key on a focused
target) on a section title, a word or a chord opens the annotation editor: text, who sees it
(Just me or Everyone), delete. Changing who sees it keeps the annotation's id. Outside edit mode annotations are shown,
not edited. Deleting shows a toast with Undo. An annotation for the whole song is made with "+ Annotation on the
whole song", shown with the annotations whose place is gone, above the sections. Preferences can hide the
the annotations shared with everyone, or the user's own (shown in edit mode whatever they say).

Where in a line a press lands is worked out from the lyrics as they are drawn, which with chords
hidden are tidied (hyphens, spaces); `snapOffset` moves it to the nearest start of a word or
segment of the chart's own lyrics, so the anchor is exact.

## Handwriting

Words are always typed. Handwriting (finger or pen) is for diagrams: a staff with a few musical notes to
record a melody line, an underline, a circle, an arrow.

**Ink is never shared.** It is always private to the musician who drew it, so Chordless never has
to serialise and re-render arbitrary vectors or bitmaps across devices and screen sizes. The types
and the stores enforce it: an `ink` body is accepted only by the private stores, and
`SetlistEntry.annotations`, share bundles and the export zip cannot carry one. Ink is not built
yet; it will reuse the same anchors, live in IndexedDB (strokes are larger than
localStorage should hold), and be drawn in a box sized in `em` relative to the anchor line, so it
scales with the font on that musician's own devices.

## Sync, sharing, export

- Shared annotations are part of the setlist file, so they sync, hash and go over live sync exactly as the
  rest of the setlist does. The Worker sees nothing new.
- A reader whose setlist is reset to the leader's is told "<song>: annotations changed" (`describeSetlistChange`).
- Share links carry the shared annotations (`ShareSong.annotations`, only when a song has some, so older shares
  keep their hash). A receiver keeps the well formed text annotations (`annotations/validate.ts`) and leaves out
  the rest. Private annotations and drawings never leave the device.
- The export zip carries shared annotations (they are in the setlist JSON); private annotations are not
  exported, like section visibility.
- A setlist is one file and a conflict is "Drive wins" (`SYNC_ARCHITECTURE.md`), so two writers
  editing annotations at once can lose one. Every annotation has an id and a `modified` stamp so the planned
  three-way merge can merge by annotation id.

## Not built yet

`SetlistEntry.notes`, the older plain-text note of a song in a setlist, is kept and synced but not
drawn or edited. A line of bars only (drawn as aligned measures) cannot be pressed for an annotation; an annotation
attached to one is drawn on the line as chords. Ink; exporting private annotations.

## Order of work

All built: 1. This doc. 2. Types and anchors. 3. Persistence and permissions. 4. Rendering. 5. The
collision pass. 6. The editor and long-press in edit mode, preferences. 7. Sync diff, share bundle,
help (Setlist Song > Edit mode: annotations).
