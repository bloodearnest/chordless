/**
 * A SongSelect lead sheet, as an import reads it (docs/RANGE.md, docs/MELODY.md): the melody is
 * read from the PDF once (`melody-pdfjs.ts`), and its range, and how it was found, come from that.
 */
import type { Melody } from './melody.ts'
import { melodyRange, sungNotes } from './melody-transpose.ts'
import type { NoteRange } from './voice-range.ts'

/** What was read from a sheet: the range, and enough of how to check it against the page */
export interface MelodyRead extends NoteRange {
  /** The key signature the sheet opens with: sharps (positive) or flats (negative) */
  keySignature: number
  /** Sung notes read; the small instrumental ones left out, and those full size with no lyric */
  notes: number
  instrumental: number
  unsung: number
  /** Bars (measures) read */
  bars: number
  /** The bar numbers the lowest and highest notes are in, as the sheet prints them (the first, if there are several) */
  lowAt: number
  highAt: number
}

/** The range of a melody's sung notes, and how it was read; null if no note is sung */
export function readOfMelody(melody: Melody): MelodyRead | null {
  const range = melodyRange(melody)
  if (!range) return null
  const sung = sungNotes(melody)
  let notes = 0
  let instrumental = 0
  let unsung = 0
  let lowAt: number | undefined
  let highAt: number | undefined
  for (const [index, measure] of melody.measures.entries())
    for (const voice of measure.voices)
      for (const e of voice) {
        if (e.kind !== 'note') continue
        if (e.cue) instrumental++
        else if (!sung(index, e)) unsung++
        else {
          notes++
          if (e.midi === range.low) lowAt ??= measure.number
          if (e.midi === range.high) highAt ??= measure.number
        }
      }
  return {
    ...range,
    keySignature: melody.measures[0]?.fifths ?? 0,
    notes,
    instrumental,
    unsung,
    bars: melody.measures.length,
    // (the range is of sung notes, so both were met)
    lowAt: lowAt as number,
    highAt: highAt as number,
  }
}
