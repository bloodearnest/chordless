# Lead sheet range

Which keys can the band sing a song in? Each song can carry the **range of its lead sheet**: the lowest
and highest note. The key picker uses it to colour the keys, so a leader changing key (in edit mode
or live, a late change is when it matters most) sees at once where the lead sheet's notes go too high or too
low.

ChordPro has no notes. The range comes from a SongSelect lead sheet, or is typed in.

## The range

The lowest and highest note, in the chart itself, as a ChordPro directive:

    {key: G}
    {x_chordless_range: D4-E5}

ChordPro has no range directive. It reserves the `x_` prefix for an application's own, which other
programs ignore, and asks for the application's name after it. The notes are in the chart's own
`{key:}`, so the range needs no key of its own: a key's range is the written one moved by the
distance between the keys, so transposing a song moves its range with it, and nothing else needs
storing per key. Notes are names with an octave (middle C is C4), spelled the way the key spells
them (F#5 in G, Eb5 in Bb), and read as MIDI numbers (60 is middle C) for the check below.
Because it is in the chart, it travels with the file: Drive, an export, a share link, a backup, a
copy in another ChordPro program. It is per chart, so an arrangement (a variant) can have its own.

- **Written pitch.** The lead sheet is written for the higher voices, and men sing it an octave down.
  So every limit below is about the written note: the written low note is what a man reaches
  first, and the written high note is what a woman does.
- **Editable, always.** A range read from a lead sheet can be wrong (a harmony line, a cue
  note we took for sung), and most songs have no lead sheet: see "Setting a range by hand".
  Importing a song again follows the duplicate choices as it does for the rest of the chart, so a
  correction is not lost without being asked.
- **None is fine.** A song with no range shows no colours: the picker is as it is today.

## What counts as comfortable

`src/js/voice-range.ts`, `rangeStatus(range, semitones)`. A rule of thumb, set by ear, and meant
to be tuned (they are constants in one place now, and a preference later).

| | Green | Yellow (the edge) | Red |
| --- | --- | --- | --- |
| Highest note | C♯5 or lower | D5 to E5 | F5 and above |
| Lowest note | B3 or higher | G3 to A♯3 | F♯3 and below |

A key is as good as its worse end. Many songs start out red in their original key (a song written
for a man's voice, sung by a woman or a congregation, is often too high); the picker is for seeing
which keys it stops being red in.

## In the picker

Built: `key-selector` takes the song's `range` and the key it is written in (`rangeKey`), and every
key in its list is marked by `rangeStatus` (`describeRange` in `voice-range.ts` gives the tone, direction and
words). A song with no range, or no key to measure it from, shows the picker as it was.

- **Not by colour alone.** Each key has a round badge of its tone with an icon that says which way:
  a tick when it fits; a triangle up for the top at the edge (yellow), two stacked when too high
  (red); down for the bottom, the same; one up over one down when both ends are out. Every badge
  is drawn the same size (an SVG, not characters: side-by-side arrows would be wider than one),
  so they line up. The words ("too high", "in range") are the hover tip, and a screen reader has
  them in the key's label ("A +2, too high", "E -3, in range"). The icon is dark on the solid
  colour, which reads the same on the popup's navy and on the lighter row of the key in use
  (coloured text on that row fails the contrast check).
- **The notes, to say what the colour means.** Each key's row also says the lead sheet's lowest and
  highest note in that key ("E4–F#5", spelled as the key spells them), with the one that is out of
  range in bold: A is red because the top is F#5. The screen-reader label has the same text, as it
  must contain what is shown ("A +2, E4–F#5, too high"). The notes are in the full text colour: a
  muted one fails the contrast check on the lighter row of the key in use.
- **Only while choosing.** The badges are in the list of keys, where a key is chosen (the key in
  use is marked there too). The picker's button, and the key shown once chosen, are plain: the fit
  is for choosing, and then it gets out of the way.
- **The octave nearest the green.** A lead sheet's octave is often wrong (SongSelect prints some a
  whole octave out), so the range is kept as it was read, and moved by whole octaves where it is
  used (`octaveNearGreen`): each key's notes and colour are for the octave that sits nearest the
  green range, the chart's own key too, and not the one nearest the chart's key (which flipped at an
  arbitrary key). The song info judges the fit the same way and says when it is an octave off what
  is stored, so the badge never disagrees with the picker.
- **A hint, never a gate.** A red key can be chosen as any other can.
- **Where.** The library's song view, the setlist's song settings, and the key on a song's card in
  edit mode. Each key's distance shown is from the key in use, as it always was; the range is
  measured from the key the chart is written in, going the near way round.

## In the song info

The song's info dialog has a "Lead Sheet Range" item under its key: the lowest and highest note in the
chart's key ("D4–E5 in G"), how it fits voices as written (the badge and its words, as the picker
has them), and how wide it is: **"9 notes wide (14 semitones)"**. It is the song's, so it is the
same whatever key the library has the song in (a different key is not a different song: it takes
different chords); the fit in other keys is the key picker's to show.

