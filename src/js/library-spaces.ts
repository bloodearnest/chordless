/**
 * Which spaces the library lists songs from. The library shows the current space's songs and those
 * of the device's other spaces (and "Shared with me"); a filter bar lets a person leave a place out
 * of the list. What was left out is kept in this browser, as the places to leave out rather than
 * the ones to keep, so a space made later is listed until it is left out.
 */
import type { SongWithContent } from './data-types.ts'

const KEY = 'library-places-left-out'

/** A place songs are listed from: a space of the device, or the songs shared with it */
export interface LibraryPlace {
  id: string
  label: string
}

/** Where a song of the library list is kept: its own database if it is from another, else the current space */
export function placeOf(song: SongWithContent, current: LibraryPlace): LibraryPlace {
  return song.source ? { id: song.source.dbId, label: song.source.label } : current
}

/** The places the songs are in, the current space first and the others as they come */
export function placesOf(songs: SongWithContent[], current: LibraryPlace): LibraryPlace[] {
  const places = new Map<string, LibraryPlace>([[current.id, current]])
  for (const song of songs) {
    const place = placeOf(song, current)
    if (!places.has(place.id)) places.set(place.id, place)
  }
  return [...places.values()]
}

/** The songs that are not in a place left out */
export function filterByPlace(
  songs: SongWithContent[],
  leftOut: readonly string[],
  current: LibraryPlace
): SongWithContent[] {
  if (leftOut.length === 0) return songs
  return songs.filter(song => !leftOut.includes(placeOf(song, current).id))
}

/** The ids of the places the person left out (none where nothing is kept, or it cannot be read) */
export function loadLeftOut(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Keep the places left out, for next time (the filter still works for this page where it can't be kept) */
export function saveLeftOut(ids: readonly string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // Not kept
  }
}
