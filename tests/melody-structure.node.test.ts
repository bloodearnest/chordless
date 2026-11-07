import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Melody, MelodyDirection, MelodyMeasure } from '../src/js/melody.ts'
import {
  lyricSimilarity,
  matchChart,
  matchVerses,
  type PlayStep,
  playOrder,
  playSteps,
  sheetSections,
  stepWords,
} from '../src/js/melody-structure.ts'

interface Spec {
  section?: string
  repeatStart?: boolean
  end?: boolean
  ending?: string
  endingStart?: boolean
  dirs?: Partial<MelodyDirection>[]
  /** One word per note: the first verse */
  words?: string[]
  /** The syllables of each note, a list per verse */
  notes?: string[][]
}

/** A melody of measures that are each a few notes; `words` and `notes` give their syllables */
function melody(specs: Spec[]): Melody {
  return {
    title: null,
    notice: [],
    measures: specs.map(
      (s, i): MelodyMeasure => ({
        number: i + 1,
        voices: [
          (s.notes ?? s.words?.map(w => [w]) ?? [[]]).map((syllables, n) => ({
            kind: 'note' as const,
            id: `n${i}-${n}`,
            step: 'C' as const,
            alter: 0,
            octave: 4,
            midi: 60,
            start: 0,
            duration: 4,
            tupletRatio: 1,
            tieStart: false,
            tieStop: false,
            cue: false,
            syllables,
            withPrevious: false,
          })),
        ],
        chords: [],
        section: s.section ?? null,
        barline: s.end ? 'repeat-end' : 'single',
        directions: (s.dirs ?? []).map(d => ({
          kind: 'text',
          al: null,
          time: null,
          text: '',
          ...d,
        })),
        repeatStart: !!s.repeatStart,
        ending: s.ending
          ? { label: s.ending, start: s.endingStart !== false, stop: true, closed: false }
          : null,
        length: 4,
        full: true,
        fifths: 0,
        beats: 4,
        beatType: 4,
        tempo: null,
      })
    ),
  }
}

const played = (m: Melody) => playOrder(m).map(p => p.measure)

describe('the play order of a lead sheet', () => {
  it('plays a repeat twice, and three times where it says so', () => {
    const twice = melody([{}, { repeatStart: true }, { end: true }, {}])
    assert.deepEqual(played(twice), [0, 1, 2, 1, 2, 3])
    const three = melody([
      { repeatStart: true, dirs: [{ kind: 'text', text: 'Play 3 times' }] },
      { end: true },
      {},
    ])
    assert.deepEqual(played(three), [0, 1, 0, 1, 0, 1, 2])
    const x4 = melody([{ dirs: [{ kind: 'text', text: '(4x)' }] }, { end: true }])
    assert.deepEqual(played(x4), [0, 1, 0, 1, 0, 1, 0, 1])
    // a "2nd x" instruction is not a count
    const second = melody([{ dirs: [{ kind: 'text', text: '(2nd x a cappella)' }] }, { end: true }])
    assert.equal(played(second).length, 4)
  })

  it('takes a repeat back to the top when no sign starts it', () => {
    assert.deepEqual(played(melody([{}, { end: true }, {}])), [0, 1, 0, 1, 2])
  })

  it('plays the first ending the first time and the second the second', () => {
    const m = melody([{ repeatStart: true }, { ending: '1', end: true }, { ending: '2' }, {}])
    assert.deepEqual(played(m), [0, 1, 0, 2, 3])
    const three = melody([
      { repeatStart: true, dirs: [{ kind: 'text', text: 'Play 3 times' }] },
      { ending: '1,2', end: true },
      { ending: '3' },
    ])
    assert.deepEqual(played(three), [0, 1, 0, 1, 0, 2])
  })

  it('follows D.S. al Coda: back to the segno, on to "to Coda", across to the coda', () => {
    const m = melody([
      {},
      { dirs: [{ kind: 'segno' }] },
      { dirs: [{ kind: 'to-coda' }] },
      { dirs: [{ kind: 'da-segno', al: 'coda' }] },
      { dirs: [{ kind: 'coda' }] },
      {},
    ])
    assert.deepEqual(played(m), [0, 1, 2, 3, 1, 2, 4, 5])
  })

  it('follows D.C. al Fine, and does not take the repeats again after a jump', () => {
    const m = melody([
      { repeatStart: true },
      { end: true },
      { dirs: [{ kind: 'fine' }] },
      { dirs: [{ kind: 'da-capo', al: 'fine' }] },
    ])
    assert.deepEqual(played(m), [0, 1, 0, 1, 2, 3, 0, 1, 2])
  })

  it('plays the last ending after a jump', () => {
    const m = melody([
      { dirs: [{ kind: 'segno' }] },
      { ending: '1', end: true },
      { ending: '2', dirs: [{ kind: 'da-segno' }] },
    ])
    assert.deepEqual(played(m), [0, 1, 0, 2, 0, 2])
  })

  it('ends a runaway sheet instead of looping for ever', () => {
    const loop = melody([{ dirs: [{ kind: 'da-capo' }] }])
    assert.ok(played(loop).length < 10)
  })
})

