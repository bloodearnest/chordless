# The melody as music: lead sheet to MusicXML

**A plan, with a spike built** (see "Spike results"). Today a lead sheet is read for one thing, the lowest and highest sung note
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
- **Transposing it offline, on the fly, is the main reason to keep the notes.** SongSelect
  transposes on its server (`GetSongLeadPreview` takes a `transposeKey`; the PDF is downloaded in
  one key), so a key change means a new download and the network. Held as notes, it is the same
  move the chords make, with no request, and it is one download per song instead of one per key.
- **Songs with no SongSelect lead sheet.** A MusicXML file from another source (an arranger, a
  public-domain hymn) could be imported the same way.

Keeping the PDF itself would give the "show it" item only, in one key, and the re-reading with the
original's full fidelity. Converting is the bigger step and the better one.

## What is in a lead sheet

Probed on two real ones (Holy Forever and Joy: 145 and 170 KB, a few pages each). They are engraved by
**Verovio** (its Leipzig music font is embedded, as SMuFL glyphs) and wrapped into a
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

Checked again on the Holy Forever download in the Bb key (3 pages, A4) against its
`GetSongLeadPreview` response, with the PDF read through `mutool` and a small content-stream script:

- **The notes are paths, not text.** The music font's glyphs appear as text in the PDF for only four
  code points in the whole song (one of them 40 times; what they are was not looked up); every
  notehead is the same filled path at a different `cm` translation. The staff lines are stroked two-point paths (5 per staff,
  about 4.6 pt apart at this scale), so a pitch is a notehead's height against its staff, the clef
  and the key signature.
- **The counts agree three ways.** The commonest filled shape is 118, 141 and 103 times on the three
  pages: 362 noteheads. The timemap names 362 distinct note ids. The MIDI has 299 note-ons (pitches
  F3 to Eb5, one track). The 63 missing are probably the second halves of ties, which a MIDI
  merges; not yet checked note by note.
- **Chords lose their flats in the text layer.** `pdftotext` reads `Eb2` as `E2` and `Bb/D` as
  `B/D`: the flat is not in the font's text mapping. The chords must be read from their glyph shapes,
  or taken from the chart's own ChordPro (`[Eb2]`, `[Bb/D]`), which has them whole. The chart is
  the safer source, and the PDF's chord row is then a check on the alignment.
- **Corpus.** A local export holds 137 lead sheet PDFs beside 141 ChordPro files (IronPdf
  throughout, 1 to 6 pages), and 134 embed the music font. The 3 that do not are worth looking at
  first; they have not been opened. The export is copyrighted and carries the church's licence
  number: it stays out of git, and is a local corpus for the spike, not a fixture.

## A better source than the PDF: the page's own SVG

