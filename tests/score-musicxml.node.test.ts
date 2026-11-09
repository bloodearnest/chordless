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
