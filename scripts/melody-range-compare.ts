/**
 * Spike for docs/MELODY.md: the range the existing reader (`melody-range.ts`) gets from each lead
 * sheet PDF against the range of the sung notes in the melody read here.
 *
 *   node scripts/melody-range-compare.ts export/
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMelodyRange } from '../src/js/melody-range.ts'
import { readPdf } from './melody-pdf-spike.ts'

const dir = process.argv[2] as string
let same = 0
let total = 0
const diffs: string[] = []
for (const f of readdirSync(dir)
  .filter(x => x.endsWith('.pdf'))
  .sort()) {
  const bytes = readFileSync(join(dir, f))
  const old = await readMelodyRange(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  const { melody } = readPdf(join(dir, f))
  const sung = melody.measures
    .flatMap(m => m.voices.flat())
    .flatMap(e => (e.kind === 'note' && !e.cue ? [e.midi] : []))
  if (!old || !sung.length) continue
  total++
  const mine = { low: Math.min(...sung), high: Math.max(...sung) }
  if (mine.low === old.low && mine.high === old.high) same++
  else diffs.push(`${f.padEnd(36)} existing ${old.low}-${old.high}  here ${mine.low}-${mine.high}`)
}
console.log(`${same}/${total} songs give the same lowest and highest sung note`)
for (const d of diffs) console.log(`  ${d}`)
