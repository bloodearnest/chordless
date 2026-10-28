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
/** The anonymous usage reports preference changed (sent on window) */
export class TelemetryPreferenceEvent extends Event {
  static readonly type = 'preferences:telemetry-changed'
  readonly enabled: boolean
  constructor(enabled: boolean) {
    super(TelemetryPreferenceEvent.type)
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
/** The longest the screen is kept awake with no touch, in minutes: 0 is no limit */
export const KEEP_AWAKE_LIMITS = [15, 30, 60, 120, 240, 0] as const
export const DEFAULT_KEEP_AWAKE_MINUTES = 30

interface PreferenceSpec<T> {
  /** Where it is kept (the first), and older keys it is also read from and written to */
  keys: readonly string[]
  /** The value from what is stored under each key (null where nothing is) */
  read(stored: (string | null)[]): T
  /** The value as it is stored */
  write(value: T): string
  /** The value when storage cannot be asked */
  blocked: T
  /** The event that says it changed (sent on window), if one does */
  changed?(value: T): Event
  /** Whether a value that cannot be saved is kept in memory for now (yes, unless said) */
  remember?: boolean
}

/**
 * A preference kept in localStorage. Read afresh each time (another tab may have changed it); a
 * value that cannot be saved (storage is blocked or full) is kept in memory until the page is
 * left, so a change still works for now.
 */
function definePreference<T>(spec: PreferenceSpec<T>) {
  let unsaved: { value: T } | null = null
  return {
    get(): T {
      if (unsaved) return unsaved.value
      try {
        return spec.read(spec.keys.map(key => localStorage.getItem(key)))
      } catch {
        return spec.blocked
      }
    },
    set(value: T): void {
      try {
        for (const key of spec.keys) localStorage.setItem(key, spec.write(value))
        unsaved = null
      } catch (error) {
        console.error(`Failed to save the preference ${spec.keys[0]}`, error)
        if (spec.remember !== false) unsaved = { value }
      }
      if (spec.changed) window.dispatchEvent(spec.changed(value))
    },
  }
}

/** A switch stored as '1' or '0' (and read as 'true' too) */
const flag = (key: string, changed: (on: boolean) => Event) =>
  definePreference<boolean>({
    keys: [key],
    read: ([stored]) => stored === '1' || stored === 'true',
    write: on => (on ? '1' : '0'),
    blocked: false,
    changed,
  })

const nashville = flag('use-nashville', on => new NashvillePreferenceEvent(on))
const accidentals = flag('use-unicode-accidentals', on => new AccidentalsPreferenceEvent(on))

const MUSICIAN_TYPE_KEY = 'musician_type'
const musicianType = definePreference<MusicianType>({
  keys: [MUSICIAN_TYPE_KEY],
  read: ([stored]) => (isMusicianType(stored) ? stored : 'general'),
  write: type => type,
  blocked: 'general',
})

const EVERYTHING: SectionDefaults = { all: 'all' }
const sectionDefaults = definePreference<SectionDefaults>({
  keys: ['section_defaults'],
  read: ([stored]) => {
    const value: unknown = JSON.parse(stored ?? 'null')
    return value && typeof value === 'object' ? (value as SectionDefaults) : EVERYTHING
  },
  write: defaults => JSON.stringify(defaults),
  blocked: EVERYTHING,
})

// (kept under two keys: 'enable_capo' is the older)
const capo = definePreference<boolean>({
  keys: ['enable_capo', 'enabled_capo'],
  read: stored => stored.some(value => value === 'true' || value === '1'),
  write: on => (on ? 'true' : 'false'),
  blocked: false,
  changed: on => new CapoPreferenceEvent(on),
})

const keepAwake = definePreference<boolean>({
  keys: ['keep_screen_awake'],
  read: ([stored]) => stored !== 'false',
  write: on => (on ? 'true' : 'false'),
  blocked: true,
  changed: on => new KeepAwakePreferenceEvent(on),
})

// On unless turned off (docs/OBSERVABILITY.md). Where storage cannot be read it is off: nothing is
// sent that the person might have refused, and the id the reports carry could not be kept anyway.
const telemetry = definePreference<boolean>({
  keys: ['telemetry'],
  read: ([stored]) => stored !== 'false' && stored !== '0',
  write: on => (on ? 'true' : 'false'),
  blocked: false,
  changed: on => new TelemetryPreferenceEvent(on),
})

const isKeepAwakeLimit = (minutes: number) =>
  (KEEP_AWAKE_LIMITS as readonly number[]).includes(minutes)
const keepAwakeMinutes = definePreference<number>({
  keys: ['keep_awake_minutes'],
  read: ([stored]) =>
    stored !== null && isKeepAwakeLimit(Number(stored))
      ? Number(stored)
      : DEFAULT_KEEP_AWAKE_MINUTES,
  write: minutes => String(minutes),
  blocked: DEFAULT_KEEP_AWAKE_MINUTES,
  changed: minutes => new KeepAwakeLimitEvent(minutes),
})

const setupDone = definePreference<boolean>({
  keys: ['setup-done'],
  read: ([stored]) => stored === '1',
  write: () => '1',
  // (it cannot be asked again; and so there is nothing to remember)
  blocked: true,
  remember: false,
})

export const getUseNashvilleNumbers = (): boolean => nashville.get()
export const setUseNashvilleNumbers = (value: boolean) => nashville.set(!!value)

export const getUseUnicodeAccidentals = (): boolean => accidentals.get()
export const setUseUnicodeAccidentals = (value: boolean) => accidentals.set(!!value)

export const getMusicianType = (): MusicianType => musicianType.get()

/** Choose a musician type, which sets what each part of a song shows by default */
export function setMusicianType(value: string) {
  const type = isMusicianType(value) ? value : 'general'
  musicianType.set(type)
  // The singer and the drummer read the words, the others have everything
  const defaults: SectionDefaults = {
    all: type === 'singer' || type === 'drummer' ? 'lyrics' : 'all',
  }
  sectionDefaults.set(defaults)
  window.dispatchEvent(new SectionDefaultsEvent(type, defaults))
}

/** What each part of a song shows by default: the user's choice, or everything */
export const getSectionDefaults = (): SectionDefaults => sectionDefaults.get()

export const getCapoPreference = (): boolean => capo.get()
export const setCapoPreference = (value: boolean) => capo.set(!!value)

/** Whether to keep the screen awake while a setlist is open: on unless the user turned it off */
export const getKeepAwakePreference = (): boolean => keepAwake.get()
export const setKeepAwakePreference = (value: boolean) => keepAwake.set(!!value)

/** Whether anonymous usage and error reports are sent (docs/OBSERVABILITY.md): on unless the user turned it off */
export const getTelemetryPreference = (): boolean => telemetry.get()
export const setTelemetryPreference = (value: boolean) => telemetry.set(!!value)

export const getKeepAwakeMinutes = (): number => keepAwakeMinutes.get()
export function setKeepAwakeMinutes(minutes: number) {
  keepAwakeMinutes.set(isKeepAwakeLimit(minutes) ? minutes : DEFAULT_KEEP_AWAKE_MINUTES)
}

/** The limit in ms, or Infinity for none */
export function keepAwakeLimitMs(minutes = getKeepAwakeMinutes()): number {
  return minutes === 0 ? Number.POSITIVE_INFINITY : minutes * 60 * 1000
}

declare global {
  interface GlobalEventHandlersEventMap {
    [TelemetryPreferenceEvent.type]: TelemetryPreferenceEvent
    [KeepAwakeLimitEvent.type]: KeepAwakeLimitEvent
    [KeepAwakePreferenceEvent.type]: KeepAwakePreferenceEvent
    [NashvillePreferenceEvent.type]: NashvillePreferenceEvent
    [AccidentalsPreferenceEvent.type]: AccidentalsPreferenceEvent
    [SectionDefaultsEvent.type]: SectionDefaultsEvent
    [CapoPreferenceEvent.type]: CapoPreferenceEvent
  }
}

/** Whether the first-use setup (musician type, capo) has been answered, skipped or made unnecessary */
export const isSetupDone = (): boolean => setupDone.get()
export const markSetupDone = () => setupDone.set(true)

/** Whether a musician type has ever been stored, by the setup or in Preferences */
export function hasStoredMusicianType(): boolean {
  try {
    return localStorage.getItem(MUSICIAN_TYPE_KEY) !== null
  } catch {
    return false
  }
}
