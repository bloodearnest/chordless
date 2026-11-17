/**
 * The roles of a team space (docs/SPACES.md, "Roles"), as the Worker enforces them and the page
 * shows them: one definition for both sides. A role may act only on those below it.
 */

/** A person's role in a team space */
export type TeamRole = 'owner' | 'admin' | 'writer' | 'reader'

/** The roles a member can hold, or be invited to: the owner is not a member, they are the space's */
export type MemberRole = Exclude<TeamRole, 'owner'>

/** The roles that can be given to someone, lowest first */
export const MEMBER_ROLES = ['reader', 'writer', 'admin'] as const satisfies readonly MemberRole[]

/** A person in a team space, as the Worker lists them (the owner first) */
export interface TeamMember {
  /** The address they last signed in with: what an app from before `emails` reads */
  email: string
  /** Every address the team knows them by (the one they signed in with, and any an invite was sent to), the first being `email` */
  emails?: string[]
  role: TeamRole
}

/** An invitation to join, as an admin sees it (the code itself is never kept or shown again) */
export interface InviteInfo {
  /** Names the invite for revoking it: the code's hash, which cannot be turned back into it */
  id: string
  /** Who it is for: only an account with this verified email can use it */
  email: string
  role: MemberRole
  createdBy: string
  createdAt: string
  expiresAt: string
  /** When Chordless emailed it; null if it was not (held back, or it could not be sent) */
  emailedAt?: string | null
}

const RANK: Record<TeamRole, number> = { reader: 0, writer: 1, admin: 2, owner: 3 }

/** Whether a role is at least another */
export function atLeast(role: TeamRole, needed: TeamRole): boolean {
  return RANK[role] >= RANK[needed]
}

/** Whether a role may act on another (change it, remove it, invite to it): only on those below it */
export function outranks(mine: TeamRole, target: TeamRole): boolean {
  return RANK[mine] > RANK[target]
}

/** A value as a role a member can hold, or null if it is not one */
export function asMemberRole(value: unknown): MemberRole | null {
  return MEMBER_ROLES.find(each => each === value) ?? null
}

/**
 * Whether someone controls a setlist, which is what may change it for everyone and delete it
 * (docs/PERSONAL_LAYER.md, "Who controls a setlist"): in a personal space (`role` null) its owner,
 * anything; in a team space an admin or the owner, any; a worship leader (`writer`) the setlists they
 * lead, and those nobody can be found to lead that they made (`madeIt`); a team member (`reader`) none.
 */
export function mayChangeSetlist(role: TeamRole | null, leadsIt: boolean, madeIt = false): boolean {
  if (role === null || atLeast(role, 'admin')) return true
  return role === 'writer' && (leadsIt || madeIt)
}

/** Whether someone may delete a setlist: those who control it (docs/SYNC_ARCHITECTURE.md, "Who can delete") */

/**
 * Whether someone may delete a song, not just one of its versions (docs/SPACES.md, "Roles"): in a
 * personal space (`role` null) its owner, in a team space an admin or the owner. Deleting a song
 * is for a bad import or a mistake, and it takes the song out of every setlist. Deleting one
 * version of several is for any worship leader, so it is not asked of this.
 */
export function mayDeleteSong(role: TeamRole | null): boolean {
  return role === null || atLeast(role, 'admin')
}
