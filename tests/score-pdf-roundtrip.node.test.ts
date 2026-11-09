/**
 * The PDF reader on lead sheets made from melodies written for the test (public-domain, or just
 * scales): Verovio engraves the melody, `svgToPdf` prints it the way SongSelect's PDFs are made
 * (tests/score-svg-pdf.ts), and `readScorePdf` has to read the melody that went in. The real
 * sheets are CCLI's and cannot be kept, so this is what stands in for them.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Score } from '../src/js/score.ts'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { readScorePdf } from '../src/js/score-pdfjs.ts'
import type { ReadStats } from '../src/js/score-read.ts'
import { renderScoreHere } from '../src/js/score-render-engine.ts'
import { measure as m, melodyOf } from './score-build.ts'
import { svgToPdf } from './score-svg-pdf.ts'

/** The tallies the reader fills in, of which the test reads the warnings */
const stats = (): ReadStats => ({
  measures: 0,
  full: 0,
  short: [],
  notes: 0,
  rests: 0,
  warnings: [],
})

const round = (n: number) => Math.round(n * 1000) / 1000

/** What the sheet shows of a melody, measure by measure, as plain text to compare */
function shown(melody: Score) {
  return melody.measures.map(x => ({
    events: x.voices
      .flat()
      .map(e =>
        e.kind === 'note'
          ? `${e.step}${e.alter}${e.octave}@${round(e.start)}+${round(e.duration)} ${e.syllables.join('/')} ${e.tuplet ?? ''}`
          : `rest@${round(e.start)}+${round(e.duration)} ${e.tuplet ?? ''}`
      ),
    chords: x.chords.map(c => `${round(c.start)} ${c.text}`),
    section: x.section,
    barline: x.barline === 'none' ? 'single' : x.barline,
    repeatStart: x.repeatStart,
    ending: x.ending && `${x.ending.label} ${x.ending.start} ${x.ending.stop} ${x.ending.closed}`,
    directions: x.directions.map(d => `${d.kind} ${d.al} ${d.time}`),
    fifths: x.fifths,
    beats: x.beats,
  }))
}

/** The pages of the PDF made from a melody, and the melody read back from them */
async function throughPdf(melody: Score) {
  const out = await renderScoreHere(writeMusicXml(melody))
  assert.ok(out, 'Verovio engraved it')
  const tally = stats()
  const read = await readScorePdf(svgToPdf(out.pages as string[]), tally)
  assert.deepEqual(tally.warnings, [])
  assert.ok(read, 'the PDF was read')
  return { read, pages: out.pages.length }
}

async function sameAfterPdf(melody: Score) {
  const { read } = await throughPdf(melody)
  assert.deepEqual(shown(read), shown(melody))
}

