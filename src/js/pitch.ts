/**
 * Notes and keys as numbers: the letters, sharps and flats that the chart's range, the melody and
 * its readers and writers all need. A note is a MIDI number (60 is middle C, C4); a key signature
 * is its count of sharps (positive) or flats (negative), MusicXML's `fifths`.
 */
import { getKeyOffset, transposeNote } from './transpose.ts'

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

/** The letters from C, as a note's step counts them (C is 0, B is 6) */
export const STEPS: readonly Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** Semitones above C of each white note */
const SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** The letters a key signature's sharps fall on, in the order they are added; its flats are the reverse */
const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B']

/** Fifths from C of each letter's major key */
const FIFTHS_OF_LETTER: Record<Step, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 }

/** The MIDI number of a spelled note */
export function midiOf(step: Step, alter: number, octave: number): number {
  return (octave + 1) * 12 + SEMITONES[step] + alter
}

/** What a written sharp or flat ('#', '♯', 'b', '♭', or none) does to a note */
export function alterOf(accidental: string | undefined): number {
  return accidental === '#' || accidental === '♯' ? 1 : accidental ? -1 : 0
}

/** A key name read: 'F#m' is F, a sharp, minor. Null if it is not a key */
export function parseKey(key: string): { step: Step; alter: number; minor: boolean } | null {
  const m = /^([A-G])([#b♯♭]?)(m|min|minor)?$/.exec(key.trim())
  return m ? { step: m[1] as Step, alter: alterOf(m[2]), minor: Boolean(m[3]) } : null
}

/** Key signature of a key name, sharps positive: 'Bb' is -2, 'Em' is 1. Null if it is not a key */
export function fifthsOfKey(key: string): number | null {
  const parsed = parseKey(key)
  if (!parsed) return null
  return FIFTHS_OF_LETTER[parsed.step] + 7 * parsed.alter - (parsed.minor ? 3 : 0)
}

/**
 * Whether a key signature (sharps positive, flats negative) is a key's: the major key of the
 * signature, or the minor of the same, by pitch, so D flat and C sharp are the same. A key that is
 * not one to be read (no way to tell) is taken to match.
 */
export function signatureMatchesKey(signature: number, key: string): boolean {
  const fifths = fifthsOfKey(key)
  // (signatures twelve fifths apart are the same keys spelled another way)
  return fifths === null || (((signature - fifths) % 12) + 12) % 12 === 0
}

/** The alteration each letter has from a key signature: in G major F is 1 and the rest are 0 */
export function keyAlters(fifths: number): Record<Step, number> {
  const out: Record<Step, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 }
  const order = fifths >= 0 ? SHARP_ORDER : [...SHARP_ORDER].reverse()
  for (const step of order.slice(0, Math.abs(fifths))) out[step] = fifths >= 0 ? 1 : -1
  return out
}

/** The major key, and its relative minor, of each key signature from seven flats to seven sharps */
const MAJOR_OF_SIGNATURE = 'Cb Gb Db Ab Eb Bb F C G D A E B F# C#'.split(' ')
const MINOR_OF_SIGNATURE = 'Ab Eb Bb F C G D A E B F# C# G# D# A#'.split(' ')

/** A key signature in words: '1 sharp (G major or E minor)' */
export function describeSignature(signature: number): string {
  const count = Math.abs(signature)
  const accidentals =
    signature === 0
      ? 'no sharps or flats'
      : `${count} ${signature > 0 ? 'sharp' : 'flat'}${count > 1 ? 's' : ''}`
  const at = Math.max(-7, Math.min(7, signature)) + 7
  return `${accidentals} (${MAJOR_OF_SIGNATURE[at]} major or ${MINOR_OF_SIGNATURE[at]} minor)`
}

/** A key written with flats (F and the flat keys, and D, G and C minor), so its notes are too */
const FLAT_KEY = /^(?:[A-G]b|F)m?$|^(?:Dm|Gm|Cm)$/

/** A note's name in a key, with its octave: 'F#5' in G, 'Eb5' in Bb */
export function noteName(midi: number, key: string): string {
  const pitchClass = ((midi % 12) + 12) % 12
  const name = transposeNote('C', pitchClass, FLAT_KEY.test(key), key) as string
  // B is Cb in a very flat key, and that is an octave up in the number
  return `${name}${Math.floor(midi / 12) - 1 + (name === 'Cb' ? 1 : 0)}`
}

/**
 * The semitones from one key to another by the nearest way round, as the key picker lists them:
 * G to A is up two, and B to C up one, not down eleven. A melody moved the long way would be an
 * octave out.
 */
export function semitonesBetween(from: string, to: string): number {
  return ((((getKeyOffset(from, to) + 6) % 12) + 12) % 12) - 6
}
