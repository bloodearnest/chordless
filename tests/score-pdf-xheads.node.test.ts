/**
 * Notes with x heads (a spoken rhythm, "Let every thing that has breath") in a lead sheet's PDF
 * (src/js/score-pdf.ts): Verovio engraves them, `svgToPdf` prints them as SongSelect's PDFs are, and the
 * reader has to find their stems and beams, which sit a little away from where a filled head's would
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { readScorePdf } from '../src/js/score-pdfjs.ts'
import type { ReadStats } from '../src/js/score-read.ts'
import { renderScoreHere } from '../src/js/score-render-engine.ts'
import { bar, measure as m, melodyOf, note } from './score-build.ts'
import { svgToPdf } from './score-svg-pdf.ts'

/** The melody as MusicXML with every note an x head, engraved, printed to a PDF and read back */
async function throughPdf(melody: ReturnType<typeof melodyOf>, heads: 'x' | 'filled' = 'x') {
  const xml = writeMusicXml(melody).replace(
    /(<type>[^<]*<\/type>)/g,
    heads === 'x' ? '$1<notehead>x</notehead>' : '$1'
  )
  const out = await renderScoreHere(xml)
  assert.ok(out, 'Verovio engraved it')
  // (the heads are the x ones: a different glyph from a filled head)
  if (heads === 'x') assert.match(out.pages[0] as string, /#E0A9-/)
  const tally = { measures: 0, full: 0, short: [], notes: 0, rests: 0, warnings: [] } as ReadStats
  const read = await readScorePdf(svgToPdf(out.pages as string[]), tally)
  assert.ok(read, 'the PDF was read')
  return { read, tally }
}

describe('x heads in a PDF', () => {
  it('are separate notes with their own lengths, not one chord', async () => {
    const { read, tally } = await throughPdf(
      melodyOf('X', [
        m(1, ['r:1', 'r:0.5', 'A4:0.5:Let', 'A4:0.5:ev-', 'A4:0.5:ry-', 'A4:0.5:thing', 'r:0.5']),
        m(2, ['r:2', 'A4:0.5:that', 'A4:0.5:has', 'A4:0.5:breath', 'r:0.5'], { barline: 'final' }),
      ])
    )
    assert.deepEqual(tally.warnings, [])
    const notes = (n: number) =>
      (read.measures[n]?.voices.flat() ?? []).flatMap(e =>
        e.kind === 'note' ? [`${e.start}+${e.duration}${e.withPrevious ? ' chord' : ''}`] : []
      )
    assert.deepEqual(notes(0), ['1.5+0.5', '2+0.5', '2.5+0.5', '3+0.5'])
    assert.deepEqual(notes(1), ['2+0.5', '2.5+0.5', '3+0.5'])
    assert.equal(read.measures[0]?.full, true)
  })

  it('are separate from a chord of whole notes, which has no stem to share and stays one chord', async () => {
    const { read } = await throughPdf(
      melodyOf('Stack', [
        bar([note('C', 4, { duration: 4 }), note('E', 4, { duration: 4, withPrevious: true })], {
          barline: 'final',
        }),
      ]),
      'filled'
    )
    const notes = (read.measures[0]?.voices.flat() ?? []).flatMap(e =>
      e.kind === 'note' ? [`${e.start}+${e.duration}${e.withPrevious ? ' chord' : ''}`] : []
    )
    assert.deepEqual(notes, ['0+4', '0+4 chord'])
  })
})
