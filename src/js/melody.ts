/**
 * The melody of a lead sheet as music: what `docs/MELODY.md` calls the `Melody`. Plain data, small
 * as JSON, and no XML: MusicXML is written from it and read into it at the edges
 * (`melody-musicxml.ts`).
 *
 * Times are in quarter notes from the start of the measure. Pitch is spelled (step, alter, octave)
 * as the sheet spells it; `midi` is derived and kept because analysis and checks want the number.
 */

export interface MelodyNote {
  kind: 'note'
  /** The id of the note's element in the sheet's SVG (the preview's time map names the same ids) */
  id: string
  step: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
  alter: number
  octave: number
  midi: number
  /** Quarter notes from the start of the measure */
  start: number
  /** Length in quarter notes as it sounds: dots and tuplets included */
  duration: number
  /** A tuplet's ratio (normal over actual: 2/3 for a triplet), 1 when the note is not in one */
  tupletRatio: number
  /** Where a tuplet bracket starts and stops (on the first and the last event under it) */
  tuplet?: 'start' | 'stop'
  /** Ties to the note after it / from the note before it */
  tieStart: boolean
  tieStop: boolean
  /** Cue size: an instrumental line (intro, turnaround), not sung */
  cue: boolean
  /** One syllable per verse, '' where the verse has none here. A trailing '-' joins it to the next */
  syllables: string[]
  /** Sounds with the note before it (a chord in the melody line) */
  withPrevious: boolean
}

export interface MelodyRest {
  kind: 'rest'
  id: string
  start: number
  duration: number
  tupletRatio: number
  /** Where a tuplet bracket starts and stops (on the first and the last event under it) */
  tuplet?: 'start' | 'stop'
  /** A rest that fills the whole measure */
  wholeMeasure: boolean
  cue: boolean
}

export type MelodyEvent = MelodyNote | MelodyRest

export interface MelodyChord {
  /** Quarter notes from the start of the measure */
  start: number
  text: string
}

/** A numbered ending's bracket, as it covers one measure of it */
export interface MelodyEnding {
  /** What the bracket says: "1", "2" or "2,3" */
  label: string
  /** This is the measure the bracket starts over / ends over */
  start: boolean
  stop: boolean
  /** The bracket has a hook down at its right end; an open one (the last ending) does not */
  closed: boolean
}

/** A sign or an instruction over a measure that changes where the player goes next, or how many times */
export interface MelodyDirection {
  /** `da-segno` is "D.S." and `da-capo` "D.C."; `to-coda` is where to jump to the coda sign; `text` is any other instruction */
  kind: 'segno' | 'coda' | 'to-coda' | 'fine' | 'da-segno' | 'da-capo' | 'text'
  /** "al Coda" / "al Fine" after a D.S. or D.C. */
  al: 'coda' | 'fine' | null
  /** "2nd time to Coda": only on this pass (2); null when it applies on every one */
  time: number | null
  /** The words as written, without the music font's signs */
  text: string
}

export interface MelodyMeasure {
  /** The number the sheet prints, counted from 1 (a pickup is 0 when the sheet says so) */
  number: number
  /** One list per voice; nearly always one */
  voices: MelodyEvent[][]
  chords: MelodyChord[]
  /** A boxed section name that starts here ("INTRO", "VERSE 1") */
  section: string | null
  /** The barline that closes the measure */
  barline: 'single' | 'double' | 'final' | 'repeat-end' | 'dashed' | 'none'
  /** The measure opens with a repeat sign (a thick line and dots on its left edge): play from here again */
  repeatStart: boolean
  /** Signs and instructions over the measure: segno, coda, D.S., D.C., Fine, "Play 3 times" */
  directions: MelodyDirection[]
  /** The numbered ending ("1", "2", "2,3") whose bracket this measure is under, if any */
  ending: MelodyEnding | null
  /** Sum of the voices' lengths, checked against the time signature */
  length: number
  /** The measure holds as much as the time signature says (a pickup or last measure may not) */
  full: boolean
  /** Fifths: negative flats, positive sharps */
  fifths: number
  beats: number
  beatType: number
  /** A tempo mark the measure carries, in quarter notes per minute */
  tempo: number | null
}

export interface Melody {
  title: string | null
  measures: MelodyMeasure[]
  /** The text under the music that has to travel with it: copyright, CCLI numbers (docs/MELODY.md, "The terms") */
  notice: string[]
}

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const

export function midiOf(step: MelodyNote['step'], alter: number, octave: number): number {
  return (octave + 1) * 12 + SEMITONE[step] + alter
}
