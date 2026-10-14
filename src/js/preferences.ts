const MUSICIAN_TYPES = ['general', 'singer', 'drummer', 'guitarist'] as const
export type MusicianType = (typeof MUSICIAN_TYPES)[number]

function isMusicianType(value: unknown): value is MusicianType {
  return MUSICIAN_TYPES.includes(value as MusicianType)
}

/** What each part of a song shows by default, as stored: { all: 'all' | 'lyrics' | ... } */
export type SectionDefaults = Record<string, string>

/** The Nashville numbers preference changed (sent on window) */
export class NashvillePreferenceEvent extends Event {
  static readonly type = 'preferences:nashville-changed'
  readonly enabled: boolean
  constructor(enabled: boolean) {
    super(NashvillePreferenceEvent.type)
    this.enabled = enabled
  }
}

/** The unicode accidentals preference changed (sent on window) */
export class AccidentalsPreferenceEvent extends Event {
  static readonly type = 'preferences:accidentals-changed'
  readonly enabled: boolean
  constructor(enabled: boolean) {
    super(AccidentalsPreferenceEvent.type)
    this.enabled = enabled
  }
}

/** The section display defaults changed (sent on window) */
export class SectionDefaultsEvent extends Event {
  static readonly type = 'preferences:section-defaults-changed'
  readonly musicianType: MusicianType
  readonly defaults: SectionDefaults | null
  constructor(musicianType: MusicianType, defaults: SectionDefaults | null) {
    super(SectionDefaultsEvent.type)
    this.musicianType = musicianType
    this.defaults = defaults
  }
}

/** The capo preference changed (sent on window) */
export class CapoPreferenceEvent extends Event {
  static readonly type = 'preferences:capo-changed'
  readonly enabled: boolean
  constructor(enabled: boolean) {
    super(CapoPreferenceEvent.type)
    this.enabled = enabled
  }
}
/** The keep-the-screen-awake preference changed (sent on window) */
export class KeepAwakePreferenceEvent extends Event {
  static readonly type = 'preferences:keep-awake-changed'
  readonly enabled: boolean
  constructor(enabled: boolean) {
    super(KeepAwakePreferenceEvent.type)
    this.enabled = enabled
  }
}
/** The longest the screen is kept awake with no touch changed (sent on window) */
export class KeepAwakeLimitEvent extends Event {
  static readonly type = 'preferences:keep-awake-limit-changed'
  readonly minutes: number
  constructor(minutes: number) {
    super(KeepAwakeLimitEvent.type)
    this.minutes = minutes
  }
}
const NASHVILLE_PREF_KEY = 'use-nashville'
const ACCIDENTAL_PREF_KEY = 'use-unicode-accidentals'
const MUSICIAN_TYPE_KEY = 'musician_type'
const SECTION_DEFAULTS_KEY = 'section_defaults'
const ENABLE_CAPO_KEY = 'enable_capo'
const ENABLED_CAPO_FLAG_KEY = 'enabled_capo'
const SETUP_DONE_KEY = 'setup-done'
const KEEP_AWAKE_KEY = 'keep_screen_awake'
const KEEP_AWAKE_MINUTES_KEY = 'keep_awake_minutes'

/** The longest the screen is kept awake with no touch, in minutes: 0 is no limit */
export const KEEP_AWAKE_LIMITS = [15, 30, 60, 120, 240, 0] as const
export const DEFAULT_KEEP_AWAKE_MINUTES = 60

let cachedUseNashville: boolean | null = null
let cachedUseUnicodeAccidentals: boolean | null = null
let cachedMusicianType: MusicianType | null = null
let cachedCapoPreference: boolean | null = null

function readPreference(): boolean {
  if (cachedUseNashville !== null) return cachedUseNashville
  if (typeof localStorage === 'undefined') {
    cachedUseNashville = false
    return cachedUseNashville
  }
  const stored = localStorage.getItem(NASHVILLE_PREF_KEY)
  cachedUseNashville = stored === '1' || stored === 'true'
  return cachedUseNashville
}

export function getUseNashvilleNumbers(): boolean {
  return readPreference()
}

export function setUseNashvilleNumbers(value: boolean) {
  const normalized = !!value
  cachedUseNashville = normalized
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(NASHVILLE_PREF_KEY, normalized ? '1' : '0')
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new NashvillePreferenceEvent(normalized))
  }
}

function readAccidentalPreference(): boolean {
  if (cachedUseUnicodeAccidentals !== null) return cachedUseUnicodeAccidentals
  if (typeof localStorage === 'undefined') {
    cachedUseUnicodeAccidentals = false
    return cachedUseUnicodeAccidentals
  }
  const stored = localStorage.getItem(ACCIDENTAL_PREF_KEY)
  cachedUseUnicodeAccidentals = stored === '1' || stored === 'true'
  return cachedUseUnicodeAccidentals
}

export function getUseUnicodeAccidentals(): boolean {
  return readAccidentalPreference()
}

