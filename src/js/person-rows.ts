/**
 * The rows of a Team's list of people (docs/ACCOUNT.md, "People: one list"): its members, the invites waiting to be
 * used, and the people who lead its setlists but are not members. The Worker knows members and invites (their roles
 * and addresses); the space's own `people` know names and extra addresses and what each leads. A member is a person
 * when any address of the member is one of the person's, as `personForMember` finds them. Pure, so it is easy to test.
 */
import type { Person } from './data-types.ts'
import { findPerson, isLive } from './leaders.ts'
import type { InviteInfo, TeamMember, TeamRole } from './team-roles.ts'

export type RowKind = 'member' | 'invite' | 'visitor'

export interface PersonRow {
  /** Stable across reads, for the list */
  key: string
  kind: RowKind
  /** As shown: the person's name, or the address when they have none yet */
  name: string
  /** The first address: the one a member signed in with, or an invite was sent to */
  email: string
  /** How many addresses more than the first */
  more: number
  /** Every address, the first first (for searching and the editor) */
  emails: string[]
  /** A member's role (the owner's too); a pending invite's is the role it gives; a visitor has none */
  role: TeamRole | null
  person: Person | null
  member: TeamMember | null
  invite: InviteInfo | null
  /** How many setlists they lead */
  leads: number
  /** Whether this is the one using the app */
  isMe: boolean
}

export interface RowInput {
  people: Person[]
  members: TeamMember[]
  invites: InviteInfo[]
  /** How many setlists each person (by id) leads */
  counts: Map<string, number>
  /** The person using the app, if known */
  meId: string | null
}

const unique = (addresses: string[]): string[] => [
  ...new Set(addresses.map(each => each.toLowerCase()).filter(Boolean)),
]

/** The rows: members first (owner down), then pending invites, then people who are not members */
export function personRows({ people, members, invites, counts, meId }: RowInput): PersonRow[] {
  const live = people.filter(isLive)
  const rows: PersonRow[] = []
  const taken = new Set<string>()
  for (const member of members) {
    const addresses = unique([member.email, ...(member.emails ?? [])])
    const person =
      addresses
        .map(email => findPerson(live, { email }))
        .find((found): found is Person => !!found) ?? null
    if (person) taken.add(person.id)
    const emails = unique([...addresses, ...(person?.emails ?? [])])
    rows.push({
      key: `member:${addresses[0]}`,
      kind: 'member',
      name: person?.name ?? member.email,
      email: emails[0] as string,
      more: Math.max(0, emails.length - 1),
      emails,
      role: member.role,
      person,
      member,
      invite: null,
      leads: person ? (counts.get(person.id) ?? 0) : 0,
      isMe: !!person && person.id === meId,
    })
  }
  for (const invite of invites) {
    rows.push({
      key: `invite:${invite.id}`,
      kind: 'invite',
      name: invite.email,
      email: invite.email,
      more: 0,
      emails: [invite.email],
      role: invite.role,
      person: null,
      member: null,
      invite,
      leads: 0,
      isMe: false,
    })
  }
  for (const person of live) {
    if (taken.has(person.id)) continue
    const emails = unique(person.emails)
    rows.push({
      key: `person:${person.id}`,
      kind: 'visitor',
      name: person.name,
      email: emails[0] ?? '',
      more: Math.max(0, emails.length - 1),
      emails,
      role: null,
      person,
      member: null,
      invite: null,
      leads: counts.get(person.id) ?? 0,
      isMe: person.id === meId,
    })
  }
  return rows
}

export type SortKey = 'name' | 'role' | 'status'

const RANK: Record<TeamRole, number> = { owner: 3, admin: 2, writer: 1, reader: 0 }
const KIND_ORDER: Record<RowKind, number> = { member: 0, invite: 1, visitor: 2 }

/** How a row compares by role: owner highest, then admin, worship leader, team member; invites and visitors below members */
function roleOrder(row: PersonRow): number {
  if (row.kind === 'member') return 10 + RANK[row.role as TeamRole]
  if (row.kind === 'invite') return 5 + RANK[row.role as TeamRole]
  return 0
}

const byName = (a: PersonRow, b: PersonRow) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/**
 * The rows in an order. `role` (the default) is the highest first, then by name; `status` is members, invites,
 * then others, then by name; `name` is alphabetical. `descending` reverses any of them.
 */
export function sortRows(rows: PersonRow[], key: SortKey, descending = false): PersonRow[] {
  const compare = (a: PersonRow, b: PersonRow): number => {
    if (key === 'name') return byName(a, b)
    if (key === 'status') return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byName(a, b)
    return roleOrder(b) - roleOrder(a) || byName(a, b)
  }
  const sorted = [...rows].sort(compare)
  return descending ? sorted.reverse() : sorted
}

/** The rows whose name or any address has what was typed in it (ignoring case); all of them if nothing was */
export function filterRows(rows: PersonRow[], query: string): PersonRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter(row => {
    const text = [row.name, ...row.emails].join(' ').toLowerCase()
    return words.every(word => text.includes(word))
  })
}

/** Whole days until a time, not below zero (an invite's days left) */
export function daysLeft(until: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(until) - now.getTime()) / 86_400_000))
}
