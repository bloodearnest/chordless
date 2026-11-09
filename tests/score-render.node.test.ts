import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Score } from '../src/js/score.ts'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { renderScoreHere, withoutStyle } from '../src/js/score-render-engine.ts'
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

  it('says null for what is not MusicXML', async () => {
    assert.equal(await renderScoreHere('this is not music'), null)
  })

  it('writes the flats and sharps of chord symbols as text, in the size of the chord, not as a glyph of a font the page lacks', () => {
    const text =
      '<tspan font-size="405px" x="1" y="2">B</tspan>\n<tspan font-family="Leipzig" font-size="720px">\uEA64</tspan>\n<tspan font-size="405px">m7</tspan>'
    assert.equal(
      withTextAccidentals(text),
      '<tspan font-size="405px" x="1" y="2">B</tspan>\n<tspan font-size="405px">♭</tspan>\n<tspan font-size="405px">m7</tspan>'
    )
    assert.match(withTextAccidentals('<tspan font-family="Leipzig">\uEA63</tspan>'), /♯<\/tspan>/)
  })

  it('has no Leipzig character left in a chord symbol of a melody with flat chords', async () => {
    const flat = {
      ...melody,
      measures: melody.measures.map(m => ({ ...m, chords: [{ start: 0, text: 'Bbm7/Db' }] })),
    }
    const out = await renderScoreHere(writeMusicXml(flat))
    assert.ok(out)
    const shown = out.pages.map(withTextAccidentals).join('')
    assert.doesNotMatch(shown, /font-family="Leipzig"[^>]*>[\uEA63-\uEA65]/)
    assert.match(shown, /♭/)
  })
})
