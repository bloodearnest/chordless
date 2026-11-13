/**
 * My instrument (docs/PERSONAL_LAYER.md): how far the chords shown are moved from the setlist's key
 * to suit the person's instrument or tuning, in semitones up. An Eb horn reads a chart up a major
 * sixth (9), a Bb horn up a whole step (2), a guitar tuned down a half step plays shapes a half step
 * higher (1). It is the person's own, kept on their device and never synced. Capo moves the shapes
 * the other way, per song, after it.
 */

/** A transposition from the setlist's key, in semitones up, 0 (concert pitch) to 11 */
export type InstrumentOffset = number

/** The offset for any number: whole semitones, wrapped into 0 to 11; anything that is not a number is none */
export function normalizeInstrument(value: unknown): InstrumentOffset {
  const semitones = Math.round(Number(value))
  if (!Number.isFinite(semitones)) return 0
  return ((semitones % 12) + 12) % 12
}

export interface InstrumentOption {
  semitones: InstrumentOffset
  /** What it is for: the instruments and tunings it suits, if any */
  hint: string
}

/** Every offset there is, each with what it suits (so any other is a custom one) */
export const INSTRUMENT_OPTIONS: readonly InstrumentOption[] = [
  { semitones: 0, hint: 'Concert pitch' },
  { semitones: 1, hint: 'Guitar tuned a half step down' },
  { semitones: 2, hint: 'B♭ instrument; guitar tuned a whole step down' },
  { semitones: 3, hint: '' },
  { semitones: 4, hint: '' },
  { semitones: 5, hint: '' },
  { semitones: 6, hint: '' },
  { semitones: 7, hint: 'F instrument' },
  { semitones: 8, hint: '' },
  { semitones: 9, hint: 'E♭ instrument' },
  { semitones: 10, hint: '' },
  { semitones: 11, hint: '' },
]

/** How an offset is named: "Concert pitch", or "+2 (B♭ instrument; …)" */
export function instrumentLabel(value: unknown): string {
  const semitones = normalizeInstrument(value)
  const { hint } = INSTRUMENT_OPTIONS[semitones]
  if (semitones === 0) return hint
  return hint ? `+${semitones} (${hint})` : `+${semitones}`
}

/**
 * How the chords of a song are moved for display, as the capo-shaped pair the chord display takes:
 * the shapes are the song's key moved by the instrument and then down by the capo. `capo` is the
 * fret of the one capo that does the same (the chords are the same wherever the shift is made, a
 * whole octave apart), and `key` the key the shapes are in (to spell the chords by), or '' for none.
 */
export function shapesFor(
  instrument: InstrumentOffset,
  capo: number,
  keyAfter: (semitones: number) => string
): { capo: number; key: string } {
  const shift = normalizeInstrument(instrument) - Math.max(0, Math.round(capo))
  if (shift === 0) return { capo: 0, key: '' }
  return { capo: normalizeInstrument(-shift), key: keyAfter(shift) }
}
