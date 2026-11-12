/**
 * Who leads a setlist, for the rule on deleting one (docs/SPACES.md, "Roles"): a worship leader
 * (a writer) may put in the bin a setlist they lead, an admin or the owner any. The setlist's file
 * names its leader (`leaderId`, a person of the space: docs/IDENTITIES.md), and the person's file
 * lists their addresses, so the leader is the caller when the caller's verified email is among
 * them. Both files are read through and nothing of them is kept. A writer can make themselves the
 * leader first, so this guards against mistakes and not against a determined writer.
 */

import type { SpaceStorage } from '../../src/js/storage/types.ts'
import { isRecord } from './http.ts'
import type { Identity } from './identity.ts'

/** Whether a file is a setlist's (it is known by its setlist id) */
export function isSetlistFile(props: Record<string, string>): boolean {
  return typeof props.setlistId === 'string' && props.setlistId !== ''
}

/** How far a merged person is followed to the one they became */
const MAX_MERGES = 20

const emailsOf = (person: Record<string, unknown>): string[] =>
  Array.isArray(person.emails)
    ? person.emails.filter((each): each is string => typeof each === 'string')
    : []

/** Whether the setlist whose file is `ref` is led by the person who is asking */
export async function leadsSetlist(
  space: SpaceStorage,
  ref: string,
  identity: Identity
): Promise<boolean> {
  let setlist: unknown
  try {
    setlist = JSON.parse(await space.readText(ref))
  } catch {
    return false
  }
  if (!isRecord(setlist)) return false
  const asking = identity.email.toLowerCase()
  const is = (email: unknown) => typeof email === 'string' && email.toLowerCase() === asking

  // (a setlist written before leaders were people names its leader by email)
  if (is(setlist.ownerId)) return true

  let personId = typeof setlist.leaderId === 'string' ? setlist.leaderId : ''
  if (!personId) return false
  const people = await space.list('people')
  for (let hops = 0; hops <= MAX_MERGES; hops++) {
    const file = people.find(each => each.props.personId === personId)
    if (!file) return false
    let person: unknown
    try {
      person = JSON.parse(await space.readText(file.ref))
    } catch {
      return false
    }
    if (!isRecord(person)) return false
    if (typeof person.mergedInto === 'string' && person.mergedInto) {
      personId = person.mergedInto
      continue
    }
    return person.deleted !== true && emailsOf(person).some(is)
  }
  return false
}
