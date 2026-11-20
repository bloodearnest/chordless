/**
 * Setlists across all of the device's spaces, so that a page need not be "in" one space to show
 * them (docs/CENTRAL_STORAGE.md, phase 0). A setlist id is a random UUID and is taken to be unique
 * across spaces (D1 will enforce it): the URL is `/setlist/<id>`, and the space is found from it.
 */
import type { Setlist, Space } from './data-types.ts'
import { openSpace } from './db.ts'
import { defaultSpaceOf } from './default-space.ts'
import { listSpaces } from './space.ts'

/** A setlist with the space it is kept in */
export interface SpaceSetlist {
  setlist: Setlist
  space: Space
}

/** Every setlist of every space, each with its space */
export async function listAllSetlists(spaces?: Space[]): Promise<SpaceSetlist[]> {
  const all = spaces ?? (await listSpaces())
  const lists = await Promise.all(
    all.map(async space => {
      const db = await openSpace(space.id)
      return (await db.getAllSetlists()).map(setlist => ({ setlist, space }))
    })
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
    if (await (await openSpace(space.id)).getSetlist(id)) found.push(space)
  }
  return found.length > 1 ? defaultSpaceOf(found) : found[0]
}
