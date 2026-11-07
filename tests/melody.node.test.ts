import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readMelodySvg } from '../scripts/melody-xml.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { absolutePath, shapeHash } from '../src/js/melody-path.ts'

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
    const stats = { warnings: [] as string[] } as Parameters<typeof readMelodySvg>[1]
    const melody = readMelodySvg(
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
    const melody = readMelodySvg([sheet(`${quarter('a', 0)}${quarter('b', 1)}${quarter('c', 2)}`)])
    assert.equal(melody.measures[0]?.full, false)
    assert.equal(melody.measures[0]?.length, 3)
  })

  it('applies the key signature, so a flat on the B line makes a B flat', () => {
    const key =
      '<g class="keySig"><g class="keyAccid"><use xlink:href="#E260-x" transform="translate(735, 3597) scale(0.72, 0.72)" /></g></g>'
    const melody = readMelodySvg([
      sheet(`${quarter('a', 4)}${quarter('b', 0)}${quarter('c', 0)}${quarter('d', 0)}`, key),
    ])
    const first = melody.measures[0]?.voices[0]?.[0]
    assert.ok(first?.kind === 'note')
    assert.equal(`${first.step}${first.alter}${first.octave}`, 'B-14')
    assert.equal(melody.measures[0]?.fifths, -1)
  })
})

describe('MusicXML', () => {
  it('writes the notes, their pitch spelling and a key', () => {
    const melody = readMelodySvg([
      sheet(`${quarter('a', 0)}${quarter('b', 1)}${quarter('c', 2)}${quarter('d', 3)}`),
    ])
    const xml = writeMusicXml(melody)
    assert.match(xml, /<score-partwise version="4.0">/)
    assert.equal((xml.match(/<note>/g) ?? []).length, 4)
    assert.match(xml, /<step>E<\/step><octave>4<\/octave>/)
    assert.match(xml, /<beats>4<\/beats><beat-type>4<\/beat-type>/)
  })
})

describe('shape names', () => {
  it('finds the same shape written with relative or absolute commands, with or without the closing line', () => {
    const a = absolutePath('M0 -39c0 68 73 172 200 172l-8 3z')
    const b = absolutePath('M0 -39C0 29 73 133 200 133L192 136 0 -39Z')
    assert.equal(shapeHash(a.key), shapeHash(b.key))
  })
})