Width is counted in the scale tones the range covers (D4 to E5 is nine, a 9th), by the notes' names
in the key, so it does not change with the key. It is what a leader asks (how many notes does this
ask of a singer?), where semitones, which are kept for being exact, are not how singers think, and
octaves are too coarse (nearly every song is an octave to an octave and a half). The notes are
written pitch: men sing the lead sheet an octave down.

**How long the song sits there.** When the song has a lead sheet (`docs/LEAD_SHEETS.md`), a line under the width says
how many beats (quarter notes) the song spends on its highest and its lowest note, over the whole song as played:
repeats and endings followed, a tie's notes added, cue notes left out ("Highest E5: 3½ beats; lowest D4: 1 beat").
A high note held for a long time tires a singer more than one touched once. This is worked out from the stored score
each time (`src/js/melody-analysis.ts`; the parse is cached by the score's hash), and is not written to the chart.
The song cards' key pickers (a setlist's edit mode) look the lead sheet up when the card is in edit mode, and not for a list as it is shown, so no score is parsed for a song whose picker is not on screen.
The range itself is the chart's `x_chordless_range` if it has one (the person's, or what an import wrote), else the
lead sheet's own; the dialog and the key picker both use it.

## Re-importing a whole library from SongSelect

To put every chart of a library in SongSelect's own key, and give each song its range
(above) from its lead sheet, without opening each song by hand. A library imported before
lead sheets were read, or in keys other than SongSelect's, can be brought up to date in one pass.

It is three steps: a script fetches the charts and lead sheets from SongSelect into a folder, the
import page takes the whole folder at once, and one choice updates every song that is there. It
opens no tabs and asks for nothing per song.

#### 1. Make the script

The script is `scripts/songselect-backfill.js` with the library's CCLI numbers after it. Export the
space (Account and Teams, the space, Export), then:

    node scripts/make-songselect-backfill.ts chordless-export-Church-2026-10-23.zip --out backfill.js

It says how many songs go in, which have no CCLI number (made by hand: they are left out) and how
old the export is: a song added since is not in it, so export again for those.

#### 2. Run it on SongSelect

Sign in to https://songselect.ccli.com in Chrome or Edge. Open the DevTools console (F12), paste the
whole of `backfill.js` (Chrome asks you to type `allow pasting` the first time) and press Enter.
It asks for a folder to save in: make one, and choose it.

