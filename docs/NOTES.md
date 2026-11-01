# NOTES

Typed notes on a chart: dynamics, stops, "repeat 4 times", "drop out here". Status: designed
2026-11-01, built in steps (see the end).

## What a note is

A note has a body, an anchor (where on the song it sits), and two independent choices.

- **Reach**: *Just me* (the default) or *Share with team*. Shared notes travel with the setlist.
  Anyone who can write the setlist can share one (`atLeast(role, 'writer') && !readOnly`); a reader,
  or someone looking at a received share, can only keep private notes. Private notes are never
  blocked by a role: a last-minute note must work for everyone.
- **Scope**: *This setlist* (the default) or *Always* (this song, in every setlist that has it).
  Shared + Always (a permanent note every team member sees on the song) needs a new synced
  collection and is not built yet; the editor disables "Share with team" for "Always".

| scope \ reach | Just me | Share with team |
|---|---|---|
| This setlist | `local-state` notes map (device) | `SetlistEntry.annotations` (synced with the setlist) |
| Always | IndexedDB `song_notes`, keyed by `songId` (device) | not built (needs a synced collection) |

The display merges every source for a song, by note id. `SetlistEntry.notes` (a string that already
existed) is the song-level line, shown with the song's header.

## Anchors

A note is attached to the song's *structure*, never to a pixel, so it lands in the right place on
any width, zoom or device.

- `song`: the whole song.
- `section`: a section title, by label and which occurrence of that label (`nth`).
- `text`: a spot in a lyric line: section, line index, character offset into the line's lyrics
  (chords stripped), and about 12 characters of text either side.

Anchors do not use chords, so transposing, Nashville numbers, a capo or hidden chords cannot move a
note. Songs are immutable (an edit is a new variant), so anchors do not use the variant's uuid
either. Re-finding a note on a changed chart: exact section and line, with the text around it
checked; else search that text in the section; else the section; else the note is **orphaned**
and shown in the song-level strip with a marker. A note is never silently lost.

## Layout

Notes are laid out with the chords, not on top of them.

- A section note sits in the slot right of the section title; the row wraps rather than colliding
  with the show/hide controls.
- A line note is a row at the top of the chord-segment column at its anchor, above the chord, with
  no width of its own (it spills like a chord does). Units align at their bottoms, so only the visual
  line that holds a note grows taller, and it works when a line wraps.
- After layout, a small pass measures the notes on each line and pushes them back inside the right
  edge and apart from each other (re-run on resize, font scale, hide mode and transposition). The
  floor is Safari 17.4 / Chrome 120, so there is no CSS anchor positioning.
- Hidden and collapsed sections hide their notes. Notes are shown in lyrics-only and chords-only modes.

Typed notes use a bundled handwriting font. Private notes are in a pencil colour, shared ones in a
warm ink with a small people glyph.

## Making notes

Notes are made and edited in **edit mode** only, with no separate mode. Long-press (about half a
second; mouse: long-press or right-click; keyboard: Enter or the context-menu key on a focused
target) on a section title, a word or a chord opens the note editor: text, a scope control, a
reach control, delete. Moving a note between kinds keeps its id. Outside edit mode notes are shown,
not edited. Deleting shows a toast with Undo.

## Handwriting

Words are always typed. Handwriting (finger or pen) is for diagrams: a staff with a few notes to
record a melody line, an underline, a circle, an arrow.

**Ink is never shared.** It is always private to the musician who drew it, so Chordless never has
to serialise and re-render arbitrary vectors or bitmaps across devices and screen sizes. The types
and the stores enforce it: an `ink` body is accepted only by the private stores, and
`SetlistEntry.annotations`, share bundles and the export zip cannot carry one. Ink is not built
yet; it will reuse the same anchors and scope choice, live in IndexedDB (strokes are larger than
localStorage should hold), and be drawn in a box sized in `em` relative to the anchor line, so it
scales with the font on that musician's own devices.

## Sync, sharing, export

- Shared notes are part of the setlist file, so they sync, hash and go over live sync exactly as the
  rest of the setlist does. The Worker sees nothing new.
- A reader whose setlist is reset to the leader's is told notes changed (`describeSetlistChange`).
- Share links carry the shared notes (`ShareSong.annotations`); private notes never leave the device.
- The export zip carries shared notes (they are in the setlist JSON); private notes are not
  exported, like section visibility.
- A setlist is one file and a conflict is "Drive wins" (`SYNC_ARCHITECTURE.md`), so two writers
  editing notes at once can lose one. Every note has an id and a `modified` stamp so the planned
  three-way merge can merge by note id.

## Not built yet

Ink; notes beside the chords in the same band to save height; shared + Always notes; exporting
private notes.

## Order of work

1. This doc. 2. Types and anchors. 3. Persistence and permissions. 4. Rendering. 5. The collision
pass. 6. The editor and long-press in edit mode, preferences. 7. Sync diff, share bundle, help.
