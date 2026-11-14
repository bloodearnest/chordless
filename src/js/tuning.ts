/**
 * How a guitar is tuned (docs/PERSONAL_LAYER.md, "How I play it"): standard, or down a half or a whole
 * step. A guitar tuned down plays its shapes higher than the song's key says, by that many semitones,
 * so the chords shown move up with it. The capo moves them the other way, per song, after it. A device
 * default, and one for a setlist that wins over it; on the device and never synced.
 */

/** How far down the guitar is tuned: 0 standard, 1 a half step, 2 a whole step */
export type Tuning = 0 | 1 | 2

export interface TuningOption {
  semitones: Tuning
  label: string
}

export const TUNINGS: readonly TuningOption[] = [
  { semitones: 0, label: 'Standard' },
  { semitones: 1, label: 'Half step down' },
  { semitones: 2, label: 'Whole step down' },
]

/** A tuning from whatever was stored: one of the three, and standard for anything else */
export function normalizeTuning(value: unknown): Tuning {
  const semitones = Number(value)
  return semitones === 1 || semitones === 2 ? semitones : 0
}

export const tuningLabel = (value: unknown): string => TUNINGS[normalizeTuning(value)].label

/**
 * How the chords of a song are moved for display, as the capo-shaped pair the chord display takes:
 * the shapes are the song's key moved up by the tuning and then down by the capo. `capo` is the
 * fret of the one capo that does the same (the chords are the same wherever the shift is made, an
 * octave apart), and `key` the key the shapes are in (to spell the chords by), or '' for none.
 */
export function shapesFor(
  tuning: Tuning,
  capo: number,
  keyAfter: (semitones: number) => string
): { capo: number; key: string } {
  const shift = normalizeTuning(tuning) - Math.max(0, Math.round(capo))
  if (shift === 0) return { capo: 0, key: '' }
  return { capo: (((-shift % 12) + 12) % 12) as number, key: keyAfter(shift) }
}