Looking at the lead sheet viewer on SongSelect (the song's Lead tab, which is not the download):

- The sheet is **inline SVG in the page, written by Verovio**: its `definition-scale` wrapper and its
  element classes (`system`, `measure`, `staff`, `layer`, `note`, `notehead`, `stem`, `flag`,
  `beam`, `dots`, `accid`, `rest`, `tie`, `clef`, `keySig`, `meterSig`, `tempo`, `reh`, `harm`,
  `verse`, `syl`, `barLine`, `mNum`). Each note, measure and rest has an `id`; the ids look
  generated by an XSLT (`d20738e74`), which suggests the server goes MusicXML to MEI to Verovio. That
  answers the open question about the renderer.
- Every symbol is a **reference to a named music-font glyph**: a solid notehead is `#E0A4`, a rest
  is `#E4E6`, a time signature digit `#E084` (SMuFL code points), placed with a `translate`. The
  length of a note, the kind of a rest, and the accidentals are read off by name, not recognised
  from a shape. The beams are a group that holds their notes; a tie is its own element.
  The syllables are `syl` elements inside `verse`, and the chords are `harm`; sections are `reh`.
- The page has **"Play midi"**, and the notes reach it as data. `GetSongLeadPreview` (arguments
  `songNumber`, `transposeKey`, `octave`, `noteSize`, `orientation`, `paperSize`, `renderer`)
  returns `payload` with: `svgs` (one base64 SVG per page, Verovio), `midi` (a standard MIDI file in
  base64, with the lyric syllables as text events), `timemap` (per event: `on`/`off` lists of
  note ids, `restsOn`/`restsOff`, `measureOn`, `tstamp` ms, `qstamp` quarter notes, `tempo`),
  `defaultBpm`, `defaultKey`, `numPages`. Checked on Holy Forever (a 1.1 MB response): the MIDI holds 299 notes with pitch
  and time, and every one of the timemap's 362 note ids is an element id in the SVG, so a MIDI
  pitch can be tied to its spelled notehead, lyric and bar. The playback samples are one piano
  `.ogg` per note from `cdn.ccli.com`.

If the response is, or holds, the SVG, **the reader is a DOM walk, not a PDF reader**: the same
checks apply (measure sums), but the hard column of the table below, note lengths and rests, becomes
a lookup of glyph names, and beams, ties, lyrics and chords are already grouped. If it also holds a
MIDI, the pitches, lengths and start times are given outright, and the SVG adds what MIDI does not
have: the spelling, the lyrics, the sections, which notes are cue size. The PDF reader stays as the
fallback for a song whose preview cannot be had, and for a PDF that was downloaded by hand.

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

`transposeMelody` (`src/js/melody-transpose.ts`) does it. The notes go through `octaveNearGreen`, the same
rule as the key picker: a key is a pitch class, so of the shift and the octave either side of it the one
that sits least outside the green range wins, and a sheet and the picker never show different octaves. The
chords take the plain nearest interval (they have no octave) through `transposeChord`. Notes are spelled
with `noteName`, so a sharp key gets sharps and a flat key flats; the unusual keys (F# major's E#) are spelled
as the chord transposer spells them. The range is of the sung notes: cue notes are not counted.

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

## The terms

What CCLI's agreements say about keeping and transposing a lead sheet. This is a reading of the
text, not legal advice. It is of the CCLI Master Terms of Agreement, US
(`store.ccli.com/download/CCLI_terms_of_agreement_us`, linked from `us.ccli.com/terms`) and UK
(`.../CCLI_terms_of_agreement_en`, linked from `uk.ccli.com/terms`), read on 2026-11-05 and 06. It
holds the Church Copyright License, which SongSelect's terms (§6.10) are subject to, and the
SongSelect Terms of Use, updated 2026-10-30. **The UK agreement is the US one with British spelling:**
compared clause by clause, the only differences are that the UK text lacks the definition of
"Territory" (§2.16 in the US text, still used in the UK one), has no US phone number, and adds a
paragraph that third-party licences sold through CCLI (the CLA and PRS/PPL ones, below) are on
those parties' own terms. Section numbers below are the same in both, and so are §3, §10.5, §12
and the SongSelect TOU. Both still say Oregon law and courts. The ccli.com website terms of use (the
same for the UK and US sites, Washington law) say nothing about scripts, scraping or automated
access. Two UK licences sit beside it and do not change the above: the CLA Church Licence (copying
from books, journals and periodicals; it does not mention music, hymns or lyrics) and the PRS/PPL
TheMusicLicence (playing and performing music at premises, with the right to copy reserved,
clause 1.2). The second is who covers performance in the UK, so playing audio in a service is
a PRS/PPL question and not a CCLI one, which the practice-only rule below stays clear of.
`songselect.ccli.com`'s own terms are the SongSelect TOU in the Master Terms.

- **Keeping a faithful copy for the church's own use is what the Church Copyright License lists.**
  §3.1.4 allows copying songs "into and from computerized storage and retrieval software", and the
  SongSelect Service is "online access to and download of Digital Fixations", a Lead Sheet being one.
  Reading the downloaded sheet into notes and storing it in the user's Drive is a copy of that
  sheet in another encoding, as the ChordPro is for the chord sheet.
- **Transposing is a copy in another key, not an arrangement.** SongSelect itself offers the key
  (the bookmarklet already passes the one picked on the page; `GetSongLeadPreview` takes
  `transposeKey`). The TOU lists "modify" among what is not allowed (§6.3), but a subscriber's key
  change is the Service's own function, and it is deterministic: nothing is added.
- **The notes stay read-only apart from the key.** Editing the melody would be an arrangement, and
  §3.1.2 allows those only "to the extent no published version is available" and only if the rights
  in the arrangement stay with the owner. A published lead sheet is what we read, so that clause
  does not cover it. The same goes for **notation made up from the MIDI alone** (no notation
  source), which is a new engraving of the melody and not a copy: do not use the MIDI as the source
  of the notes, only as a check on them and as the pitch for playing.
- **The notice travels with it (§10.5, and TOU §6.9, "will not remove or obscure any notice or
  legend").** On reproducing a song the church is to include the title, writers and copyright
  notice, "Used by Permission. CCLI License #…". It is not limited to projection, and a copy in
  computerized storage is a Copy (§2.8). The lead sheet's own page header and footer carry all of it
  (title, writers, `CCLI Song #`, the copyright, "For use solely with the SongSelect® Terms of Use",
  and the church's `CCLI License #`), and the chart keeps the same as `{ccli}`, `{ccli_license}`,
  `{copyright}` and `{footer}`. A `Melody` view or export must show the notice from those, in every
  key. The song info already shows them; they should be at the foot of the melody too.
- **Only the licensed church.** §3.1.7 allows copies for people in the congregation, §3.2.2 no
  distribution outside services and activities, §12 no sublicensing, and the TOU (§6.3, §6.6, §6.7)
  keeps the Service to the church's staff and volunteers. So a team space is for one church's
  team (asking for a CCLI licence when a team is made is an attestation, which is as far as the app
  can go), a team that spans churches is not, and the melody is in no share link (already so, above).
  §10.4 asks for all copies to be destroyed if the licence lapses; the app cannot, and the help can
  say so.
- **Playing it is for practice and rehearsal, never in a service.** §3.2.3 leaves performing out of
  the licence, and CCLI sells a separate Rehearsal License for sharing recordings with the worship
  team to learn from. A MIDI is not a Master Recording, so that is not the same thing, but the
  intent is the same, and the help should say "practice, not for use in a service".
- **Downloads are what is counted.** A song costs one download either way; reading it once and
  transposing here is fewer than one per key. The two ways of getting the notes differ here: the
  PDF download is counted and checked against the subscription's tier like any other. The preview
  call may not be, and may be shown to a tier that has no lead sheets (the TOU's §6.4 speaks of
  subscriptions that "grant the right to print Lead Sheet, Chord Sheet and/or Hymn Sheet"). Until
  that is known, the preview is for what the person could download, and is not stored or sent
  anywhere: it is a check on the PDF's reading, or an equivalent source, not a way round the count.
- **Not decided here:** whether a preview call is counted; whether a missing tier is shown the
  preview (an account on a chord-sheet-only tier would tell). Neither agreement says anything about
  scripts calling SongSelect's own endpoints, for or against. CCLI can be asked in writing, and a
  yes would settle all of it.

## Uses, once it exists

- The range (`x_chordless_range`) is **derived** from it, so the PDF reader's range and the new one
  cannot disagree, and a hand-set range stays as the override.
- **Key picker**: per key, the time-weighted position of the notes, the longest held high note,
  and where a section starts to climb; the colours stay (green, yellow, red) but say why.
- **A voice preference**: choose the voices the band has and the picker rates keys for them.
- **View**: a "Melody" view in the key in use, rendered by OpenSheetMusicDisplay or Verovio (each a
  dependency to add as a reviewed change; Verovio is WebAssembly, several MB, and engraves the
  same way SongSelect does, so a transposed sheet looks like the original). Lazy loaded, and never
  on the path of the lyrics screen. Whichever it is, the chord symbols should be written into the
  MusicXML as `<harmony>` from our own transposer, so Nashville numbers and spelling are the app's
  and not the renderer's; whether OpenSheetMusicDisplay transposes `<harmony>` correctly (Eb to Bb)
  is not known, and is the first thing to try. The notice (above) goes under it.
- **Play it**: the melody as notes, for finding the starting pitch and for practice. Small, and
  only if wanted.
- **Export** to MusicXML for a band that wants to open it in their own software.

## Risks

- **SongSelect changes its renderer.** The shapes are the renderer's. Tests keep the failures
  visible (below), and the self-check turns a change into "could not read", not a wrong melody.
- **Test data.** The real sheets are copyrighted and cannot be committed; today's tests use
  synthetic PDFs drawn by `tests/melody-pdf.ts`. The renderer is Verovio, so public-domain tunes
  (a hymn as MusicXML) rendered by Verovio, as SVG or as PDF, would give fixtures made the way the
  real ones are, without being anyone's song. Verovio would be a dev dependency (a reviewed change).
  The real ones, a local export of PDFs and charts, are a corpus for the spike and for scoring the
  reader, kept out of git (they carry the church's licence number as well as the songs).
- **A copy without its notice.** A reader or view that keeps the notes and drops the header and
  footer would break §10.5 (see "The terms"). The `Melody` keeps the notice text, and a test fails
  if a rendered sheet lacks it.
- **A wrong tune that looks right.** The measure sum is the guard; a note one step off in pitch
  passes it, so pitch has the existing checks (the key signature against the chart's key, the lyric
  rule) and the import page keeps showing what was found, with its place on the PDF.
- **Effort.** The reader is weeks, not days, and the storage is a design of its own. Neither is
  needed for the range, which works now.

## Spike results

Step 0 was done on 2026-11-06 (branch `claude/melody-spike`): `src/js/melody-read.ts` (the shared reader of Verovio's tree),
`melody-pdf.ts` and `melody-pdfjs.ts` (the PDF reader), `melody-musicxml.ts` (the writer), `melody.ts` (the `Melody` type),
`scripts/melody-xml.ts` (the preview SVG, the oracle: nothing in `src/` uses it), `scripts/melody-spike.ts`,
`scripts/melody-pdf-spike.ts` and `scripts/melody-mutool.ts` (the scoring), `tests/melody.node.test.ts`.
Tested on the Holy Forever preview (`preview.json`) and on all 137 PDFs of the local corpus, none of which is in git.
**The answer to "stop here if it does not reach nearly every measure of nearly every song" is that it does.**

**From the preview's SVG (Holy Forever, 3 pages): all of it.**

- 362 notes and 82 rests read; 61 of 62 measures add up to the time signature, and the 62nd is the
  3-beat pickup. The reader is a walk of Verovio's tree and is about 450 lines; a note's length is its head
  glyph, its flag or beams, and its dots, and a rest's is its glyph.
- Against the time map: all 362 note ids are found and all 362 have the same length.
- Against the MIDI: all 299 note-ons match one of our notes at the same time and pitch. The other 63 notes of
  the 362 are exactly the 63 tie continuations, so the guess above (the MIDI merges ties) is right, and the
  tie reader finds every one. A tie that runs off the end of a system is drawn only on the first system, so the
  reader carries it to the first head of the next.
- Lyrics: all 187 words of verse 1, rebuilt from the syllables and their hyphen marks, are in the chart's text.
  A syllable is followed by a drawn bar (`<rect>`): short is a hyphen, long is the extender of a held syllable.
- Chords: the flat in a chord symbol is a private use character of the music font (U+EA64), which is why the
  PDF's text loses it. No sharp appeared in this song, so U+EA65 for it is a guess.
- **The cue notes are in the MIDI** (the intro and the harmony line above a few bars). They are in the same
  layer as the sung notes, so a harmony line is a `chord` of a sung head and a cue head sharing a stem.

**The PDF is the same drawing, and it is simpler than the plan said.** IronPdf keeps the SVG's own units and path
data, only the grouping and the glyph names are lost (check: `mutool draw -F svg` of the Holy Forever PDF has
"M0 3237H4939" for a staff line, the same numbers as the SVG).

- **All the music in the 137 PDFs is 31 distinct glyph shapes** (plus lines and circles). Each glyph is a flipped
  filled path whose data is the font's outline, so a hash of the path (`melody-path.ts`, `shapeHash`) names it.
  The table (`melody-glyphs.ts`) came from the glyph definitions in the preview SVG (9 shapes, named) and, for the
  other 22, from looking at a sheet of the shapes: both heads, whole/half/16th rests and flags, the sharp and the
  natural, the digits 2 3 5 6 8, cut time, F clef, fermatas, the repeat dots, an x head. There is no
  shape recognition and no tolerance to tune. A new shape is a "glyph not read" warning and a measure that does
  not pass, not a wrong tune.
- **The hard part is the grouping** (which stem, flag, dot and accidental goes with which head): geometry in
  staff-line units. `melody-pdf.ts` rebuilds Verovio's own tree from the page (measure, staff, layer, note, beam,
  tuplet) and hands it to the same reader as the SVG, so the two readers cannot disagree about meaning.
  The PDF reading of Holy Forever is the SVG reading: 362 of 362 notes the same in pitch, length and tie.
- **Corpus: 137 PDFs, 8,410 measures, 8,264 (98.3%) add up.** Of the 146 that do not: 55 are a first or last measure
  (pickups and a last bar completing one: legitimate; a first measure shorter than the bar is not a failure); 35 are
  other short measures to look at (probably the bar after a repeat or ending); 30 are a cue voice
  that Verovio moved sideways to clear a second, so the sweep that lines voices up by x puts it a column off;
  16 are one construction in `3277849` (the F# one: look at it first); 10 are other cue cases. 109 of 137
  songs have no failing measure but the first or last. The key signature agrees with the chart's `{key}` in
  137 of 137 sheets (the relative minor counted), and the time signature in all 133 whose chart has a `{time}`.
- **The 3 PDFs that do not embed the music font** (`185883`, `2098033`, `3359080`) read as well as any, since the notes
  never needed the font: all their measures add up.
- **Against the existing range reader** (`melody-range.ts`, a different way: ellipses in the page by size and
  lyrics): the lowest and highest sung note agree for 125 of 137 sheets. The 12 differences are where this reader
  counts a full-size note the old one drops for having no lyric under its measure (a bass line, an instrumental
  bar: 7123436 has a 49 against 64) and accidentals the old one does not read (a flat or sharp apex: one semitone).
  The PDF reader here does not read lyrics yet (the SVG's are in the `verse` elements; the PDF's are text
  positions to match to heads by x), and with them the old rule would apply to it too.

**Written: MusicXML 4.0 (partwise).** Pitch spelling, durations in 24 divisions to the quarter note, dots, ties,
tuplets (`time-modification`), lyrics with syllabic and extend, `<harmony>` (root, kind with the original text as
`text`, bass), rehearsal marks for sections, tempo, key, time, the notice as `<rights>`. Well formed
(`xmllint`) and ordered by the schema, but **not opened in a renderer**: no Verovio or OpenSheetMusicDisplay in
the checkout (a dependency to add for step 4), so "does OSMD transpose `<harmony>` correctly" is still open.

**Text and pdf.js (second round, from the PDF alone).** `src/js/melody-pdfjs.ts` reads a lead sheet PDF with
pdf.js (as `melody-range.ts` does) and needs nothing else: the preview is only the oracle it was developed against.

- **Words are read from the PDF.** Each character is its own text operation, so the words are rebuilt from the
  text objects (pdf.js's joined text items run far-apart syllables together). The fonts' names (needs
  `fontExtraProperties: true`) say which words are bold (sections, tempo). The chord flat and sharp are the music
  font's U+EA64 and U+EA66 (a sharp seen at last).
- **Lyric rows are told from chord rows by their spacing**: under a system the first row within 2,000 units of
  the staff starts the lyrics and each row within 640 of the last is another verse; any other word above the next
  staff is a chord. Hyphens and extenders are the short and long bars drawn after a syllable.
- **Against the preview (Holy Forever, PDF only):** syllables with their hyphens 279 of 280, chords 62 of 62
  measures (symbol and beat), sections and tempo 62 of 62, title and notice the same, notes 362 of 362.
- **Against the ChordPro charts (all 137):** 98.6% of the sung words (all verses) are words of the chart, 99.0%
  of the chord symbols are chords of the chart (the rest are spelled differently there, such as `A2` for `Asus2`); the
  section names the chart also has are 84.8% (the sheet says `VERSE`, the chart `Verse 1`: not an error).
- **pdf.js against mutool:** 127 of 137 PDFs give the identical melody, text included; all 8,264 measures that add up
  do so either way. The ten differences are chord-text joins.
- **The chart is useful as a check, and could correct** a reading (word boundaries, the flats), but nothing
  needs it: a PDF imported alone reads the same.

**Repeats and endings (read from the PDF alone).** A repeat is dots beside a thick line (a 90-unit stroke
as tall as the staff; a thin barline is 27): dots before the thick line end a repeat (`barline: 'repeat-end'`),
dots after it start one (`repeatStart` on the measure), and a start sign drawn at the end of a system is the next
measure's. A double bar is two thin lines and a final bar a thin and a thick. An ending is a 13-unit line over the
staff with a hook down at its left end (and at its right if it is closed), the numbers ("1", "2,3") written
under it: each measure under it gets `ending` with `start`/`stop`/`closed`. MusicXML gets the `<barline>`s with
`<repeat>` and `<ending>` (an open last ending is `discontinue`). Over the 137 sheets: 319 start signs, 324 end
signs (the difference is songs that repeat to the top, and one that starts with a sign and ends without),
and every sheet's endings have as many starts as stops; the measure sums are as before (8264 of 8410).

**Jumps: D.S., D.C., segno, coda, Fine (read from the PDF alone).** They are italic words over the staff and two
characters of the music font in the text (U+E047 segno, U+E048 coda), so there is no glyph to name. Each
measure gets `directions`: `segno`, `coda`, `to-coda` ("2nd time to Coda" has `time: 2`), `fine`, `da-segno`
and `da-capo` (with `al: 'coda' | 'fine'`), and `text` for any other instruction ("Play 3 times", "(4x)",
"(2nd x a cappella)", "(To Ch.)": kept as written, for the structure work to read). A direction goes to the measure
its text ends over (D.S. is set against the barline). MusicXML gets `<direction>` with `<segno/>`/`<coda/>` or the
words, and `<sound segno/coda/tocoda/dalsegno/dacapo/fine>`. Over the corpus: 93 of 137 sheets have one; every D.S. has a
segno, every "al Coda" has a "to Coda" and a coda, and every "al Fine" a Fine. The jumps are not followed
yet: expanding the sheet into the order it is played is the structure work (`structureOf`).

**Structure: the order a sheet is played in, matched to the chart (`melody-structure.ts`).** `playOrder` follows
repeats (twice, or "Play 3 times" / "(4x)"), numbered endings (by pass), and D.S./D.C. al Coda/Fine with the
usual conventions (repeats not taken again after a jump; only the last ending after one; "to Coda" taken on the
way through after a jump). `playSteps` groups that into goes at each boxed section. `matchChart` finds the
ChordPro section for each step **by the lyrics** (the sheet's words for the verse of that pass against each chart
section's, as word pairs; identical sections go to the first not used, so a chorus sung twice is Chorus 1 then
Chorus 2), and by name where a step has no words. A section with several verses written under it (a strophic
hymn) is read with `matchVerses`. Holy Forever comes out as: Intro, Verse 1, Pre-Chorus, Chorus 1, Verse 2,
Chorus 1, Chorus 2, Pre-Chorus (twice, with its endings), then D.S. back to the chorus and across to the tag:
which is what the sheet says and the chart's order alone cannot.
Scored on the corpus against the ChordPro (`scripts/melody-structure-check.ts`; a chart section with at least eight words
counts): 91 of 137 songs have every lyric section of the chart placed, in the chart's order; 118 have all of
them placed; 100 are in the chart's order. The rest are mostly real differences: the sheet's order is not the
chart's (a chorus first, a verse repeated by a D.S., "Chorus 1a/1b" split differently), a chart section the sheet
leaves out ("Ending", "Instrumental"), and choruses whose words are the same, so which one is which is a guess.
It is the publisher's arrangement, a default to offer the leader and not a truth; a song's step list is what the
setlist's structure feature would show first, with the chart's order as the fallback where there is no sheet.

**Not done, in the order of how much it matters:**

1. (Done: the SVG reader, the XML parser and the time-map and MIDI scoring are in `scripts/`; `src/` has only the PDF route.)
2. (Done: repeats, endings and the D.S./D.C./coda signs and words, above. Not done: following them, to give the
   order a song is played in.)
3. A second full-size voice. (A cue line drawn a head's width aside to clear a sung note a second or a unison away is
   now one place with it: 8273 of 8410 measures add up, from 8264; what is left of the 30 is the same line when it is
   shifted by more than that, or the F# construction in `3277849`.)
4. Meter changes inside a song are read (the digits start a measure) but none was checked.
5. Whole-measure and multi-measure rests of the `multiRest` kind, grace notes: not seen in the corpus.

## Open questions

1. ~~What does `GetSongLeadPreview` return?~~ SVG pages, a MIDI and a timemap (above). Checked on
   Holy Forever: the 63 ids with no MIDI note are exactly the tie continuations, and the MIDI includes the
   cue notes. Still to check: how it varies by song (several voices? repeats played out or not?), on more
   than one preview.
2. ~~Is it Verovio?~~ Yes: its SVG classes and the music font say so (above).
3. ~~How are repeats and endings drawn?~~ In the PDF: dots beside a thick line, and a line with hooks and the
   numbers under it (above). A coda is italic words ("D.C. al Coda", "2nd time to Coda") and a sign character of the
   music font (above).
4. **May a script outside SongSelect's own pages call the preview?** The bookmarklet runs on
   SongSelect with the person's login, as for the PDF, so it should be the same; the backfill
   script's pacing applies to it. The agreements read so far do not forbid it, but say nothing for
   it either; whether the call is counted as a download, and whether it is gated by tier, is open
   (see "The terms"), and decides whether the preview may be a source or only a check.
5. **Keep the PDF as well?** Not needed if the view renders from the notes. Keeping it is a copy of
   the sheet the licence already lets the church hold (§3.1.4), so it is not forbidden; it would
   be a fallback if a reading is wrong, but is one more thing in the Drive and the key it was
   downloaded in.
6. **Which source is the one**: the PDF (a counted, tier-checked download, with the notice on it, but
   needs the harder reader) or the preview's SVG (a DOM walk, with the notes given, but with the
   counting and tier question above). The reader for the PDF is needed either way for a PDF
   downloaded by hand, so the spike can score both on the same songs.

## Steps

0. **Spike (done: see "Spike results").** Answer question 1 first. Then on four or five real lead sheets read the
   lengths and rests (from the SVG if it is there, else the PDF) and check every measure against the
   time signature; say how many measures pass. Stop here if it does not reach nearly every measure
   of nearly every song. Run it over the local corpus of 137 PDFs and score pitch and start time
   against each one's MIDI where a preview is to hand, and open the 3 PDFs with no music font first.
1. **The reader and the `Melody`**, behind `readMelodyRange`'s place: the range comes from it, the
   import page says what was read, and a song it cannot read keeps today's result. Tests from
   fixtures that are not copyrighted. The notice text is kept with the notes from the start.
2. **MusicXML out and in**, and the storage and sync of the `Melody` beside the chart.
3. **Analysis in the key picker**, and the voice preference.
4. **The view** (and playing it), if the band wants it.

Reading a PDF's notes reverses what `docs/EMAIL_IMPORT.md` says today ("PDFs are never imported as
charts": a PDF from an email or a share is read for its metadata only). That stays true for those:
the notes would come only from a lead sheet the person downloaded or imported themselves, and that
page and the help text change in the step that ships it.

Each step is a pull request that leaves the app working; the first two change nothing a person
sees except a better range and a "how it was read" that can show the whole line.
