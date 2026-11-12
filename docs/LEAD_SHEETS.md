# Lead sheets: a lead sheet kept as MusicXML

A lead sheet from SongSelect used to be read for one thing, the lowest and highest sung note
(`docs/RANGE.md`), and the PDF then thrown away. What is kept now is the lead sheet as MusicXML: its
notes, and the words, chords, sections, repeats and directions that go with them, so that Chordless can
transpose it, analyse it and show it. The range comes from the notes read there. Built; the sections
"Why" to "What is in a lead sheet" are the reasoning and the findings behind it.

**The words.** The thing is the **lead sheet** (to people: "Show the lead sheet", "the lead sheet could not
be read"; not "sheet music", which is any notation). Its MusicXML is the **score** in the code's own words:
`Score` and the `Score*` types (`src/js/score.ts`), the `score-*.ts` modules that read, write, transpose
and render it, and `ScoreView` for the lead sheet's view. Some code and stored names still say `melody`
(`melody-analysis.ts`, `x_chordless_range`, the `?melody` URL option, the old Drive names); they are not
renamed. What is stored: the `scores` store (`getScore`/`saveScore`, `ScoreRecord`), the `score` file type
in Drive and, as people see it in Drive, `.lead-sheet.mxl` (docs/SYNC_ARCHITECTURE.md, "Scores").

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
  limit) can be run again over what was kept. The backfill (docs/RANGE.md, "Re-importing a whole library") took 140 songs at
  one request every 5 s; it should not need doing twice.
- **Show it.** Musicians want to see the lead sheet to check the vocal line or the instrumental one.
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

### It checks itself

Every measure must add up to the time signature (a pickup measure and the last one may be short).
A measure that does not is a measure read wrong. So the reader can say, per measure and for the
song, how sure it is, and refuse (keep the range-only result) instead of keeping a wrong tune. That
is the main reason the work is feasible: the format of the answer is its own test.

## The format

Two layers, and not one.

1. **Inside the app: a small typed `Score`**, not XML: measures, each with notes `{ midi, step,
   alter, octave, start, duration, tied, syllable, cue }`, plus key, time signature, tempo,
   sections, chord symbols. Analysis, transposing, the range and the play order derive from it. It is
   what the PDF reader builds and what the score is parsed into when it is wanted, not what is stored (below).
   As JSON it is not small: 68 KB at the median and 164 KB at most over the 137 sheets (the PDF is 125 KB).
