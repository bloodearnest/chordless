/**
 * Spike for docs/MELODY.md: the MusicXML written from a lead sheet PDF, engraved by Verovio (the
 * renderer SongSelect uses), and read back with the SVG reader. If the MusicXML says what the sheet
 * says, the notes that come back are the notes that went in.
 *
 *   node scripts/melody-render-check.ts export/             every song, scored
 *   node scripts/melody-render-check.ts export/ 7201044     one song, in full (and the SVG to /tmp)
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Melody } from '../src/js/melody.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { renderMelody } from '../src/js/melody-render.ts'
import { transposeMelody } from '../src/js/melody-transpose.ts'
import { transposeKeyName } from '../src/js/transpose.ts'
import { readPdf } from './melody-pdf-spike.ts'
import { readMelodySvg } from './melody-xml.ts'

const dir = process.argv[2] as string
const only = process.argv[3]

/**
 * Every note as measure, pitch and length. Where a note starts is left out: the SVG has no spacer for a
 * line that comes in late (a cue line over a rest), so the reader of it counts from the line's first note;
 * voices, ids and the cue flag are reading details too.
 */
const notesOf = (m: Melody) =>
  m.measures
    .flatMap((x, i) =>
      x.voices
        .flat()
        .flatMap(e =>
          e.kind === 'note' ? [`${i}:${e.midi}:${Math.round(e.duration * 1000) / 1000}`] : []
        )
    )
    .sort()
/** The syllables of the melody, as text without its hyphens, extenders and verse numbers */
const syllablesOf = (m: Melody) =>
  m.measures
    .flatMap(x =>
      x.voices
        .flat()
        .flatMap(e =>
          e.kind === 'note' && !e.cue
            ? e.syllables.filter(Boolean).map(s => s.replace(/[-_]$/, '').replace(/^\d+\.\s*/, ''))
            : []
        )
    )
    .filter(Boolean)
    .sort()
/** The same from Verovio's SVG: the text of each syllable group (a syllable is a run of glyph tspans) */
const syllablesOfSvg = (pages: string[]) =>
  pages
    .flatMap(page =>
      page
        .split('class="syl"')
        .slice(1)
        .map(g =>
          [
            ...g
              .slice(0, g.indexOf('</g>'))
              .matchAll(/<tspan[^>]*font-size="[^"]*"[^>]*>([^<]*)<\/tspan>/g),
          ]
            .map(t => t[1])
            .join('')
            .replace(/^\d+\.\s*/, '')
        )
    )
    .filter(Boolean)
    .sort()

/** The major key of a key signature, sharps positive */
const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']

let movedSame = 0
let movedNotes = 0
let movedBad = 0
let warned = 0
let songs = 0
let rendered = 0
let measuresIn = 0
let measuresOut = 0
let notesIn = 0
let notesSame = 0
let wordsSame = 0
const bad: string[] = []
for (const f of readdirSync(dir)
  .filter(x => x.endsWith('.pdf'))
  .sort()) {
  const id = f.split('-')[0] as string
  if (only && id !== only) continue
  songs++
  const { melody } = readPdf(join(dir, f))
  const xml = writeMusicXml(melody)
  const out = await renderMelody(xml)
  if (!out) {
    bad.push(`${id} Verovio could not read the MusicXML`)
    continue
  }
  rendered++
  const back = readMelodySvg(out.pages)
  const a = notesOf(melody)
  const b = new Set(notesOf(back))
  const same = a.filter(n => b.has(n)).length
  measuresIn += melody.measures.length
  measuresOut += back.measures.length
  notesIn += a.length
  notesSame += same
  const sylIn = syllablesOf(melody)
  const sylOut = syllablesOfSvg(out.pages)
  if (sylIn.join('|') === sylOut.join('|')) wordsSame++
  else bad.push(`${id} syllables ${sylIn.length} in, ${sylOut.length} out`)
  if (same < a.length || melody.measures.length !== back.measures.length)
    bad.push(
      `${id} measures ${melody.measures.length}->${back.measures.length}, notes ${same}/${a.length}`
    )
  if (out.log.trim()) warned++
  // and moved three semitones up: the MusicXML of a transposed melody, with its new key and spelling
  const from = MAJOR[(melody.measures[0]?.fifths ?? 0) + 7] as string
  const moved = transposeMelody(melody, from, transposeKeyName(from, 3))
  const movedOut = await renderMelody(writeMusicXml(moved))
  if (movedOut) {
    const x = notesOf(moved)
    const y = new Set(notesOf(readMelodySvg(movedOut.pages)))
    movedNotes += x.length
    movedSame += x.filter(n => y.has(n)).length
  } else movedBad++
  if (only) {
    writeFileSync(`/tmp/verovio-${id}.svg`, out.pages[0] as string)
    console.log(`pages ${out.pages.length}; log: ${out.log.slice(0, 600) || '(empty)'}`)
  }
}
console.log({
  songs,
  rendered,
  warned,
  movedNotes,
  movedSame,
  movedBad,
  measuresIn,
  measuresOut,
  notesIn,
  notesSame,
  wordsSame,
})
console.log(bad.slice(0, 40).join('\n'))
