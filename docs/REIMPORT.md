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
- A song with no lead sheet (SongSelect has none, or the account cannot get it) is still saved,
  with no range. A chart with no key in it cannot be asked for a lead sheet in its key.
- SongSelect counts a lead sheet fetched this way as a download (`activityType=downloaded`, as its
  own button sends), so about as many downloads as songs are recorded on the account.

## 3. Import the folder

In Chordless, Import, "Import ChordPro Files": choose every file in the folder. Each lead sheet is
paired with its ChordPro by CCLI number (docs/RANGE.md), and the page lists the songs the library
already has. Then, in the bar "For all of them":

- **Update the N that are the same song**: the same words and chords as the library's, whatever else
  differs, the key included. Those with other words or chords are left for you to decide one by one
  (they may be arrangements).
- **Update all N**: every one, including those that differ.
- **Do not import any**.

and "Import all with these choices". It says how far it has got ("Importing 37 of 141…").

**What "Update current song" does** (`replaceSong`): the song keeps its identity and its place in
every setlist; its chart is replaced; its original key and tempo come from the new chart (the key
picker marks the original, and reset goes back to it); and **the key and tempo the library has the
song in are kept**. A setlist entry with no key of its own follows the song's, so moving that to the
new chart's would change the key of every such setlist, old services included.

**Variants are left alone.** The import finds the song's default variant by its CCLI number and
updates only that: another variant of the same song (an arrangement with its own label) is not
touched, and keeps hanging from it.

## What it cannot know

- **SongSelect's own key** is what SongSelect gives when no key is asked for. It is the song's key as
  SongSelect has it, which should be the recording's; the lead sheet says "original key: X" in its
  heading, so a few can be checked by eye.
- **A song with no CCLI number** (made by hand) is not fetched.
