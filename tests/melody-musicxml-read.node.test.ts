import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Melody, MelodyEvent, MelodyMeasure, MelodyNote } from '../src/js/melody.ts'
import { midiOf } from '../src/js/melody.ts'
import { writeMusicXml } from '../src/js/melody-musicxml.ts'
import { readMusicXml } from '../src/js/melody-musicxml-read.ts'
import { parseXml } from '../src/js/xml.ts'

describe('the XML reader', () => {
  it('reads elements, attributes, text and entities, and skips what is not content', () => {
    const root = parseXml(
      `<?xml version="1.0"?>
<!DOCTYPE note PUBLIC "-//X//DTD//EN" "http://example.com/x.dtd" [ <!ENTITY e "boom"> ]>
<!-- a comment with a > in it -->
<a x="1 &amp; 2" y='q'><b/><c>fish &amp; chips &#65;&#x42;</c><d><![CDATA[<raw> & text]]></d>&e;</a>`
    )
    assert.equal(root?.name, 'a')
    assert.deepEqual(root?.attrs, { x: '1 & 2', y: 'q' })
    assert.deepEqual(
      root?.children.map(c => c.name),
      ['b', 'c', 'd']
    )
    assert.equal(root?.children[1]?.text, 'fish & chips AB')
    assert.equal(root?.children[2]?.text, '<raw> & text')
    // an entity it does not know, or declared in the file, is left as written, never expanded
    assert.equal(root?.text, '&e;')
  })

  it('says nothing for a document with no element, and leaves a number that is no character', () => {
    assert.equal(parseXml('<?xml version="1.0"?>'), undefined)
    assert.equal(parseXml('<a>&#1114112;</a>')?.text, '&#1114112;')
  })
})

