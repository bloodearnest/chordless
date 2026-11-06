/**
 * Spike for docs/MELODY.md: read lead sheet PDFs into melodies and check every measure against its
 * time signature. With a preview's JSON it also compares the PDF's reading with the SVG's, note by note.
 *
 *   node scripts/melody-pdf-spike.ts export/7201044-lead-Bb.pdf [--compare preview.json] [--dump]
 *   node scripts/melody-pdf-spike.ts export/            (every PDF in a folder, one line each)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Melody, type MelodyNote } from '../src/js/melody.ts'
import { pdfPageToTree } from '../src/js/melody-pdf.ts'
import { readMelodySvg, readMelodyTrees, type ReadStats } from '../src/js/melody-svg.ts'

/** The pages of a PDF as SVG text, by mutool */
function pdfPages(file: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'melody-'))
  try {
    execFileSync('mutool', ['draw', '-F', 'svg', '-o', join(dir, 'p-%d.svg'), file], { stdio: 'ignore' })
    return readdirSync(dir)
      .sort((a, b) => parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function readPdf(file: string): { melody: Melody; stats: ReadStats } {
  const stats = { warnings: [] as string[] } as ReadStats
  const trees = pdfPages(file).flatMap((p) => pdfPageToTree(p, stats.warnings) ?? [])
  return { melody: readMelodyTrees(trees, stats), stats }
}

const notesOf = (m: Melody) => m.measures.flatMap((x) => x.voices.flat().filter((e): e is MelodyNote => e.kind === 'note'))
const spell = (n: MelodyNote) => `${n.step}${n.alter > 0 ? '#' : n.alter < 0 ? 'b' : ''}${n.octave}:${n.duration}${n.cue ? 'c' : ''}`

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
  for (const f of readdirSync(target).filter((x) => x.endsWith('.pdf')).sort()) {
    const { stats } = readPdf(join(target, f))
    songs++
    measures += stats.measures
    full += stats.full
    if (stats.measures && stats.full >= stats.measures - 1) perfect++
    rows.push(`${f.padEnd(52)} ${String(stats.full).padStart(3)}/${String(stats.measures).padEnd(3)} ${stats.warnings.length ? `${stats.warnings.length} warnings: ${[...new Set(stats.warnings.map((w) => w.replace(/ at [-\d.,]+$/, '').replace(/ \([^)]*\)/, '')))].slice(0, 3).join('; ')}` : ''}`)
  }
  console.log(rows.join('\n'))
  console.log(`${songs} songs, ${measures} measures, ${full} add up (${((100 * full) / measures).toFixed(1)}%); ${perfect} songs with at most one measure that does not`)
} else {
  const { melody, stats } = readPdf(target)
  console.log(`${stats.measures} measures, ${stats.full} add up; ${stats.notes} notes, ${stats.rests} rests`)
  for (const m of stats.short.slice(0, 10)) console.log(`  measure ${m.number}: ${m.length} of ${(m.beats * 4) / m.beatType}`)
  for (const w of stats.warnings.slice(0, 15)) console.log(`  warning: ${w}`)
  const cmp = args.indexOf('--compare')
  if (cmp >= 0) {
    const res = JSON.parse(readFileSync(args[cmp + 1] as string, 'utf8'))
    const svgs = (res.payload.svgs as string[]).map((s) => Buffer.from(s.replace(/^data:[^,]*,\s*/, ''), 'base64').toString('utf8'))
    const ref = readMelodySvg(svgs)
    const a = notesOf(melody)
    const b = notesOf(ref)
    let same = 0
    const bad: string[] = []
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (spell(a[i] as MelodyNote) === spell(b[i] as MelodyNote) && (a[i] as MelodyNote).tieStart === (b[i] as MelodyNote).tieStart) same++
      else if (bad.length < 10) bad.push(`#${i}: pdf ${spell(a[i] as MelodyNote)}${(a[i] as MelodyNote).tieStart ? '~' : ''} svg ${spell(b[i] as MelodyNote)}${(b[i] as MelodyNote).tieStart ? '~' : ''}`)
    }
    console.log(`against the preview's SVG: ${a.length} notes against ${b.length}; ${same} the same pitch, length and tie`)
    for (const x of bad) console.log(`  ${x}`)
  }
  if (args.includes('--dump'))
    for (const m of melody.measures)
      console.log(`${String(m.number).padStart(3)} ${m.voices.map((v) => v.map((e) => (e.kind === 'rest' ? `r${e.duration}` : spell(e) + (e.tieStart ? '~' : ''))).join(' ')).join(' | ')} ${m.full ? '' : '!!'}`)
}
