import type { ParsedChart } from './data-types.ts'

// Musical transposition module for chord charts

interface KeyInfo {
  mode: 'major' | 'minor'
  sharps?: number
  flats?: number
  useFlats: boolean
}

/** Which way to spell a note that has two names (C# or Db) */
type Accidental = 'sharp' | 'flat'

/**
 * Key information database
 * Defines which keys are major/minor and whether they use sharps or flats
 */
const KEY_INFO: Record<string, KeyInfo> = {
  // Major keys (sharps)
  C: { mode: 'major', sharps: 0, useFlats: false },
  G: { mode: 'major', sharps: 1, useFlats: false },
  D: { mode: 'major', sharps: 2, useFlats: false },
  A: { mode: 'major', sharps: 3, useFlats: false },
  E: { mode: 'major', sharps: 4, useFlats: false },
  B: { mode: 'major', sharps: 5, useFlats: false },
  'F#': { mode: 'major', sharps: 6, useFlats: false },
  'C#': { mode: 'major', sharps: 7, useFlats: false },

  // Major keys (flats)
  F: { mode: 'major', flats: 1, useFlats: true },
  Bb: { mode: 'major', flats: 2, useFlats: true },
  Eb: { mode: 'major', flats: 3, useFlats: true },
  Ab: { mode: 'major', flats: 4, useFlats: true },
  Db: { mode: 'major', flats: 5, useFlats: true },
  Gb: { mode: 'major', flats: 6, useFlats: true },
  Cb: { mode: 'major', flats: 7, useFlats: true },

  // Minor keys (sharps)
  Am: { mode: 'minor', sharps: 0, useFlats: false },
  Em: { mode: 'minor', sharps: 1, useFlats: false },
  Bm: { mode: 'minor', sharps: 2, useFlats: false },
  'F#m': { mode: 'minor', sharps: 3, useFlats: false },
  'C#m': { mode: 'minor', sharps: 4, useFlats: false },
  'G#m': { mode: 'minor', sharps: 5, useFlats: false },
  'D#m': { mode: 'minor', sharps: 6, useFlats: false },
  'A#m': { mode: 'minor', sharps: 7, useFlats: false },

  // Minor keys (flats)
  Dm: { mode: 'minor', flats: 1, useFlats: true },
  Gm: { mode: 'minor', flats: 2, useFlats: true },
  Cm: { mode: 'minor', flats: 3, useFlats: true },
  Fm: { mode: 'minor', flats: 4, useFlats: true },
  Bbm: { mode: 'minor', flats: 5, useFlats: true },
  Ebm: { mode: 'minor', flats: 6, useFlats: true },
  Abm: { mode: 'minor', flats: 7, useFlats: true },
}

/**
 * Chromatic scale with both sharp and flat names
 */
const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/**
 * Convert note to semitone number (C=0, C#=1, etc.)
 */
function noteToSemitone(note: string): number {
  let normalized = note.replace(/♯/, '#').replace(/♭/, 'b')

  // Handle enharmonic edge cases
  if (normalized === 'E#' || normalized === 'Fb') normalized = normalized === 'E#' ? 'F' : 'E'
  if (normalized === 'B#' || normalized === 'Cb') normalized = normalized === 'B#' ? 'C' : 'B'

  let index = NOTES_SHARP.indexOf(normalized)
  if (index !== -1) return index
  index = NOTES_FLAT.indexOf(normalized)
  return index
}

/**
 * Convert semitone number to note name
 * Special handling: B becomes Cb in very flat keys (Gb, Cb)
 */
function semitoneToNote(
  semitone: number,
  useFlats: boolean,
  targetKey: string | null | undefined,
  preferredAccidental: Accidental | null = null
): string {
  const normalized = ((semitone % 12) + 12) % 12
  let useFlatNaming = useFlats

  if (preferredAccidental === 'flat') {
    useFlatNaming = true
  } else if (preferredAccidental === 'sharp') {
    useFlatNaming = false
  } else if (targetKey) {
    const keyRoot = extractKeyRoot(targetKey)
    const targetSemitone = keyRoot ? noteToSemitone(keyRoot) : -1
    if (targetSemitone !== -1) {
      const diff = (((normalized - targetSemitone) % 12) + 12) % 12
      const defaultAccidental: Accidental | undefined = DEFAULT_ACCIDENTAL_BY_DIFF[diff]
      if (defaultAccidental === 'flat') {
        useFlatNaming = true
      } else if (defaultAccidental === 'sharp') {
        useFlatNaming = false
      }
    }
  }

  let note = useFlatNaming ? NOTES_FLAT[normalized] : NOTES_SHARP[normalized]

  // In keys Gb and Cb, use Cb instead of B
  if (note === 'B' && useFlatNaming && targetKey && (targetKey === 'Gb' || targetKey === 'Cb')) {
    note = 'Cb'
  }

  return note
}

