/**
 * A melody in another key: docs/MELODY.md, "Transposing". The notes move by the interval and are
 * respelled for the new key; the chord symbols go through the app's own transposer, so they read
 * as the chart's do. Nothing else about the song changes.
 *
 * A key is a pitch class, so the same key can be had an octave up or down. The notes go where the
 * sung melody lands nearest the green range (`octaveNearGreen`, as the key picker shows), and the
 * chords take the plain nearest interval, since they have no octave.
 */
import type { Melody, MelodyEvent, MelodyNote } from './melody.ts'
import { playOrder } from './melody-structure.ts'
import { fifthsOfKey, midiOf, noteName, semitonesBetween } from './pitch.ts'
import { transposeChord } from './transpose.ts'
import { type NoteRange, octaveNearGreen } from './voice-range.ts'

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

/** The range, and how long the song sits on its two ends */
export interface MelodyExtremes extends NoteRange {
  /** Quarter notes sounding at the lowest / highest pitch, over the song as it is played */
  lowBeats: number
  highBeats: number
}

/**
 * The lowest and highest sung note, and the total length of them in quarter notes across the whole
 * song as played: the repeats and endings followed (`playOrder`), a tie's notes added up, cue notes
 * left out. A high note held a long time tires a singer more than one touched once. Null if no
 * note is sung.
 */
export function melodyExtremes(melody: Melody): MelodyExtremes | null {
  const range = melodyRange(melody)
  if (!range) return null
  let lowBeats = 0
  let highBeats = 0
  for (const { measure } of playOrder(melody))
    for (const voice of melody.measures[measure].voices)
      for (const e of voice)
        if (e.kind === 'note' && !e.cue) {
          if (e.midi === range.low) lowBeats += e.duration
          if (e.midi === range.high) highBeats += e.duration
        }
  return { ...range, lowBeats, highBeats }
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
  // (the range in the new key by the nearest interval, then taken to the octave nearest the green)
  const shift = range
    ? octaveNearGreen({ low: range.low + nearest, high: range.high + nearest }).low - range.low
    : nearest
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
