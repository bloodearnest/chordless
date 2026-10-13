/**
 * Making a setlist from a reviewed email: the songs the person confirmed, all of them in the
 * library, and the setlist with its details. The page that reviews the email is
 * components/setlist-email-import.ts; what it decides is passed in here.
 */
import type { Setlist, SongRecord } from './data-types.ts'
import { type ChordlessDB, createSetlist } from './db.ts'
import type { ImportedSong } from './email-setlist.ts'
import { type LibrarySong, lyricsOf } from './import-plan.ts'

/** The words of charts already read, by chart and its content: a chart is read once */
export type LyricsCache = Map<string, string>

/**
 * The library's songs for matching: one for each song, its default variant if it has several,
 * with the words of its chart (for finding a song by a line of it)
 */
export async function libraryForMatching(
  db: ChordlessDB,
  cache: LyricsCache = new Map()
): Promise<LibrarySong[]> {
  const byId = new Map<string, SongRecord>()
  for (const record of await db.getAllSongs()) {
    if (record.isDefault || !byId.has(record.id)) byId.set(record.id, record)
  }
  const library: LibrarySong[] = []
  for (const record of byId.values()) {
    const key = `${record.chordproFileId}:${record.contentHash}`
    let lyrics = cache.get(key)
    if (lyrics === undefined) {
      lyrics = lyricsOf((await db.getChordPro(record.chordproFileId))?.content ?? '')
      cache.set(key, lyrics)
    }
    library.push({
      uuid: record.uuid,
      id: record.id,
      title: record.title,
      ccli: record.ccliNumber,
      lyrics,
    })
  }
  return library
}

/** A song the person has settled on: a song of the library, with the key and note for this setlist */
export interface ReviewedSong {
  song: ImportedSong
  /** The key to play it in */
  key: string | null
  notes: string
  /** The library's song it is */
  library: LibrarySong
}

/** Save the setlist, with these songs in this order */
export async function createImportedSetlist(
  db: ChordlessDB,
  details: Parameters<typeof createSetlist>[0],
  reviewed: ReviewedSong[]
): Promise<Setlist> {
  const setlist = createSetlist(details)
  setlist.songs = reviewed.map(({ song, key, notes, library }, order) => ({
    order,
    songId: library.id,
    songUuid: library.uuid,
    key,
    tempo: song.tempo,
    notes,
  }))
  await db.saveSetlist(setlist)
  return setlist
}