describe('a melody printed as SongSelect prints it and read back', () => {
  it('keeps notes, lengths, rests, words, chords and the section name', async () => {
    await sameAfterPdf(
      melodyOf('Plain', [
        m(1, ['C4:1:Ho-', 'D4:1:ly', 'E4:1:is', 'F4:1:He'], {
          section: 'VERSE 1',
          chords: [
            [0, 'C'],
            [2, 'G7'],
          ],
        }),
        m(2, ['G4:2:ho-', 'E4:1:ly', 'r:1'], { barline: 'final' }),
      ])
    )
  })

  it('keeps short and dotted notes, and a three-four time signature', async () => {
    await sameAfterPdf(
      melodyOf('Lengths', [
        m(1, ['C4:0.5:a', 'D4:0.5:b', 'E4:1:c', 'F4:1.5:d', 'G4:0.5:e']),
        m(2, ['A4:3:f', 'r:1'], { barline: 'final' }),
      ])
    )
    await sameAfterPdf(
      melodyOf('Waltz', [
        m(1, ['C4:1:one', 'D4:1:two', 'E4:1:three'], { beats: 3 }),
        m(2, ['F4:3:four'], { beats: 3, barline: 'final' }),
      ])
    )
  })

  it('keeps lone short notes, which have a flag and no beam (a rest or a long note either side)', async () => {
    await sameAfterPdf(
      melodyOf('Flags', [
        m(1, ['C4:0.5:a', 'r:0.5', 'D4:1:b', 'E4:0.25:c', 'r:0.75', 'F4:1:d']),
        m(2, ['G4:0.5:e', 'r:0.5', 'A4:0.25:f', 'r:0.25', 'B4:2:g'], { barline: 'final' }),
      ])
    )
  })

  it('keeps beamed notes of mixed lengths: broken second beams, hooks and a dotted note', async () => {
    await sameAfterPdf(
      melodyOf('Beams', [
        m(1, ['C4:0.25:a', 'D4:0.25:b', 'E4:0.5:c', 'F4:0.5:d', 'G4:0.25:e', 'A4:0.25:f']),
        m(2, ['C4:0.75:g', 'D4:0.25:h', 'E4:0.25:i', 'F4:0.75:j', 'G4:2:k'], { barline: 'final' }),
      ])
    )
  })

  it('keeps the key signature and the accidentals it makes', async () => {
    await sameAfterPdf(
      melodyOf('Sharps', [
        m(1, ['F#4:1:one', 'G#4:1:two', 'A4:1:three', 'B4:1:four'], {
          fifths: 2,
          chords: [
            [0, 'D'],
            [2, 'A/C#'],
          ],
        }),
        m(2, ['C#5:2:five', 'B4:1:six', 'A4:1:seven'], { fifths: 2, barline: 'final' }),
      ])
    )
    await sameAfterPdf(
      melodyOf('Flats', [
        m(1, ['Bb4:1:a', 'Ab4:1:b', 'G4:1:c', 'F4:1:d'], {
          fifths: -3,
          chords: [
            [0, 'Eb'],
            [2, 'Bb7'],
          ],
        }),
        m(2, ['Eb4:4:long'], { fifths: -3, barline: 'final' }),
      ])
    )
  })

  it('keeps a triplet, its bracket and its number', async () => {
    await sameAfterPdf(
      melodyOf('Triplet', [
        m(1, ['C4:0.5:a', 'D4:0.5:b', 'E4:0.5:c', 'F4:1:d', 'G4:2:e'], { triplet: [0, 2] }),
        m(2, ['C5:4:end'], { barline: 'final' }),
      ])
    )
  })

  it('keeps a pickup measure', async () => {
    const pickup = { ...m(0, ['G4:1:up']), full: false }
    const { read } = await throughPdf(
      melodyOf('Pickup', [pickup, m(1, ['C5:4:down'], { barline: 'final' })])
    )
    assert.equal(read.measures[0]?.length, 1)
    assert.equal(read.measures[0]?.full, false)
  })

  it('keeps repeats and numbered endings', async () => {
    await sameAfterPdf(
      melodyOf('Repeat', [
        m(1, ['C4:4:one'], { repeatStart: true }),
        m(2, ['D4:4:two'], { barline: 'repeat-end' }),
        m(3, ['E4:4:three'], { barline: 'final' }),
      ])
    )
    await sameAfterPdf(
      melodyOf('Endings', [
        m(1, ['C4:4:one'], { repeatStart: true }),
        m(2, ['D4:4:first'], {
          barline: 'repeat-end',
          ending: { label: '1', start: true, stop: true, closed: true },
        }),
        m(3, ['E4:4:second'], {
          barline: 'final',
          ending: { label: '2', start: true, stop: true, closed: false },
        }),
      ])
    )
  })

  it('keeps a section whose name sits high over its first staff, over an ending, a sign and a chord', async () => {
    // (on SongSelect's sheets an INTRO over the tempo, or a section over an ending's bracket, was read
    // as a credit, or lost)
    await sameAfterPdf(
      melodyOf('High', [
        m(1, ['C4:4:one'], {
          section: 'INTRO',
          chords: [[0, 'G']],
          directions: [{ kind: 'segno' }],
          barline: 'repeat-end',
          ending: { label: '1', start: true, stop: true, closed: true },
        }),
        m(2, ['D4:4:two'], {
          barline: 'final',
          ending: { label: '2', start: true, stop: true, closed: false },
        }),
      ])
    )
  })

  it('keeps the segno, coda, To Coda and D.S. al Coda', async () => {
    await sameAfterPdf(
      melodyOf('Signs', [
        m(1, ['C4:4:a'], { directions: [{ kind: 'segno' }] }),
        m(2, ['D4:4:b'], { directions: [{ kind: 'to-coda', text: 'To Coda' }] }),
        m(3, ['E4:4:c'], {
          directions: [{ kind: 'da-segno', al: 'coda', text: 'D.S. al Coda' }],
          barline: 'double',
        }),
        m(4, ['F4:4:d'], { directions: [{ kind: 'coda' }], barline: 'final' }),
      ])
    )
  })

  it('reads a sheet of several pages as one melody', async () => {
    // (Verovio engraves a tall single page: two engravings are two pages of the one sheet)
    const measures = Array.from({ length: 24 }, (_, i) =>
      m(i + 1, ['C4:1:Ho-', 'D4:1:ly', 'E4:1:is', 'F4:1:He'])
    )
    const rest = Array.from({ length: 24 }, (_, i) =>
      m(i + 25, ['G4:2:a', 'E4:2:b'], i === 23 ? { barline: 'final' } : {})
    )
    const pages = [measures, rest].flatMap(part => part)
    assert.equal(pages.length, 48)
    const engrave = async (part: typeof measures) => {
      const out = await renderScoreHere(writeMusicXml(melodyOf('Long', part)))
      assert.ok(out)
      return out.pages
    }
    const tally = stats()
    const read = await readScorePdf(
      svgToPdf([...(await engrave(measures)), ...(await engrave(rest))]),
      tally
    )
    assert.deepEqual(tally.warnings, [])
    assert.ok(read)
    assert.deepEqual(shown(read), shown(melodyOf('Long', pages)))
  })

  it('has no melody in a file that is no PDF, and none in a PDF with no music', async () => {
    assert.equal(
      await readScorePdf(new TextEncoder().encode('not a pdf').buffer as ArrayBuffer),
      null
    )
    assert.equal(
      await readScorePdf(
        svgToPdf([
          '<svg viewBox="0 0 100 100"><text x="10" y="50" font-size="10px">hello</text></svg>',
        ])
      ),
      null
    )
  })
})
