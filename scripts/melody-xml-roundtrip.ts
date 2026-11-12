/**
 * Spike for docs/LEAD_SHEETS.md: the MusicXML a melody is written as, read back. If the file is to be what
 * is kept, `readMusicXml(writeMusicXml(melody))` has to give the melody again, field by field.
 *
 *   node scripts/melody-xml-roundtrip.ts export/             every song, scored
 *   node scripts/melody-xml-roundtrip.ts export/ 7201044     one song, with what differs
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Score, ScoreEvent, ScoreNote } from '../src/js/score.ts'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { readMusicXml } from '../src/js/score-musicxml-read.ts'
import { readPdf } from './melody-pdf-spike.ts'

const dir = process.argv[2] as string
const only = process.argv[3]
const r = (n: number) => Math.round(n * 10000) / 10000

/**
 * A melody as plain data to compare. What the file does not keep, and so is not compared: the ids of
 * the sheet's own elements, how the events are grouped into voices, a lyric that is only a verse number ("1."), the lyrics of a cue note, a
 * barline that is "none" (a plain one), and the words of a segno or coda sign.
 */
/** The lyrics a note keeps: none on a cue note, no verse number, and no empty verse at the end */
function syllablesOf(e: ScoreNote): string[] {
  const kept = e.cue ? [] : e.syllables.map(s => (/^\d+\.$/.test(s) ? '' : s))
  while (kept.length && !kept[kept.length - 1]) kept.pop()
  return kept
}

function normal(m: Score) {
  const event = (e: ScoreEvent) =>
    e.kind === 'note'
      ? [
          'n',
          e.step,
          e.alter,
          e.octave,
          e.midi,
          r(e.start),
          r(e.duration),
          r(e.tupletRatio),
          e.tieStart,
          e.tieStop,
          e.cue,
          e.withPrevious,
          e.tuplet ?? '',
          syllablesOf(e).join('¦'),
        ].join('|')
      : [
          'r',
          r(e.start),
          r(e.duration),
          r(e.tupletRatio),
          e.wholeMeasure,
          e.cue,
          e.tuplet ?? '',
        ].join('|')
  return {
    title: m.title || null,
    notice: m.notice,
    measures: m.measures.map(x => ({
      number: x.number,
      // (the events of the measure: how they are grouped into voices is a way of writing them)
      voices: x.voices.flatMap(v => v.map(event)).sort(),
      chords: x.chords.map(c => `${r(c.start)}|${c.text}`),
      section: x.section ?? null,
      barline: x.barline === 'none' ? 'single' : x.barline,
      directions: x.directions.map(d =>
        d.kind === 'segno' || d.kind === 'coda'
          ? `${d.kind}`
          : `${d.kind}|${d.al}|${d.time}|${d.text}`
      ),
      repeatStart: x.repeatStart,
      ending: x.ending
        ? `${x.ending.label}|${x.ending.start}|${x.ending.stop}|${x.ending.closed}`
        : null,
      length: r(x.length),
      full: x.full,
      fifths: x.fifths,
      time: `${x.beats}/${x.beatType}`,
      tempo: x.tempo,
    })),
  }
}

const fields = new Map<string, number>()
const examples = new Map<string, string>()
let songs = 0
let exact = 0
let measures = 0
let measuresExact = 0
for (const f of readdirSync(dir)
  .filter(x => x.endsWith('.pdf'))
  .sort()) {
  const id = f.split('-')[0] as string
  if (only && id !== only) continue
  songs++
  const { melody } = readPdf(join(dir, f))
  const back = readMusicXml(writeMusicXml(melody))
  if (!back) {
    fields.set('(not read)', (fields.get('(not read)') ?? 0) + 1)
    continue
  }
  const a = normal(melody)
  const b = normal(back)
  let same = true
  for (const k of ['title', 'notice'] as const)
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      same = false
      fields.set(k, (fields.get(k) ?? 0) + 1)
      examples.set(k, `${id}: ${JSON.stringify(a[k])} / ${JSON.stringify(b[k])}`)
    }
  if (a.measures.length !== b.measures.length) {
    same = false
    fields.set('measure count', (fields.get('measure count') ?? 0) + 1)
  }
  a.measures.forEach((x, i) => {
    const y = b.measures[i]
    measures++
    let ok = true
    for (const k of Object.keys(x) as (keyof typeof x)[]) {
      if (JSON.stringify(x[k]) !== JSON.stringify(y?.[k])) {
        ok = false
        fields.set(k, (fields.get(k) ?? 0) + 1)
        if (!examples.has(k) || only)
          examples.set(
            k,
            `${id} m${i + 1}: ${JSON.stringify(x[k])?.slice(0, 300)}\n      ->  ${JSON.stringify(y?.[k])?.slice(0, 300)}`
          )
      }
    }
    if (ok) measuresExact++
    else same = false
  })
  if (same) exact++
}
console.log({ songs, exact, measures, measuresExact })
for (const [k, n] of fields) console.log(`  ${k}: ${n}\n    ${examples.get(k)}`)