describe('reading MusicXML written by another program', () => {
  const doc = (body: string, header = '') =>
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Hymn</work-title></work>
  <identification><rights>(c) Somebody</rights><encoding><software>MuseScore</software></encoding></identification>
  ${header}
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">${body}</part>
</score-partwise>`

  it('reads the title, the rights, and notes with their pitch, length, lyrics and ties', () => {
    const melody = readMusicXml(
      doc(`
<measure number="1">
  <attributes><divisions>2</divisions><key><fifths>-1</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
  <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice><type>quarter</type><staff>1</staff>
    <lyric number="1"><syllabic>begin</syllabic><text>Hal</text></lyric></note>
  <note><grace/><pitch><step>G</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type></note>
  <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice><type>quarter</type>
    <lyric number="1"><syllabic>end</syllabic><text>le</text><extend/></lyric></note>
  <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
</measure>`)
    )
    assert.ok(melody)
    assert.equal(melody.title, 'Hymn')
    assert.deepEqual(melody.notice, ['(c) Somebody'])
    const m = melody.measures[0] as MelodyMeasure
    assert.deepEqual([m.fifths, m.beats, m.beatType], [-1, 3, 4])
    const notes = m.voices[0] as MelodyNote[]
    // (the grace note has no length and is left out)
    assert.deepEqual(
      notes.map(n => [n.step, n.alter, n.octave, n.start, n.duration, n.tieStart, n.tieStop]),
      [
        ['F', 0, 4, 0, 1, true, false],
        ['F', 0, 4, 1, 1, false, true],
        ['B', -1, 4, 2, 1, false, false],
      ]
    )
    assert.deepEqual(
      notes.map(n => n.syllables),
      [['Hal-'], ['le_'], []]
    )
    assert.equal(notes[2]?.midi, 70)
    assert.equal(m.length, 3)
    assert.equal(m.full, true)
  })

  it('puts a chord on the same start, and two voices apart with <backup>', () => {
    const melody = readMusicXml(
      doc(`
<measure number="1">
  <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
  <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
  <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
  <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
  <backup><duration>4</duration></backup>
  <note><rest/><duration>1</duration><voice>2</voice></note>
  <note><pitch><step>A</step><octave>3</octave></pitch><duration>3</duration><voice>2</voice></note>
</measure>`)
    )
    const [one, two] = ((melody as Melody).measures[0] as MelodyMeasure).voices as [
      MelodyEvent[],
      MelodyEvent[],
    ]
    assert.deepEqual(
      one.map(e => [e.start, e.kind === 'note' && e.withPrevious]),
      [
        [0, false],
        [0, true],
        [2, false],
      ]
    )
    assert.deepEqual(
      two.map(e => [e.kind, e.start, e.duration]),
      [
        ['rest', 0, 1],
        ['note', 1, 3],
      ]
    )
  })

  it('reads chord symbols, a rehearsal mark, a tempo, a repeat and an ending', () => {
    const melody = readMusicXml(
      doc(`
<measure number="1">
  <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
  <direction><direction-type><rehearsal>VERSE</rehearsal></direction-type></direction>
  <direction><direction-type><words/></direction-type><sound tempo="96"/></direction>
  <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>
  <harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind text="m7">minor-seventh</kind><bass><bass-step>D</bass-step></bass></harmony>
  <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note>
</measure>
<measure number="2">
  <barline location="left"><ending number="1, 2" type="start">1.</ending></barline>
  <note><rest measure="yes"/><duration>4</duration></note>
</measure>
<measure number="3">
  <note><rest measure="yes"/><duration>4</duration></note>
  <barline location="right"><bar-style>light-heavy</bar-style><ending number="1, 2" type="stop"/><repeat direction="backward"/></barline>
</measure>
<measure number="4">
  <note><rest measure="yes"/><duration>4</duration></note>
</measure>`)
    )
    const [a, b, c, d] = (melody as Melody).measures as [
      MelodyMeasure,
      MelodyMeasure,
      MelodyMeasure,
      MelodyMeasure,
    ]
    assert.deepEqual([a.section, a.tempo, a.repeatStart], ['VERSE', 96, true])
    assert.deepEqual(a.chords, [{ start: 0, text: 'Bbm7/D' }])
    // the barlines name the start and the stop of an ending: the measures between are under it too
    assert.deepEqual(b.ending, { label: '1,2', start: true, stop: false, closed: true })
    assert.deepEqual(c.ending, { label: '1,2', start: false, stop: true, closed: true })
    assert.equal(c.barline, 'repeat-end')
    assert.equal(d.ending, null)
    assert.equal(b.voices[0]?.[0]?.kind === 'rest' && b.voices[0][0].wholeMeasure, true)
  })

  it('is null for what is not a partwise score with a part', () => {
    assert.equal(readMusicXml('not xml'), null)
    assert.equal(readMusicXml('<score-timewise version="3.1"><measure/></score-timewise>'), null)
    assert.equal(readMusicXml('<score-partwise><part-list/></score-partwise>'), null)
  })
})

describe('MusicXML as what is kept: written and read back', () => {
  const note = (
    step: MelodyNote['step'],
    start: number,
    over: Partial<MelodyNote> = {}
  ): MelodyNote => ({
    kind: 'note',
    id: `${step}${start}`,
    step,
    alter: 0,
    octave: 4,
    midi: midiOf(step, 0, 4),
    start,
    duration: 1,
    tupletRatio: 1,
    tieStart: false,
    tieStop: false,
    cue: false,
    syllables: [],
    withPrevious: false,
    ...over,
  })
  const measure = (over: Partial<MelodyMeasure>): MelodyMeasure => ({
    number: 1,
    voices: [[]],
    chords: [],
    section: null,
    barline: 'single',
    directions: [],
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
  const back = (m: Melody) => readMusicXml(writeMusicXml(m)) as Melody

  it('keeps a chord inside a held note, a chord after the last note, and two lines in one voice', () => {
    const whole = note('D', 0, { duration: 4 })
    const m = measure({
      voices: [
        [whole],
        // two lines that run together, which MusicXML holds as voices of their own
        [
          note('A', 0, { cue: true, duration: 3 }),
          note('B', 3, { cue: true }),
          note('C', 0, { cue: true }),
        ],
      ],
      chords: [
        { start: 0, text: 'D' },
        { start: 2, text: 'G/D' },
      ],
    })
    const out = back({ title: 'T', notice: ['n'], measures: [m] })
    const read = out.measures[0] as MelodyMeasure
    assert.deepEqual(read.chords, m.chords)
    const key = (e: MelodyEvent) => (e.kind === 'note' ? `${e.step}${e.start}` : 'r')
    assert.deepEqual(read.voices.flat().map(key).sort(), ['A0', 'B3', 'C0', 'D0'])
    assert.equal(out.title, 'T')
    assert.deepEqual(out.notice, ['n'])
    assert.equal(read.full, true)
  })

  it('keeps a line that comes in late, tuplets, accidentals, directions, repeats and endings', () => {
    const first = measure({
      repeatStart: true,
      section: 'CHORUS',
      tempo: 80,
      directions: [{ kind: 'to-coda', al: null, time: 2, text: '2nd time to Coda' }],
      voices: [
        [
          note('C', 1, { cue: true, alter: 1, midi: 61 }),
          note('E', 2, { tupletRatio: 2 / 3, duration: 2 / 3, tuplet: 'start' }),
          note('F', 2 + 2 / 3, { tupletRatio: 2 / 3, duration: 2 / 3 }),
          note('G', 2 + 4 / 3, { tupletRatio: 2 / 3, duration: 2 / 3, tuplet: 'stop' }),
        ],
      ],
      length: 4,
      full: false,
    })
    const second = measure({
      number: 2,
      barline: 'repeat-end',
      ending: { label: '1', start: true, stop: true, closed: true },
      directions: [{ kind: 'da-segno', al: 'coda', time: null, text: 'D.S. al Coda' }],
      voices: [[note('A', 0, { duration: 4, syllables: ['Lord-', 'x'] })]],
    })
    const read = back({ title: null, notice: [], measures: [first, second] }).measures
    const [a, b] = read as [MelodyMeasure, MelodyMeasure]
    assert.deepEqual(
      a.voices
        .flat()
        .map(e =>
          e.kind === 'note' ? [e.step, e.alter, +e.start.toFixed(3), e.tuplet ?? ''] : []
        ),
      [
        ['C', 1, 1, ''],
        ['E', 0, 2, 'start'],
        ['F', 0, 2.667, ''],
        ['G', 0, 3.333, 'stop'],
      ]
    )
    assert.deepEqual(
      [a.repeatStart, a.section, a.tempo, a.directions[0]?.time],
      [true, 'CHORUS', 80, 2]
    )
    assert.deepEqual(b.directions[0], {
      kind: 'da-segno',
      al: 'coda',
      time: null,
      text: 'D.S. al Coda',
    })
    assert.deepEqual(
      [b.barline, b.ending],
      ['repeat-end', { label: '1', start: true, stop: true, closed: true }]
    )
    assert.deepEqual(((b.voices[0] as MelodyEvent[])[0] as MelodyNote).syllables, ['Lord-', 'x'])
  })
})
