/**
 * A melody in another key: docs/MELODY.md, "Transposing". The notes move by the interval and are
 * respelled for the new key; the chord symbols go through the app's own transposer, so they read
 * as the chart's do. Nothing else about the song changes.
 *
 * A key is a pitch class, so the same key can be had an octave up or down. The notes go where the
 * sung melody lands nearest the green range (`shiftNearGreen`, as the key picker shows), and the
 * chords take the plain nearest interval, since they have no octave.
 */
import { noteName, semitonesBetween } from './chart-range.ts'
import type { Melody, MelodyEvent, MelodyNote } from './melody.ts'
import { midiOf } from './melody.ts'
import { transposeChord } from './transpose.ts'
import { type NoteRange, shiftNearGreen } from './voice-range.ts'

const FIFTHS_OF_LETTER = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 } as const

/** Key signature of a key name, sharps positive: 'Bb' is -2, 'Em' is 1. Null if it is not a key */
export function fifthsOfKey(key: string): number | null {
  const m = /^([A-G])([#b♯♭]?)(m|min|minor)?$/.exec(key.trim())
  if (!m) return null
  const alter = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0
  return FIFTHS_OF_LETTER[m[1] as keyof typeof FIFTHS_OF_LETTER] + 7 * alter - (m[3] ? 3 : 0)
}

/** The lowest and highest sung note (cue notes are an instrumental line), or null if none is sung */
export function melodyRange(melody: Melody): NoteRange | null {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const measure of melody.measures)
    for (const voice of measure.voices)
      for (const e of voice)
        if (e.kind === 'note' && !e.cue) {
          low = Math.min(low, e.midi)
          high = Math.max(high, e.midi)
        }
  return low <= high ? { low, high } : null
}

/** The note at a new pitch, spelled in a key */
function respell(note: MelodyNote, midi: number, key: string): MelodyNote {
  const [, step, accidental, octave] = /^([A-G])([#b]?)(-?\d+)$/.exec(
    noteName(midi, key)
  ) as RegExpExecArray
  const alter = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  const spelled = { step: step as MelodyNote['step'], alter, octave: Number(octave) }
  return { ...note, ...spelled, midi: midiOf(spelled.step, alter, spelled.octave) }
}

/**
 * The melody in `to`, written in `from`. The result is the sheet in the new key, with a new key
 * signature; a key either name does not parse leaves the melody as it was.
 */
export function transposeMelody(melody: Melody, from: string, to: string): Melody {
  const fifths = fifthsOfKey(to)
  if (fifths === null || fifthsOfKey(from) === null) return melody
  const nearest = semitonesBetween(from, to)
  const range = melodyRange(melody)
  const shift = range ? shiftNearGreen(range, nearest) : nearest
  const move = (e: MelodyEvent): MelodyEvent =>
    e.kind === 'note' ? respell(e, e.midi + shift, to) : e
  return {
    ...melody,
    measures: melody.measures.map(m => ({
      ...m,
      fifths,
      voices: m.voices.map(voice => voice.map(move)),
      chords: m.chords.map(c => ({ ...c, text: transposeChord(c.text, from, to).chord })),
    })),
  }
}
