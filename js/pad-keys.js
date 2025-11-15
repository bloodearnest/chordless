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
]);

export const PAD_FILE_KEY_SET = new Set(PAD_FILE_KEYS);

export const ENHARMONIC_KEY_MAP = {
  Bb: 'A#',
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Cb: 'B',
  Fb: 'E',
  'E#': 'F',
  'B#': 'C',
};

/**
 * Normalize an arbitrary key label (e.g., "bb", "A_flat") to one of the canonical pad keys.
 * @param {string} key
 * @returns {string|null}
 */
export function normalizePadKey(key) {
  if (!key) return null;

  const cleaned = `${key}`
    .trim()
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/flat/gi, 'b')
    .replace(/sharp/gi, '#');

  // Match any pattern like A, Bb, A#, etc.
  const match = cleaned.match(/([A-Ga-g])([#b]?)/);
  if (!match) {
    const upper = cleaned.toUpperCase();
    const mapped = ENHARMONIC_KEY_MAP[upper] || upper;
    return PAD_FILE_KEY_SET.has(mapped) ? mapped : null;
  }

  const letter = match[1].toUpperCase();
  const accidentalRaw = match[2] || '';
  const accidental = accidentalRaw === '#' ? '#' : accidentalRaw.toLowerCase() === 'b' ? 'b' : '';

  const canonical = `${letter}${accidental}`;
  const padKey = ENHARMONIC_KEY_MAP[canonical] || canonical;
  return PAD_FILE_KEY_SET.has(padKey) ? padKey : null;
}

/**
 * Attempt to extract the first recognizable pad key from a filename.
 * @param {string} filename
 * @returns {string|null}
 */
export function extractPadKeyFromFilename(filename) {
  if (!filename) return null;
  const base = filename.split('/').pop() || filename;
  const nameWithoutExt = base.replace(/\.[^.]+$/, '');

  // Prefer tokens near the end separated by common delimiters
  const tokens = nameWithoutExt.split(/[\s_\-()]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    const match = token.match(/^([A-Ga-g])([#b♯♭]?)/);
    if (match && token.length <= 3) {
      const normalized = normalizePadKey(match[0]);
      if (normalized) {
        return normalized;
      }
    }
  }

  // Fallback: find the last standalone key anywhere in the name
  const globalPattern = /\b([A-Ga-g])([#b♯♭]?)/g;
  let match;
  let candidate = null;
  while ((match = globalPattern.exec(nameWithoutExt)) !== null) {
    candidate = match[0];
  }

  return candidate ? normalizePadKey(candidate) : null;
}
