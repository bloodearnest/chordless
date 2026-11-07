import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Melody, MelodyNote } from '../src/js/melody.ts'
import { pdfPageToTree } from '../src/js/melody-pdf.ts'
import { type ReadStats, readMelodySvg, readMelodyTrees } from '../src/js/melody-svg.ts'
import { mutoolPages } from './melody-mutool.ts'

export function readPdf(file: string): { melody: Melody; stats: ReadStats } {
  const stats = { warnings: [] as string[] } as ReadStats
  const trees = mutoolPages(file).flatMap(p => pdfPageToTree(p.items, stats.warnings, p.runs) ?? [])
  return { melody: readMelodyTrees(trees, stats), stats }
}

/** The notes in the order they sound (voices are only a reading detail), the lower of a chord first */
const notesOf = (m: Melody) =>
  m.measures.flatMap(x =>
    x.voices
      .flat()
      .filter((e): e is MelodyNote => e.kind === 'note')
      .sort((p, q) => p.start - q.start || p.midi - q.midi)
  )
const spell = (n: MelodyNote) =>
  `${n.step}${n.alter > 0 ? '#' : n.alter < 0 ? 'b' : ''}${n.octave}:${n.duration}${n.cue ? 'c' : ''}`

const args = process.argv.slice(2)
const target = args[0] as string
if (!import.meta.main) {
  // imported for readPdf
} else if (statSync(target).isDirectory()) {
  let songs = 0
  let measures = 0
  let full = 0
  let perfect = 0
  const rows: string[] = []
  for (const f of readdirSync(target)
    .filter(x => x.endsWith('.pdf'))
    .sort()) {
    const { stats } = readPdf(join(target, f))
    songs++
    measures += stats.measures
    full += stats.full
    if (stats.measures && stats.full >= stats.measures - 1) perfect++
    rows.push(
      `${f.padEnd(52)} ${String(stats.full).padStart(3)}/${String(stats.measures).padEnd(3)} ${stats.warnings.length ? `${stats.warnings.length} warnings: ${[...new Set(stats.warnings.map(w => w.replace(/ at [-\d.,]+$/, '').replace(/ \([^)]*\)/, '')))].slice(0, 3).join('; ')}` : ''}`
    )
  }
  console.log(rows.join('\n'))
  console.log(
    `${songs} songs, ${measures} measures, ${full} add up (${((100 * full) / measures).toFixed(1)}%); ${perfect} songs with at most one measure that does not`
  )
} else {
  const { melody, stats } = readPdf(target)
  console.log(
    `${stats.measures} measures, ${stats.full} add up; ${stats.notes} notes, ${stats.rests} rests`
  )
  for (const m of stats.short.slice(0, 10))
    console.log(`  measure ${m.number}: ${m.length} of ${(m.beats * 4) / m.beatType}`)
  for (const w of stats.warnings.slice(0, 15)) console.log(`  warning: ${w}`)
  const cmp = args.indexOf('--compare')
  if (cmp >= 0) {
    const res = JSON.parse(readFileSync(args[cmp + 1] as string, 'utf8'))
    const svgs = (res.payload.svgs as string[]).map(s =>
      Buffer.from(s.replace(/^data:[^,]*,\s*/, ''), 'base64').toString('utf8')
    )
    const ref = readMelodySvg(svgs)
    const a = notesOf(melody)
    const b = notesOf(ref)
    let same = 0
    const bad: string[] = []
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (
        spell(a[i] as MelodyNote) === spell(b[i] as MelodyNote) &&
        (a[i] as MelodyNote).tieStart === (b[i] as MelodyNote).tieStart
      )
        same++
      else if (bad.length < 10)
        bad.push(
          `#${i}: pdf ${spell(a[i] as MelodyNote)}${(a[i] as MelodyNote).tieStart ? '~' : ''} svg ${spell(b[i] as MelodyNote)}${(b[i] as MelodyNote).tieStart ? '~' : ''}`
        )
    }
    // The words: syllables on the notes (the first two verses), chords and sections by measure
    let syl = 0
    let sylSame = 0
    const sylBad: string[] = []
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      for (let v = 0; v < 2; v++) {
        const x = (a[i] as MelodyNote).syllables[v] ?? ''
        const y = (b[i] as MelodyNote).syllables[v] ?? ''
        if (!x && !y) continue
        syl++
        if (x === y) sylSame++
        else if (sylBad.length < 8) sylBad.push(`#${i} verse ${v + 1}: pdf "${x}" svg "${y}"`)
      }
    console.log(`syllables (verses 1 and 2): ${sylSame}/${syl} the same, with their hyphens`)
    for (const x of sylBad) console.log(`  ${x}`)
    const chords = (m: Melody) =>
      m.measures.map(x => x.chords.map(c => `${c.text}@${c.start}`).join(' '))
    const ca = chords(melody)
    const cb = chords(ref)
    const cBad = ca.flatMap((x, i) =>
      x === cb[i] ? [] : [`measure ${i + 1}: pdf [${x}] svg [${cb[i]}]`]
    )
    console.log(
      `chords: ${ca.length - cBad.length}/${ca.length} measures the same, symbol and beat`
    )
    for (const x of cBad.slice(0, 6)) console.log(`  ${x}`)
    const sec = (m: Melody) => m.measures.map(x => `${x.section ?? ''}|${x.tempo ?? ''}`)
    const sa = sec(melody)
    const sb = sec(ref)
    const sBad = sa.flatMap((x, i) =>
      x === sb[i] ? [] : [`measure ${i + 1}: pdf ${x} svg ${sb[i]}`]
    )
    console.log(`sections and tempo: ${sa.length - sBad.length}/${sa.length} measures the same`)
    for (const x of sBad.slice(0, 6)) console.log(`  ${x}`)
    console.log(`title: pdf "${melody.title}" svg "${ref.title}"`)
    console.log(
      `notice: pdf ${JSON.stringify(melody.notice)}\n        svg ${JSON.stringify(ref.notice)}`
    )
    console.log(
      `against the preview's SVG: ${a.length} notes against ${b.length}; ${same} the same pitch, length and tie`
    )
    for (const x of bad) console.log(`  ${x}`)
  }
  if (args.includes('--dump'))
    for (const m of melody.measures)
      console.log(
        `${String(m.number).padStart(3)} ${m.voices.map(v => v.map(e => (e.kind === 'rest' ? `r${e.duration}` : spell(e) + (e.tieStart ? '~' : ''))).join(' ')).join(' | ')} ${m.full ? '' : '!!'}`
      )
}
