/**
 * The people of the current space, who can lead its setlists (docs/IDENTITIES.md). A setlist's
 * leader is a person's id (`leaderId`); the people are stored with the space.
 */

import type { Person } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { getCurrentUserInfo } from './google-auth.ts'
import {
  findPerson,
  idFromKey,
  isLive,
  leaderCounts,
  mergePlan,
  NEW_PERSON,
  normalizeEmail,
  resolvePerson,
} from './leaders.ts'
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
  const person = newPerson({ name, email }, now) as Person
  return { person, changed: [person] }
}

/**
 * A new person for a name and/or email, with the id the same leader always gets (null for neither).
 * It is not looked for among the people: see `personFor` for that.
 */
export function newPerson(
  who: { name?: string | null; email?: string | null },
  now = new Date().toISOString()
): Person | null {
  const email = normalizeEmail(who.email)
  const name = (who.name ?? '').trim()
  if (!email && !name) return null
  return {
    id: idFromKey(email ? `email:${email}` : `name:${name.toLowerCase()}`),
    name: name || email,
    emails: email ? [email] : [],
    modifiedDate: now,
  }
}

/** Where this device keeps which person of a space is the one using it (not synced: it differs by device) */
const meKey = (spaceId: string) => `chordless:me:${spaceId}`

/** The person this device was told is the one using it, in a space, if it was told */
export function chosenMeId(spaceId: string): string | null {
  try {
    return localStorage.getItem(meKey(spaceId))
  } catch {
    // (storage may be unavailable: then it is worked out from the signed-in account as before)
    return null
  }
}

/**
 * Tell this device which person of the space is the one using it. The signed-in account's address
 * becomes one of that person's, so they are found by it from then on, on any device.
 */
export async function chooseMe(db: ChordlessDB, personId: string): Promise<void> {
  try {
    localStorage.setItem(meKey(db.spaceId), personId)
  } catch {
    // (kept for this session only by the address added below, if signed in)
  }
  const [user, person] = await Promise.all([getSignedInUser(), db.getPerson(personId)])
  if (user && person && !person.emails.includes(user.email)) {
    await db.savePeople([
      { ...person, emails: [...person.emails, user.email], modifiedDate: new Date().toISOString() },
    ])
  }
}

/**
 * The space's people, with a person for each of the space's members; and which one is the person
 * using the app (`me`): the one chosen on this device, else the one with the signed-in account's
 * address, else the one of that name who has no address yet (who gains it), else a new person.
 * Where the signed-in name is that of a person with other addresses it is not guessed, and
 * `askWho` says the person should be asked which one they are (`chooseMe`).
 */
export async function getSpacePeople(
  db: ChordlessDB
): Promise<{ people: Person[]; me: Person | null; askWho: boolean }> {
  const [user, space] = await Promise.all([getSignedInUser(), getCurrentSpaceFull()])
  let people = await db.getAllPeople()
  const changed = new Map<string, Person>()
  const keep = (made: NonNullable<ReturnType<typeof personFor>>): Person => {
    for (const person of made.changed) changed.set(person.id, person)
    people = [...people.filter(p => p.id !== made.person.id), made.person]
    return made.person
  }
  for (const member of space?.members || []) {
    const made = personFor(people, { name: member.name || member.email, email: member.email })
    if (made) keep(made)
  }

  let me: Person | null = null
  let askWho = false
  if (user) {
    const chosen = resolvePerson(people, chosenMeId(db.spaceId))
    const byEmail = findPerson(people, { email: user.email })
    const byName = findPerson(people, { name: user.name })
    if (chosen) {
      // (an address the person was chosen with is theirs from then on)
      if (chosen.emails.includes(user.email)) me = chosen
      else {
        const person = {
          ...chosen,
          emails: [...chosen.emails, user.email],
          modifiedDate: new Date().toISOString(),
        }
        me = keep({ person, changed: [person] })
      }
    } else if (byEmail) {
      me = byEmail
    } else if (byName && byName.emails.length > 0) {
      askWho = true
    } else {
      const made = personFor(people, { name: user.name, email: user.email })
      if (made) me = keep(made)
    }
  }
  if (changed.size) await db.savePeople([...changed.values()])
  return { people: livePeople(people), me, askWho }
}

/**
 * The person answered "which of these is you?" (`SetlistDetailsIdentifyEvent`): one of the
 * people, or NEW_PERSON for none of them, who is then made from the signed-in account.
 */
export async function identifyMe(db: ChordlessDB, answer: string): Promise<void> {
  if (answer !== NEW_PERSON) return chooseMe(db, answer)
  const user = await getSignedInUser()
  if (!user) return
  // (a new person, not the one of the same name: they said it is none of the people)
  const made = newPerson(user) as Person
  await db.addPeople([made])
  await chooseMe(db, made.id)
}

/**
 * Merge one person into another (docs/IDENTITIES.md, "People page"): the other gains their
 * addresses, the setlists they led are led by the other, and they are marked as merged. Resolves
 * with whether it was done (not if either is not one of the people).
 */
export async function mergePersonInto(
  db: ChordlessDB,
  fromId: string,
  intoId: string
): Promise<boolean> {
  const people = await db.getAllPeople()
  const plan = mergePlan(people, fromId, intoId)
  if (!plan) return false
  await db.savePeople(plan)
  const was = new Set([
    fromId,
    ...people.filter(each => each.mergedInto === fromId).map(each => each.id),
  ])
  const now = new Date().toISOString()
  for (const setlist of await db.getAllSetlists()) {
    if (!setlist.leaderId || !was.has(setlist.leaderId)) continue
    await db.updateSetlist(setlist.id, stored => {
      stored.leaderId = intoId
      stored.modifiedDate = now
    })
  }
  return true
}

/**
 * Delete a person who leads no setlist. The record stays, marked, or another device's copy would
 * bring them back; a person who is a member of a team, or the one signed in, is made again
 * (`getSpacePeople`). Resolves with whether it was done.
 */
export async function deletePerson(db: ChordlessDB, id: string): Promise<boolean> {
  const people = await db.getAllPeople()
  const person = people.find(each => each.id === id && isLive(each))
  if (!person || leaderCounts(people, await db.getAllSetlists()).get(id)) return false
  await db.savePeople([{ ...person, deleted: true, modifiedDate: new Date().toISOString() }])
  return true
}

/** The people not merged into another, sorted by name */
export function livePeople(people: Person[]): Person[] {
  return people.filter(isLive).sort((a, b) => a.name.localeCompare(b.name))
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
