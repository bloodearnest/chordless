import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readMelodySvg } from '../scripts/melody-xml.ts'
import type { Melody, MelodyEvent, MelodyNote } from '../src/js/melody.ts'
import { midiOf } from '../src/js/melody.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { absolutePath, shapeHash } from '../src/js/melody-path.ts'
import { type Glyph, type Line, type Staff, signsOf } from '../src/js/melody-pdf.ts'
import { fifthsOfKey, melodyRange, transposeMelody } from '../src/js/melody-transpose.ts'

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
          { start: 1, text: 'X"><evil/>' },
          { start: 2, text: 'F#m7' },
        ],
        section: 'VERSE 1',
        barline: 'single' as const,
        repeatStart: false,
        ending: null,
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
    // a chord's text is in an attribute: a quote in it cannot end the attribute
    assert.ok(!xml.includes('<evil/>'))
    assert.match(xml, /text="X&quot;&gt;&lt;evil\/&gt;"/)
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
    const melody = readMelodySvg([svg])
    assert.equal(melody.measures[0]?.length, 4)
    assert.equal(melody.measures[0]?.full, true)
    // a cue head a bar further along is not beside anything: it stays a place of its own
    const far = svg.replace(/data-x="1830"/, 'data-x="2400"')
    assert.notEqual(readMelodySvg([far]).measures[0]?.length, 4)
  })
})

describe('transposing a melody', () => {
  const note = (step: MelodyNote['step'], octave: number, alter = 0, cue = false): MelodyNote => ({
    kind: 'note',
    id: `${step}${octave}`,
    step,
    alter,
    octave,
    midi: midiOf(step, alter, octave),
    start: 0,
    duration: 1,
    tupletRatio: 1,
    tieStart: false,
    tieStop: false,
    cue,
    syllables: [],
    withPrevious: false,
  })
  const tune = (notes: MelodyNote[], chord = 'G'): Melody => ({
    title: null,
    notice: [],
    measures: [
      {
        number: 1,
        voices: [notes],
        chords: [{ start: 0, text: chord }],
        section: null,
        barline: 'single',
        repeatStart: false,
        ending: null,
        length: 4,
        full: true,
        fifths: 1,
        beats: 4,
        beatType: 4,
        tempo: null,
      },
    ],
  })

  it('moves the notes, respells them, and gives the key signature and chords of the new key', () => {
    // G major, D4 to B4, up a fourth to C: G4 to E5, already in the green
    const out = transposeMelody(tune([note('D', 4), note('B', 4)]), 'G', 'C')
    const events = out.measures[0].voices[0] as MelodyNote[]
    assert.deepEqual(
      events.map(n => [n.step, n.alter, n.octave]),
      [
        ['G', 0, 4],
        ['E', 0, 5],
      ]
    )
    assert.equal(out.measures[0].fifths, 0)
    assert.equal(out.measures[0].chords[0].text, 'C')
  })

  it('spells for the key: flats in a flat key, sharps in a sharp one', () => {
    const flat = transposeMelody(tune([note('G', 4), note('A', 4)]), 'G', 'Bb')
    assert.deepEqual(
      (flat.measures[0].voices[0] as MelodyNote[]).map(n => [n.step, n.alter]),
      [
        ['B', -1],
        ['C', 0],
      ]
    )
    assert.equal(flat.measures[0].fifths, -2)
    const sharp = transposeMelody(tune([note('G', 4), note('A', 4)]), 'G', 'E')
    assert.deepEqual(
      (sharp.measures[0].voices[0] as MelodyNote[]).map(n => [n.step, n.alter]),
      [
        ['E', 0],
        ['F', 1],
      ]
    )
    assert.equal(sharp.measures[0].fifths, 4)
  })

  it('takes the octave nearest the green range, not the nearest interval', () => {
    // C3 to G3 in C, to D: the nearest way is up two (D3 to A3, red); up fourteen is D4 to A4
    const low = transposeMelody(tune([note('C', 3), note('G', 3)], 'C'), 'C', 'D')
    assert.deepEqual(
      (low.measures[0].voices[0] as MelodyNote[]).map(n => n.midi),
      [62, 69]
    )
    // and a high tune comes down: C6 to G6 in C, to D, is down twenty-two, not up two
    const high = transposeMelody(tune([note('C', 6), note('G', 6)], 'C'), 'C', 'D')
    assert.deepEqual(
      (high.measures[0].voices[0] as MelodyNote[]).map(n => n.midi),
      [62, 69]
    )
  })

  it('leaves cue notes out of the range, and the melody alone for a key it cannot read', () => {
    const t = tune([note('C', 4), note('C', 2, 0, true)])
    assert.deepEqual(melodyRange(t), { low: 60, high: 60 })
    assert.equal(transposeMelody(t, 'C', 'H'), t)
    assert.equal(fifthsOfKey('Em'), 1)
    assert.equal(fifthsOfKey('F#'), 6)
    assert.equal(fifthsOfKey('F♯'), 6)
    assert.equal(fifthsOfKey('B♭m'), -5)
  })

  it('keeps rests, takes a melody with no sung note as it is, and moves a minor key', () => {
    const rest: MelodyEvent = {
      kind: 'rest',
      id: 'r',
      start: 1,
      duration: 1,
      tupletRatio: 1,
      wholeMeasure: false,
      cue: false,
    }
    const t = tune([note('E', 4)], 'Em')
    t.measures[0].voices[0].push(rest)
    const out = transposeMelody(t, 'Em', 'Am')
    assert.equal(out.measures[0].voices[0][1], rest)
    assert.equal(out.measures[0].fifths, 0)
    assert.equal(out.measures[0].chords[0].text, 'Am')
    const cueOnly = tune([note('E', 2, 0, true)], 'Em')
    assert.equal(melodyRange(cueOnly), null)
    assert.equal(transposeMelody(cueOnly, 'Em', 'Gm').measures[0].fifths, -2)
  })
})

