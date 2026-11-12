/**
 * A melody in another key: docs/LEAD_SHEETS.md, "Transposing". The notes move by the interval and are
 * respelled for the new key; the chord symbols go through the app's own transposer, so they read
 * as the chart's do. Nothing else about the song changes.
 *
 * A key is a pitch class, so the same key can be had an octave up or down. The notes go where the
 * sung melody lands nearest the green range (`octaveNearGreen`, as the key picker shows), and the
 * chords take the plain nearest interval, since they have no octave.
 */

import { fifthsOfKey, midiOf, noteName, semitonesBetween } from './pitch.ts'
import type { Score, ScoreEvent, ScoreNote } from './score.ts'
import { playOrder } from './score-structure.ts'
import { transposeChord } from './transpose.ts'
import { type NoteRange, octaveNearGreen } from './voice-range.ts'

/**
 * Which notes are sung: not the cue-size ones (an instrumental line), nor a full-size one in a
 * measure with no lyric under it (an intro or a turnaround printed full size), unless it is tied
 * over from the measure before. A sheet with no lyrics at all has none to go by, so its full-size
 * notes all count.
 */
export function sungNotes(melody: Score): (measure: number, note: ScoreNote) => boolean {
  const lyric = melody.measures.map(m =>
    m.voices.some(voice => voice.some(e => e.kind === 'note' && e.syllables.some(Boolean)))
  )
  const anyLyric = lyric.includes(true)
  return (measure, note) => !note.cue && (!anyLyric || lyric[measure] === true || note.tieStop)
}

/** The lowest and highest sung note (`sungNotes`), or null if none is sung */
export function melodyRange(melody: Score): NoteRange | null {
  const sung = sungNotes(melody)
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const [index, measure] of melody.measures.entries())
    for (const voice of measure.voices)
      for (const e of voice)
        if (e.kind === 'note' && sung(index, e)) {
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
 * song as played: the repeats and endings followed (`playOrder`), a tie's notes added up, the notes
 * not sung (`sungNotes`) left out. A high note held a long time tires a singer more than one touched once. Null if no
 * note is sung.
 */
export function melodyExtremes(melody: Score): MelodyExtremes | null {
  const range = melodyRange(melody)
  if (!range) return null
  const sung = sungNotes(melody)
  let lowBeats = 0
  let highBeats = 0
  for (const { measure } of playOrder(melody))
    for (const voice of melody.measures[measure].voices)
      for (const e of voice)
        if (e.kind === 'note' && sung(measure, e)) {
          if (e.midi === range.low) lowBeats += e.duration
          if (e.midi === range.high) highBeats += e.duration
        }
  return { ...range, lowBeats, highBeats }
}

/** The note at a new pitch, spelled in a key */
function respell(note: ScoreNote, midi: number, key: string): ScoreNote {
  const [, step, accidental, octave] = /^([A-G])([#b]?)(-?\d+)$/.exec(
    noteName(midi, key)
  ) as RegExpExecArray
  const alter = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0
  const spelled = { step: step as ScoreNote['step'], alter, octave: Number(octave) }
  return { ...note, ...spelled, midi: midiOf(spelled.step, alter, spelled.octave) }
}

/**
 * The melody in `to`, written in `from`. The result is the sheet in the new key, with a new key
 * signature; a key either name does not parse leaves the melody as it was.
 */
export function transposeScore(melody: Score, from: string, to: string): Score {
  const fifths = fifthsOfKey(to)
  if (fifths === null || fifthsOfKey(from) === null) return melody
  const nearest = semitonesBetween(from, to)
  const range = melodyRange(melody)
  // (the range in the new key by the nearest interval, then taken to the octave nearest the green)
  const shift = range
    ? octaveNearGreen({ low: range.low + nearest, high: range.high + nearest }).low - range.low
    : nearest
  const move = (e: ScoreEvent): ScoreEvent =>
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