export function setUseUnicodeAccidentals(value: boolean) {
  const normalized = !!value
  cachedUseUnicodeAccidentals = normalized
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ACCIDENTAL_PREF_KEY, normalized ? '1' : '0')
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new AccidentalsPreferenceEvent(normalized))
  }
}

function readMusicianTypePreference(): MusicianType {
  if (cachedMusicianType !== null) return cachedMusicianType
  if (typeof localStorage === 'undefined') {
    cachedMusicianType = 'general'
    return cachedMusicianType
  }
  const stored = localStorage.getItem(MUSICIAN_TYPE_KEY)
  cachedMusicianType = isMusicianType(stored) ? stored : 'general'
  return cachedMusicianType
}

export function getMusicianType(): MusicianType {
  return readMusicianTypePreference()
}

export function setMusicianType(value: string) {
  const normalized = isMusicianType(value) ? value : 'general'
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
    let defaultsDetail: SectionDefaults | null = null
    if (typeof localStorage !== 'undefined') {
      try {
        const storedDefaults = localStorage.getItem(SECTION_DEFAULTS_KEY)
        defaultsDetail = storedDefaults ? JSON.parse(storedDefaults) : null
      } catch {
        defaultsDetail = null
      }
    }
    window.dispatchEvent(new SectionDefaultsEvent(normalized, defaultsDetail))
  }
}

function readCapoPreferenceFromStorage(): boolean {
  if (typeof localStorage === 'undefined') {
    return false
  }
  const keys = [ENABLE_CAPO_KEY, ENABLED_CAPO_FLAG_KEY]
  return keys.some(key => {
    const value = localStorage.getItem(key)
    return value === 'true' || value === '1'
  })
}

export function getCapoPreference(): boolean {
  if (cachedCapoPreference === null) {
    cachedCapoPreference = readCapoPreferenceFromStorage()
  }
  return cachedCapoPreference
}

export function setCapoPreference(value: boolean) {
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
    window.dispatchEvent(new CapoPreferenceEvent(enabled))
  }
}

/** Whether to keep the screen awake while a setlist is open: on unless the user turned it off */
export function getKeepAwakePreference(): boolean {
  try {
    return localStorage.getItem(KEEP_AWAKE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setKeepAwakePreference(value: boolean) {
  const enabled = !!value
  try {
    localStorage.setItem(KEEP_AWAKE_KEY, enabled ? 'true' : 'false')
  } catch (error) {
    console.error('Failed to save keep-awake preference', error)
  }
  window.dispatchEvent(new KeepAwakePreferenceEvent(enabled))
}

export function getKeepAwakeMinutes(): number {
  try {
    const stored = Number(localStorage.getItem(KEEP_AWAKE_MINUTES_KEY))
    return localStorage.getItem(KEEP_AWAKE_MINUTES_KEY) !== null &&
      (KEEP_AWAKE_LIMITS as readonly number[]).includes(stored)
      ? stored
      : DEFAULT_KEEP_AWAKE_MINUTES
  } catch {
    return DEFAULT_KEEP_AWAKE_MINUTES
  }
}

export function setKeepAwakeMinutes(minutes: number) {
  const value = (KEEP_AWAKE_LIMITS as readonly number[]).includes(minutes)
    ? minutes
    : DEFAULT_KEEP_AWAKE_MINUTES
  try {
    localStorage.setItem(KEEP_AWAKE_MINUTES_KEY, String(value))
  } catch (error) {
    console.error('Failed to save keep-awake limit', error)
  }
  window.dispatchEvent(new KeepAwakeLimitEvent(value))
}

/** The limit in ms, or Infinity for none */
export function keepAwakeLimitMs(minutes = getKeepAwakeMinutes()): number {
  return minutes === 0 ? Number.POSITIVE_INFINITY : minutes * 60 * 1000
}

declare global {
  interface GlobalEventHandlersEventMap {
    [KeepAwakeLimitEvent.type]: KeepAwakeLimitEvent
    [KeepAwakePreferenceEvent.type]: KeepAwakePreferenceEvent
    [NashvillePreferenceEvent.type]: NashvillePreferenceEvent
    [AccidentalsPreferenceEvent.type]: AccidentalsPreferenceEvent
    [SectionDefaultsEvent.type]: SectionDefaultsEvent
    [CapoPreferenceEvent.type]: CapoPreferenceEvent
  }
}

/** Whether the first-use setup (musician type, capo) has been answered, skipped or made unnecessary */
export function isSetupDone(): boolean {
  try {
    return localStorage.getItem(SETUP_DONE_KEY) === '1'
  } catch {
    return true
  }
}

export function markSetupDone() {
  try {
    localStorage.setItem(SETUP_DONE_KEY, '1')
  } catch (error) {
    console.error('Failed to save the setup flag', error)
  }
}

/** Whether a musician type has ever been stored, by the setup or in Preferences */
export function hasStoredMusicianType(): boolean {
  try {
    return localStorage.getItem(MUSICIAN_TYPE_KEY) !== null
  } catch {
    return false
  }
}
