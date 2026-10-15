/**
 * Songs in this device's other databases: what was received in shared setlists ("Shared with
 * me"), and the songs of the other organisations on the device. They can be found and read
 * from the current organisation's library, and added to it (copied; nothing is moved or
 * deleted, and what is in another database stays there).
 */

import type { SongSource, SongWithContent } from './data-types.ts'
import { ChordlessDB } from './db.ts'
import { listOrganisations } from './organisation.ts'
import { databaseExists, SHARED_DB_ID } from './share-receiver.ts'
import { addChart, getLibrarySongs, getSongWithContent } from './song-utils.ts'

const SHARED_LABEL = 'Shared with me'

/** The databases other than the current organisation's that may hold songs, shared first */
async function otherSources(currentDbId: string): Promise<SongSource[]> {
  const sources: SongSource[] = []
  if (currentDbId !== SHARED_DB_ID && (await databaseExists(SHARED_DB_ID))) {
    sources.push({ dbId: SHARED_DB_ID, label: SHARED_LABEL })
  }
  for (const organisation of await listOrganisations()) {
    if (organisation.id === currentDbId) continue
    if (await databaseExists(organisation.id)) {
      sources.push({ dbId: organisation.id, label: organisation.name })
    }
  }
  return sources
}

/** Run something with a source's database open, and let go of it after */
async function withSource<T>(dbId: string, use: (db: ChordlessDB) => Promise<T>): Promise<T> {
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
 * one is listed once (the first, "Shared with me" before organisations).
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
 * The library to search: the organisation's songs, and the other databases' songs it
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

/** The song with this uuid from the current organisation's database or, failing that, another */
export async function getSongFromAnywhere(
  uuid: string,
  currentDb: ChordlessDB
): Promise<SongWithContent> {
  if (await currentDb.getSong(uuid)) return getSongWithContent(uuid, currentDb)
  for (const source of await otherSources(currentDb.dbName)) {
    const song = await withSource(source.dbId, async db =>
      (await db.getSong(uuid)) ? { ...(await getSongWithContent(uuid, db)), source } : null
    )
    if (song) return song
  }
  throw new Error(`Song not found: ${uuid}`)
}

/**
 * Add a song from another database to the organisation's library: a copy of its chart, which
 * is the same song if the library has that chart already, and a variant if it has the song in
 * another form. Sync takes it to Drive like any song of the library.
 * @returns the library's song
 */
export async function addToLibrary(
  song: SongWithContent,
  library: ChordlessDB
): Promise<SongWithContent> {
  const record = await addChart(library, song.chordpro, {
    variantLabel: song.source?.dbId === SHARED_DB_ID ? 'Shared' : 'Copied',
    importSource: 'copy',
    makeDefault: 'first',
    title: song.title,
  })
  return getSongWithContent(record.uuid, library)
}