For each song it asks SongSelect for the ChordPro (with no key asked for, so SongSelect gives the
song's own) and for the lead sheet in that key, and saves `<number>-<title>.cho` and
`<number>-lead-<key>.pdf` in the folder. It says what it is doing, and about how long it will take:
**twenty minutes or so for 140 songs**, as it goes slowly on purpose.

- **It does not trip SongSelect's limits.** One request at a time, with a pause before each of four
  to seven seconds (it varies); when SongSelect says to slow down (429, or a 5xx) it waits as long as
  it is told, or 30 seconds and then twice that, and tries again; and when five songs fail one after
  another it stops, and says to wait.
- **It can be stopped and started.** `stopSongSelectBackfill()` in the console stops it after the
  song it is on. A manifest in the folder (`backfill-manifest.json`) remembers what is done, so
  running the script again carries on, and tries again those that failed.
- **Signed out** (or no access) is noticed, and it stops at once rather than asking again.
- A song SongSelect has **no ChordPro for** is left out, and listed at the end. SongSelect answers
  such a song with a sentence ("no chordPro for this song") as if it were the chart; the script
  checks that what came is ChordPro (a directive like `{title: …}`, or a chord like `[G]`) and does
  not save the sentence. It is not counted as a failure (it is not SongSelect limiting the
  requests), and is not asked for again when the script is run again.
- A song with no lead sheet (SongSelect has none, or the account cannot get it) is still saved,
  with no range. A chart with no key in it cannot be asked for a lead sheet in its key.
- SongSelect counts a lead sheet fetched this way as a download (`activityType=downloaded`, as its
  own button sends), so about as many downloads as songs are recorded on the account.

#### 3. Import the folder

In Chordless, Import, "Import ChordPro Files": choose every file in the folder (the manifest in it,
`backfill-manifest.json`, is a JSON file, and the import page passes over any: "a JSON file, not a
ChordPro chart"). Each lead sheet is
paired with its ChordPro by CCLI number (below, "Getting a range from a lead sheet"), and the page reads them all.

**The same song is updated with no question.** A song the library has, whose new chart has the same
words and chords as the library's (whatever else differs: the copyright, the tempo, even the key),
is updated at once: there is nothing to decide. The page says "updated: the same song as in your
library", and says how far it has got when there are several ("Importing 37 of 141…"). More than
eight songs are folded behind a count of what came of them ("141 updated: the same song as in your
library") with "Show the 141 songs" to open the list, so the choices that follow (add them to a
setlist, or save to the library only) are on the first screen and not thirteen screens down.
When there is nothing to save (every song is the same as the library's) the page still has a way
on: "Go to the Library", beside adding them to a setlist or making one. What is
listed for you to decide is only what differs: other words or other chords (they may be
arrangements), which can be imported as a variant, replace the library's, or not be imported. When
several are listed, a bar "For all of them" makes one choice for all: **Update all N**, or **Do not
import any**; then "Import all with these choices".

The one exception is a library chart from SongSelect, with a chart that is not from SongSelect (it
has none of SongSelect's CCLI material): that is not replaced without asking, though it is the same
song.

**Where the songs are recorded as from.** A chart that carries SongSelect's CCLI material (its
`CCLI Song #` line and the terms-of-use footer: `hasCcliBumph`) is recorded as from SongSelect even
when it arrives as a file or as pasted text, as a download from SongSelect is. A chart without it
stays a file, or pasted text. A library song that was imported as a file before, and comes again as
the same chart, has its source set to SongSelect: a folder imported earlier can be imported again to
correct it, and nothing else changes ("Its source is now recorded as SongSelect"). The library
repair (`planSources`, docs/ACCOUNT.md) does the same for a whole library.

**What an update does** (`replaceSong`): the song keeps its identity and its place in every setlist;
its chart is replaced; and **the new chart's key and tempo become the song's own** (the key it is in
by default, and the original that the key picker marks and a reset goes back to). A setlist entry
with no key or tempo of its own shows the song's, so moving the song would move every such setlist,
old services included: **the entries that would change are given the key and tempo they showed**
(`keepShown`, as merging two songs already does), and only those are written. A setlist that has
none of the song, an entry with its own key, and a song whose key does not move are not touched.
So no setlist changes; new setlists have the song in its new key. No migration is needed first: it
is done for each song as it is updated.

**Variants are left alone.** The import finds the song's default variant by its CCLI number and
updates only that: another variant of the same song (an arrangement with its own label) is not
touched, and keeps hanging from it.

#### What it cannot know

- **SongSelect's own key** is what SongSelect gives when no key is asked for. It is the song's key as
  SongSelect has it, which should be the recording's; the lead sheet says "original key: X" in its
  heading, so a few can be checked by eye.
- **A song with no CCLI number** (made by hand) is not fetched.

## Getting a range from a lead sheet

The whole lead sheet is read once (`src/js/score-pdfjs.ts`, docs/LEAD_SHEETS.md), and the range
is its lowest and highest sung note (`readOfMelody` in `src/js/lead-sheet.ts`). Two signs say a note
is not sung, and either leaves it out (`sungNotes` in `src/js/score-transpose.ts`): it is drawn
small (an instrumental line: an intro, a turnaround), or its measure has no lyric under it (a
full-size instrumental line has none). It is the measure, not each note, that needs a lyric, as a
run of notes on one syllable has the one (and a note tied over from a sung one is sung). A sheet
with no lyrics at all is read by size alone. The page says how it was read: the bars and notes,
what was left out, the key signature, and the bar the lowest and the highest note are in.

The bookmarklet (`src/js/songselect-bookmarklet.ts`) fetches the lead sheet after the ChordPro,
from `/api/GetSongLeadPdf?songNumber=…&transposeKey=<the chart's key>&…`, so its notes are in the
chart's own `{key:}`, and sends both in its message. It takes the response as the PDF itself, or as
JSON with the PDF in base64, like the ChordPro (the endpoint's answer was not seen, only its URL).
The import page (`song-import.ts`) reads the range, writes it into the chart as the directive
(`src/js/chart-range.ts`), and drops the PDF: **a lead sheet is never kept** (Chordless stores no
copyrighted content: CLAUDE.md, "Spaces and copyright"). The PDF reader is a 1.6 MB chunk the app
already loads only when a PDF is shared to it, and is deferred rather than precached (docs/BUILD.md). A lead sheet that cannot be
fetched or read never stops the song being imported: it comes with no range, which can be typed in.
**Files chosen together.** The file picker (and files opened with or shared to Chordless) takes a
ChordPro and its lead sheet PDF together, as the bookmarklet sends them. Each PDF goes with the
ChordPro of the song it is the sheet of: the same CCLI number (printed at the foot of the sheet),
else the same title (the sheet's, or its filename's). It is then read as a bookmarklet's is, key
check and all. A PDF that goes with none of the chosen songs is not imported (the picker says
so), and a song has one lead sheet: another is left out. Shared PDFs that are no song's lead sheet
are still matched to the library as a leader's charts (docs/EMAIL_IMPORT.md).

**The tab the bookmarklet opens** shows a spinner with what it is doing ("Waiting for SongSelect…",
"Reading the song…", "Reading the lead sheet…", which takes a moment) and not the ways to import by
hand, which would only be in the way. A failure shows them, and so does "Import a file or paste
instead". A song already in the library is compared as any import is; a chart that only gains a
range from the lead sheet is suggested as "Update current song" (keeping the library's would lose
it), and one that is the same as the library's says so.

**Checking the import.** The import page says what it found: the range and its key, or why there is
none (no lead sheet came, it had no notes, it could not be read). Under it, "How the lead sheet was
read" gives the bars, the sung notes read and what was left out (small instrumental
notes, and notes with no lyric), the key
signature, and the bar the lowest and the highest notes are in (as the sheet numbers them), so
each can be found on the PDF and checked. The lead sheet's key signature is compared with the
chart's `{key:}` (a minor key by its relative major, and by pitch, so D flat is C sharp): a sheet in
another key is **not used**, as its notes would be out by the difference, and the page says so.

The download is recorded by SongSelect as a download (`activityType=downloaded`, as its own button
sends).

## Costs of keeping it in the chart

- Changing a range changes the chart, so it syncs as a chart change (a new checksum, the whole
  file) and meets the rules for chart conflicts (docs/SYNC_ARCHITECTURE.md), not the field by
  field sync of a song's Drive properties. A range changes rarely, so this is accepted.
- Reading every lead sheet again (a better reader, later) would rewrite every chart it finds a
  different range for.
- To find songs by range ("which fit in A?"), the app keeps the range read from the chart on the
  song's record when it is saved: derived, not synced, so the chart stays the one source.

## Setting a range by hand

The song info's "Lead Sheet Range" item has **Add a range** (when there is none) or **Edit**. Two
pickers, "Lowest note" and "Highest note", offer the notes from A2 to C6 (wider if the range is),
named as the chart's key names them; **Save**, **Cancel**, and **Remove** (when there is one). A
new range starts at D4 to D5. A lowest note above the highest is not saved, and says so. The notes
are in the chart's own key, as written: men sing the lead sheet an octave down.

The import page offers the same two pickers, under "Set the range yourself", for a single song that
has no range (no lead sheet came, or it could not be read), once the song is in the library as it is
to stay: **Save the range** writes it with `setSongRange`, and the page then says "set by you". It is
not offered for a list of songs, for a song waiting on a choice, or for one that is the library's
already.

- **Not behind edit mode.** It changes the song's chart, not the setlist, and it is reached from
  the library and the setlist alike, live too (docs: "permissive in the moment"). The friction is
  the dialog and the two taps.
- **The chart's text changes, and nothing else** (`setSongRange` in `song-utils.ts`): the chart, its
  hash and its date, for sync to see. Not the key or tempo saved on the song: `overwriteSong`
  takes those back from the chart, which would undo a key someone had chosen. A chart with no
  `{key:}` is given the song's, which the notes are then in; a song with no key at all cannot be
  given a range (there is nothing to name the notes by).
- **A failure is a toast** with "Try again", never lost silently.
- **The key picker follows at once**, in the library and in the setlist (the dialog says
  `song-info-dialog:range-changed` and each page gives the picker the new one), and the info shows
  the song as it was saved.
- It is the song's chart (the default variant the info shows), so every setlist that uses the song
  sees it. A setlist's own edits of a chart (`chordproEdits`) are not written anywhere yet.

## Not decided

- Limits as a preference (a group of altos, a younger group). Reading the whole lead sheet, not just
  its range, would let the picker rate keys per voice: see `docs/LEAD_SHEETS.md`.
