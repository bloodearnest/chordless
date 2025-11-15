// Musical transposition module for chord charts

/**
 * Key information database
 * Defines which keys are major/minor and whether they use sharps or flats
 */
const KEY_INFO = {
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
};

/**
 * Chromatic scale with both sharp and flat names
 */
const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Convert note to semitone number (C=0, C#=1, etc.)
 */
function noteToSemitone(note) {
  let normalized = note.replace(/♯/, '#').replace(/♭/, 'b');

  // Handle enharmonic edge cases
  if (normalized === 'E#' || normalized === 'Fb') normalized = normalized === 'E#' ? 'F' : 'E';
  if (normalized === 'B#' || normalized === 'Cb') normalized = normalized === 'B#' ? 'C' : 'B';

  let index = NOTES_SHARP.indexOf(normalized);
  if (index !== -1) return index;
  index = NOTES_FLAT.indexOf(normalized);
  return index;
}

/**
 * Convert semitone number to note name
 * Special handling: B becomes Cb in very flat keys (Gb, Cb)
 */
function semitoneToNote(semitone, useFlats, targetKey) {
  const normalized = ((semitone % 12) + 12) % 12;
  let note = useFlats ? NOTES_FLAT[normalized] : NOTES_SHARP[normalized];

  // In keys Gb and Cb, use Cb instead of B
  if (note === 'B' && useFlats && targetKey && (targetKey === 'Gb' || targetKey === 'Cb')) {
    note = 'Cb';
  }

  return note;
}

/**
 * Parse a chord string into components
 * Returns: { root, extensions, bass, isValid, original }
 */
export function parseChord(chordString) {
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
    };
  }

  const original = chordString;

  // Split on slash to separate bass note
  const parts = chordString.split('/');
  const mainPart = parts[0];
  const bassPart = parts.length > 1 ? parts[1] : null;

  // Parse root note (1-2 characters: letter + optional accidental)
  const rootMatch = mainPart.match(/^([A-G][#b♯♭]?)/);
  if (!rootMatch) {
    return {
      root: null,
      extensions: '',
      bass: null,
      isValid: false,
      original,
    };
  }

  const root = rootMatch[1].replace(/♯/, '#').replace(/♭/, 'b');
  const extensions = mainPart.substring(root.length);

  // Parse bass note if present
  let bass = null;
  if (bassPart) {
    const bassMatch = bassPart.match(/^([A-G][#b♯♭]?)/);
    if (bassMatch) {
      bass = bassMatch[1].replace(/♯/, '#').replace(/♭/, 'b');
    }
  }

  return {
    root,
    extensions,
    bass,
    isValid: true,
    isSpecial: false,
    original,
  };
}

/**
 * Transpose a single note by semitones
 */
export function transposeNote(note, semitones, useFlats, targetKey) {
  if (!note) return null;
  const originalSemitone = noteToSemitone(note);
  if (originalSemitone === -1) return null;
  const newSemitone = originalSemitone + semitones;
  return semitoneToNote(newSemitone, useFlats, targetKey);
}

/**
 * Get available keys for transposition
 * Returns only major keys if current is major, minor if current is minor
 * Sorted in chromatic order, rotated so current key is in the middle
 * Excludes uncommon enharmonic keys (Db, Gb, Cb, D#m, G#m, A#m) from UI selection
 */
export function getAvailableKeys(currentKey) {
  if (!currentKey) return [];

  const keyInfo = KEY_INFO[currentKey];
  if (!keyInfo) return [];

  // Keys to exclude from UI (but keep in KEY_INFO for transposition logic)
  const excludedKeys = ['Db', 'Gb', 'Cb', 'D#m', 'G#m', 'A#m'];

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
  ];
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
  ];

  const order = keyInfo.mode === 'major' ? majorOrder : minorOrder;

  // Get sorted list of available keys, excluding uncommon enharmonic keys
  const keys = Object.keys(KEY_INFO)
    .filter(key => KEY_INFO[key].mode === keyInfo.mode && !excludedKeys.includes(key))
    .sort((a, b) => {
      const aIndex = order.indexOf(a);
      const bIndex = order.indexOf(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

  // Find current key index
  const currentIndex = keys.indexOf(currentKey);
  if (currentIndex === -1) return keys;

  // Rotate so current key is in the middle
  const middleIndex = Math.floor(keys.length / 2);
  const rotateAmount = currentIndex - middleIndex;

  // Perform rotation
  let rotated;
  if (rotateAmount > 0) {
    // Rotate left: move first N elements to end
    rotated = [...keys.slice(rotateAmount), ...keys.slice(0, rotateAmount)];
  } else if (rotateAmount < 0) {
    // Rotate right: move last N elements to start
    rotated = [...keys.slice(rotateAmount), ...keys.slice(0, rotateAmount)];
  } else {
    rotated = keys;
  }

  // Reverse so higher keys are above, lower keys are below
  return rotated.reverse();
}

/**
 * Calculate semitone offset between two keys
 */
export function getKeyOffset(fromKey, toKey) {
  if (!fromKey || !toKey) return 0;

  // Get root notes of keys (strip 'm' for minor)
  const fromRoot = fromKey.replace(/m$/, '');
  const toRoot = toKey.replace(/m$/, '');

  const fromSemitone = noteToSemitone(fromRoot);
  const toSemitone = noteToSemitone(toRoot);

  if (fromSemitone === -1 || toSemitone === -1) return 0;

  return toSemitone - fromSemitone;
}

/**
 * Transpose a chord from one key to another
 * Returns: { chord, transposed, valid }
 */
export function transposeChord(chordString, fromKey, toKey) {
  const parsed = parseChord(chordString);

  // Special chords pass through unchanged
  if (parsed.isSpecial) {
    return {
      chord: parsed.original,
      transposed: true,
      valid: true,
    };
  }

  // Invalid chords are marked but returned unchanged
  if (!parsed.isValid) {
    return {
      chord: parsed.original,
      transposed: false,
      valid: false,
    };
  }

  // Calculate transposition
  const semitones = getKeyOffset(fromKey, toKey);
  if (semitones === 0) {
    return {
      chord: parsed.original,
      transposed: true,
      valid: true,
    };
  }

  // Determine whether to use flats or sharps
  const toKeyInfo = KEY_INFO[toKey];
  const useFlats = toKeyInfo ? toKeyInfo.useFlats : false;

  // Transpose root
  const newRoot = transposeNote(parsed.root, semitones, useFlats, toKey);
  if (!newRoot) {
    return {
      chord: parsed.original,
      transposed: false,
      valid: false,
    };
  }

  // Transpose bass if present
  let newBass = null;
  if (parsed.bass) {
    newBass = transposeNote(parsed.bass, semitones, useFlats, toKey);
    if (!newBass) {
      return {
        chord: parsed.original,
        transposed: false,
        valid: false,
      };
    }
  }

  // Reconstruct chord
  let newChord = newRoot + parsed.extensions;
  if (newBass) {
    newChord += '/' + newBass;
  }

  return {
    chord: newChord,
    transposed: true,
    valid: true,
  };
}

/**
 * Transpose all chords in parsed song structure
 * Modifies the parsed structure in place
 */
export function transposeSong(parsed, fromKey, toKey) {
  if (!parsed || !parsed.sections) return;

  for (const section of parsed.sections) {
    for (const line of section.lines) {
      for (const segment of line.segments) {
        if (segment.chord) {
          const result = transposeChord(segment.chord, fromKey, toKey);
          segment.chord = result.chord;
          segment.transposed = result.transposed;
          segment.valid = result.valid;
        }
      }
    }
  }
}
