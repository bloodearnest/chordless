import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Score } from '../src/js/score.ts'
import { writeMusicXml, writeSectionsMusicXml } from '../src/js/score-musicxml.ts'
import { balanceLines, renderScoreHere, withoutStyle } from '../src/js/score-render-engine.ts'
import {
  realBookQuality,
  withRealBookChords,
  withTextAccidentals,
} from '../src/js/score-svg-text.ts'
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
    assert.doesNotMatch(shown, /font-family="Leipzig"[^>]*>[\uEA63-\uEA66]/)
    assert.match(shown, /♭/)
  })
})

describe('the Real Book style', () => {
  it('engraves with the handwritten music font when asked, and with Leipzig otherwise', async () => {
    const plain = await renderScoreHere(writeMusicXml(melody))
    const hand = await renderScoreHere(writeMusicXml(melody), { font: 'Petaluma' })
    assert.ok(plain && hand)
    assert.notEqual(hand.pages[0], plain.pages[0])
    assert.equal(hand.log, '')
  })

  it('draws the lines and the stems heavier in the Real Book style, and no heavier again after it', async () => {
    const strokes = (svg: string) =>
      [...svg.matchAll(/stroke-width="(\d+)"/g)].map(m => Number(m[1]))
    const before = await renderScoreHere(writeMusicXml(melody))
    const hand = await renderScoreHere(writeMusicXml(melody), { font: 'Petaluma' })
    const after = await renderScoreHere(writeMusicXml(melody))
    assert.ok(before && hand && after)
    assert.ok(
      Math.min(...strokes(hand.pages[0] as string)) >
        Math.min(...strokes(before.pages[0] as string))
    )
    // (the toolkit is kept between sheets: what one sets must not stay for the next. The weights are
    // compared, not the SVG, which has new ids in its element names each time)
    assert.deepEqual(strokes(after.pages[0] as string), strokes(before.pages[0] as string))
  })

  it('writes the quality of a chord as a Real Book does', () => {
    const cases: Record<string, string> = {
      // (these vary from chart to chart, so they are as the chart has them)
      maj7: 'maj7',
      M7: 'M7',
      maj: 'maj',
      M: 'M',
      m: '-',
      m7: '-7',
      min7: '-7',
      m9: '-9',
      m7b5: 'ø7',
      dim: '°',
      dim7: '°7',
      aug: '+',
      sus4: 'sus4',
      '7': '7',
      add9: 'add9',
      '': '',
    }
    for (const [quality, written] of Object.entries(cases)) {
      assert.equal(realBookQuality(quality), written, quality)
    }
  })

  it('raises the extension of a chord and brings a bass note back to the line', () => {
    const run = (text: string, attrs = '') =>
      withRealBookChords(
        `<g class="harm"><tspan class="text"><tspan font-size="400px"${attrs}>${text}</tspan></tspan></g>`
      )
        .replace(/^.*?<tspan font-size/, '<tspan font-size')
        .replace(/<\/tspan><\/g>$/, '')
    // the root and the minor sign on the line, the 7 smaller and above it
    assert.equal(
      run('Am7', ' x="1" y="2"'),
      '<tspan font-size="400px" x="1" y="2">A-</tspan><tspan font-size="280px" dy="-120">7</tspan>'
    )
    // a bass note on the line again, as far down as the extension went up
    assert.equal(
      run('C7/E'),
      '<tspan font-size="400px">C</tspan><tspan font-size="280px" dy="-120">7</tspan><tspan font-size="400px" dy="120">/E</tspan>'
    )
    // (a bass note with no extension is not moved down, as nothing was moved up)
    assert.equal(
      run('C/E'),
      '<tspan font-size="400px">C</tspan><tspan font-size="400px">/E</tspan>'
    )
    // a chord with no extension has one run, a run after a flat has no root, and a flat is not raised
    assert.equal(run('G'), '<tspan font-size="400px">G</tspan>')
    assert.equal(run('b'), '<tspan font-size="400px">b</tspan>')
    assert.equal(run('sus4'), '<tspan font-size="280px" dy="-120">sus4</tspan>')
  })

  it('changes the chord symbols of a sheet and nothing else', async () => {
    const chords = ['Bbmaj7', 'Am7', 'F#m7b5', 'Cdim', 'G']
    const m: Score = {
      title: 'T',
      notice: [],
      measures: [
        measure(1, ['C4:1:a', 'D4:1:b', 'E4:1:c', 'F4:1:d', 'G4:1:e'], {
          chords: chords.map((c, i) => [i, c]) as [number, string][],
          barline: 'final',
        }),
      ],
    }
    const out = await renderScoreHere(writeMusicXml(m), { font: 'Petaluma' })
    assert.ok(out)
    const page = withRealBookChords(withTextAccidentals(out.pages[0] as string))
    const text = [...page.matchAll(/class="harm"[\s\S]*?<\/g>/g)].map(g =>
      [...g[0].matchAll(/<tspan font-size="\d+px"[^>]*>([^<]*)<\/tspan>/g)].map(t => t[1]).join('')
    )
    assert.equal(withRealBookChords(page, false), page)
    assert.deepEqual(text, ['Bbmaj7', 'A-7', 'F#ø7', 'C°', 'G'])
  })
})
