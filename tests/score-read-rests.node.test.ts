/** Rests and notes in a lead sheet's SVG (src/js/score-read.ts): the chords over them, and the ones it cannot read */
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

describe('rests in a lead sheet SVG', () => {
  it('puts two chords over one whole rest on different beats, by how far along the measure each is', () => {
    const chord = (text: string, x: number) =>
      `<g class="harm"><text x="${x}" y="3000"><tspan class="text"><tspan x="${x}" y="3000">${text}</tspan></tspan></text></g>`
    const rest =
      '<g class="mRest"><use xlink:href="#E4E3-x" transform="translate(2000, 3777) scale(0.72, 0.72)" /></g>'
    const read = (chords: string) =>
      readScoreSvg([sheet(rest).replace('</g></g></svg>', `${chords}</g></g></svg>`)]).measures[0]
        ?.chords
    // "Am" at the start of the room and "F" halfway to the barline: the third beat
    assert.deepEqual(read(chord('Am', 500) + chord('F', 2250)), [
      { start: 0, text: 'Am' },
      { start: 2, text: 'F' },
    ])
    // (a chord a little way along stays on its beat, to the nearest half beat)
    assert.equal(read(chord('Am', 500) + chord('F', 1400))?.[1]?.start, 1)
    // (and with nothing under them at all, they are all at the start)
    const bare = readScoreSvg([
      sheet('').replace('</g></g></svg>', `${chord('Am', 500)}${chord('F', 2250)}</g></g></svg>`),
    ]).measures[0]?.chords
    assert.deepEqual(
      bare?.map(c => c.start),
      [0, 0]
    )
    // chords that are not apart are on the same beat, as before
    assert.deepEqual(read(chord('Am', 500) + chord('F', 540)), [
      { start: 0, text: 'Am' },
      { start: 0, text: 'F' },
    ])
  })

  it('says so, and goes on, for a rest with no glyph or one it does not know', () => {
    const stats = { warnings: [] as string[] } as NonNullable<Parameters<typeof readScoreSvg>[1]>
    const rest = (id: string, glyph: string) => `<g id="${id}" class="rest">${glyph}</g>`
    const use = (code: string) =>
      `<use xlink:href="#${code}-x" transform="translate(2000, 3777) scale(0.72, 0.72)" />`
    readScoreSvg([sheet(rest('a', '') + rest('b', use('E4FF')))], stats)
    assert.deepEqual(stats.warnings, [
      'measure 1: rest a has no glyph',
      'measure 1: rest glyph E4FF',
    ])
  })
})

describe('notes in a lead sheet SVG', () => {
  it('says so, and goes on, for a note with no head or one whose head glyph it does not know', () => {
    const stats = { warnings: [] as string[] } as NonNullable<Parameters<typeof readScoreSvg>[1]>
    const use = (code: string) =>
      `<use xlink:href="#${code}-x" transform="translate(2000, 3777) scale(0.72, 0.72)" />`
    const note = (id: string, head: string) =>
      `<g id="${id}" class="note">${head}<g class="stem"><path d="M2100 3777 L2100 3400" /></g></g>`
    readScoreSvg(
      [sheet(note('a', '') + note('b', `<g class="notehead">${use('E0FF')}</g>`))],
      stats
    )
    assert.deepEqual(stats.warnings, [
      'measure 1: note a has no head',
      'measure 1: head glyph E0FF',
    ])
  })

  it('reads a plain note: no accidental, no key signature and no id, so it is natural and unnamed', () => {
    const head =
      '<g class="notehead"><use xlink:href="#E0A4-x" transform="translate(2000, 3777) scale(0.72, 0.72)" /></g>'
    const score = readScoreSvg([sheet(`<g class="note">${head}</g>`)])
    const [event] = score.measures[0]?.voices[0] ?? []
    assert.equal(event?.kind, 'note')
    assert.equal((event as { id: string }).id, '')
    assert.equal((event as { alter: number }).alter, 0)
  })
})
