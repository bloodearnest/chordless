/**
 * What a setlist keeps on this device, in localStorage, and not in the setlist (so not in Drive):
 * how each part of each song is shown (the user's own choices in this setlist), and each song's
 * capo. Both are kept by the song (its uuid), not by its place in the setlist, so a setlist that
 * someone else reorders or adds to leaves them with the song they were set for. (A song that is in
 * the setlist twice shares them.) The page works on them by place, as the songs are on the page.
 */
import type { ChartAnnotation, SectionState } from '../data-types.ts'
import { normalizePitch, type PitchId } from '../instrument-pitch.ts'
import { normalizeTuning, type Tuning } from '../tuning.ts'

/** Per song index, then per section index */
export type SectionStates = Record<number, Record<number, SectionState>>

export interface SetlistLocalState {
  sectionState: SectionStates
  /** Per song index */
  capoValues: Record<string, unknown>
}

/** What identifies a song in a setlist */
export interface SongRef {
  songId: string
  songUuid?: string
}

/** What is stored: by song, marked with its version (before it, by place in the setlist) */
interface StoredState {
  v: 2
  sections: Record<string, Record<number, SectionState>>
  capos: Record<string, unknown>
  /**
   * This setlist's private annotations on each song (docs/ANNOTATIONS.md). An optional field of
   * version 2, so a build from before annotations keeps it when it saves
   */
  annotations?: Record<string, ChartAnnotation[]>
  /** What `annotations` was called until 2026-11-06: read, and moved to `annotations` when saved */
  notes?: Record<string, ChartAnnotation[]>
  /** How the guitar is tuned for this setlist (docs/PERSONAL_LAYER.md); none: the device's */
  tuning?: number
  /** The instrument pitch for this setlist; none: the device's */
  pitch?: string
  /** The instrument pitch for each song that has its own, by song: it wins over the setlist's */
  pitches?: Record<string, string>
}

const keyFor = (setlistId: string | null) => `state-${setlistId}`

/**
 * Whether two entries of a setlist are the same song. An older entry named the song by its id alone, and is given the
 * uuid when it is saved (db.ts, `fillEntryMetadata`), so a copy taken before then, with no uuid, is the same song.
 */
export function sameSong(a: SongRef | undefined, b: SongRef): boolean {
  return a?.songId === b.songId && (a.songUuid === b.songUuid || !a.songUuid || !b.songUuid)
}

/** The song a record of state is kept under */
const songKey = (song: SongRef) => song.songUuid || song.songId

/**
 * What is kept for a song: under its uuid, or under its id if it was kept while its entry named the song by id alone (an
 * older entry is given the uuid when it is saved, and what was kept moves to it at the next save: `byUuid`)
 */
function keptFor<T>(record: Record<string, T> | undefined, song: SongRef): T | undefined {
  const value = record?.[songKey(song)]
  return value !== undefined || !song.songUuid ? value : record?.[song.songId]
}

/** What was kept under the id of a song that now has its uuid, moved to the uuid (unless a song of the setlist still goes by the id) */
function byUuid(saved: StoredState, songs: SongRef[]): StoredState {
  const stored = structuredClone(saved)
  const byId = new Set(songs.filter(song => !song.songUuid).map(song => song.songId))
  for (const record of [
    stored.sections,
    stored.capos,
    stored.pitches,
    stored.annotations,
    stored.notes,
  ] as (Record<string, unknown> | undefined)[]) {
    if (!record) continue
    for (const song of songs) {
      const uuid = song.songUuid
      if (!uuid || byId.has(song.songId) || record[song.songId] === undefined) continue
      if (record[uuid] === undefined) record[uuid] = record[song.songId]
      delete record[song.songId]
    }
  }
  return stored
}

function readSaved(setlistId: string | null): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(keyFor(setlistId)) ?? 'null') ?? {}
  } catch (error) {
    console.error('Failed to parse saved state:', error)
    return {}
  }
}

/**
 * What was kept by place, as older versions did (the section states at the top level, and the
 * capos as `capo`).
 */
