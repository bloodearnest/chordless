/**
 * Spike for docs/LEAD_SHEETS.md, "Structure": the play order a lead sheet gives, matched to the sections of
 * the ChordPro of the same song, by the lyrics.
 *
 *   node scripts/melody-structure-check.ts export/            every song, scored
 *   node scripts/melody-structure-check.ts export/ 7201044    one song, in full
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ChordProParser } from '../src/js/parser.ts'
import {
  matchChart,
  matchVerses,
  playOrder,
  playSteps,
  sheetSections,
  stepWords,
} from '../src/js/score-structure.ts'
import { readPdf } from './melody-pdf-spike.ts'

const dir = process.argv[2] as string
const only = process.argv[3]
let songs = 0
let clean = 0
let allSections = 0
let inOrder = 0
let stepsTotal = 0
let stepsMatched = 0
const worst: string[] = []
for (const f of readdirSync(dir)
  .filter(x => x.endsWith('.pdf'))
  .sort()) {
  const id = f.split('-')[0] as string
  if (only && id !== only) continue
  const cho = readdirSync(dir).find(x => x.startsWith(`${id}-`) && x.endsWith('.cho'))
  if (!cho) continue
  const chart = new ChordProParser().parse(readFileSync(join(dir, cho), 'utf8'))
  const chartText = chart.sections
    .filter(s => s.label)
    .map(s => ({
      label: s.label as string,
      text: s.lines.map(l => l.segments.map(g => g.lyrics).join('')).join(' '),
    }))
  const { melody } = readPdf(join(dir, f))
  const order = playOrder(melody)
  const steps = playSteps(melody, order)
  const matched = matchChart(melody, steps, chartText)
  songs++
  stepsTotal += matched.length
  stepsMatched += matched.filter(m => m.label).length
  // every chart section is played, or is a verse written under a section that is; the first plays come in the chart's order
  // (a section with no lyrics, an intro or an instrumental, is not one the lyrics can place)
  const all = chartText
    .filter(c => c.text.split(/\s+/).filter(Boolean).length >= 8)
    .map(c => c.label)
  const seen = [
    ...new Set(matched.flatMap(m => (m.label && all.includes(m.label) ? [m.label] : []))),
  ]
  const viaRows = new Set(
    steps.flatMap(st => matchVerses(melody, st, chartText).filter((l): l is string => !!l))
  )
  const covered = new Set([...seen, ...viaRows])
  const complete = all.every(l => covered.has(l))
  const ordered = seen.every(
    (l, i) => i === 0 || all.indexOf(l) >= all.indexOf(seen[i - 1] as string)
  )
  if (complete) allSections++
  if (ordered) inOrder++
  if (complete && ordered) clean++
  else
    worst.push(
      `${f.slice(0, 8)} missing ${all.filter(l => !covered.has(l)).join(', ') || '-'}${ordered ? '' : '; out of order'}`
    )
  if (only) {
    const sections = sheetSections(melody)
    console.log('chart:', chartText.map(c => c.label).join(' | '))
    for (const m of matched) {
      const s = sections[m.step.section]
      console.log(
        `  ${s?.name || '(none)'} m${m.step.from + 1}-${m.step.to} pass ${m.step.pass} -> ${m.label ?? '?'} (${m.score.toFixed(2)}) ${stepWords(melody, m.step).slice(0, 5).join(' ')}`
      )
    }
  }
}
console.log({ songs, clean, allSections, inOrder, stepsTotal, stepsMatched })
if (!only) console.log(worst.slice(0, 40).join('\n'))
