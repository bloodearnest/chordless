/**
 * A team on this device, and syncing it (docs/CHURCH_TEAM_DESIGN.md): a team is a church's, and its files are Chordless's.
 */

import type { Space } from './data-types.ts'
import { createSpace, getSpaceById, listSpaces, updateSpace } from './space.ts'
import { trackSync } from './sync-status.ts'
import type { TeamRole } from './team-roles.ts'
import { t } from './text.ts'

/**
 * Run something that makes or finds team spaces on this device with nothing else doing so: joining,
 * making one, and asking which the person is in (team-memberships.ts) would otherwise see each
 * other's half-made space and make it twice. Where there are no Web Locks it just runs.
 */
export function withMembershipLock<T>(run: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('chordless-team-spaces', run) : run()
}

/** A name for the new space that no space on this device has */
async function freeName(wanted: string): Promise<string> {
  const names = new Set((await listSpaces()).map(space => space.name))
  let name = wanted
  for (let n = 1; names.has(name); n++) {
    name = n === 1 ? `${wanted} (team)` : `${wanted} (team ${n})`
  }
  return name
}

/**
 * The space on this device for a team the Worker says the person is in, as joining makes it: named
 * as the team calls it, a member's reached through the Worker (its id is its `rootRef`), an owner's
 * straight in the folder they were told of
 */
export async function createLocalTeamSpace(team: {
  spaceId: string
  name: string
  role: TeamRole
  rootRef?: string
  churchId?: string
  followed?: boolean
}): Promise<Space> {
  const space = await createSpace(await freeName(team.name || 'Team'))
  return updateSpace(space.id, {
    rootRef: team.role === 'owner' ? team.rootRef : team.spaceId,
    team: {
      id: team.spaceId,
      role: team.role,
      ...(team.churchId ? { churchId: team.churchId, followed: team.followed } : {}),
    },
    readOnly: team.role === 'reader',
  })
}

const ROLE_LABELS: Record<TeamRole, string> = {
  owner: 'role-owner',
  admin: 'role-admin',
  writer: 'role-writer',
  reader: 'role-reader',
}
const ROLE_LABELS_WITH_ARTICLE: Record<TeamRole, string> = {
  owner: 'role-owner-with-article',
  admin: 'role-admin-with-article',
  writer: 'role-writer-with-article',
  reader: 'role-reader-with-article',
}

/**
 * What a role is called to people: the roles are the Worker's (a reader may only read, a writer may
 * change files), but a church knows them as team members and worship leaders.
 */
export function roleLabel(role: TeamRole): string {
  return t(ROLE_LABELS[role])
}

/** A role as part of a sentence: "a worship leader", "an admin" */
export function roleWithArticle(role: TeamRole): string {
  return t(ROLE_LABELS_WITH_ARTICLE[role])
}

/** The link to send someone an invite: /join/<space id>/<code> */
export function inviteLink(origin: string, teamId: string, code: string): string {
  return `${origin}/join/${encodeURIComponent(teamId)}/${encodeURIComponent(code)}`
}

/**
 * What to say with an invite's link, to the person it is for. The address it was sent to is a label for a
 * team member or a worship leader: they sign in with their email address or any Google account. An **admin**
 * invite only works with its address.
 */
export function inviteMessage(teamName: string, role: TeamRole, email: string): string {
  const intro = t('invite-message-intro', { team: teamName, role: roleWithArticle(role) })
  return `${intro} ${t(role === 'admin' ? 'invite-message-admin' : 'invite-message-open', { email })}`
}

/** The ways to hand an invite on where the browser has no share sheet: WhatsApp, and Gmail's compose window (a mailto: link does nothing on a desktop with no mail app) */
export function inviteSendLinks(
  teamName: string,
  role: TeamRole,
  email: string,
  url: string
): { whatsapp: string; gmail: string } {
  const message = inviteMessage(teamName, role, email)
  const subject = t('invite-subject', { team: teamName })
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${message}\n\n${url}`)}`,
    gmail: `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${message}\n\n${url}\n`)}`,
  }
}

/**
 * Bring a team's setlists into step with its church's: the first sync of a team just joined, so they are on this device before
 * anyone is told it is ready. The team is not the one in use yet, so its own database is given to the sync. A team the Worker
 * says has moved into its church (this device was away) is learnt of, and synced as the church's.
 */
export async function syncTeamSpace(space: Space): Promise<void> {
  const { syncSpaceDataFor } = await import('./space-data-runtime.ts')
  try {
    await trackSync(space.id, () => syncSpaceDataFor(space.id, { all: true }))
    /* v8 ignore start -- needs a Worker that refuses the old route: the decision is `learnOfMove`, tested on its own */
  } catch (error) {
    const church = await learnOfMove(space, error)
    if (!church) throw error
    return syncTeamSpace(church)
    /* v8 ignore stop */
  }
}

/** What the Worker says of a team that is a church's now, asked for as a Drive team */
const MOVED_TO_CHURCH = /moved to its church/i

/**
 * The space as a church's team, if `error` is the Worker saying the team moved into its church: the device asks which teams there
 * are (which sets the space up as the church's, and sends what it holds), then reads the space again. Null for any other error, or
 * if it is still not the church's.
 */
export async function learnOfMove(
  space: Space,
  error: unknown,
  /* v8 ignore next 2 -- the real check needs the Worker; a test gives its own */
  check: () => Promise<unknown> = async () =>
    (await import('./team-memberships.ts')).checkTeamMemberships({ force: true })
): Promise<Space | null> {
  if (!MOVED_TO_CHURCH.test(errorText(error))) return null
  await check()
  const now = await getSpaceById(space.id)
  return now?.team?.churchId ? now : null
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
