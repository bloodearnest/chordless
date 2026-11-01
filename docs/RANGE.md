# Melody range

Which keys can the band sing a song in? Each song can carry the **range of its melody**: the lowest
and highest note. The key picker uses it to colour the keys, so a leader changing key (in edit mode
or live, a late change is when it matters most) sees at once where the melody goes too high or too
low.

ChordPro has no melody. The range comes from a SongSelect lead sheet, or is typed in.

## The range

`{ low, high, key }`: the lowest and highest note as MIDI numbers (60 is middle C), and the key
those numbers are in. A key's range is the stored one moved by the distance between the keys, so
transposing a song moves its range with it, and nothing else needs storing per key.

- **Written pitch.** The melody is written for the higher voices, and men sing it an octave down.
  So every limit below is about the written note: the written low note is what a man reaches
  first, and the written high note is what a woman does.
- **Editable, always.** A range read from a lead sheet can be wrong (a harmony line, a cue
  note we took for sung), and most songs have no lead sheet. Both ends can be typed in, in the key
  the song is in at the time: that is then the stored key, so nothing is converted back. A range
  records where it came from (read from a lead sheet, or edited), so reading a lead sheet again
  never overwrites a correction.
- **None is fine.** A song with no range shows no colours: the picker is as it is today.

## What counts as comfortable

`src/js/voice-range.ts`, `rangeStatus(range, semitones)`. A rule of thumb, set by ear, and meant
to be tuned (they are constants in one place now, and a preference later).

| | Green | Yellow (the edge) | Red |
| --- | --- | --- | --- |
| Highest note | C♯5 or lower | D5 to F5 | F♯5 and above |
| Lowest note | B3 or higher | G3 to A♯3 | F♯3 and below |

A key is as good as its worse end. Many songs start out red in their original key (a song written
for a man's voice, sung by a woman or a congregation, is often too high); the picker is for seeing
which keys it stops being red in.

## In the picker

- **Not by colour alone.** Each key also has a mark and a word ("high", "low", "high and low"), for
  anyone who cannot tell the colours apart, and for a screen reader.
- **Always shown**, in live mode as in edit mode: nothing is withheld, and a red key can be chosen.
  It is a hint, never a gate.
- In the library and in a setlist (where a song's key is its own): the range is the song's, and the
  key shown is the setlist's.

## Getting a range from a lead sheet

`src/js/melody-range.ts`, `readMelodyRange(pdf)`: the notes of a SongSelect lead sheet are drawn
shapes, so it reads them from the page (staves, noteheads, the key signature), leaving out the
small noteheads of instrumental lines. See the header of that file for what it reads and does not.

The bookmarklet is to fetch the lead sheet with the ChordPro, in the same key, and send both to
the import page, which reads the range and then drops the PDF: **a lead sheet is never kept**
(Chordless stores no copyrighted content: CLAUDE.md, "Spaces and copyright"). The PDF reader is a
1.6 MB chunk the app already loads only when a PDF is shared to it, and is not precached. A lead
sheet that cannot be fetched or read must not stop the song being imported.

## Not decided

- Whether the range lives in the song's record and in Drive's metadata with its key and tempo, or
  in the chart as a ChordPro directive (`{x_range: D4-E5}`), which would travel with the file.
- Limits as a preference (a group of altos, a younger group), and showing a song's range in its
  settings in note names.
