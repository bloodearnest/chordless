/**
 * Which spaces the library lists songs from. The library shows the songs of all of the device's
 * spaces (and "Shared with me"), each in its own space; a filter bar lets a person leave a place out
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

/** Where a song of the library list is kept: its own space, or the database it came from ("Shared with me") */
export function placeOf(song: SongWithContent, names: ReadonlyMap<string, string>): LibraryPlace {
  if (song.source) return { id: song.source.dbId, label: song.source.label }
  const id = song.spaceId ?? ''
  return { id, label: names.get(id) ?? '' }
}

/** The places the songs are in, each once, in the order they come */
export function placesOf(
  songs: SongWithContent[],
  names: ReadonlyMap<string, string>
): LibraryPlace[] {
  const places = new Map<string, LibraryPlace>()
  for (const song of songs) {
    const place = placeOf(song, names)
    if (!places.has(place.id)) places.set(place.id, place)
  }
  return [...places.values()]
}

/** The songs that are not in a place left out */
export function filterByPlace(
  songs: SongWithContent[],
  leftOut: readonly string[],
  names: ReadonlyMap<string, string>
): SongWithContent[] {
  if (leftOut.length === 0) return songs
  return songs.filter(song => !leftOut.includes(placeOf(song, names).id))
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
