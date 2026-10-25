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
  email: string
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
