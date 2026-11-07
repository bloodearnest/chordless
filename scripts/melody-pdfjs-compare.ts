/**
 * Spike for docs/MELODY.md: the melody read with pdf.js (what the app will use) against the one read
 * from mutool's output, for every lead sheet PDF in a folder. They should be the same.
 *
 *   node scripts/melody-pdfjs-compare.ts export/
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMelodyPdf } from '../src/js/melody-pdfjs.ts'
import { readPdf } from './melody-pdf-spike.ts'

/** What a melody says, without the ids of its elements (they count what was drawn, and differ in how) */
const essence = (m: unknown) =>
  JSON.stringify(m, (k, v) =>
    k === 'id' ? undefined : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v
  )

const dir = process.argv[2] as string
let same = 0
let total = 0
let full = 0
let measures = 0
const diffs: string[] = []
for (const f of readdirSync(dir)
  .filter(x => x.endsWith('.pdf'))
  .sort()) {
  const bytes = readFileSync(join(dir, f))
  const stats = { warnings: [] as string[] } as Parameters<typeof readMelodyPdf>[1]
  const viaPdfjs = await readMelodyPdf(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    stats
  )
  const viaMutool = readPdf(join(dir, f)).melody
  total++
  if (stats) {
    full += stats.full
    measures += stats.measures
  }
  if (viaPdfjs && essence(viaPdfjs) === essence(viaMutool)) same++
  else if (diffs.length < 12) {
    const parts: string[] = []
    if (viaPdfjs) {
      if (essence(viaPdfjs.title) !== essence(viaMutool.title)) parts.push('title')
      if (essence(viaPdfjs.notice) !== essence(viaMutool.notice)) parts.push('notice')
      for (const [i, m] of viaPdfjs.measures.entries()) {
        const o = viaMutool.measures[i] as unknown as Record<string, unknown>
        for (const [k, v] of Object.entries(m))
          if (essence(v as never) !== essence(o[k] as never)) parts.push(`${k}@${i + 1}`)
        if (parts.length > 5) break
      }
    }
    diffs.push(`${f}: ${viaPdfjs ? parts.slice(0, 6).join(' ') : 'pdf.js gave nothing'}`)
  }
}
console.log(`${same}/${total} PDFs read identically by pdf.js and by mutool`)
console.log(`pdf.js: ${full}/${measures} measures add up`)
for (const d of diffs) console.log(`  ${d}`)
