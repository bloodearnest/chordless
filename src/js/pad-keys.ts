export const PAD_FILE_KEYS = Object.freeze([
  'A',
  'A#',
  'B',
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
] as const)

export const PAD_FILE_KEY_SET = new Set<string>(PAD_FILE_KEYS)

export const ENHARMONIC_KEY_MAP: Readonly<Record<string, string>> = {
  Bb: 'A#',
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Cb: 'B',
  Fb: 'E',
  'E#': 'F',
  'B#': 'C',
}

/**
 * Normalize an arbitrary key label (e.g., "bb", "A_flat") to one of the canonical pad keys.
 */
export function normalizePadKey(key: string | null | undefined): string | null {
  if (!key) return null

  const cleaned = `${key}`
    .trim()
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/flat/gi, 'b')
    .replace(/sharp/gi, '#')

  // Match any pattern like A, Bb, A#, etc.
  const match = cleaned.match(/([A-Ga-g])([#b]?)/)
  // (every key has a letter from A to G in it)
  if (!match) return null

  // Any letter with a sharp or flat is a pad key, or the enharmonic name of one
  const canonical = `${match[1].toUpperCase()}${match[2]}`
  return ENHARMONIC_KEY_MAP[canonical] ?? canonical
}

/**
 * Attempt to extract the first recognizable pad key from a filename.
 */
export function extractPadKeyFromFilename(filename: string | null | undefined): string | null {
  if (!filename) return null
  const base = filename.split('/').pop() || filename
  const nameWithoutExt = base.replace(/\.[^.]+$/, '')

  // Prefer tokens near the end separated by common delimiters
  const tokens = nameWithoutExt.split(/[\s_\-()]+/).filter(Boolean)
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]
    const match = token.match(/^([A-Ga-g])([#b♯♭]?)/)
    if (match && token.length <= 3) {
      const normalized = normalizePadKey(match[0])
      if (normalized) {
        return normalized
      }
    }
  }

  // Fallback: find the last standalone key anywhere in the name
  const globalPattern = /\b([A-Ga-g])([#b♯♭]?)/g
  let match: RegExpExecArray | null
  let candidate: string | null = null
  for (
    match = globalPattern.exec(nameWithoutExt);
    match !== null;
    match = globalPattern.exec(nameWithoutExt)
  ) {
    candidate = match[0]
  }

  return candidate ? normalizePadKey(candidate) : null
}
