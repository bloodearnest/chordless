import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Score } from '../src/js/score.ts'
import { writeMusicXml, writeSectionsMusicXml } from '../src/js/score-musicxml.ts'
import { balanceLines, renderScoreHere, withoutStyle } from '../src/js/score-render-engine.ts'
import { withTextAccidentals } from '../src/js/score-svg-text.ts'
import { measure } from './score-build.ts'

const melody: Score = {
  title: 'A Song',
  notice: [],
  measures: [
    measure(1, ['C4:1:Ho-', 'D4:1:ly', 'E4:1:is', 'F4:1:He'], {
      chords: [[0, 'C']],
      section: 'VERSE',
      barline: 'final',
    }),
  ],
}

describe('engraving a melody with Verovio', () => {
  it('turns our MusicXML into SVG with the staff, the notes and the words', async () => {
    const out = await renderScoreHere(writeMusicXml(melody))
    assert.ok(out)
    assert.equal(out.pages.length, 1)
    const svg = out.pages[0] as string
    assert.match(svg, /^<svg /)
    assert.equal((svg.match(/class="notehead"/g) ?? []).length, 4)
    assert.equal((svg.match(/class="syl"/g) ?? []).length, 4)
  })

  it('leaves no <style> element in the pages, which the page’s policy would not allow', async () => {
    const out = await renderScoreHere(writeMusicXml(melody))
    assert.ok(out)
    for (const page of out.pages) assert.doesNotMatch(page, /<style/i)
  })

  it('takes every <style> element out, including one made by taking another out', () => {
    assert.equal(
      withoutStyle('<svg><style>a{}</style><g/><style>b{}</style></svg>'),
      '<svg><g/></svg>'
    )
    assert.equal(withoutStyle('<svg><sty<style>x</style>le>y</style></svg>'), '<svg></svg>')
    assert.equal(withoutStyle('<svg><g/></svg>'), '<svg><g/></svg>')
  })

  it('keeps a section that starts a line on the page, with no wide margin kept for it', async () => {
    // (on a phone's narrow page the lines break every few bars, so sections start lines)
    const measures = Array.from({ length: 12 }, (_, i) =>
      measure(i + 1, ['G4:1:la', 'A4:1:la', 'B4:1:la', 'D5:1:la'], {
        chords: [[0, 'G']],
        ...(i % 3 === 0 ? { section: 'PRE-CHORUS' } : {}),
      })
    )
    const out = await renderScoreHere(writeMusicXml({ ...melody, measures }), { pageWidth: 1200 })
    assert.ok(out)
    const svg = out.pages.join('')
    const boxes = [...svg.matchAll(/class="reh"[^>]*>\s*<rect [^>]*\bx="(-?\d+)"/g)]
    assert.equal(boxes.length, 4)
    for (const [, x] of boxes)
      assert.ok(Number(x) >= 0, `a section's box starts at ${x}, off the page`)
  })

  it('starts every section on a line of its own when given the sections, sharing out their measures', async () => {
    // (seven measures a section: on a phone's page Verovio would run each into the next, mid-line)
    const measures = Array.from({ length: 21 }, (_, i) =>
      measure(i + 1, ['G4:1:la', 'A4:1:la', 'B4:1:la', 'D5:1:la'], {
        chords: [[0, 'G']],
        ...(i % 7 === 0 ? { section: `PART ${i / 7 + 1}` } : {}),
      })
    )
    const score = { ...melody, measures }
    const lines = async (sections?: string[]) => {
      const out = await renderScoreHere(writeMusicXml(score), { pageWidth: 1200, sections })
      assert.ok(out)
      return out.pages
        .join('')
        .split('class="system"')
        .slice(1)
        .map(line => line.split('class="measure"').slice(1))
    }
    const startsALine = (all: string[][]) =>
      all.flatMap(line => line.filter(m => m.includes('class="reh"')).map(m => line[0] === m))
    assert.ok(startsALine(await lines()).includes(false), 'without them, a section starts mid-line')
    const laidOut = await lines(writeSectionsMusicXml(score))
    assert.deepEqual(startsALine(laidOut), [true, true, true])
    // (seven measures over three lines, three, two and two: not three, three and one)
    assert.deepEqual(
      laidOut.map(line => line.length),
      [3, 2, 2, 3, 2, 2, 3, 2, 2]
    )
  })

  it('shares measures out over the lines, so a last line is not left with one', () => {
    assert.deepEqual(balanceLines([3, 1]), [2, 2])
    assert.deepEqual(balanceLines([4, 4, 1]), [4, 3, 2])
    assert.deepEqual(balanceLines([4, 3]), [4, 3])
    assert.deepEqual(balanceLines([1, 3]), [1, 3])
    assert.deepEqual(balanceLines([5]), [5])
    assert.deepEqual(balanceLines([]), [])
  })

  it('lays the sheet out as Verovio would when a section cannot be read', async () => {
    const out = await renderScoreHere(writeMusicXml(melody), {
      sections: ['not music', 'nor this'],
    })
    assert.ok(out)
    assert.equal((out.pages[0]?.match(/class="notehead"/g) ?? []).length, 4)
  })

  it('says null for what is not MusicXML', async () => {
    assert.equal(await renderScoreHere('this is not music'), null)
  })

  it('writes the flats and sharps of chord symbols as text, in the size of the chord, not as a glyph of a font the page lacks', () => {
    const text =
      '<tspan font-size="405px" x="1" y="2">B</tspan>\n<tspan font-family="Leipzig" font-size="720px">\uEA64</tspan>\n<tspan font-size="405px">m7</tspan>'
    assert.equal(
      withTextAccidentals(text, true),
      '<tspan font-size="405px" x="1" y="2">B</tspan>\n<tspan font-size="405px">♭</tspan>\n<tspan font-size="405px">m7</tspan>'
    )
    assert.match(
      withTextAccidentals('<tspan font-family="Leipzig">\uEA63</tspan>', true),
      /♯<\/tspan>/
    )
  })

  it('writes them as the letters b and # of the chart when the signs are not asked for, so the chord stays compact', () => {
    const text =
      '<tspan font-size="405px" x="1" y="2">B</tspan>\n<tspan font-family="Leipzig" font-size="720px">\uEA64</tspan>\n<tspan font-size="405px">m7</tspan>'
    assert.equal(
      withTextAccidentals(text),
      '<tspan font-size="405px" x="1" y="2">B</tspan>\n<tspan font-size="405px">b</tspan>\n<tspan font-size="405px">m7</tspan>'
    )
    assert.match(withTextAccidentals('<tspan font-family="Leipzig">\uEA63</tspan>'), />#<\/tspan>/)
    assert.match(withTextAccidentals('<tspan font-family="Leipzig">\uEA65</tspan>'), />♮<\/tspan>/)
  })

  it('has no Leipzig character left in a chord symbol of a melody with flat chords', async () => {
    const flat = {
      ...melody,
      measures: melody.measures.map(m => ({ ...m, chords: [{ start: 0, text: 'Bbm7/Db' }] })),
    }
    const out = await renderScoreHere(writeMusicXml(flat))
    assert.ok(out)
    const shown = out.pages.map(page => withTextAccidentals(page, true)).join('')
    assert.doesNotMatch(shown, /font-family="Leipzig"[^>]*>[\uEA63-\uEA65]/)
    assert.match(shown, /♭/)
  })
})
