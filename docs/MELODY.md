# The melody as music: lead sheet to MusicXML

**A plan, not built.** Today a lead sheet is read for one thing, the lowest and highest sung note
(`src/js/melody-range.ts`, `docs/RANGE.md`), and the PDF is then thrown away. This asks whether to
read the whole melody (pitches, lengths, rests, lyrics, chords, sections) into a music format, keep
that, and do more with it: transpose the notes, analyse them, show them, play them.

## Why

- **Better answers to "can we sing it in this key?"** The range is two numbers. What decides
  whether a key is singable is also how long the top notes are held, how much of the song sits near
  the top (the tessitura), how big the leaps are, and whether it is the chorus or a verse that
  climbs. A song whose top note is a passing F5 and one that holds it for four beats have the same
  range.
- **Per singer, not fixed limits.** With the notes kept, a leader can ask for the best key for a
  given voice, and the limits (`RANGE_LIMITS`) become a preference rather than a constant (the open
  "Not decided" item in `docs/RANGE.md`).
- **Re-reading without SongSelect.** A better reader (single accidentals, a harmony line, a new
  limit) can be run again over what was kept. The backfill (`docs/REIMPORT.md`) took 140 songs at
  one request every 5 s; it should not need doing twice.
- **Show it.** Musicians want to see the melody to check the vocal line or the instrumental one.
  Rendered from our own notes it can be shown in the key the setlist uses, which the downloaded PDF
  (one key) cannot.
- **Songs with no SongSelect lead sheet.** A MusicXML file from another source (an arranger, a
  public-domain hymn) could be imported the same way.

Keeping the PDF itself would give the "show it" item only, in one key, and the re-reading with the
original's full fidelity. Converting is the bigger step and the better one.

## What is in a lead sheet

Probed on two real ones (Holy Forever and Joy: 145 and 170 KB, a few pages each). They are engraved by
what looks like **Verovio** (its Leipzig music font is embedded, as SMuFL glyphs) and wrapped into a
PDF by IronPdf. The engraving is deterministic: the same notehead is the same path every time.

- 952 and 1265 filled shapes per song, but only about 240 and 230 **distinct** ones. One notehead
  shape accounts for 324 of the first song's 952: they are identical to the 0.05 pt. The treble clef,
  rests, flags, dots and the accidentals each have one shape too. What varies is geometry that is
  derived from the notes: beams, ties and slurs, and stems (about 180 shapes seen once).
- About 1,800 and 2,800 stroked lines: staff lines, stems, barlines, ledger lines.
- Text, as text: the title and credits, **section names** in boxes (INTRO, VERSE 1), **chord
  symbols** above the staff, **lyrics** under it (a text item per syllable, hyphens drawn as marks),
  **measure numbers**, and the tempo ("=72" with its note a music-font glyph).
- Everything the notes of a worship lead sheet need: rests of every length, dotted notes, beams of
  two and three levels, ties, repeats and endings, pickup bars, a time signature, key signature,
  cue-size notes for an instrumental line.

This is not optical music recognition of a scan, which is hard. It is reading vector drawing with a
small vocabulary of exact shapes, which is a lookup and some geometry.

## What the reader has, and what it lacks

Has (done and checked against real songs): the staves, the noteheads (solid, hollow, cue size),
their pitch from height and the key signature, the barlines, and the lyric under each measure.

Lacks, in the order of how much it matters:

| To read | How | Difficulty |
|---|---|---|
| Note lengths | head (solid or hollow) + stem + number of flags or beams + dots; a tie adds to it | medium: a rule per combination, beams are a geometry join |
| Rests | one shape per kind (whole and half rests are small rectangles on a line) | easy: a lookup |
| Time signature, tempo | digits and a glyph | easy |
| Accidentals on single notes | sharp, flat, natural shape just left of a head; holds to the barline | medium: the pitch spelling rules |
| Ties, and slurs | thin curved shapes between heads; same pitch is a tie | medium |
| Lyrics onto notes | text item nearest in x under each head; hyphen marks and the extender line give begin, middle and end of a word | medium |
| Chord symbols onto beats | text above the staff, nearest head in x | easy |
| Sections | the boxed text, onto the measure it starts | easy |
| Repeats, endings, D.S. and coda | dotted barlines, bracket plus number text | medium, and rarer |
| Tuplets | a bracket with a "3" | rare in these songs, but it breaks the check below |
| Two voices in a staff | stem direction | rare: leave out (or the top voice) |

### It checks itself

Every measure must add up to the time signature (a pickup measure and the last one may be short).
A measure that does not is a measure read wrong. So the reader can say, per measure and for the
song, how sure it is, and refuse (keep the range-only result) instead of keeping a wrong tune. That
is the main reason the work is feasible: the format of the answer is its own test.

## The format

Two layers, and not one.

