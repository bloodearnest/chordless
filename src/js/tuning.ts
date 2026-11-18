/**
 * How a guitar is tuned (docs/PERSONAL_LAYER.md, "How I play it"): standard, or down by up to five semitones
 * (E♭ standard to B standard). A guitar tuned down plays its shapes higher than the song's key says, by that many semitones,
 * so the chords shown move up with it. The capo moves them the other way, per song, after it. A device
 * default, and one for a setlist that wins over it; on the device and never synced.
 */

import { t } from './text.ts'

/** How far down the guitar is tuned, in semitones: 0 standard (E), 1 E♭, 2 D, 3 D♭, 4 C, 5 B */
export type Tuning = 0 | 1 | 2 | 3 | 4 | 5

export interface TuningOption {
  semitones: Tuning
  label: string
}

const LABELS = [
  'tuning-standard',
  'tuning-eb',
  'tuning-d',
  'tuning-db',
  'tuning-c',
  'tuning-b',
] as const

export const TUNINGS: readonly TuningOption[] = LABELS.map((name, semitones) => ({
  semitones: semitones as Tuning,
  get label() {
    return t(name)
  },
}))

/** A tuning from whatever was stored: one of the six, and standard for anything else */
export function normalizeTuning(value: unknown): Tuning {
  const semitones = Number(value)
  return Number.isInteger(semitones) && semitones >= 1 && semitones <= 5 ? (semitones as Tuning) : 0
}

export const tuningLabel = (value: unknown): string => TUNINGS[normalizeTuning(value)].label

/**
 * How the chords of a song are moved for display, as the capo-shaped pair the chord display takes:
 * the shapes are the song's key moved up (by the guitar's tuning, and the instrument's pitch) and then
 * down by the capo. `up` is the semitones up, whatever made them. `capo` is the
 * fret of the one capo that does the same (the chords are the same wherever the shift is made, an
 * octave apart), and `key` the key the shapes are in (to spell the chords by), or '' for none.
 */
export function shapesFor(
  up: number,
  capo: number,
  keyAfter: (semitones: number) => string
): { capo: number; key: string } {
  const shift = (Math.round(up) % 12) - Math.max(0, Math.round(capo))
  if (shift === 0) return { capo: 0, key: '' }
  return { capo: ((-shift % 12) + 12) % 12, key: keyAfter(shift) }
}
