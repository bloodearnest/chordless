/**
 * Melodies for the tests. Written out short (`measure`): each measure is a list of events,
 * `C4:1:Ho-` a note (pitch, beats, syllable) and `r:1` a rest; a pitch is a letter, an optional
 * `#` or `b`, and an octave. Or one event or measure at a time with every field (`note`, `rest`,
 * `bar`), for what the short form cannot say: give only what the test is about.
 */

import { midiOf, type Step } from '../src/js/pitch.ts'
import type {
  Score,
  ScoreDirection,
  ScoreEvent,
  ScoreMeasure,
  ScoreNote,
  ScoreRest,
} from '../src/js/score.ts'

let ids = 0

/** A quarter note at the start of the measure, sung to nothing, unless `over` says otherwise (its MIDI number follows `alter`) */
export function note(step: Step, octave = 4, over: Partial<ScoreNote> = {}): ScoreNote {
  const alter = over.alter ?? 0
  return {
    kind: 'note',
    id: `n${ids++}`,
    step,
    alter,
    octave,
    midi: midiOf(step, alter, octave),
    start: 0,
    duration: 1,
    tupletRatio: 1,
    tieStart: false,
    tieStop: false,
    cue: false,
    syllables: [''],
    withPrevious: false,
    ...over,
  }
}

/** A quarter rest at the start of the measure, unless `over` says otherwise */
export function rest(over: Partial<ScoreRest> = {}): ScoreRest {
  return {
    kind: 'rest',
    id: `r${ids++}`,
    start: 0,
    duration: 1,
    tupletRatio: 1,
    wholeMeasure: false,
    cue: false,
    ...over,
  }
}

/** Measure 1 of 4/4 in C with these events in one voice, full, unless `over` says otherwise */
export function bar(events: ScoreEvent[], over: Partial<ScoreMeasure> = {}): ScoreMeasure {
  return {
    number: 1,
    voices: [events],
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
  }
}

export interface MeasureOptions {
  chords?: [start: number, text: string][]
  section?: string
  barline?: ScoreMeasure['barline']
  repeatStart?: boolean
  ending?: { label: string; start: boolean; stop: boolean; closed: boolean }
  directions?: Partial<ScoreDirection>[]
  fifths?: number
  beats?: number
  beatType?: number
  /** Tuplet brackets: the first event of the bracket and the last, by index */
  triplet?: [first: number, last: number]
}

/** One measure from its events: starts are worked out from the lengths */
export function measure(
  number: number,
  events: string[],
  options: MeasureOptions = {}
): ScoreMeasure {
  let start = 0
  const triplet = options.triplet
  const list: ScoreEvent[] = events.map((text, index) => {
    const [what = '', beats = '1', ...words] = text.split(':')
    const inTriplet = triplet && index >= triplet[0] && index <= triplet[1]
    const length = Number(beats) * (inTriplet ? 2 / 3 : 1)
    const base = {
      id: `e${ids++}`,
      start,
      duration: length,
      tupletRatio: inTriplet ? 2 / 3 : 1,
      ...(triplet && index === triplet[0] ? { tuplet: 'start' as const } : {}),
      ...(triplet && index === triplet[1] ? { tuplet: 'stop' as const } : {}),
      cue: false,
    }
    start += length
    if (what === 'r') {
      return { kind: 'rest', ...base, wholeMeasure: false }
    }
    const [, step = 'C', accidental = '', octave = '4'] = /^([A-G])([#b]?)(\d)$/.exec(what) ?? []
    const alter = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
    return {
      kind: 'note',
      ...base,
      step: step as Step,
      alter,
      octave: Number(octave),
      midi: midiOf(step as Step, alter, Number(octave)),
      tieStart: false,
      tieStop: false,
      syllables: words.length ? [words.join(':')] : [''],
      withPrevious: false,
    }
  })
  const beats = options.beats ?? 4
  return {
    number,
    voices: [list],
    chords: (options.chords ?? []).map(([at, text]) => ({ start: at, text })),
    section: options.section ?? null,
    barline: options.barline ?? 'single',
    repeatStart: options.repeatStart ?? false,
    directions: (options.directions ?? []).map(d => ({
      kind: 'text',
      al: null,
      time: null,
      text: '',
      ...d,
    })),
    ending: options.ending ?? null,
    length: start,
    full: start === beats,
    fifths: options.fifths ?? 0,
    beats,
    beatType: options.beatType ?? 4,
    tempo: null,
  }
}

/** A melody of these measures, with no notice */
export function melodyOf(title: string | null, measures: ScoreMeasure[]): Score {
  return { title, notice: [], measures }
}
