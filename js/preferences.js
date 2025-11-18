const NASHVILLE_PREF_KEY = 'setalight-use-nashville';
const ACCIDENTAL_PREF_KEY = 'setalight-use-unicode-accidentals';
const MUSICIAN_TYPE_KEY = 'musician_type';
const SECTION_DEFAULTS_KEY = 'section_defaults';
const ENABLE_CAPO_KEY = 'enable_capo';

let cachedUseNashville = null;
let cachedUseUnicodeAccidentals = null;
let cachedMusicianType = null;

function readPreference() {
  if (cachedUseNashville !== null) return cachedUseNashville;
  if (typeof localStorage === 'undefined') {
    cachedUseNashville = false;
    return cachedUseNashville;
  }
  const stored = localStorage.getItem(NASHVILLE_PREF_KEY);
  cachedUseNashville = stored === '1' || stored === 'true';
  return cachedUseNashville;
}

export function getUseNashvilleNumbers() {
  return readPreference();
}

export function setUseNashvilleNumbers(value) {
  const normalized = !!value;
  cachedUseNashville = normalized;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(NASHVILLE_PREF_KEY, normalized ? '1' : '0');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nashville-preference-changed', { detail: normalized }));
  }
}

function readAccidentalPreference() {
  if (cachedUseUnicodeAccidentals !== null) return cachedUseUnicodeAccidentals;
  if (typeof localStorage === 'undefined') {
    cachedUseUnicodeAccidentals = false;
    return cachedUseUnicodeAccidentals;
  }
  const stored = localStorage.getItem(ACCIDENTAL_PREF_KEY);
  cachedUseUnicodeAccidentals = stored === '1' || stored === 'true';
  return cachedUseUnicodeAccidentals;
}

export function getUseUnicodeAccidentals() {
  return readAccidentalPreference();
}

export function setUseUnicodeAccidentals(value) {
  const normalized = !!value;
  cachedUseUnicodeAccidentals = normalized;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ACCIDENTAL_PREF_KEY, normalized ? '1' : '0');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('accidental-preference-changed', { detail: normalized }));
  }
}

function readMusicianTypePreference() {
  if (cachedMusicianType !== null) return cachedMusicianType;
  if (typeof localStorage === 'undefined') {
    cachedMusicianType = 'general';
    return cachedMusicianType;
  }
  const stored = localStorage.getItem(MUSICIAN_TYPE_KEY);
  cachedMusicianType = stored || 'general';
  return cachedMusicianType;
}

export function getMusicianType() {
  return readMusicianTypePreference();
}

export function setMusicianType(value) {
  const validTypes = ['general', 'singer', 'drummer', 'guitarist'];
  const normalized = validTypes.includes(value) ? value : 'general';
  cachedMusicianType = normalized;

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MUSICIAN_TYPE_KEY, normalized);

    // Update dependent settings based on musician type
    if (normalized === 'general') {
      // Clear all special settings
      localStorage.removeItem(SECTION_DEFAULTS_KEY);
      localStorage.removeItem(ENABLE_CAPO_KEY);
    } else if (normalized === 'singer' || normalized === 'drummer') {
      // Hide chords by default
      localStorage.setItem(SECTION_DEFAULTS_KEY, JSON.stringify({ all: 'lyrics' }));
      localStorage.removeItem(ENABLE_CAPO_KEY);
    } else if (normalized === 'guitarist') {
      // Enable capo
      localStorage.setItem(ENABLE_CAPO_KEY, 'true');
      localStorage.removeItem(SECTION_DEFAULTS_KEY);
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('musician-type-changed', { detail: normalized }));
  }
}
