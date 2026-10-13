/**
 * Making a setlist from a reviewed email: the songs the person confirmed, all of them in the
 * library, and the setlist with its details. The page that reviews the email is
 * components/setlist-email-import.ts; what it decides is passed in here.
 */
import type { Setlist, SongRecord, SongWithContent } from './data-types.ts'
import { type ChordlessDB, createSetlist } from './db.ts'
import type { ImportedSong } from './email-setlist.ts'
import { type LibrarySong, lyricsOf } from './import-plan.ts'
import { addToLibrary } from './other-songs.ts'

/** The words of charts already read, by chart and its content: a chart is read once */
export type LyricsCache = Map<string, string>

/**
 * The library's songs for matching: one for each song, its default variant if it has several,
 * with the words of its chart (for finding a song by a line of it). Then the songs of the other
 * databases the library does not have (a song it has is its own, whatever the others hold): they
 * are matched like the rest, and copied into the library when the setlist is made.
 */
export async function libraryForMatching(
  db: ChordlessDB,
  cache: LyricsCache = new Map(),
  elsewhere: SongWithContent[] = []
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
  for (const song of elsewhere) {
    if (byId.has(song.id)) continue
    library.push({
      uuid: song.uuid,
      id: song.id,
      title: song.title,
      ccli: song.ccliNumber,
      lyrics: lyricsOf(song.chordpro),
      ...(song.source ? { source: song.source } : {}),
    })
  }
  return library
}

/**
 * Songs of the library for a reviewed list: a song that is another database's is copied into the
 * library first (as adding it from the library's search does), and the setlist uses the copy
 */
export async function copyFromElsewhere(
  db: ChordlessDB,
  reviewed: ReviewedSong[],
  elsewhere: SongWithContent[]
): Promise<ReviewedSong[]> {
  const copies = new Map<string, LibrarySong>()
  const result: ReviewedSong[] = []
  for (const each of reviewed) {
    const { library } = each
    if (!library.source) {
      result.push(each)
      continue
    }
    let copy = copies.get(library.uuid)
    if (!copy) {
      const original = elsewhere.find(song => song.uuid === library.uuid)
      if (!original) throw new Error(`${library.title} is no longer in ${library.source.label}`)
      const added = await addToLibrary(original, db)
      copy = { uuid: added.uuid, id: added.id, title: added.title, ccli: added.ccliNumber }
      copies.set(library.uuid, copy)
    }
    result.push({ ...each, library: copy })
  }
  return result
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
