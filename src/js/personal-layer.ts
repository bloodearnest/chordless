/**
 * What a person keeps for themselves, taken into an export and put back from one (docs/PERSONAL_LAYER.md,
 * "Export"): their capo, tuning and pitch for each setlist and song, the sections they show, their own
 * annotations and the songs they added for themselves, and the settings that describe them and not the
 * device (what they play, how the chart looks). It is a file they carry; nothing of it is synced.
 *
 * Putting it back only fills what the device lacks: it never overwrites what is kept here.
 */
import type { SetlistEntry } from './data-types.ts'
import type { ChordlessDB } from './db.ts'

/** The settings that are the person's and not the device's (what they play, how the chart reads) */
export const PERSONAL_PREFERENCE_KEYS = [
  'musician_type',
  'section_defaults',
  'enable_capo',
  'enabled_capo',
  'enable_pitch',
  'pitch',
  'tuning',
  'chord_tint',
  'font_ui',
  'font_lyrics',
  'font_chords',
] as const

/** What the personal layer of a space holds, as it goes in `personal.json` */
export interface PersonalLayer {
  /** For each setlist: what the device kept for it (as stored) and the songs added for the person alone */
  setlists: Record<string, { state?: unknown; local?: SetlistEntry[] }>
  /** What the person set for each song of the space (capo, sections, the click, the pad set) */
  songPrefs: Record<string, unknown>
  /** The person's settings, by key, as stored */
  preferences: Record<string, string>
}

const stateKey = (setlistId: string) => `state-${setlistId}`
const songPrefsKey = (spaceId: string) => `song-prefs-${spaceId}`

function readJson(key: string): unknown {
  try {
    const text = localStorage.getItem(key)
    return text === null ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The personal layer of a space, for the setlists given (those the export holds); null if there is none to keep */
export async function collectPersonalLayer(
  db: ChordlessDB,
  setlistIds: string[]
): Promise<PersonalLayer | null> {
  const layer: PersonalLayer = { setlists: {}, songPrefs: {}, preferences: {} }
  for (const id of setlistIds) {
    const state = readJson(stateKey(id))
    const local = (await db.getSetlist(id))?.songs.filter(entry => entry.local) ?? []
    if (state === undefined && local.length === 0) continue
    layer.setlists[id] = {
      ...(state === undefined ? {} : { state }),
      ...(local.length > 0 ? { local } : {}),
    }
  }
  const prefs = readJson(songPrefsKey(db.spaceId))
  if (isRecord(prefs)) layer.songPrefs = prefs
  for (const key of PERSONAL_PREFERENCE_KEYS) {
    const value = localStorage.getItem(key)
    if (value !== null) layer.preferences[key] = value
  }
  const empty =
    Object.keys(layer.setlists).length === 0 &&
    Object.keys(layer.songPrefs).length === 0 &&
    Object.keys(layer.preferences).length === 0
  return empty ? null : layer
}

/** What putting the layer back did */
export interface PersonalRestoreReport {
  setlists: number
  songs: number
  preferences: number
}

/**
 * Put a personal layer back into a space: for each setlist, what the device kept is restored where it
 * kept nothing, and the songs the person added are added again if the setlist does not have them. What is
 * kept here is not overwritten, and a setlist the space does not have is skipped.
 */
export async function restorePersonalLayer(
  layer: PersonalLayer,
  db: ChordlessDB
): Promise<PersonalRestoreReport> {
  const report: PersonalRestoreReport = { setlists: 0, songs: 0, preferences: 0 }
  for (const [id, kept] of Object.entries(layer.setlists)) {
    const setlist = await db.getSetlist(id)
    if (!setlist) continue
    let touched = false
    if (kept.state !== undefined && localStorage.getItem(stateKey(id)) === null) {
      localStorage.setItem(stateKey(id), JSON.stringify(kept.state))
      touched = true
    }
    const toAdd = (kept.local ?? []).filter(
      entry => entry.local && !setlist.songs.some(each => each.songUuid === entry.songUuid)
    )
    if (toAdd.length > 0) {
      await db.saveSetlist({
        ...setlist,
        songs: [...setlist.songs, ...toAdd].map((entry, order) => ({ ...entry, order })),
      })
      report.songs += toAdd.length
      touched = true
    }
    if (touched) report.setlists++
  }
  if (Object.keys(layer.songPrefs).length > 0) {
    const have = readJson(songPrefsKey(db.spaceId))
    const merged = { ...layer.songPrefs, ...(isRecord(have) ? have : {}) }
    localStorage.setItem(songPrefsKey(db.spaceId), JSON.stringify(merged))
  }
  for (const [key, value] of Object.entries(layer.preferences)) {
    if (!(PERSONAL_PREFERENCE_KEYS as readonly string[]).includes(key)) continue
    if (localStorage.getItem(key) !== null || typeof value !== 'string') continue
    localStorage.setItem(key, value)
    report.preferences++
  }
  return report
}