2. **MusicXML 4.0 (partwise) is the file that is kept, and the edge**: written from the `Score`
   (`score-musicxml.ts`) and read into it (`score-musicxml-read.ts`), for the renderer, for export and
   import, and as the file in Drive. It is the interchange format every notation program speaks, so
   the user's file stays one they can open without us, and there is one format at the edge, not two. It is
   62 KB at the median (151 KB at most) and 3 KB gzipped. MEI is the other candidate (it is what Verovio
   uses); MusicXML is the one other programs open. MIDI is not enough: it has no spelling (F# or Gb), no
   lyrics, no sections.

Transposing is the notes moved by the interval and respelled for the new key, which
`transposeNote`/`noteName` already do for chords. Nothing else about the song changes.

`transposeScore` (`src/js/score-transpose.ts`) does it. The notes go through `octaveNearGreen`, the same
rule as the key picker: a key is a pitch class, so of the shift and the octave either side of it the one
that sits least outside the green range wins, and a sheet and the picker never show different octaves. The
chords take the plain nearest interval (they have no octave) through `transposeChord`. Notes are spelled
with `noteName`, so a sharp key gets sharps and a flat key flats; the unusual keys (F# major's E#) are spelled
as the chord transposer spells them. The range is of the sung notes: cue notes are not counted.

## Where it is kept

- **Not in the chart.** A directive could hold the range (it does); the lead sheet is kilobytes and
  would make the chart unreadable in the editor.
- **A MusicXML file beside the chart in Drive** (built: PR "sync a song's lead sheet"), per chart (a variant has its own),
  in the key the chart is in, linked to its chart by `appProperties` (`type: 'score'`, `songUuid` and `songId`, `key`,
  `scoreFormat`, `spaceId`, `appVersion`; `melody` and `melodyFormat` before the rename) like the chart's own, named `<title>[-<ccli>].lead-sheet.mxl`: an `.mxl`
  (`src/js/mxl.ts`), the zipped MusicXML that MuseScore, Sibelius and Dorico write and open, `scoreFormat: '2'`. It goes
  through the same storage and sync as the chart (`docs/STORAGE_API.md`, `docs/SYNC_ARCHITECTURE.md`, "Lead sheets"): the
  user's browser and the user's, or their team space owner's, Drive. Older clients ignore it: the pull skips a file in
  `songs` whose `type` is not `chordpro`. Deleting a song deletes its lead sheet and puts its file in the trash (a lead sheet
  whose chart was deleted in Drive is cleaned up by the next full sync). **Merging copies** (`applyRepair`: the same chart imported twice) moves the lead sheet of a copy that goes to the song kept, if that has none, as a new file to upload (the copy's file goes in the trash); the kept song's own lead sheet is never replaced. It keeps its `key`, which may differ from the kept chart's. Linking a song as a variant of another (`linkSong`) deletes nothing, so each keeps its lead sheet.
- **On the device, the MusicXML text**, in an IndexedDB store of its own (`melodies`, since database version 13, keyed
  by the song's uuid, with the file's `fileRef`, `fileRev` and `fileModified` as the chart's records have; `ScoreRecord`
  in `data-types.ts`), not in `songs` or `chordpro`: it is 30 to 70 KB a song and only the lead sheet view wants it. It is
  read again from the file when the file's `rev` changes, and only the original key is kept: other keys are
  `transposeScore`. **The score is kept, not its parse** (version 14; version 13 kept the parsed `Score`, and its records are
  cleared by the upgrade, being derived data). Parsing a score takes 2 to 4 ms on a desktop, so it is done when a song's
  lead sheet is wanted (the view, the key picker's analysis of the song in front of you), not for every song; a stored parse
  would have to be migrated whenever the `Score` type changes, and would keep what an older reader made of the score
  after the reader improved. The score also goes straight to Verovio for the original key. `contentHash` (of the score) is
  how a change made here is found; `scoreRecord(uuid, xml, key)` makes a record with it. The import step writes the
  score once (`writeMusicXml`) and a pull stores what Drive had, once it is known to parse.
- **Compression:** the file in Drive is an `.mxl`: 62 KB of MusicXML is 3 KB, so about 150 songs are 0.5 MB rather than 9 MB
  to download on a new device or a first sync. Drive stores the bytes as sent and counts them, and the browser's
  transport does not compress an upload, so it is done here, only at the edge: the device keeps the plain score.
  `CompressionStream` and `DecompressionStream` do the deflate (in the browsers we support and in Node), and the zip
  around it is written by hand with a fixed timestamp. **No churn:** change detection is the hash of the *score*, not of
  the file, so a different deflate in another browser makes a different file (and a different `rev`) but never an upload:
  the pull downloads it once, sees the same hash, and only records the file's markers. A lead sheet is uploaded only when its
  score changed. Reading takes either form: `.mxl`, or the plain `.lead-sheet.musicxml` (`.melody.musicxml` before the rename; `scoreFormat:
  '1'`), which is rewritten as an `.mxl` the next time the lead sheet changes here. **A space that holds text only** (a team
  space, until the Worker's routes take bytes: `SpaceStorage.bytes`) keeps the plain `.lead-sheet.musicxml`.
- **The copyright rule holds** (`CLAUDE.md`): the notes and lyrics are the song's, so they live
  only in the user's browser and Drive, never on the Worker, never in a share link, never in
  telemetry. A share carries the setlist; the receiver imports their own.
- It is derived data: it can be thrown away and read again from a PDF or a MusicXML file, so it is
  safe to lose, and need not be in exports (the MusicXML file is itself an export).

## The terms

CCLI's terms for keeping and transposing a lead sheet are in [CCLI.md](CCLI.md), "Lead sheets". The rules that follow from them are applied below.

## Uses, once it exists

- The range (`x_chordless_range`) is **derived** from it, so the PDF reader's range and the new one
  cannot disagree, and a hand-set range stays as the override.
- **Key picker**: per key, the time-weighted position of the notes, the longest held high note,
  and where a section starts to climb; the colours stay (green, yellow, red) but say why.
- **A voice preference**: choose the voices the band has and the picker rates keys for them.
- **View (built for a setlist's songs and the library's song page)**: a lead sheet button in the header (the `music` icon, beside edit and info; only for a
  song that has a lead sheet) switches *that song* between its lyrics and its sheet, in the section the song already has, so
  swiping or the arrow keys still move to the next song (which is in its own mode: the choice is per song, not carried over),
  and up and down scroll the sheet. The mode is in the URL as `?melody` (`docs/ROUTING.md`), a replace and not a new history
  entry, so a reload or a link keeps it; the sheet is `<score-view>` (`src/components/score-view.ts`), engraved in the key
  the song is shown in (a key change engraves it again, keeping the old sheet on show until the new one is ready), fitted to
  the width of the screen with almost no margin, and with a narrower page on a phone so the music is drawn larger. Each
  section starts a line, as on SongSelect's sheets: Verovio's own mode for keeping a line break written in the file ('smart')
  did not keep them, so the engine lays out each section alone to find its lines, shares its measures out over them (no
  last line of one measure stretched across the page), and lays out the whole with exactly those breaks
  (`score-render-engine.ts`); a pickup before the first section goes on its first line. Verovio's
  own `<style>` element is taken out of each page (the page's policy allows none) and its few rules are the component's. The library's song page has the same button and `?melody` (`/songs/<uuid>?melody`); there it is the one song open. A `built` test (`tests/built.playwright.ts`) engraves a sheet on the production build under the real policy, checks the worker file's own policy, and fails without the `_headers` rule. Not
  yet: the beats of the high notes shown
  on it.
- **View, as first planned**: a lead sheet view in the key in use, rendered by **Verovio**, the engraver SongSelect uses
  (chosen; see "Rendering with Verovio" in the spike results), so a transposed sheet looks like
  the original. Lazy loaded, and never on the path of the lyrics screen. The chord symbols are
  written into the MusicXML as `<harmony>` from our own transposer, so Nashville numbers and spelling
  are the app's and not the renderer's. The notice (above) goes under it.
- **Play it**: the lead sheet as notes, for finding the starting pitch and for practice. Small, and
  only if wanted.
- **Export** to MusicXML for a band that wants to open it in their own software.

## In the chart: the notes of an instrumental part

Most of a band plays from the chart in a set, and uses the lead sheet to check a tune or a rhythm in
rehearsal. What they want in the chart itself is the small notes of an instrumental line (an intro, a
turnaround). So a part of the chart can be shown as that line of music, in place of its chords: a fifth
choice in the part's Show options (All, Lyrics, Chords, **Lead sheet**, None; the button is still labelled "Melody" in the app), `HideMode` `'melody'`.

- **Which parts have it.** Only a part of the chart with no words (an intro, an instrumental; words in brackets, such as
  "(To Br.)", are not words): a part to sing has the words as its content. `cueMeasures` (`src/js/score-section.ts`)
  matches it to the sheet's section by name (Intro to INTRO, ignoring case and marks; "INTRO / TURNAROUND" is both,
  a meter after a dash is no part of a name, and "Interlude 1a" is INTERLUDE) and takes the measures from the box's
  start for as long as they are cue notes with nothing sung. It is a run, not the whole box, because the sheets do not
  always box what follows an instrumental. Sheet habits it allows for: a last measure with a sung note in its final
  beat (the pickup into the next part), a first measure that only holds a note over from the part before (a tie), a
  lead-in measure before the intro's box, and a first part with no box at all (the intro). A run that the singing cuts
  short, with more cue-only bars after it (voices over an instrumental), is only part of it, so it is not offered. Where
  nothing matches there is no option and no staff, never a wrong one. A sheet section that comes up more than once gives
  its first whole go.
- **Checked on the 137 sheets in `export/`** (read from the PDFs, against each chart): 111 have cue notes; the staff is
  offered for 97 parts in those (38 instrumental, 29 intro, 15 turnaround, 11 ending, outro or interlude, and the rest
  combined names). Most of the rest are cue notes over sung parts (a harmony line), which are left out by design; the
  misses that are left are sheets with a sung bar inside a TURNAROUND box, a chart part that has words of its own (an
  interlude with "Your love, your love"), and a chart with no intro for the sheet's INTRO.
- **What it shows.** The measures of that section (`sliceMeasures`: no title, notice or section box), in the
  key the song is shown in, by `<score-view>`, which takes the whole lead sheet and the `measures` to show. The
  notes are moved before they are cut, so a few measures are in the octave the whole sheet chose. The chords
  are the sheet's own, written as `<harmony>` as ever. The notice is on the song's own sheet, not repeated.
- **The default.** A part with no words and notes in the sheet shows them (`getRecommendedHideMode`), unless
  the preference is words only (the part then collapses, as for chords only). A chart with no stored lead
  sheet is as it was. The library's song page has the option but not the default: it keeps no defaults.
- **Where it is wired.** `attachCues` (`score-shown.ts`) gives `<song-display>` its `cues` and so each
  `<song-section>` its `melody` and `melodyMeasures`; it runs where the song's sheet is asked for (the
  setlist's `applyMelodyMode`, the library's `#applyMelody`), and the setlist works the sections' states out again
  once it has.
- **Seen in the chart.** A part the sheet has notes for has a music note by its title (in every mode: dimmed, and lit
  while the notes are what is shown), so a player can tell there is a lead sheet to switch to; the switch itself is in the
  Show options in edit mode. The sheet of a part fades into the page on all four sides, by a short 0.4rem (a mask, so a light sheet
  does not end in a hard edge on a dark page; a tablet shows the left and right edges too). Chord symbols use the letters "b" and "#" of the chart's own chords, which sit
  close to the root, unless the preference for ♯ and ♭ is on (`withTextAccidentals`, applied by `<score-view>`: Verovio
  draws the signs in a music font the page does not have, and a text font's ♭ has a wide space of its own). There is no
  collapse chevron outside edit mode: on a phone it wrapped under the title and made a line of its own.
- **The engraver is the heavy part**: it loads in a worker the first time a part is shown as music, as for the
  song's sheet (the page's plan for pulling Verovio and pdf.js in after load applies to both).
- Not done: a way to say which sheet section is which when the match fails (an instrumental the sheet does not name); sung lead sheet for any part (the
  slice is general, the matching and the choice of parts are not); a harmony line shown over a sung part.

## How the reader and the renderer work

**Rendering with Verovio (the engraver SongSelect uses; `src/js/score-render.ts`).** The sheet's SVG was written
by Verovio 6.0.1, so that exact version is the dependency (`verovio@6.0.1`, pinned; `renderScore(musicXml)`
gives one SVG a page). It is WebAssembly embedded in a 6.4 MB JavaScript module (`verovio/wasm`) with a 14 KB wrapper
(`verovio/esm`), imported only on first use, in a worker (below). `scripts/melody-render-check.ts` is the test of the MusicXML: write it
from each PDF, engrave it, read Verovio's SVG back with the SVG reader, and compare with what went in.


- **Wired for the app.** Verovio runs in a
  **worker** (`verovio-worker.ts`; the page asks it through `renderScore` in `score-render.ts`, and Node calls the
  engine, `score-render-engine.ts`, directly). WebAssembly needs `'wasm-unsafe-eval'`, and the page's policy does not
  have it: a worker has the policy of its own response, so `public/_headers` gives the files named `verovio-*` (the worker
  and its modules) a policy of their own, `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'` (with a `!` line to take
  off the page's policy first, as two policies on one file are both enforced). The 7 MB module is also compiled off the
  thread the lyrics scroll on. The files are not precached but deferred (`DEFERRED`, like the PDF reader): fetched shortly after the app loads, so the sheet works offline (docs/BUILD.md).
  Checked on a real build with a temporary import: the page's policy has no `wasm-unsafe-eval`, the three `verovio-*`
  files have only the tight one, a sheet is engraved with no violations, and without the `_headers` rule the worker fails
  with the policy's CompileError. A browser unit test runs `renderScore` through a real worker. When the view lands, add the
  `built` test that does the same on the build (done: it seeds the build's database directly, as it has no module paths to import).
  Verovio is **LGPL-3.0-or-later**: it stays an unmodified chunk of its own, and `/licences.html` (linked from the terms
  and privacy pages) has the notice, the source and the full LGPL and GPL texts (`public/licences/`).
- "Does OpenSheetMusicDisplay transpose `<harmony>` correctly" no longer matters: it is not used.

**Repeats and endings (read from the PDF alone).** A repeat is dots beside a thick line (a 90-unit stroke
as tall as the staff; a thin barline is 27): dots before the thick line end a repeat (`barline: 'repeat-end'`),
dots after it start one (`repeatStart` on the measure), and a start sign drawn at the end of a system is the next
measure's. A double bar is two thin lines and a final bar a thin and a thick. An ending is a 13-unit line over the
staff with a hook down at its left end (and at its right if it is closed), the numbers ("1", "2,3") written
under it: each measure under it gets `ending` with `start`/`stop`/`closed`. MusicXML gets the `<barline>`s with
`<repeat>` and `<ending>` (an open last ending is `discontinue`). 

**Jumps: D.S., D.C., segno, coda, Fine (read from the PDF alone).** They are italic words over the staff and two
characters of the music font in the text (U+E047 segno, U+E048 coda), so there is no glyph to name. Each
measure gets `directions`: `segno`, `coda`, `to-coda` ("2nd time to Coda" has `time: 2`), `fine`, `da-segno`
and `da-capo` (with `al: 'coda' | 'fine'`), and `text` for any other instruction ("Play 3 times", "(4x)",
"(2nd x a cappella)", "(To Ch.)": kept as written, for the structure work to read). A direction goes to the measure
its text ends over (D.S. is set against the barline). MusicXML gets `<direction>` with `<segno/>`/`<coda/>` or the
words, and `<sound segno/coda/tocoda/dalsegno/dacapo/fine>`. Over the corpus: 93 of 137 sheets have one; every D.S. has a
segno, every "al Coda" has a "to Coda" and a coda, and every "al Fine" a Fine. The jumps are not followed
yet: expanding the sheet into the order it is played is the structure work (`structureOf`).

**Structure: the order a sheet is played in, matched to the chart (`score-structure.ts`).** `playOrder` follows
repeats (twice, or "Play 3 times" / "(4x)"), numbered endings (by pass), and D.S./D.C. al Coda/Fine with the
usual conventions (repeats not taken again after a jump; only the last ending after one; "to Coda" taken on the
way through after a jump). `playSteps` groups that into goes at each boxed section. `matchChart` finds the
ChordPro section for each step **by the lyrics** (the sheet's words for the verse of that pass against each chart
section's, as word pairs; identical sections go to the first not used, so a chorus sung twice is Chorus 1 then
Chorus 2), and by name where a step has no words. A section with several verses written under it (a strophic
hymn) is read with `matchVerses`. Holy Forever comes out as: Intro, Verse 1, Pre-Chorus, Chorus 1, Verse 2,
Chorus 1, Chorus 2, Pre-Chorus (twice, with its endings), then D.S. back to the chorus and across to the tag:
which is what the sheet says and the chart's order alone cannot.
The sheet's order is the publisher's arrangement, a default to offer the leader and not a truth.

## Risks

- **SongSelect changes its renderer.** The shapes are the renderer's. Tests keep the failures
  visible (below), and the self-check turns a change into "could not read", not a wrong lead sheet.
- **Test data.** The real sheets are copyrighted and cannot be committed; the tests engrave
  lead sheets of their own with Verovio and print them as PDFs (`tests/score-svg-pdf.ts`,
  `tests/melody-pdf-roundtrip.node.test.ts`), so the fixtures are made the way the real ones are,
  without being anyone's song.
  A local export of real PDFs and charts was the corpus the reader was scored on; it stays out of git
  (it carries the church's licence number as well as the songs).
- **A copy without its notice.** A reader or view that keeps the notes and drops the header and
  footer would break §10.5 (see "The terms"). The `Score` keeps the notice text, and a test fails
  if a rendered sheet lacks it.
- **A wrong tune that looks right.** The measure sum is the guard; a note one step off in pitch
  passes it, so pitch has the existing checks (the key signature against the chart's key, the lyric
  rule) and the import page keeps showing what was found, with its place on the PDF.

## Tests and import

Reading a PDF's notes reverses what `docs/EMAIL_IMPORT.md` says today ("PDFs are never imported as
charts": a PDF from an email or a share is read for its metadata only). That stays true for those:
the notes would come only from a lead sheet the person downloaded or imported themselves, and that
page and the help text change in the step that ships it.

**Synthetic lead sheets (built).** The real sheets are CCLI's and stay out of the repository, so the PDF reader is tested on
sheets made from lead sheets written for the test: `tests/score-build.ts` writes a `Score` short (`C4:1:Ho-`),
Verovio engraves it, `tests/score-svg-pdf.ts` prints the SVG as a PDF, and `readScorePdf` has to read the lead sheet that
went in (`tests/melody-pdf-roundtrip.node.test.ts`; notes, lengths, rests, words, chords, sections, key signatures and
accidentals, triplets, pickups, repeats, endings, segno/coda/D.S., several pages). The converter exists because a general
SVG-to-PDF tool (`rsvg-convert`) bakes the placing into each glyph's coordinates, so the glyph hashes in `score-glyphs.ts`
no longer match. SongSelect's PDFs are IronPdf printing the same Verovio SVG, and the glyph outlines in them are Verovio's
own (the three checked, clef, time signature and notehead, hash to the table's entries), so the converter keeps each glyph's
path as Verovio draws it and puts it on the page with a matrix. Lines are stroked, noteheads and stems filled, words are
Times text (a text with `text-anchor` is shifted by its width, which is how Verovio right-aligns "D.S. al Coda"), the
accidentals in a chord symbol and the segno and coda signs are characters of an unembedded `Leipzig` font named by code point
(as in the real ones, where the reader finds the segno as U+E047).

Run over MusicXML from MuseScore (three lead sheets, kept locally), the same path found what the reader does not do, none
of it the converter's: a triplet with no bracket in the MusicXML has no bracket on the page, so it is read as eighths; the
accidental of a tied note is not drawn on the second note, so a tie over a barline loses its sharp; and a lyric's extender
is sometimes read as a hyphen or missed. `readMusicXml` reads the title from a `credit` where there is no work title (MuseScore
puts it there), and "Repeat 3x Last time to Coda" as the third pass.

**Import keeps the lead sheet (built).** `song-import` reads a lead sheet once, with `readScorePdf`, for the whole `Score`,
and the range is that lead sheet's sung notes (`readOfMelody`, `src/js/lead-sheet.ts`). The lead sheet is saved (`scoreRecord`, in the
`melodies` store, synced as in "Syncing") for the song the chart goes to: a new song, the library's song when the chart
updates it, the new song of an import as original or as variant, and the library's song when its own chart stays
(`use-existing`, or the same chart again): the lead sheet may have changed where the chart has not, so a re-import
replaces the lead sheet. It is kept only when the sheet is in the chart's key (its first measure's key signature against the
chart's `{key}`), as the range is; a sheet in another key, or one `readScorePdf` cannot read, leaves the song with its
chart and no lead sheet. A chart that has a range already keeps it, but the lead sheet is
still kept. The import page says it under the range: "The lead sheet is kept with the song."; "The lead sheet could not be saved…". It says the same whichever chart is taken. A sheet in another key gives neither, and the page says why.
