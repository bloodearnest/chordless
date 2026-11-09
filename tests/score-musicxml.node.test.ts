/** Writing a melody as MusicXML (src/js/score-musicxml.ts) */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Step } from '../src/js/pitch.ts'
import type { ScoreEvent, ScoreMeasure, ScoreNote } from '../src/js/score.ts'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { bar, measure, melodyOf, note, rest } from './score-build.ts'

describe('MusicXML', () => {
  it('writes the notes, their pitch spelling and a key', () => {
    const xml = writeMusicXml(melodyOf(null, [measure(1, ['E4', 'F4', 'G4', 'A4'])]))
    assert.match(xml, /<score-partwise version="4.0">/)
    assert.equal((xml.match(/<note>/g) ?? []).length, 4)
    assert.match(xml, /<step>E<\/step><octave>4<\/octave>/)
    assert.match(xml, /<beats>4<\/beats><beat-type>4<\/beat-type>/)
  })
})

describe('MusicXML of a hand-built melody', () => {
  const bFlat = (over: Partial<ScoreNote>) => note('B', 4, { alter: -1, ...over })
  const melody = {
    title: 'A & B',
    notice: ['CCLI Song # 1'],
    measures: [
      bar(
        [
          bFlat({ syllables: ['ho-'], tieStart: true }),
          bFlat({ start: 1, syllables: ['ly_'], tieStop: true }),
          note('C', 4, { start: 2, duration: 2 / 3, tupletRatio: 2 / 3, alter: 1 }),
          rest({ start: 2.67, duration: 1.33 }),
        ],
        {
          chords: [
            { start: 0, text: 'Bb/D' },
            { start: 1, text: 'X"><evil/>' },
            { start: 2, text: 'F#m7' },
          ],
          section: 'VERSE 1',
          fifths: -2,
          tempo: 72,
        }
      ),
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

describe('MusicXML for an engraver', () => {
  /** A note in octave 4, sharp (1), natural (0) or flat (-1) */
  const at = (step: Step, alter: number, over: Partial<ScoreNote> = {}) =>
    note(step, 4, { alter, ...over })
  const measure = (fifths: number, events: ScoreEvent[]) => bar(events, { fifths })
  const write = (...measures: ScoreMeasure[]) => writeMusicXml(melodyOf(null, measures))

  it('prints an accidental only where the alteration is not the one in force', () => {
    // G major: F is sharp already. F#, then F natural (marked), then F natural again (not), then Bb (marked)
    const xml = write(
      measure(1, [
        at('F', 1, { start: 0 }),
        at('F', 0, { start: 1 }),
        at('F', 0, { start: 2 }),
        at('B', -1, { start: 3 }),
      ])
    )
    assert.deepEqual(xml.match(/<accidental>[a-z-]+<\/accidental>/g), [
      '<accidental>natural</accidental>',
      '<accidental>flat</accidental>',
    ])
    // the next measure starts from the key again
    const two = write(measure(1, [at('F', 0)]), measure(1, [at('F', 1)]))
    assert.equal((two.match(/<accidental>/g) ?? []).length, 1)
  })

  it("carries a tied note's accidental over the barline unmarked", () => {
    const xml = write(
      measure(0, [at('G', 1, { tieStart: true })]),
      measure(0, [at('G', 1, { tieStop: true })])
    )
    assert.equal((xml.match(/<accidental>sharp<\/accidental>/g) ?? []).length, 1)
  })

  it('goes back to the start of the measure for a second voice, by as far as the first went', () => {
    const m = measure(0, [at('C', 0, { duration: 4 })])
    m.voices.push([at('E', 0, { cue: true, duration: 2 })])
    const xml = write(m)
    assert.match(
      xml,
      /<duration>96<\/duration><voice>1<\/voice>[\s\S]*<backup><duration>96<\/duration><\/backup>/
    )
    // a ratio that is no tuplet of whole notes is written as plain notes rather than a wrong one
    const odd = write(measure(0, [at('C', 0, { tupletRatio: 0.3137 })]))
    assert.doesNotMatch(odd, /time-modification/)
  })

  it('opens and closes a tuplet bracket, and moves a late line forward to where it starts', () => {
    const xml = write(
      measure(0, [
        at('C', 0, { start: 1, duration: 2 / 3, tupletRatio: 2 / 3, tuplet: 'start' }),
        at('D', 0, { start: 1 + 2 / 3, duration: 2 / 3, tupletRatio: 2 / 3 }),
        at('E', 0, { start: 1 + 4 / 3, duration: 2 / 3, tupletRatio: 2 / 3, tuplet: 'stop' }),
      ])
    )
    assert.match(xml, /<forward><duration>24<\/duration><\/forward>/)
    assert.match(xml, /<notations><tuplet type="start" bracket="yes"\/><\/notations>/)
    assert.match(xml, /<notations><tuplet type="stop" bracket="yes"\/><\/notations>/)
  })
})

describe('directions, repeats and endings', () => {
  it('writes them as MusicXML directions with their sound', () => {
    const xml = writeMusicXml(
      melodyOf(null, [
        bar([], {
          directions: [
            { kind: 'segno', al: null, time: null, text: '' },
            { kind: 'to-coda', al: null, time: 2, text: '2nd time to Coda' },
            { kind: 'da-segno', al: 'coda', time: null, text: 'D.S. al "Coda"' },
            { kind: 'da-capo', al: null, time: null, text: 'D.C.' },
            { kind: 'fine', al: null, time: null, text: 'Fine' },
            { kind: 'coda', al: null, time: null, text: '' },
            { kind: 'text', al: null, time: null, text: 'Play 3 times' },
          ],
        }),
      ])
    )
    assert.match(xml, /<segno\/><\/direction-type><sound segno="segno"\/>/)
    assert.match(xml, /<coda\/><\/direction-type><sound coda="coda"\/>/)
    assert.match(xml, /<words>2nd time to Coda<\/words><\/direction-type><sound tocoda="coda"\/>/)
    assert.match(
      xml,
      /<words>D\.S\. al &quot;Coda&quot;<\/words><\/direction-type><sound dalsegno="segno"\/>/
    )
    assert.match(xml, /<sound dacapo="yes"\/>/)
    assert.match(xml, /<sound fine="yes"\/>/)
    assert.match(xml, /<words>Play 3 times<\/words><\/direction-type><\/direction>/)
  })

  it('writes repeats and endings as MusicXML barlines', () => {
    const barOf = (over: Partial<ScoreMeasure>) => bar([], over)
    const xml = writeMusicXml(
      melodyOf(null, [
        barOf({ repeatStart: true }),
        barOf({
          barline: 'repeat-end',
          ending: { label: '1', start: true, stop: true, closed: true },
        }),
        barOf({
          barline: 'final',
          ending: { label: '2,3', start: true, stop: true, closed: false },
        }),
        barOf({ barline: 'double' }),
      ])
    )
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

describe('MusicXML beams', () => {
  const beamsIn = (xml: string) =>
    [...xml.matchAll(/<beam number="(\d)">([^<]*)<\/beam>/g)].map(m => `${m[1]}${m[2]}`)
  const eighths = (...starts: number[]) =>
    starts.map(start => note('E', 4, { start, duration: 0.5 }))

  it('beams the eighths of a beat together and leaves the quarters alone', () => {
    const xml = writeMusicXml(
      melodyOf(null, [bar([...eighths(0, 0.5), note('G', 4, { start: 1 }), ...eighths(2, 2.5)])])
    )
    assert.deepEqual(beamsIn(xml), ['1begin', '1end', '1begin', '1end'])
  })

  it('does not beam across a beat, or over a rest', () => {
    const xml = writeMusicXml(
      melodyOf(null, [
        bar([...eighths(0.5, 1), rest({ start: 1.5, duration: 0.5 }), ...eighths(2, 2.5)]),
      ])
    )
    // (0.5 and 1 are in different beats; the rest breaks what is left)
    assert.deepEqual(beamsIn(xml), ['1begin', '1end'])
  })

  it('gives sixteenths a second beam, with a hook for one that has no neighbour at that level', () => {
    const xml = writeMusicXml(
      melodyOf(null, [
        bar([
          note('E', 4, { start: 0, duration: 0.75 }),
          note('F', 4, { start: 0.75, duration: 0.25 }),
          note('G', 4, { start: 1, duration: 1 }),
        ]),
      ])
    )
    assert.deepEqual(beamsIn(xml), ['1begin', '1end', '2backward hook'])
  })

  it('joins the three eighths of a beat in 6/8 and keeps a cue line apart', () => {
    const six = bar([...eighths(0, 0.5, 1), ...eighths(1.5, 2, 2.5)], { beats: 6, beatType: 8 })
    assert.deepEqual(beamsIn(writeMusicXml(melodyOf(null, [six]))), [
      '1begin',
      '1continue',
      '1end',
      '1begin',
      '1continue',
      '1end',
    ])
    const cue = bar([
      note('E', 4, { duration: 0.5, cue: true }),
      note('E', 4, { start: 0.5, duration: 0.5 }),
    ])
    assert.deepEqual(beamsIn(writeMusicXml(melodyOf(null, [cue]))), [])
  })

  it('puts a forward hook on a sixteenth that starts a beam, and beams a chord with its note', () => {
    const hook = bar([
      note('E', 4, { start: 0, duration: 0.25 }),
      note('F', 4, { start: 0.25, duration: 0.5 }),
      note('G', 4, { start: 1, duration: 1 }),
    ])
    assert.deepEqual(beamsIn(writeMusicXml(melodyOf(null, [hook]))), [
      '1begin',
      '2forward hook',
      '1end',
    ])
    const chord = bar([
      note('E', 4, { start: 0, duration: 0.5 }),
      note('G', 4, { start: 0, duration: 0.5, withPrevious: true }),
      note('F', 4, { start: 0.5, duration: 0.5 }),
      note('A', 4, { start: 0.5, duration: 0.5, withPrevious: true }),
    ])
    assert.deepEqual(beamsIn(writeMusicXml(melodyOf(null, [chord]))), [
      '1begin',
      '1begin',
      '1end',
      '1end',
    ])
  })
})