describe('repeat signs and endings on a page', () => {
  const staff = (x0: number, x1: number, top: number, sys = 0): Staff & { sys: number } => ({
    x0,
    x1,
    ys: [0, 1, 2, 3, 4].map(i => top + i * 180),
    sys,
  })
  const bar = (x: number, top: number, width = 27): Line => ({
    x1: x,
    y1: top,
    x2: x,
    y2: top + 720,
    width,
  })
  const dots = (x: number, top: number): Glyph[] =>
    [top + 270, top + 450].map(y => ({ code: 'E1E7', x, y, scale: 1, used: false }))
  const unit = { a: 1, e: 0, f: 0 }
  const run = (text: string, x: number, y: number) => ({
    text,
    x0: x,
    x1: x + 100,
    y,
    size: 10,
    bold: false,
    italic: false,
  })

  it('reads dots before a thick line as the end of a repeat, and a double or final bar', () => {
    const [a, b, c] = [staff(0, 4000, 1000), staff(4000, 8000, 1000), staff(8000, 12000, 1000)]
    const lines = [
      bar(3800, 1000), // thin
      bar(3900, 1000, 90), // thick: dots before it
      bar(7928, 1000),
      bar(8000, 1000), // two thin ones
      bar(11900, 1000),
      bar(12000, 1000, 90), // thin then thick, no dots: final
    ]
    const signs = signsOf([a, b, c], lines, dots(3600, 1000), [], unit)
    assert.equal(signs.get(a)?.bar, 'repeat-end')
    assert.equal(signs.get(b)?.bar, 'double')
    assert.equal(signs.get(c)?.bar, 'final')
    assert.equal(signs.get(a)?.repeatStart, false)
  })

  it('reads dots after a thick line as the start of a repeat, on the next system when at the end of one', () => {
    const [a, b] = [staff(0, 4000, 1000, 0), staff(0, 4000, 3000, 1)]
    // |: in the middle of a measure's left edge, and one drawn at the end of the first system
    const lines = [bar(3700, 1000, 90), bar(3800, 1000), bar(4000, 1000)]
    const signs = signsOf([a, b], lines, dots(3860, 1000), [], unit)
    assert.equal(signs.get(a)?.repeatStart, false)
    assert.equal(signs.get(b)?.repeatStart, true)
    assert.equal(signs.get(a)?.bar, 'single')
    const left = signsOf([b], [bar(300, 3000, 90), bar(400, 3000)], dots(460, 3000), [], unit)
    assert.equal(left.get(b)?.repeatStart, true)
  })

  it('reads a numbered ending: a line over the measures, a hook down at its left and right ends', () => {
    const [a, b, c] = [staff(0, 4000, 3000), staff(4000, 8000, 3000), staff(8000, 12000, 3000)]
    const line = (x1: number, x2: number): Line => ({ x1, y1: 2000, x2, y2: 2000, width: 13 })
    const hook = (x: number): Line => ({ x1: x, y1: 2000, x2: x, y2: 2328, width: 13 })
    const lines = [
      line(4000, 7900),
      hook(4000),
      hook(7900), // closed: "1"
      line(8000, 12000),
      hook(8000), // open: "2,3"
    ]
    const runs = [run('1', 4073, 2328), run('2, 3', 8073, 2328), run('7', 100, 2328)]
    const signs = signsOf([a, b, c], lines, [], runs, unit)
    assert.equal(signs.get(a)?.ending, null)
    assert.deepEqual(signs.get(b)?.ending, { label: '1', start: true, stop: true, closed: true })
    assert.deepEqual(signs.get(c)?.ending, {
      label: '2,3',
      start: true,
      stop: true,
      closed: false,
    })
  })

  it('writes repeats and endings as MusicXML barlines', () => {
    const measure = (over: object) => ({
      number: 1,
      voices: [[]],
      chords: [],
      section: null,
      barline: 'single' as const,
      repeatStart: false,
      ending: null,
      length: 4,
      full: true,
      fifths: 0,
      beats: 4,
      beatType: 4,
      tempo: null,
      ...over,
    })
    const xml = writeMusicXml({
      title: null,
      notice: [],
      measures: [
        measure({ repeatStart: true }),
        measure({
          barline: 'repeat-end',
          ending: { label: '1', start: true, stop: true, closed: true },
        }),
        measure({
          barline: 'final',
          ending: { label: '2,3', start: true, stop: true, closed: false },
        }),
        measure({ barline: 'double' }),
      ],
    })
    assert.match(
      xml,
      /<barline location="left"><bar-style>heavy-light<\/bar-style><repeat direction="forward"\/>/
    )
    assert.match(xml, /<ending number="1" type="start">1\.<\/ending><\/barline>/)
    assert.match(xml, /<ending number="1" type="stop"\/><repeat direction="backward"\/>/)
    assert.match(xml, /<ending number="2, 3" type="discontinue"\/>/)
    assert.match(xml, /<bar-style>light-light<\/bar-style>/)
  })
})
