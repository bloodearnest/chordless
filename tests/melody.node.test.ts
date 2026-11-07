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

describe('MusicXML of a hand-built melody', () => {
  const note = (over: Record<string, unknown>) => ({
    kind: 'note' as const,
    id: 'n',
    step: 'B' as const,
    alter: -1,
    octave: 4,
    midi: 70,
    start: 0,
    duration: 1,
    tupletRatio: 1,
    tieStart: false,
    tieStop: false,
    cue: false,
    syllables: [] as string[],
    withPrevious: false,
    ...over,
  })
  const melody = {
    title: 'A & B',
    notice: ['CCLI Song # 1'],
    measures: [
      {
        number: 1,
        voices: [
          [
            note({ syllables: ['ho-'], tieStart: true }),
            note({ start: 1, syllables: ['ly_'], tieStop: true }),
            note({ start: 2, duration: 2 / 3, tupletRatio: 2 / 3, step: 'C', alter: 1 }),
            {
              kind: 'rest' as const,
              id: 'r',
              start: 2.67,
              duration: 1.33,
              tupletRatio: 1,
              wholeMeasure: false,
              cue: false,
            },
          ],
        ],
        chords: [
          { start: 0, text: 'Bb/D' },
          { start: 2, text: 'F#m7' },
        ],
        section: 'VERSE 1',
        barline: 'single' as const,
        length: 4,
        full: true,
        fifths: -2,
        beats: 4,
        beatType: 4,
        tempo: 72,
      },
    ],
  }

  it('writes ties, lyrics with their syllabic, a triplet, chords and the section', () => {
    const xml = writeMusicXml(melody)
    assert.match(xml, /<work-title>A &amp; B<\/work-title>/)
    assert.match(xml, /<tie type="start"\/>/)
    assert.match(xml, /<syllabic>begin<\/syllabic><text>ho<\/text>/)
    assert.match(xml, /<syllabic>end<\/syllabic><text>ly<\/text><extend\/>/)
    assert.match(xml, /<actual-notes>3<\/actual-notes><normal-notes>2<\/normal-notes>/)
    assert.match(
      xml,
      /<root-step>B<\/root-step><root-alter>-1<\/root-alter>.*<bass-step>D<\/bass-step>/
    )
    assert.match(xml, /<rehearsal>VERSE 1<\/rehearsal>/)
    assert.match(xml, /<sound tempo="72"\/>/)
    assert.match(xml, /<rights>CCLI Song # 1<\/rights>/)
  })
})

describe('path normalising', () => {
  it('takes smooth curves, horizontals and verticals as absolute curves and lines', () => {
    const smooth = absolutePath('M0 0c10 0 20 10 20 20s10 10 20 0h5v5z')
    assert.match(smooth.key, /^M0,0 C10,0,20,10,20,20 C20,30,30,30,40,20 L45,20 L45,25 Z$/)
    assert.equal(smooth.box.maxX, 45)
  })
})
