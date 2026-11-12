/**
 * Spike for docs/LEAD_SHEETS.md: how well the words read from a lead sheet PDF agree with the ChordPro
 * chart of the same song (the chart is the check here, and is not needed to read the PDF).
 *
 *   node scripts/melody-text-check.ts export/
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPdf } from './melody-pdf-spike.ts'

const dir = process.argv[2] as string
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
let songs = 0
let words = 0
let wordsOk = 0
let chords = 0
let chordsOk = 0
let sections = 0
let sectionsOk = 0
const worst: string[] = []
const badChords: string[] = []
const badSections: string[] = []
for (const f of readdirSync(dir)
  .filter(x => x.endsWith('.pdf'))
  .sort()) {
  const id = f.split('-')[0]
  const cho = readdirSync(dir).find(x => x.startsWith(`${id}-`) && x.endsWith('.cho'))
  if (!cho) continue
  const chart = readFileSync(join(dir, cho), 'utf8')
  const { melody } = readPdf(join(dir, f))
  songs++
  // lyrics: the words of every verse, put back together from syllables and their hyphens, against the chart's words
  const chartWords = new Set(
    chart
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/ - /g, '')
      .split(/\s+/)
      .map(norm)
      .filter(Boolean)
  )
  let mine = 0
  let ok = 0
  const missing: string[] = []
  const notes = melody.measures
    .flatMap(m => m.voices.flat())
    .flatMap(e => (e.kind === 'note' && !e.cue ? [e] : []))
  const rows = Math.max(0, ...notes.map(n => n.syllables.length))
  for (let v = 0; v < rows; v++) {
    let cur = ''
    for (const n of notes) {
      const s = n.syllables[v] ?? ''
      if (!s) continue
      cur += s.replace(/[-_]$/, '')
      if (s.endsWith('-')) continue
      const w = norm(cur)
      cur = ''
      if (!w) continue
      mine++
      if (chartWords.has(w)) ok++
      else if (missing.length < 6) missing.push(cur || w)
    }
  }
  words += mine
  wordsOk += ok
  // chords: every symbol on the sheet is one the chart has (the chart spells a few differently: compared without a trailing 2 or sus detail)
  const chartChords = new Set([...chart.matchAll(/\[([^\]|.]+)\]/g)].map(m => m[1] as string))
  const sheetChords = melody.measures.flatMap(m => m.chords.map(c => c.text))
  chords += sheetChords.length
  chordsOk += sheetChords.filter(c => chartChords.has(c)).length
  for (const c of sheetChords)
    if (!chartChords.has(c) && badChords.length < 40)
      badChords.push(`${f.slice(0, 8)} ${c} (chart: ${[...chartChords].slice(0, 6).join(' ')})`)
  // sections: the chart's {comment: Verse 1} lines against the sheet's boxed names
  const chartSections = new Set(
    [...chart.matchAll(/\{comment:\s*([^}]*)\}/g)].map(m => (m[1] as string).trim().toLowerCase())
  )
  const sheetSections = melody.measures.flatMap(m => (m.section ? [m.section] : []))
  sections += sheetSections.length
  sectionsOk += sheetSections.filter(s => chartSections.has(s.toLowerCase())).length
  for (const s of sheetSections)
    if (!chartSections.has(s.toLowerCase()) && badSections.length < 30)
      badSections.push(
        `${f.slice(0, 8)} "${s}" (chart: ${[...chartSections].slice(0, 5).join(' | ')})`
      )
  if (mine && ok / mine < 0.95)
    worst.push(`${f.padEnd(34)} words ${ok}/${mine}  missing: ${missing.join(' ')}`)
}
const pct = (a: number, b: number) => `${a}/${b} (${((100 * a) / (b || 1)).toFixed(1)}%)`
console.log(`${songs} songs`)
console.log(`lyric words (all verses) found in the chart: ${pct(wordsOk, words)}`)
console.log(`chord symbols the chart has too: ${pct(chordsOk, chords)}`)
console.log(`section names the chart has too: ${pct(sectionsOk, sections)}`)
for (const w of worst.slice(0, 15)) console.log(`  ${w}`)

if (process.argv.includes('--chords')) console.log(badChords.join('\n'))
if (process.argv.includes('--sections')) console.log(badSections.join('\n'))
