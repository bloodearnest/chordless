const NASHVILLE_PREF_KEY = 'use-nashville'
const ACCIDENTAL_PREF_KEY = 'use-unicode-accidentals'
const MUSICIAN_TYPE_KEY = 'musician_type'
const SECTION_DEFAULTS_KEY = 'section_defaults'
const ENABLE_CAPO_KEY = 'enable_capo'
const ENABLED_CAPO_FLAG_KEY = 'enabled_capo'

let cachedUseNashville = null
let cachedUseUnicodeAccidentals = null
let cachedMusicianType = null
let cachedCapoPreference = null

function readPreference() {
  if (cachedUseNashville !== null) return cachedUseNashville
  if (typeof localStorage === 'undefined') {
    cachedUseNashville = false
    return cachedUseNashville
  }
  const stored = localStorage.getItem(NASHVILLE_PREF_KEY)
  cachedUseNashville = stored === '1' || stored === 'true'
  return cachedUseNashville
}

export function getUseNashvilleNumbers() {
  return readPreference()
}

export function setUseNashvilleNumbers(value) {
  const normalized = !!value
  cachedUseNashville = normalized
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(NASHVILLE_PREF_KEY, normalized ? '1' : '0')
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nashville-preference-changed', { detail: normalized }))
  }
}

function readAccidentalPreference() {
  if (cachedUseUnicodeAccidentals !== null) return cachedUseUnicodeAccidentals
  if (typeof localStorage === 'undefined') {
    cachedUseUnicodeAccidentals = false
    return cachedUseUnicodeAccidentals
  }
  const stored = localStorage.getItem(ACCIDENTAL_PREF_KEY)
  cachedUseUnicodeAccidentals = stored === '1' || stored === 'true'
  return cachedUseUnicodeAccidentals
}

export function getUseUnicodeAccidentals() {
  return readAccidentalPreference()
}

export function setUseUnicodeAccidentals(value) {
  const normalized = !!value
  cachedUseUnicodeAccidentals = normalized
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ACCIDENTAL_PREF_KEY, normalized ? '1' : '0')
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('accidental-preference-changed', { detail: normalized }))
  }
}

function readMusicianTypePreference() {
  if (cachedMusicianType !== null) return cachedMusicianType
  if (typeof localStorage === 'undefined') {
    cachedMusicianType = 'general'
    return cachedMusicianType
  }
  const stored = localStorage.getItem(MUSICIAN_TYPE_KEY)
  cachedMusicianType = stored || 'general'
  return cachedMusicianType
}

export function getMusicianType() {
  return readMusicianTypePreference()
}

export function setMusicianType(value) {
  const validTypes = ['general', 'singer', 'drummer', 'guitarist']
  const normalized = validTypes.includes(value) ? value : 'general'
  cachedMusicianType = normalized

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MUSICIAN_TYPE_KEY, normalized)

    // Update dependent settings based on musician type
    if (normalized === 'general') {
      localStorage.setItem(SECTION_DEFAULTS_KEY, JSON.stringify({ all: 'all' }))
    } else if (normalized === 'singer' || normalized === 'drummer') {
      localStorage.setItem(SECTION_DEFAULTS_KEY, JSON.stringify({ all: 'lyrics' }))
    } else if (normalized === 'guitarist') {
      localStorage.setItem(SECTION_DEFAULTS_KEY, JSON.stringify({ all: 'all' }))
    }
  }

  if (typeof window !== 'undefined') {
    let defaultsDetail = null
    if (typeof localStorage !== 'undefined') {
      try {
        const storedDefaults = localStorage.getItem(SECTION_DEFAULTS_KEY)
        defaultsDetail = storedDefaults ? JSON.parse(storedDefaults) : null
      } catch {
        defaultsDetail = null
      }
    }
    window.dispatchEvent(
      new CustomEvent('section-defaults-changed', {
        detail: { musicianType: normalized, defaults: defaultsDetail },
      })
    )
  }
}

function readCapoPreferenceFromStorage() {
  if (typeof localStorage === 'undefined') {
    return false
  }
  const keys = [ENABLE_CAPO_KEY, ENABLED_CAPO_FLAG_KEY]
  return keys.some(key => {
    const value = localStorage.getItem(key)
    return value === 'true' || value === '1'
  })
}

export function getCapoPreference() {
  if (cachedCapoPreference === null) {
    cachedCapoPreference = readCapoPreferenceFromStorage()
  }
  return cachedCapoPreference
}

export function setCapoPreference(value) {
  const enabled = !!value
  cachedCapoPreference = enabled
  if (typeof localStorage !== 'undefined') {
    const storageValue = enabled ? 'true' : 'false'
    try {
      localStorage.setItem(ENABLE_CAPO_KEY, storageValue)
      localStorage.setItem(ENABLED_CAPO_FLAG_KEY, storageValue)
    } catch (error) {
      console.error('Failed to save capo preference', error)
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('capo-preference-changed', { detail: enabled }))
  }
}
