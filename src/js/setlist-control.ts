/**
 * Who controls a setlist, on this device (docs/PERSONAL_LAYER.md, "Who controls a setlist"): the one
 * who may change what everyone has, not only what they keep for themselves. Advisory: the client does
 * not offer the controls to anyone else (the Worker checks only who may delete one).
 */
import type { Person, Setlist, Space } from './data-types.ts'
import { normalizeEmail, resolvePerson } from './leaders.ts'
import type { TeamRole } from './team-roles.ts'
import { mayChangeSetlist } from './team-roles.ts'

/** Who is using the device in a space, as far as a leader can be told from the people */
export interface Me {
  /** The signed-in account's address, if signed in */
  email: string | null
  /** The person this device was told is its user, if it was told */
  chosenPersonId: string | null
}

/** Whether the person using the device is the setlist's leader: their address or the person chosen is the leader's */
export function leadsSetlist(
  setlist: Pick<Setlist, 'leaderId'>,
  people: Person[],
  me: Me
): boolean {
  const leader = resolvePerson(people, setlist.leaderId)
  if (!leader) return false
  if (me.chosenPersonId && resolvePerson(people, me.chosenPersonId)?.id === leader.id) return true
  const email = me.email ? normalizeEmail(me.email) : ''
  return Boolean(email) && leader.emails.some(each => normalizeEmail(each) === email)
}

/**
 * Whether the person using the device controls the setlist: in a personal space always; in a team,
 * by the role they have there, the leader being found as above and, for a setlist whose leader cannot be
 * found, the person who made it.
 */
export function controlsSetlist(
  setlist: Pick<Setlist, 'leaderId' | 'createdBy'>,
  space: Pick<Space, 'team'> | undefined,
  people: Person[],
  me: Me
): boolean {
  const role: TeamRole | null = space?.team?.role ?? null
  if (role === null) return true
  if (space?.team?.churchId) return role === 'writer' || role === 'admin'
  const noLeader = !resolvePerson(people, setlist.leaderId)
  const madeIt =
    noLeader && Boolean(me.email) && normalizeEmail(setlist.createdBy) === normalizeEmail(me.email)
  return mayChangeSetlist(role, leadsSetlist(setlist, people, me), madeIt)
}
