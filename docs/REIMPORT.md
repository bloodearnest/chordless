# Re-importing a library from SongSelect

To put every chart of a library in SongSelect's own key, and give each song its melody range
(docs/RANGE.md) from its lead sheet, without opening each song by hand. A library imported before
lead sheets were read, or in keys other than SongSelect's, can be brought up to date in one pass.

It is three steps: a script fetches the charts and lead sheets from SongSelect into a folder, the
import page takes the whole folder at once, and one choice updates every song that is there. It
opens no tabs and asks for nothing per song.

## 1. Make the script

The script is `scripts/songselect-backfill.js` with the library's CCLI numbers after it. Export the
space (Account and Teams, the space, Export), then:

    node scripts/make-songselect-backfill.ts chordless-export-Church-2026-10-23.zip --out backfill.js

It says how many songs go in, which have no CCLI number (made by hand: they are left out) and how
old the export is: a song added since is not in it, so export again for those.

## 2. Run it on SongSelect

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

## 3. Import the folder

In Chordless, Import, "Import ChordPro Files": choose every file in the folder (the manifest in it,
`backfill-manifest.json`, is a JSON file, and the import page passes over any: "a JSON file, not a
ChordPro chart"). Each lead sheet is
paired with its ChordPro by CCLI number (docs/RANGE.md), and the page reads them all.

**The same song is updated with no question.** A song the library has, whose new chart has the same
words and chords as the library's (whatever else differs: the copyright, the tempo, even the key),
is updated at once: there is nothing to decide. The page says "updated: the same song as in your
library", and says how far it has got when there are several ("Importing 37 of 141…"). More than
eight songs are folded behind a count of what came of them ("141 updated: the same song as in your
library") with "Show the 141 songs" to open the list, so the choices that follow (add them to a
setlist, or save to the library only) are on the first screen and not thirteen screens down. What is
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

## What it cannot know

- **SongSelect's own key** is what SongSelect gives when no key is asked for. It is the song's key as
  SongSelect has it, which should be the recording's; the lead sheet says "original key: X" in its
  heading, so a few can be checked by eye.
- **A song with no CCLI number** (made by hand) is not fetched.