function byPlace(saved: Record<string, unknown>): SetlistLocalState {
  return {
    sectionState: (saved.sectionState ??
      Object.fromEntries(
        Object.entries(saved).filter(([key]) => /^\d+$/.test(key))
      )) as SectionStates,
    capoValues: (saved.capoValues ?? saved.capo ?? {}) as Record<string, unknown>,
  }
}

/** What was kept, by song, as it is in the stored form (what was kept by place is taken to be where the songs are now) */
function bySong(saved: Record<string, unknown>, songs: SongRef[]): StoredState {
  if (saved.v === 2) return byUuid(saved as unknown as StoredState, songs)
  const old = byPlace(saved)
  const stored: StoredState = { v: 2, sections: {}, capos: {} }
  songs.forEach((song, index) => {
    if (old.sectionState[index]) stored.sections[songKey(song)] = old.sectionState[index]
    if (old.capoValues[index] !== undefined) stored.capos[songKey(song)] = old.capoValues[index]
  })
  return stored
}

/**
 * What was kept, for the songs of the setlist as they are now (by place). Where it was kept by
 * place it is read as it was, and kept by song from the next save.
 */
export function loadSetlistLocalState(
  setlistId: string | null,
  songs: SongRef[]
): SetlistLocalState {
  const saved = readSaved(setlistId)
  if (saved.v !== 2) return byPlace(saved)
  const { sections, capos } = bySong(saved, songs)
  const state: SetlistLocalState = { sectionState: {}, capoValues: {} }
  songs.forEach((song, index) => {
    const key = songKey(song)
    if (sections?.[key]) state.sectionState[index] = sections[key]
    if (capos?.[key] !== undefined) state.capoValues[index] = capos[key]
  })
  return state
}

/** The capo kept for one song (`index` is its place, for what was kept by place) */
export function loadSongCapo(setlistId: string | null, song: SongRef, index: number): unknown {
  const saved = readSaved(setlistId)
  return saved.v === 2
    ? keptFor((saved as unknown as StoredState).capos, song)
    : byPlace(saved).capoValues[index]
}

/** The tuning kept for this setlist, or null for the device's */
export function loadSetlistTuning(setlistId: string | null): Tuning | null {
  const saved = readSaved(setlistId)
  return saved.v === 2 && (saved as unknown as StoredState).tuning !== undefined
    ? normalizeTuning((saved as unknown as StoredState).tuning)
    : null
}

/** Keep a tuning for this setlist (null: the device's). `songs` are the setlist's, for state still kept by place. */
export function saveSetlistTuning(
  setlistId: string | null,
  tuning: Tuning | null,
  songs: SongRef[]
) {
  try {
    const stored = bySong(readSaved(setlistId), songs)
    if (tuning === null) delete stored.tuning
    else stored.tuning = tuning
    localStorage.setItem(keyFor(setlistId), JSON.stringify(stored))
  } catch (error) {
    console.error('Failed to save the setlist tuning:', error)
  }
}

/** The instrument pitch kept for this setlist, or null for the device's */
export function loadSetlistPitch(setlistId: string | null): PitchId | null {
  const saved = readSaved(setlistId)
  const pitch = saved.v === 2 ? (saved as unknown as StoredState).pitch : undefined
  return pitch === undefined ? null : normalizePitch(pitch)
}

/** Keep an instrument pitch for this setlist (null: the device's) */
export function saveSetlistPitch(
  setlistId: string | null,
  pitch: PitchId | null,
  songs: SongRef[]
) {
  try {
    const stored = bySong(readSaved(setlistId), songs)
    if (pitch === null) delete stored.pitch
    else stored.pitch = pitch
    localStorage.setItem(keyFor(setlistId), JSON.stringify(stored))
  } catch (error) {
    console.error('Failed to save the setlist pitch:', error)
  }
}

