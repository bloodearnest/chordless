/**
 * Melodies for the tests, written out short: each measure is a list of events, `C4:1:Ho-` a note
 * (pitch, beats, syllable) and `r:1` a rest. A pitch is a letter, an optional `#` or `b`, and an octave.
 */
import type { Melody, MelodyDirection, MelodyEvent, MelodyMeasure } from '../src/js/melody.ts'
import { midiOf } from '../src/js/melody.ts'

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const

export interface MeasureOptions {
  chords?: [start: number, text: string][]
  section?: string
  barline?: MelodyMeasure['barline']
  repeatStart?: boolean
  ending?: { label: string; start: boolean; stop: boolean; closed: boolean }
  directions?: Partial<MelodyDirection>[]
  fifths?: number
  beats?: number
  beatType?: number
  /** Tuplet brackets: the first event of the bracket and the last, by index */
  triplet?: [first: number, last: number]
}

let ids = 0

/** One measure from its events: starts are worked out from the lengths */
export function measure(
  number: number,
  events: string[],
  options: MeasureOptions = {}
): MelodyMeasure {
  let start = 0
  const triplet = options.triplet
  const list: MelodyEvent[] = events.map((text, index) => {
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
      step: step as (typeof STEPS)[number],
      alter,
      octave: Number(octave),
      midi: midiOf(step as (typeof STEPS)[number], alter, Number(octave)),
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

export function melodyOf(title: string, measures: MelodyMeasure[]): Melody {
  return { title, notice: [], measures }
}
