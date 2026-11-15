/** Reading the tree of a lead sheet as Verovio engraves it (src/js/score-read.ts), from an SVG drawn the same way */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readScoreSvg } from '../scripts/melody-xml.ts'

/** One measure of 4/4 in the shape Verovio writes, drawn with the glyphs named, as a lead sheet's SVG is */
function sheet(notes: string, key = ''): string {
  const lines = [3237, 3417, 3597, 3777, 3957].map(y => `<path d="M0 ${y} L4000 ${y}" />`).join('')
  const clef =
    '<g class="clef"><use xlink:href="#E050-x" transform="translate(90, 3777) scale(0.72, 0.72)" /></g>'
  const meter =
    '<g class="meterSig"><use xlink:href="#E084-x" transform="translate(1223, 3417) scale(0.72, 0.72)" />' +
    '<use xlink:href="#E084-x" transform="translate(1223, 3777) scale(0.72, 0.72)" /></g>'
  return (
    `<svg><g class="system"><g class="measure"><g class="staff">${lines}${clef}${key}${meter}` +
    `<g class="layer">${notes}</g></g></g></g></svg>`
  )
}

/** A quarter note at a height above the bottom staff line, in half spaces (0 is E4) */
const quarter = (id: string, step: number, extra = '') =>
  `<g id="${id}" class="note"><g class="notehead"><use xlink:href="#E0A4-x" transform="translate(${1500 + step * 100}, ${3957 - step * 90}) scale(0.72, 0.72)" /></g>${extra}</g>`

describe('reading a lead sheet SVG', () => {
  it('reads pitch from the staff and length from the glyphs, and checks the measure adds up', () => {
    const stats = { warnings: [] as string[] } as Parameters<typeof readScoreSvg>[1]
    const melody = readScoreSvg(
      [sheet(`${quarter('a', 0)}${quarter('b', 1)}${quarter('c', 2)}${quarter('d', 3)}`)],
      stats
    )
    const notes = (melody.measures[0]?.voices[0] ?? []).flatMap(e => (e.kind === 'note' ? [e] : []))
    assert.deepEqual(
      notes.map(n => `${n.step}${n.octave}`),
      ['E4', 'F4', 'G4', 'A4']
    )
    assert.deepEqual(
      notes.map(n => n.duration),
      [1, 1, 1, 1]
    )
    assert.equal(melody.measures[0]?.full, true)
    assert.equal(melody.measures[0]?.beats, 4)
  })

  it('flags a measure that does not add up', () => {
    const melody = readScoreSvg([sheet(`${quarter('a', 0)}${quarter('b', 1)}${quarter('c', 2)}`)])
    assert.equal(melody.measures[0]?.full, false)
    assert.equal(melody.measures[0]?.length, 3)
  })

  it('applies the key signature, so a flat on the B line makes a B flat', () => {
    const key =
      '<g class="keySig"><g class="keyAccid"><use xlink:href="#E260-x" transform="translate(735, 3597) scale(0.72, 0.72)" /></g></g>'
    const melody = readScoreSvg([
      sheet(`${quarter('a', 4)}${quarter('b', 0)}${quarter('c', 0)}${quarter('d', 0)}`, key),
    ])
    const first = melody.measures[0]?.voices[0]?.[0]
    assert.ok(first?.kind === 'note')
    assert.equal(`${first.step}${first.alter}${first.octave}`, 'B-14')
    assert.equal(melody.measures[0]?.fifths, -1)
  })
})

describe('lining up a cue line with the sung one', () => {
  it('puts a cue head drawn a head aside to clear a second in the same place as the sung one', () => {
    // sung quarters, and cue quarters a second below each, drawn 330 to the right: one bar of four, not eight
    const head = (id: string, x: number, step: number, scale: number, drawnAt: number) =>
      `<g id="${id}" class="note" data-x="${drawnAt}"><g class="notehead"><use xlink:href="#E0A4-x" transform="translate(${x}, ${3957 - step * 90}) scale(${scale}, ${scale})" /></g></g>`
    const sung = [0, 1, 2, 3].map(i => head(`s${i}`, 1500 + i * 700, 4 + i, 0.72, 1500 + i * 700))
    const cue = [0, 1, 2, 3].map(i => head(`c${i}`, 1830 + i * 700, 3 + i, 0.5, 1830 + i * 700))
    const svg = sheet('').replace(
      '<g class="layer"></g>',
      `<g class="layer">${sung.join('')}</g><g class="layer">${cue.join('')}</g>`
    )
    const melody = readScoreSvg([svg])
    assert.equal(melody.measures[0]?.length, 4)
    assert.equal(melody.measures[0]?.full, true)
    // a cue head a bar further along is not beside anything: it stays a place of its own
    const far = svg.replace(/data-x="1830"/, 'data-x="2400"')
    assert.notEqual(readScoreSvg([far]).measures[0]?.length, 4)
  })
})