/** The instrument pitch each song has of its own, by place in the setlist */
export function loadSongPitches(
  setlistId: string | null,
  songs: SongRef[]
): Record<number, PitchId> {
  const saved = readSaved(setlistId)
  const kept = saved.v === 2 ? (saved as unknown as StoredState).pitches : undefined
  const pitches: Record<number, PitchId> = {}
  songs.forEach((song, index) => {
    const pitch = keptFor(kept, song)
    if (pitch !== undefined) pitches[index] = normalizePitch(pitch)
  })
  return pitches
}

/** Keep an instrument pitch for one song of this setlist (null: it follows the setlist's again) */
export function saveSongPitch(
  setlistId: string | null,
  song: SongRef,
  pitch: PitchId | null,
  songs: SongRef[]
) {
  try {
    const stored = bySong(readSaved(setlistId), songs)
    stored.pitches ??= {}
    if (pitch === null) delete stored.pitches[songKey(song)]
    else stored.pitches[songKey(song)] = pitch
    if (Object.keys(stored.pitches).length === 0) delete stored.pitches
    localStorage.setItem(keyFor(setlistId), JSON.stringify(stored))
  } catch (error) {
    console.error('Failed to save the song pitch:', error)
  }
}

/** The private annotations kept for one song in this setlist (by song, so a reordered setlist keeps them) */
export function loadSetlistAnnotations(setlistId: string | null, song: SongRef): ChartAnnotation[] {
  const saved = readSaved(setlistId)
  if (saved.v !== 2) return []
  const stored = saved as unknown as StoredState
  return keptFor(stored.annotations ?? stored.notes, song) ?? []
}

/**
 * Keep these as the private annotations for one song in this setlist (none: forget them). `songs` are
 * the setlist's, as they are now, for state still kept by place to be moved to by song.
 */
export function saveSetlistAnnotations(
  setlistId: string | null,
  song: SongRef,
  annotations: ChartAnnotation[],
  songs: SongRef[]
) {
  try {
    const stored = bySong(readSaved(setlistId), songs)
    stored.annotations ??= stored.notes ?? {}
    delete stored.notes
    if (annotations.length) stored.annotations[songKey(song)] = annotations
    else delete stored.annotations[songKey(song)]
    localStorage.setItem(keyFor(setlistId), JSON.stringify(stored))
  } catch (error) {
    console.error('Failed to save the annotations:', error)
  }
}

/**
 * Keep what is set for the songs of the setlist as they are now (by place). What was kept for
 * songs that are not in it is left, for when they are.
 */
export function saveSetlistLocalState(
  setlistId: string | null,
  state: SetlistLocalState,
  songs: SongRef[]
) {
  try {
    const stored = bySong(readSaved(setlistId), songs)
    stored.sections ??= {}
    stored.capos ??= {}
    const last = new Map<string, number>()
    songs.forEach((song, index) => {
      last.set(songKey(song), index)
    })
    for (const [key, index] of last) {
      if (state.sectionState[index]) stored.sections[key] = state.sectionState[index]
      else delete stored.sections[key]
      if (state.capoValues[index] !== undefined) stored.capos[key] = state.capoValues[index]
      else delete stored.capos[key]
    }
    localStorage.setItem(keyFor(setlistId), JSON.stringify(stored))
  } catch (error) {
    console.error('Failed to save the setlist state:', error)
  }
}

/**
 * A page that moves a song moves what it holds for the songs by place: a record kept by song
 * index with its keys renumbered (null drops the key).
 */
export function renumberSongs<T>(
  record: Record<number | string, T>,
  newIndex: (index: number) => number | null
): Record<number, T> {
  const renumbered: Record<number, T> = {}
  for (const [key, value] of Object.entries(record)) {
    const index = newIndex(Number(key))
    if (index !== null) renumbered[index] = value
  }
  return renumbered
}

/** The new place of each song index when the song at `from` is moved to `to` */
export const afterMove = (from: number, to: number) => (index: number) => {
  if (index === from) return to
  if (from < to && index > from && index <= to) return index - 1
  if (from > to && index >= to && index < from) return index + 1
  return index
}

/** Forget it all: the setlist has been deleted */
export function clearSetlistLocalState(setlistId: string) {
  localStorage.removeItem(keyFor(setlistId))
}
