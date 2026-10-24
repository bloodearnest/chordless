/**
 * What a setlist keeps on this device, in localStorage, and not in the setlist (so not in Drive):
 * how each part of each song is shown (the user's own choices in this setlist), and each song's
 * capo. Both are kept by the song (its uuid), not by its place in the setlist, so a setlist that
 * someone else reorders or adds to leaves them with the song they were set for. (A song that is in
 * the setlist twice shares them.) The page works on them by place, as the songs are on the page.
 */
import type { SectionState } from '../data-types.ts'

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
}

const keyFor = (setlistId: string | null) => `state-${setlistId}`

/** The song a record of state is kept under */
const songKey = (song: SongRef) => song.songUuid || song.songId

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
  if (saved.v === 2) return saved as unknown as StoredState
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
    ? (saved as unknown as StoredState).capos?.[songKey(song)]
    : byPlace(saved).capoValues[index]
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
