/**
 * People who can lead setlists in the current space.
 *
 * A person is { id, name }, where id is their Google account email. Setlists
 * store the leader as `owner` (name) and `ownerId` (id). The id is empty for a
 * leader entered by name only ("Other…" in the setlist form).
 */

import type { Person } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { getCurrentUserInfo } from './google-auth.ts'
import { getCurrentSpaceFull } from './space.ts'

/** The signed-in user as a person, or null if not signed in */
export async function getCurrentPerson(): Promise<Person | null> {
  // (getCurrentUserInfo gives null rather than failing)
  const user = await getCurrentUserInfo()
  if (!user?.email) return null
  return { id: user.email, name: user.name || user.email }
}

/**
 * The space's members (the people its Drive folder is shared with,
 * cached at each sync) plus the signed-in user, sorted by name.
 */
export async function getSpacePeople(): Promise<{ people: Person[]; me: Person | null }> {
  const [me, space] = await Promise.all([getCurrentPerson(), getCurrentSpaceFull()])
  const members = (space?.members || []).map(m => ({ id: m.email, name: m.name || m.email }))
  return { people: mergePeople(me ? [me, ...members] : members), me }
}

/** Combine lists of people, one entry per id (the first wins), sorted by name */
export function mergePeople(people: Person[]): Person[] {
  const byId = new Map<string, Person>()
  for (const person of people) {
    const key = person.id?.toLowerCase()
    if (key && !byId.has(key)) byId.set(key, person)
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * One-off: give setlists without a leader id to `me`, if their leader is me by
 * name or they have no leader. For setlists from before leaders had ids, while
 * everything was led by the one user. Saved with a new modifiedDate so they
 * sync. Returns how many were updated.
 */
export async function claimSetlistsWithoutOwnerId(
  db: ChordlessDB,
  me: Person | null | undefined
): Promise<number> {
  if (!me?.id) return 0
  let claimed = 0
  for (const setlist of await db.getAllSetlists()) {
    if (setlist.ownerId) continue
    const owner = setlist.owner?.trim() || ''
    if (owner && owner.toLowerCase() !== me.name.toLowerCase()) continue
    await db.saveSetlist({
      ...setlist,
      owner: me.name,
      ownerId: me.id,
      modifiedDate: new Date().toISOString(),
    })
    claimed++
  }
  return claimed
}

/**
 * Run claimSetlistsWithoutOwnerId once per space on this device. Once
 * done it doesn't run again, so a setlist later saved with "No leader" isn't
 * claimed.
 */
export async function claimSetlistsOnce(db: ChordlessDB, spaceId: string): Promise<number> {
  const key = `setlist-owner-ids-claimed:${spaceId}`
  try {
    if (localStorage.getItem(key)) return 0
    const me = await getCurrentPerson()
    if (!me) return 0 // not signed in: try again next time
    const claimed = await claimSetlistsWithoutOwnerId(db, me)
    localStorage.setItem(key, new Date().toISOString())
    return claimed
  } catch (error) {
    console.warn('[People] Could not set setlist leader ids:', error)
    return 0
  }
}