/** A chord taken apart (see parseChord) */
export interface ParsedChord {
  root: string | null
  extensions: string
  bass: string | null
  isValid: boolean
  /** A bar line or other mark that is not a chord to transpose */
  isSpecial?: boolean
  original: string
  /** '(' and ')' when the chord was in brackets, else '' */
  wrapperPrefix: string
  wrapperSuffix: string
}

/** The result of transposing a chord */
export interface TransposeResult {
  chord: string
  transposed: boolean
  valid: boolean
}

/**
 * Parse a chord string into components
 */
export function parseChord(chordString: string): ParsedChord {
  // Skip special non-chord values
  if (
    !chordString ||
    chordString === '.' ||
    chordString === 'N.C.' ||
    chordString === '|' ||
    chordString === '||' ||
    chordString === '||:' ||
    chordString === ':||'
  ) {
    return {
      root: null,
      extensions: '',
      bass: null,
      isValid: true,
      isSpecial: true,
      original: chordString,
      wrapperPrefix: '',
      wrapperSuffix: '',
    }
  }

  const original = chordString
  let coreChord = (chordString || '').trim()
  let wrapperPrefix = ''
  let wrapperSuffix = ''

  if (coreChord.startsWith('(') && coreChord.endsWith(')') && coreChord.length > 2) {
    wrapperPrefix = '('
    wrapperSuffix = ')'
    coreChord = coreChord.slice(1, -1).trim()
  }

  // Split on slash to separate bass note
  const parts = coreChord.split('/')
  const mainPart = parts[0]
  const bassPart = parts.length > 1 ? parts[1] : null

  // Parse root note (1-2 characters: letter + optional accidental)
  const rootMatch = mainPart.match(/^([A-G][#b♯♭]?)/)
  if (!rootMatch) {
    return {
      root: null,
      extensions: '',
      bass: null,
      isValid: false,
      original,
      wrapperPrefix,
      wrapperSuffix,
    }
  }

  const root = rootMatch[1].replace(/♯/, '#').replace(/♭/, 'b')
  const extensions = mainPart.substring(root.length)

  // Parse bass note if present
  let bass: string | null = null
  if (bassPart) {
    const bassMatch = bassPart.match(/^([A-G][#b♯♭]?)/)
    if (bassMatch) {
      bass = bassMatch[1].replace(/♯/, '#').replace(/♭/, 'b')
    }
  }

  return {
    root,
    extensions,
    bass,
    isValid: true,
    isSpecial: false,
    original,
    wrapperPrefix,
    wrapperSuffix,
  }
}

/**
 * Transpose a single note by semitones
 */
export function transposeNote(
  note: string | null | undefined,
  semitones: number,
  useFlats: boolean,
  targetKey?: string | null,
  preferredAccidental: Accidental | null = null
): string | null {
  if (!note) return null
  const originalSemitone = noteToSemitone(note)
  if (originalSemitone === -1) return null
  const newSemitone = originalSemitone + semitones
  return semitoneToNote(newSemitone, useFlats, targetKey, preferredAccidental)
}

/**
 * Get available keys for transposition
 * Returns only major keys if current is major, minor if current is minor
 * Sorted in chromatic order, rotated so current key is in the middle
 * Excludes uncommon enharmonic keys (Db, Gb, Cb, D#m, G#m, A#m) from UI selection
 */
export function getAvailableKeys(currentKey: string | null | undefined): string[] {
  if (!currentKey) return []

  const keyInfo = KEY_INFO[currentKey]
  if (!keyInfo) return []

  // Keys to exclude from UI (but keep in KEY_INFO for transposition logic)
  const excludedKeys = ['Db', 'Gb', 'Cb', 'D#m', 'G#m', 'A#m']

  // Fixed chromatic order starting from Ab
  // Includes enharmonic equivalents (Db/C#, Gb/F#, Cb/B) for complete key coverage
  const majorOrder = [
    'Ab',
    'A',
    'Bb',
    'B',
    'Cb',
    'C',
    'Db',
    'C#',
    'D',
    'Eb',
    'E',
    'F',
    'Gb',
    'F#',
    'G',
  ]
  const minorOrder = [
    'Abm',
    'Am',
    'Bbm',
    'Bm',
    'Cm',
    'C#m',
    'Dm',
    'Ebm',
    'D#m',
    'Em',
    'Fm',
    'F#m',
    'Gm',
    'G#m',
    'A#m',
  ]

  const order = keyInfo.mode === 'major' ? majorOrder : minorOrder

  // Get sorted list of available keys, excluding uncommon enharmonic keys
  const keys = Object.keys(KEY_INFO)
    .filter(key => KEY_INFO[key].mode === keyInfo.mode && !excludedKeys.includes(key))
    .sort((a, b) => {
      const aIndex = order.indexOf(a)
      const bIndex = order.indexOf(b)
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })

  // Find current key index
  const currentIndex = keys.indexOf(currentKey)
  if (currentIndex === -1) return keys

  // Rotate so current key is in the middle
  const middleIndex = Math.floor(keys.length / 2)
  const rotateAmount = currentIndex - middleIndex

  // Rotate left by N (move the first N to the end), or right (the last N to the start) if N is negative
  const rotated = [...keys.slice(rotateAmount), ...keys.slice(0, rotateAmount)]

  // Reverse so higher keys are above, lower keys are below
  return rotated.reverse()
}

/**
 * Calculate semitone offset between two keys
 */
export function getKeyOffset(
  fromKey: string | null | undefined,
  toKey: string | null | undefined
): number {
  if (!fromKey || !toKey) return 0

  // Get root notes of keys (strip 'm' for minor)
  const fromRoot = fromKey.replace(/m$/, '')
  const toRoot = toKey.replace(/m$/, '')

  const fromSemitone = noteToSemitone(fromRoot)
  const toSemitone = noteToSemitone(toRoot)

  if (fromSemitone === -1 || toSemitone === -1) return 0

  return toSemitone - fromSemitone
}

/**
 * Transpose a chord from one key to another
 */
export function transposeChord(
  chordString: string,
  fromKey: string | null | undefined,
  toKey: string | null | undefined
): TransposeResult {
  const parsed = parseChord(chordString)

  // Special chords pass through unchanged
  if (parsed.isSpecial) {
    return {
      chord: parsed.original,
      transposed: true,
      valid: true,
    }
  }

  // Invalid chords are marked but returned unchanged
  if (!parsed.isValid) {
    return {
      chord: parsed.original,
      transposed: false,
      valid: false,
    }
  }

  // Calculate transposition
  const semitones = getKeyOffset(fromKey, toKey)
  if (semitones === 0) {
    return {
      chord: parsed.original,
      transposed: true,
      valid: true,
    }
  }

  // Determine whether to use flats or sharps
  const toKeyInfo = toKey ? KEY_INFO[toKey] : undefined
  const useFlats = toKeyInfo ? toKeyInfo.useFlats : false

  return { chord: shiftChord(parsed, semitones, useFlats, toKey), transposed: true, valid: true }
}

/**
 * A valid chord with its root and bass moved by semitones, and what comes with them kept: the
 * extensions, and the brackets round it all
 */
function shiftChord(
  parsed: ParsedChord,
  semitones: number,
  useFlats: boolean,
  targetKey: string | null | undefined
): string {
  // (a valid chord's root and bass are notes we can name: parseChord only takes A to G)
  const shift = (note: string) =>
    semitoneToNote(
      noteToSemitone(note) + semitones,
      useFlats,
      targetKey,
      determineAccidentalPreference(note)
    )
  const bass = parsed.bass ? `/${shift(parsed.bass)}` : ''
  return `${parsed.wrapperPrefix}${shift(parsed.root as string)}${parsed.extensions}${bass}${parsed.wrapperSuffix}`
}

export function transposeChordBySemitones(
  chordString: string,
  semitones: number,
  targetKey: string | null = null
): TransposeResult {
  const parsed = parseChord(chordString)

  if (parsed.isSpecial) {
    return {
      chord: parsed.original,
      transposed: true,
      valid: true,
    }
  }

  if (!parsed.isValid) {
    return {
      chord: parsed.original,
      transposed: false,
      valid: false,
    }
  }

  if (!semitones) {
    return {
      chord: parsed.original,
      transposed: false,
      valid: true,
    }
  }

  const toKeyInfo = targetKey ? KEY_INFO[targetKey] : null
  const useFlats = toKeyInfo ? toKeyInfo.useFlats : false

  return {
    chord: shiftChord(parsed, semitones, useFlats, targetKey),
    transposed: true,
    valid: true,
  }
}

/**
 * Transpose all chords in parsed song structure
 * Modifies the parsed structure in place
 */
export function transposeSong(
  parsed: ParsedChart | null | undefined,
  fromKey: string | null | undefined,
  toKey: string | null | undefined
): void {
  if (!parsed?.sections) return

  for (const section of parsed.sections) {
    for (const line of section.lines) {
      for (const segment of line.segments) {
        if (segment.chord) {
          if (isNashvilleChord(segment.chord) && fromKey) {
            const converted = convertNashvilleChordToStandard(segment.chord, fromKey)
            segment.chord = converted
          }
          const result = transposeChord(segment.chord, fromKey, toKey)
          segment.chord = result.chord
          segment.transposed = result.transposed
          segment.valid = result.valid
        }
      }
    }
  }
}

export function transposeKeyName(key: string, semitones: number): string {
  if (!key || !semitones) return key
  const mode = KEY_INFO[key]?.mode || (key.endsWith('m') ? 'minor' : 'major')
  const root = extractKeyRoot(key)
  if (!root) return key
  const targetSemitone = (((noteToSemitone(root) + semitones) % 12) + 12) % 12
  const candidates = Object.keys(KEY_INFO).filter(candidate => {
    const info = KEY_INFO[candidate]
    if (info.mode !== mode) return false
    const candidateRoot = extractKeyRoot(candidate)
    return candidateRoot !== null && noteToSemitone(candidateRoot) === targetSemitone
  })
  const preference = determineAccidentalPreference(root)
  if (preference === 'flat') {
    const flatCandidate = candidates.find(name => name.includes('b'))
    if (flatCandidate) return flatCandidate
  } else if (preference === 'sharp') {
    const sharpCandidate = candidates.find(name => name.includes('#'))
    if (sharpCandidate) return sharpCandidate
  }
  const naturalCandidate = candidates.find(name => !name.includes('#') && !name.includes('b'))
  if (naturalCandidate) return naturalCandidate
  return candidates[0]
}

const DEGREE_OFFSETS: Record<number, number> = {
  1: 0,
  2: 2,
  3: 4,
  4: 5,
  5: 7,
  6: 9,
  7: 11,
}

const DEFAULT_ACCIDENTAL_BY_DIFF: Record<number, Accidental> = {
  1: 'sharp',
  3: 'flat',
  6: 'sharp',
  8: 'flat',
  10: 'flat',
}

const NASHVILLE_CORE_REGEX = /^([#b♯♭]?)([1-7])(.*)$/

function extractKeyRoot(key: string | null | undefined): string | null {
  if (!key) return null
  const match = key.match(/^([A-G][#b♯♭]?)/)
  return match ? match[1].replace(/♯/, '#').replace(/♭/, 'b') : null
}

function getKeyInfo(key: string): KeyInfo | null {
  return KEY_INFO[key] || KEY_INFO[key.replace(/m$/, '')] || null
}

function accidentToOffset(accidental: string | undefined): number {
  if (!accidental) return 0
  return accidental === '#' || accidental === '♯' ? 1 : -1
}

export function isNashvilleChord(chordText: string | null | undefined): boolean {
  if (!chordText) return false
  let text = chordText.trim()
  if (text.startsWith('(') && text.endsWith(')') && text.length > 2) {
    text = text.slice(1, -1).trim()
  }
  const parts = text.split('/')
  if (!NASHVILLE_CORE_REGEX.test(parts[0])) return false
  if (parts[1] && !NASHVILLE_CORE_REGEX.test(parts[1])) return false
  return true
}

/** The note a Nashville number is in a key, or null if the key is not one */
function convertDegreeToNote(degreeMatch: RegExpMatchArray, key: string): string | null {
  const keyRoot = extractKeyRoot(key)
  if (!keyRoot) return null
  const accidental = accidentToOffset(degreeMatch[1])
  const offset = DEGREE_OFFSETS[Number(degreeMatch[2])]
  const targetSemitone = noteToSemitone(keyRoot) + offset + accidental
  const keyInfo = getKeyInfo(key)
  const useFlats = keyInfo?.useFlats ?? false
  return semitoneToNote(targetSemitone, useFlats, key)
}

export function convertNashvilleChordToStandard(
  chordText: string,
  key: string | null | undefined
): string {
  if (!isNashvilleChord(chordText) || !key) {
    return chordText
  }
  let text = chordText.trim()
  let prefix = ''
  let suffix = ''
  if (text.startsWith('(') && text.endsWith(')') && text.length > 2) {
    prefix = '('
    suffix = ')'
    text = text.slice(1, -1).trim()
  }
  // (it is a Nashville chord: the root, and the bass if there is one, match)
  const parts = text.split('/')
  const mainMatch = parts[0].match(NASHVILLE_CORE_REGEX) as RegExpMatchArray
  const rootNote = convertDegreeToNote(mainMatch, key)
  if (!rootNote) return chordText
  let chord = rootNote + mainMatch[3]
  if (parts[1]) {
    chord += `/${convertDegreeToNote(parts[1].match(NASHVILLE_CORE_REGEX) as RegExpMatchArray, key)}`
  }
  return `${prefix}${chord}${suffix}`
}

function determineAccidentalPreference(note: string | null | undefined): Accidental | null {
  if (!note) return null
  if (note.includes('b') || note.includes('♭')) return 'flat'
  if (note.includes('#') || note.includes('♯')) return 'sharp'
  return null
}

/** A scale degree as written in Nashville numbers: '#', 'b' or '' before 1 to 7 */
interface Degree {
  accidental: string
  degree: string
}

/**
 * The Nashville number for a distance in semitones above the key. A note that is not in the
 * major scale is a sharpened degree or a flattened one: the preference says which, else the
 * usual one for that distance (#1, b3, #4, b6, b7).
 */
function findDegreeForSemitone(diff: number, preference: Accidental | null = null): Degree {
  const normalized = ((diff % 12) + 12) % 12
  const degrees = Object.entries(DEGREE_OFFSETS)
  const natural = degrees.find(([, offset]) => offset === normalized)
  if (natural) return { accidental: '', degree: natural[0] }

  const accidental = (preference ?? DEFAULT_ACCIDENTAL_BY_DIFF[normalized]) === 'sharp' ? '#' : 'b'
  const next = accidental === '#' ? 1 : 11
  const [degree] = degrees.find(([, offset]) => (offset + next) % 12 === normalized) as [
    string,
    number,
  ]
  return { accidental, degree }
}

export function convertChordToNashville(chordText: string, key: string | null | undefined): string {
  if (!key || !chordText) return chordText
  if (isNashvilleChord(chordText)) {
    return chordText
  }
  const parsed = parseChord(chordText)
  const keyRoot = extractKeyRoot(key)
  // (a bar line, or something that is no chord, or a key that is no key, is left as it is)
  if (!parsed.root || !keyRoot) return chordText
  const keySemitone = noteToSemitone(keyRoot)
  const degree = (note: string) => {
    const { accidental, degree } = findDegreeForSemitone(
      noteToSemitone(note) - keySemitone,
      determineAccidentalPreference(note)
    )
    return `${accidental}${degree}`
  }
  const bass = parsed.bass ? `/${degree(parsed.bass)}` : ''
  return `${parsed.wrapperPrefix}${degree(parsed.root)}${parsed.extensions}${bass}${parsed.wrapperSuffix}`
}

export function normalizeSongChordsToStandard(
  parsed: ParsedChart | null | undefined,
  key: string | null | undefined
): void {
  if (!parsed?.sections || !key) {
    return
  }
  for (const section of parsed.sections) {
    for (const line of section.lines) {
      for (const segment of line.segments) {
        if (segment.chord && isNashvilleChord(segment.chord)) {
          segment.chord = convertNashvilleChordToStandard(segment.chord, key)
        }
      }
    }
  }
}