describe('the sections a sheet plays through', () => {
  const song = melody([
    { section: 'VERSE', words: ['Hold', 'the', 'light', 'high', 'tonight'] },
    { repeatStart: true, section: 'CHORUS', words: ['Sing', 'out', 'loud', 'and', 'clear'] },
    { end: true, words: ['A', 'new', 'song', 'rise', 'now'] },
  ])

  it('lists the boxed sections, and an unnamed one before the first box', () => {
    assert.deepEqual(
      sheetSections(song).map(s => [s.name, s.from, s.to]),
      [
        ['VERSE', 0, 1],
        ['CHORUS', 1, 3],
      ]
    )
    const pickup = melody([{}, { section: 'INTRO' }])
    assert.deepEqual(
      sheetSections(pickup).map(s => s.name),
      ['', 'INTRO']
    )
  })

  it('groups the order into steps, and reads each pass its own verse', () => {
    const steps = playSteps(song)
    assert.deepEqual(
      steps.map(s => [s.section, s.from, s.to, s.pass]),
      [
        [0, 0, 1, 1],
        [1, 1, 3, 1],
        [1, 1, 3, 2],
      ]
    )
    // one verse written for a chorus that is sung twice: the second time reads the first
    assert.deepEqual(stepWords(song, steps[2] as PlayStep), [
      'sing',
      'out',
      'loud',
      'and',
      'clear',
      'a',
      'new',
      'song',
      'rise',
      'now',
    ])
  })

  it('joins hyphenated syllables into words', () => {
    const m = melody([{ section: 'A', words: ['Ho-', 'ly', 'one'] }])
    assert.deepEqual(stepWords(m, playSteps(m)[0] as PlayStep), ['holy', 'one'])
  })

  it('keeps an ending skipped in the middle of a go as a gap, and leaves cue notes out of the words', () => {
    const m = melody([
      { section: 'A', repeatStart: true, words: ['one'] },
      { ending: '1', end: true, words: ['two'] },
      { ending: '2', words: ['three'] },
    ])
    const [first, second] = playSteps(m) as [PlayStep, PlayStep]
    assert.deepEqual(first.spans, [[0, 2]])
    assert.deepEqual(second.spans, [
      [0, 1],
      [2, 3],
    ])
    const cue = m.measures[0]?.voices[0]?.[0]
    if (cue?.kind === 'note') cue.cue = true
    assert.deepEqual(stepWords(m, second), ['three'])
  })

  it('reads the verse of the pass where each has its own', () => {
    const m = melody([
      {
        section: 'A',
        repeatStart: true,
        notes: [
          ['one', 'five'],
          ['two', 'six'],
        ],
      },
      { end: true, notes: [['three', 'seven']] },
    ])
    const [first, second] = playSteps(m) as [PlayStep, PlayStep]
    assert.deepEqual(stepWords(m, first), ['one', 'two', 'three'])
    assert.deepEqual(stepWords(m, second), ['five', 'six', 'seven'])
  })
})

describe('matching steps to the chart by lyrics', () => {
  const sentence = (text: string) => text.split(' ')
  const song = melody([
    { section: 'VERSE', words: sentence('Hold the light high tonight for all to see') },
    {
      section: 'CHORUS',
      repeatStart: true,
      words: sentence('Sing out loud and clear to the world'),
    },
    { end: true },
  ])
  const chart = [
    { label: 'Verse 1', text: 'Hold the light high tonight for all to see' },
    { label: 'Chorus 1', text: 'Sing out loud and clear to the world' },
    { label: 'Chorus 2', text: 'Sing out loud and clear to the world' },
  ]

  it('is alike for the same words and not for others', () => {
    assert.equal(lyricSimilarity(['a', 'b', 'c'], ['a', 'b', 'c']), 1)
    assert.equal(lyricSimilarity(['a', 'b', 'c'], ['x', 'y', 'z']), 0)
    assert.equal(lyricSimilarity([], ['x']), 0)
    assert.ok(lyricSimilarity(['a', 'b', 'c'], ['c', 'b', 'a']) > 0)
  })

  it('gives identical sections to the first one not used, so a repeated chorus is Chorus 1 then 2', () => {
    const matched = matchChart(song, playSteps(song), chart)
    assert.deepEqual(
      matched.map(m => m.label),
      ['Verse 1', 'Chorus 1', 'Chorus 2']
    )
  })

  it('goes by the name for a step with no words, and says null where nothing is near', () => {
    const quiet = melody([{ section: 'INTRO' }, { section: 'BRIDGE', words: ['zz'] }])
    const matched = matchChart(quiet, playSteps(quiet), [
      { label: 'Intro', text: '' },
      { label: 'Verse', text: 'something quite different here' },
    ])
    assert.deepEqual(
      matched.map(m => m.label),
      ['Intro', null]
    )
  })

  it('reads every verse written under a section', () => {
    const strophic = melody([
      {
        section: 'V',
        notes: [
          ['one', 'five'],
          ['two', 'six'],
          ['three', 'seven'],
        ],
      },
    ])
    const labels = matchVerses(strophic, playSteps(strophic)[0] as PlayStep, [
      { label: 'Verse 1', text: 'one two three' },
      { label: 'Verse 2', text: 'five six seven' },
    ])
    assert.deepEqual(labels, ['Verse 1', 'Verse 2'])
  })
})
