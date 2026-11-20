/**
 * Setlists across all of the device's spaces, so that a page need not be "in" one space to show
 * them (docs/CENTRAL_STORAGE.md, phase 0). A setlist id is a random UUID and is taken to be unique
 * across spaces (D1 will enforce it): the URL is `/setlist/<id>`, and the space is found from it.
 */
import type { Setlist, SongWithContent, Space } from './data-types.ts'
import { type ChordlessDB, openSpace } from './db.ts'
import { defaultSpaceOf, importTargetOf } from './default-space.ts'
import { getSongWithContent } from './song-utils.ts'
import { ensureCurrentSpace, listSpaces } from './space.ts'

/** Run something with a space's database open, and let go of it after (many spaces are read in turn) */
export async function withSpace<T>(
  spaceId: string,
  use: (db: ChordlessDB) => Promise<T>
): Promise<T> {
  const db = await openSpace(spaceId)
  try {
    return await use(db)
  } finally {
    db.db?.close()
  }
}

/** A setlist with the space it is kept in */
export interface SpaceSetlist {
  setlist: Setlist
  space: Space
}

/** Every setlist of every space, each with its space */
export async function listAllSetlists(spaces?: Space[]): Promise<SpaceSetlist[]> {
  const all = spaces ?? (await listSpaces())
  const lists = await Promise.all(
    all.map(space =>
      withSpace(space.id, async db =>
        (await db.getAllSetlists()).map(setlist => ({ setlist, space }))
      )
    )
  )
  return lists.flat()
}

/**
 * The space a setlist is in. The id is unique, except for a moment while a setlist is moved or a
 * received share is joined: then the default space's copy is the one meant.
 */
export async function findSetlistSpace(id: string, spaces?: Space[]): Promise<Space | undefined> {
  const all = spaces ?? (await listSpaces())
  const found: Space[] = []
  for (const space of all) {
    if (await withSpace(space.id, db => db.getSetlist(id))) found.push(space)
  }
  return found.length > 1 ? defaultSpaceOf(found) : found[0]
}

/** A song with the space it is in */
export interface SpaceSong {
  song: SongWithContent
  space: Space
}

/** The song with this uuid, from whichever of the spaces has it (the default space's if several do) */
export async function findSong(uuid: string, spaces?: Space[]): Promise<SpaceSong | undefined> {
  const all = spaces ?? (await listSpaces())
  const found: SpaceSong[] = []
  for (const space of all) {
    const song = await withSpace(space.id, async db =>
      (await db.getSong(uuid)) ? await getSongWithContent(uuid, db) : undefined
    )
    if (song) found.push({ song, space })
  }
  const chosen = found.length > 1 ? defaultSpaceOf(found.map(entry => entry.space)) : undefined
  return found.find(entry => entry.space.id === chosen?.id) ?? found[0]
}

/**
 * The database new things go to when no space was asked for: the default space's (or the first one
 * that can be written to). A device with no space gets its first made.
 */
export async function openDefaultSpace(): Promise<ChordlessDB> {
  const target = importTargetOf(await listSpaces())
  /* v8 ignore next 2 -- a device with no space at all: the tests always have some */
  return openSpace((target ?? (await ensureCurrentSpace())).id)
}