1. **Inside the app: a small typed `Melody`**, not XML: measures, each with notes `{ midi, step,
   alter, octave, start, duration, tied, syllable, cue }`, plus key, time signature, tempo,
   sections, chord symbols. Analysis, transposing and the range derive from it, and it is a few KB
   as JSON (the PDF is 130 to 170 KB).
2. **MusicXML 4.0 (partwise) at the edges**, written from the `Melody` for export and for the
   renderer, and read into it for import. It is the interchange format every notation program and
   every web renderer speaks. It is verbose (30 to 80 KB for a song), so it is not what is kept.
   MEI is the other candidate (it is what Verovio uses); MusicXML is the one other programs open.
   MIDI is not enough: it has no spelling (F# or Gb), no lyrics, no sections.

Transposing is the notes moved by the interval and respelled for the new key, which
`transposeNote`/`noteName` already do for chords. Nothing else about the song changes.

## Where it is kept

- **Not in the chart.** A directive could hold the range (it does); the melody is kilobytes and
  would make the chart unreadable in the editor.
- **A file beside the chart**, per chart (a variant has its own), in the key the chart is in. It
  goes through the same storage and sync as the chart (`docs/STORAGE_API.md`): the user's browser
  and the user's, or their team space owner's, Drive. A new kind of file there is the largest part
  of the work after the reader.
- **The copyright rule holds** (`CLAUDE.md`): the notes and lyrics are the song's, so they live
  only in the user's browser and Drive, never on the Worker, never in a share link, never in
  telemetry. A share carries the setlist; the receiver imports their own.
- It is derived data: it can be thrown away and read again from a PDF or a MusicXML file, so it is
  safe to lose, and need not be in exports.

## Uses, once it exists

- The range (`x_chordless_range`) is **derived** from it, so the PDF reader's range and the new one
  cannot disagree, and a hand-set range stays as the override.
- **Key picker**: per key, the time-weighted position of the notes, the longest held high note,
  and where a section starts to climb; the colours stay (green, yellow, red) but say why.
- **A voice preference**: choose the voices the band has and the picker rates keys for them.
- **View**: a "Melody" view in the key in use, rendered by OpenSheetMusicDisplay or Verovio (each a
  dependency to add as a reviewed change; Verovio is WebAssembly, several MB, and engraves the
  same way SongSelect does, so a transposed sheet looks like the original). Lazy loaded, and never
  on the path of the lyrics screen.
- **Play it**: the melody as notes, for finding the starting pitch. Small, and only if wanted.
- **Export** to MusicXML for a band that wants to open it in their own software.

## Risks

- **SongSelect changes its renderer.** The shapes are the renderer's. Tests keep the failures
  visible (below), and the self-check turns a change into "could not read", not a wrong melody.
- **Test data.** The real PDFs are copyrighted and cannot be committed; today's tests use synthetic
  PDFs drawn by `tests/melody-pdf.ts`. If SongSelect's renderer is Verovio, public-domain tunes
  (a hymn as MusicXML) rendered by Verovio into PDFs would give fixtures that are realistic
  without being anyone's song. **To check first**, as it decides the test approach.
- **A wrong tune that looks right.** The measure sum is the guard; a note one step off in pitch
  passes it, so pitch has the existing checks (the key signature against the chart's key, the lyric
  rule) and the import page keeps showing what was found, with its place on the PDF.
- **Effort.** The reader is weeks, not days, and the storage is a design of its own. Neither is
  needed for the range, which works now.

## Open questions

1. **Does SongSelect offer the notes in another form?** The download is `GetSongLeadPdf` with
   `renderer=pipeline`. If the page or its API has a MusicXML or MIDI download, or another renderer
   value, none of the reading is needed. Cheap to look for: the Network tab on the lead sheet
   download, and the page's download menu on a song.
2. **Is it Verovio?** The Leipzig font says so; the PDF's text (the Producer is IronPdf) does not.
3. **How are repeats and endings drawn**, and what does a lead sheet with a coda look like? Needs a
   few more real samples than the two probed.
4. **Keep the PDF as well?** For the "show the original" case, at 150 KB a song in the user's own
   Drive. Not needed if the view renders from the notes.

## Steps

0. **Spike (a few days).** On four or five real lead sheets, read the lengths and rests and check
   every measure against the time signature; say how many measures pass. Answer questions 1 to 3.
   Stop here if it does not reach nearly every measure of nearly every song.
1. **The reader and the `Melody`**, behind `readMelodyRange`'s place: the range comes from it, the
   import page says what was read, and a song it cannot read keeps today's result. Tests from
   fixtures that are not copyrighted.
2. **MusicXML out and in**, and the storage and sync of the `Melody` beside the chart.
3. **Analysis in the key picker**, and the voice preference.
4. **The view** (and playing it), if the band wants it.

Each step is a pull request that leaves the app working; the first two change nothing a person
sees except a better range and a "how it was read" that can show the whole line.
