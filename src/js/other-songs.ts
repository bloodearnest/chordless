/**
 * Songs in this device's other databases: the songs of the other spaces on the device (what was received in a share is not here: it
 * stays inside the share). They can be found and read
 * from the current space's library, and added to it (copied; nothing is moved or
 * deleted, and what is in another database stays there).
 */

import type { SongSource, SongWithContent } from './data-types.ts'
import { ChordlessDB } from './db.ts'
import { databaseExists, SHARED_DB_ID } from './share-receiver.ts'
import { addChart, getLibrarySongs, getSongWithContent } from './song-utils.ts'
import { getSpaceById, listSpaces } from './space.ts'
import { t } from './text.ts'
import { UserError } from './utils/errors.ts'

/** The databases other than the current space's that may hold songs (what was received in a share is not one: it stays in its share) */
async function otherSources(currentDbId: string): Promise<SongSource[]> {
  const sources: SongSource[] = []
  if ((await getSpaceById(currentDbId))?.team?.churchId) return sources
  for (const space of await listSpaces()) {
    if (space.id === currentDbId || space.team?.churchId) continue
    if (await databaseExists(space.id)) {
      sources.push({ dbId: space.id, label: space.name })
    }
  }
  return sources
}

/** Run something with a source's database open, and let go of it after */
export async function withSource<T>(
  dbId: string,
  use: (db: ChordlessDB) => Promise<T>
): Promise<T> {
  const db = new ChordlessDB(dbId)
  await db.init()
  try {
    return await use(db)
  } finally {
    db.db?.close()
  }
}

/**
 * The songs of the other databases, each marked with where it is from. A song in more than
 * one is listed once (the first, "Shared with me" before spaces).
 */
export async function getSongsElsewhere(currentDbId: string): Promise<SongWithContent[]> {
  const found = new Map<string, SongWithContent>()
  let sources: SongSource[] = []
  try {
    sources = await otherSources(currentDbId)
  } catch (error) {
    // The library works without the others
    console.error('[Songs] Could not look for the songs of other databases:', error)
  }
  for (const source of sources) {
    try {
      const songs = await withSource(source.dbId, db => getLibrarySongs(db))
      for (const song of songs) {
        if (!found.has(song.id)) found.set(song.id, { ...song, source })
      }
    } catch (error) {
      console.error(`[Songs] Could not read the songs of ${source.label}:`, error)
    }
  }
  return [...found.values()]
}

/**
 * The songs of a space marked with its name, where the device has more than one space (with one,
 * saying which each is in is noise): the library lists them with songs of other spaces
 */
export function withSpaceName(
  songs: SongWithContent[],
  spaceCount: number,
  spaceName: string,
  spaceId?: string
): SongWithContent[] {
  return songs.map(song => ({
    ...song,
    ...(spaceId ? { spaceId } : {}),
    ...(spaceCount > 1 ? { spaceName } : {}),
  }))
}

/**
 * The library to search: the space's songs, and the other databases' songs it
 * doesn't have (a song it has is its own, whatever the others hold), by title.
 */
export function withSongsFromElsewhere(
  own: SongWithContent[],
  elsewhere: SongWithContent[]
): SongWithContent[] {
  const ids = new Set(own.map(song => song.id))
  return [...own, ...elsewhere.filter(song => !ids.has(song.id))].sort((a, b) =>
    (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase())
  )
}

/**
 * Add a song from another database to the space's library: a copy of its chart, which
 * is the same song if the library has that chart already, and a variant if it has the song in
 * another form. Sync takes it to Drive like any song of the library.
 * @returns the library's song
 */
export async function addToLibrary(
  song: SongWithContent,
  library: ChordlessDB
): Promise<SongWithContent> {
  // (a chart received in a share stays inside the share: it is read there, and no one's to copy)
  if (song.source?.dbId === SHARED_DB_ID) throw new UserError(t('share-no-song-copy'))
  if (
    song.source &&
    ((await getSpaceById(library.spaceId))?.team?.churchId ||
      (await getSpaceById(song.source.dbId))?.team?.churchId)
  )
    throw new UserError(t('church-no-song-copy'))
  const record = await addChart(library, song.chordpro, {
    variantLabel: 'Copied',
    importSource: song.importSource,
    importDate: song.importDate,
    importUser: song.importUser,
    makeDefault: 'first',
    title: song.title,
  })
  return getSongWithContent(record.uuid, library)
}
