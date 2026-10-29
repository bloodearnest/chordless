/**
 * Who leads a setlist, as people (docs/IDENTITIES.md): finding a person by email or name, and
 * making people from the names and emails setlists carried before they had people. Pure, with no
 * other imports than types, so the database's upgrade can use it.
 */
import type { Person, Setlist } from './data-types.ts'

/** What a setlist said of its leader before leaders were people */
export interface LegacyLeader {
  owner?: string | null
  ownerId?: string | null
}

/** A name for comparing: no case, accents or punctuation, one space between words */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** An email for comparing: trimmed and lower-cased */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * A uuid made from a key, so that two devices that make the person for the same email or name
 * (the upgrade, or a pull of a setlist from before people) make the same one.
 */
export function idFromKey(key: string): string {
  const hex: string[] = []
  for (let seed = 0; seed < 4; seed++) {
    let hash = 0x811c9dc5 ^ (seed * 0x9e3779b1)
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    hex.push((hash >>> 0).toString(16).padStart(8, '0'))
  }
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** The person an id means: the one it was merged into, if it was */
export function resolvePerson(people: Person[], id: string | null | undefined): Person | undefined {
  const byId = new Map(people.map(person => [person.id, person]))
  let person = id ? byId.get(id) : undefined
  for (let hops = 0; person?.mergedInto && hops < 20; hops++) {
    const next = byId.get(person.mergedInto)
    if (!next) break
    person = next
  }
  return person
}

/** A leader's name for showing; empty if the setlist has none, or the person is not known (yet) */
export function leaderName(people: Person[], id: string | null | undefined): string {
  return resolvePerson(people, id)?.name ?? ''
}

/**
 * The person with this email, else with this name (ignoring case, accents and punctuation), among
 * those not merged into another. An email that is not any person's is not matched by name to
 * someone who has other emails: that would be a different person with the same name.
 */
export function findPerson(
  people: Person[],
  who: { name?: string | null; email?: string | null }
): Person | undefined {
  const live = people.filter(person => !person.mergedInto)
  const email = normalizeEmail(who.email)
  if (email) {
    const byEmail = live.find(person => person.emails.includes(email))
    if (byEmail) return byEmail
  }
  const name = normalizeName(who.name ?? '')
  if (!name) return undefined
  return live.find(person => normalizeName(person.name) === name)
}

/** The most common of some spellings, the first of any tie */
function commonest(names: string[]): string {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  let best = ''
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount || (count === bestCount && name.localeCompare(best) < 0)) {
      best = name
      bestCount = count
    }
  }
  return best
}

/** A person made from what a setlist said of its leader: with the id the same leader always gets */
export function personFromLegacy(legacy: LegacyLeader, now: string): Person | null {
  const email = normalizeEmail(legacy.ownerId)
  const name = (legacy.owner ?? '').trim()
  if (email) {
    return {
      id: idFromKey(`email:${email}`),
      name: name || email,
      emails: [email],
      modifiedDate: now,
    }
  }
  const norm = normalizeName(name)
  if (!norm) return null
  return { id: idFromKey(`name:${norm}`), name, emails: [], modifiedDate: now }
}

/**
 * The people for a list of setlists' leaders, and the id of each one's person (null for no leader),
 * in the order given. One person for each email; one for each name that has no email, unless it is
 * the name of one person with an email (then it is theirs). A person is named by the spelling used
 * most often.
 */
export function planPeople(
  leaders: LegacyLeader[],
  now: string
): { people: Person[]; leaderIds: (string | null)[] } {
  const byEmail = new Map<string, string[]>()
  for (const leader of leaders) {
    const email = normalizeEmail(leader.ownerId)
    if (!email) continue
    const names = byEmail.get(email) ?? []
    const name = (leader.owner ?? '').trim()
    if (name) names.push(name)
    byEmail.set(email, names)
  }

  const people = new Map<string, Person>()
  const emailPerson = new Map<string, Person>()
  for (const [email, names] of byEmail) {
    const person = personFromLegacy({ owner: commonest(names), ownerId: email }, now) as Person
    people.set(person.id, person)
    emailPerson.set(email, person)
  }

  // A name with no email belongs to the one person with an email that is called that
  const emailNames = new Map<string, Person[]>()
  for (const [email, names] of byEmail) {
    for (const name of new Set(names)) {
      const norm = normalizeName(name)
      emailNames.set(norm, [...(emailNames.get(norm) ?? []), emailPerson.get(email) as Person])
    }
  }

  const nameSpellings = new Map<string, string[]>()
  for (const leader of leaders) {
    if (normalizeEmail(leader.ownerId)) continue
    const name = (leader.owner ?? '').trim()
    const norm = normalizeName(name)
    if (norm) nameSpellings.set(norm, [...(nameSpellings.get(norm) ?? []), name])
  }
  const namePerson = new Map<string, Person>()
  for (const [norm, spellings] of nameSpellings) {
    const owners = new Set(emailNames.get(norm)?.map(person => person.id))
    if (owners.size === 1) {
      namePerson.set(norm, emailNames.get(norm)?.[0] as Person)
      continue
    }
    const person = personFromLegacy({ owner: commonest(spellings) }, now) as Person
    people.set(person.id, person)
    namePerson.set(norm, person)
  }

  const leaderIds = leaders.map(leader => {
    const email = normalizeEmail(leader.ownerId)
    if (email) return (emailPerson.get(email) as Person).id
    return namePerson.get(normalizeName(leader.owner ?? ''))?.id ?? null
  })
  return { people: [...people.values()], leaderIds }
}

/** The people a pull knows, and those it has made for setlists from before people */
export interface Leaders {
  known: Person[]
  added: Person[]
}

/**
 * A setlist as it is now: one that still has the leader's `owner` and `ownerId` (a file written
 * before leaders were people) gets the person for them, found or made (and added to `leaders.added`).
 */
export function adoptLegacyLeader<T extends Setlist>(setlist: T, leaders: Leaders): T {
  if (setlist.owner === undefined && setlist.ownerId === undefined) return setlist
  const { owner, ownerId, ...rest } = setlist
  if (setlist.leaderId) return rest as T
  const all = [...leaders.known, ...leaders.added]
  let person = findPerson(all, { name: owner, email: ownerId })
  if (!person) {
    const made = personFromLegacy({ owner, ownerId }, new Date().toISOString())
    if (made) {
      leaders.added.push(made)
      person = made
    }
  }
  return (person ? { ...rest, leaderId: person.id } : rest) as T
}
