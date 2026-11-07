/**
 * Whether a song's melody sits where people can sing it, in a key: docs/RANGE.md.
 *
 * A range is the lowest and highest note of the melody as MIDI numbers (60 is middle C), at the
 * pitch the chart is written in. The melody is written for the higher voices; men sing it an
 * octave down. So the written low note is what a man reaches first, and the written high note is
 * what a woman does, and both limits are in written pitch.
 *
 * What counts as comfortable is a rule of thumb, set by ear: green is easy, yellow is the edge
 * (a note some will strain for), red is out of reach for many. A song that starts out red (the
 * original keys of songs written for a man's voice often do) is normal, and the point is to see
 * which keys it stops being red in.
 */

/** The lowest and highest note of a melody, as MIDI numbers */
export interface NoteRange {
  low: number
  high: number
}

export type RangeStatus = 'green' | 'yellow' | 'red'

/**
 * The limits, in MIDI numbers. A low note at or above `green` is green, at or above `yellow` is
 * yellow, and lower is red. A high note at or below `green` is green, at or below `yellow` is
 * yellow, and higher is red.
 */
export const RANGE_LIMITS = {
  low: { green: 59 /* B3 */, yellow: 55 /* G3 */ },
  high: { green: 73 /* C#5 */, yellow: 76 /* E5 */ },
} as const

export interface RangeCheck {
  /** The worse of the two ends */
  status: RangeStatus
  low: RangeStatus
  high: RangeStatus
}

const ORDER: RangeStatus[] = ['green', 'yellow', 'red']

/** A status for a person to read: which way it is out, and words, as well as the colour (which is never all of it) */
export interface RangeNote {
  tone: RangeStatus
  /** Which end is out of range: none when all is well */
  direction: 'none' | 'high' | 'low' | 'both'
  /** What is out of range ('too high, low'): none when all is well */
  words: string
}

/** A check in words: 'too high' for an end that is red, 'high' for one that is yellow */
export function describeRange(check: RangeCheck): RangeNote {
  const ends = [
    ['high', check.high],
    ['low', check.low],
  ] as const
  const words = ends
    .filter(([, status]) => status !== 'green')
    .map(([end, status]) => `${status === 'red' ? 'too ' : ''}${end}`)
    .join(', ')
  const high = check.high !== 'green'
  const low = check.low !== 'green'
  const direction = high && low ? 'both' : high ? 'high' : low ? 'low' : 'none'
  return { tone: check.status, direction, words }
}

/**
 * How the melody fares if the song is moved by `semitones` (up is positive): the chart's own key
 * is 0, and each key in the picker is its offset from the key the range was written in.
 */
export function rangeStatus(range: NoteRange, semitones = 0): RangeCheck {
  const low = range.low + semitones
  const high = range.high + semitones
  const lowStatus: RangeStatus =
    low >= RANGE_LIMITS.low.green ? 'green' : low >= RANGE_LIMITS.low.yellow ? 'yellow' : 'red'
  const highStatus: RangeStatus =
    high <= RANGE_LIMITS.high.green ? 'green' : high <= RANGE_LIMITS.high.yellow ? 'yellow' : 'red'
  const status = ORDER[Math.max(ORDER.indexOf(lowStatus), ORDER.indexOf(highStatus))]
  return { status, low: lowStatus, high: highStatus }
}

/**
 * The range moved by whole octaves to where it sits nearest the green range. A lead sheet's
 * octave is often wrong (SongSelect prints some a whole octave out), so a range is kept as it was
 * read, for fidelity, and this decides where to take it when it is used: only the notes' names
 * are relied on. A tie goes to the move nearest the range as it is.
 */
export function octaveNearGreen(range: NoteRange): NoteRange {
  const outside = (shift: number) =>
    Math.max(0, RANGE_LIMITS.low.green - (range.low + shift)) +
    Math.max(0, range.high + shift - RANGE_LIMITS.high.green)
  let best = 0
  for (let octaves = 1; octaves <= 3; octaves++) {
    for (const shift of [-12 * octaves, 12 * octaves]) {
      if (outside(shift) < outside(best)) best = shift
    }
  }
  return { low: range.low + best, high: range.high + best }
}
