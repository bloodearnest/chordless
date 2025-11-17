const NASHVILLE_PREF_KEY = 'setalight-use-nashville';
const ACCIDENTAL_PREF_KEY = 'setalight-use-unicode-accidentals';
let cachedUseNashville = null;
let cachedUseUnicodeAccidentals = null;

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
