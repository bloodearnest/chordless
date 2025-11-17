const NASHVILLE_PREF_KEY = 'setalight-use-nashville';
let cachedUseNashville = null;

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
