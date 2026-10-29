/**
 * The people of the current space, who can lead its setlists (docs/IDENTITIES.md). A setlist's
 * leader is a person's id (`leaderId`); the people are stored with the space.
 */

import type { Person } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { getCurrentUserInfo } from './google-auth.ts'
import { findPerson, idFromKey, normalizeEmail } from './leaders.ts'
import { getCurrentSpaceFull } from './space.ts'

/** The signed-in Google account, or null if not signed in */
export async function getSignedInUser(): Promise<{ email: string; name: string } | null> {
  // (getCurrentUserInfo gives null rather than failing)
  const user = await getCurrentUserInfo()
  if (!user?.email) return null
  return { email: normalizeEmail(user.email), name: user.name || user.email }
}

/**
 * The person for a name and/or email, found among `people` or made: someone with that email, else
 * someone of that name (who gains the email if they had none), else a new person. Returns the
 * person and the list as it should now be stored (`changed` are the people to save).
 */
export function personFor(
  people: Person[],
  who: { name?: string | null; email?: string | null },
  now = new Date().toISOString()
): { person: Person; changed: Person[] } | null {
  const email = normalizeEmail(who.email)
  const name = (who.name ?? '').trim()
  if (!email && !name) return null
  const found = findPerson(people, { name, email })
  if (found) {
    if (email && !found.emails.includes(email) && found.emails.length === 0) {
      const person = { ...found, emails: [email], modifiedDate: now }
      return { person, changed: [person] }
    }
    return { person: found, changed: [] }
  }
  const person: Person = {
    id: idFromKey(email ? `email:${email}` : `name:${name.toLowerCase()}`),
    name: name || email,
    emails: email ? [email] : [],
    modifiedDate: now,
  }
  return { person, changed: [person] }
}

/**
 * The space's people, with a person for each of the space's members and for the signed-in user
 * if they have none yet; and the signed-in user's own person.
 */
export async function getSpacePeople(
  db: ChordlessDB
): Promise<{ people: Person[]; me: Person | null }> {
  const [user, space] = await Promise.all([getSignedInUser(), getCurrentSpaceFull()])
  let people = await db.getAllPeople()
  const known = [
    ...(user ? [{ name: user.name, email: user.email }] : []),
    ...(space?.members || []).map(m => ({ name: m.name || m.email, email: m.email })),
  ]
  const changed = new Map<string, Person>()
  for (const who of known) {
    const made = personFor(people, who)
    if (!made) continue
    for (const person of made.changed) changed.set(person.id, person)
    people = [...people.filter(p => p.id !== made.person.id), made.person]
  }
  if (changed.size) await db.savePeople([...changed.values()])
  const me = user ? (findPerson(people, { email: user.email }) ?? null) : null
  return { people: livePeople(people), me }
}

/** The people not merged into another, sorted by name */
export function livePeople(people: Person[]): Person[] {
  return people.filter(person => !person.mergedInto).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The details of a setlist form as setlist fields: a leader typed in with "Other…" is found among
 * the people or made, and saved, so what is returned has only a `leaderId`.
 */
export async function settleLeader<T extends { leaderId: string; newLeader?: string }>(
  db: ChordlessDB,
  details: T
): Promise<Omit<T, 'newLeader'>> {
  const { newLeader, ...rest } = details
  if (!newLeader?.trim()) return rest
  // (a name was typed, so there is a person for it)
  const made = personFor(await db.getAllPeople(), { name: newLeader }) as NonNullable<
    ReturnType<typeof personFor>
  >
  await db.savePeople(made.changed)
  return { ...rest, leaderId: made.person.id }
}
