/**
 * Sharing a space with a team, and joining one: what changes on this device
 * (docs/SPACES.md, "Setting up and joining a team space"). The Worker does the rest
 * (team-client.ts); the space's files are synced as any space's, by whichever backend
 * `storageFor` gives it.
 */

import { cleanLicence } from './ccli-licence.ts'
import type { Space } from './data-types.ts'
import { ChordlessDB } from './db.ts'
import { isAuthenticated } from './google-auth.ts'
import { createSpace, listSpaces, updateSpace } from './space.ts'
import { storageFor } from './storage/space-storage.ts'
import type { TeamStorage } from './storage/team-storage.ts'
import type { ProgressCallback } from './sync/session.ts'
import { trackSync } from './sync-status.ts'
import { teamApi } from './team-client.ts'
import type { TeamRole } from './team-roles.ts'
import { t } from './text.ts'
import { UserError } from './utils/errors.ts'

/** What making a team space needs from Drive: a folder inside the one the person picked */
export interface TeamFolders {
  createTeamFolder(parentId: string, name: string): Promise<string>
}

/**
 * Make a team space (docs/SPACES.md, "Creating a team space"): a new folder named for the team
 * inside the parent the person picked, registered with the Worker, and a space of its own on this
 * device for it. A personal space is never turned into one. The Worker is told last but one and
 * the device last, so a failure leaves nothing here that has to be cleaned up; a folder made
 * and not registered is left in Drive for the person to delete.
 */
export function createTeamSpace(
  name: string,
  parentId: string,
  folders: TeamFolders,
  options: { ccliLicence?: string } = {}
): Promise<Space> {
  return withMembershipLock(() => makeTeamSpace(name, parentId, folders, options))
}

async function makeTeamSpace(
  name: string,
  parentId: string,
  folders: TeamFolders,
  options: { ccliLicence?: string }
): Promise<Space> {
  const teamName = name.trim()
  if (!teamName) throw new UserError(t('team-needs-name'))
  if (!(await isAuthenticated())) throw new UserError(t('team-sign-in-first'))

  const ccliLicence = cleanLicence(options.ccliLicence)
  const rootRef = await folders.createTeamFolder(parentId, teamFolderName(teamName))
  // (the Worker keeps the number with the team; this device keeps a copy to show)
  const { spaceId, role } = await teamApi.createSpace({
    rootRef,
    name: teamName,
    ...(ccliLicence ? { ccliLicence } : {}),
  })
  const space = await createSpace(await freeName(teamName))
  return updateSpace(space.id, {
    rootRef,
    team: { id: spaceId, role },
    ...(ccliLicence ? { ccliLicence } : {}),
  })
}

/** The Drive folder's name: it says what it is, as it sits beside folders that are not Chordless's */
function teamFolderName(teamName: string): string {
  return `${teamName} Chordless`
}

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
 * Join a team space with an invite's code. This device gets a space of its own for it, named as
 * the team calls it, whose files come through the Worker; nothing is synced yet.
 */
export function joinSpace(
  teamId: string,
  code: string,
  backend: Pick<TeamStorage, 'inspectRoot'>
): Promise<Space> {
  return withMembershipLock(() => joinTeamSpace(teamId, code, backend))
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

async function joinTeamSpace(
  teamId: string,
  code: string,
  backend: Pick<TeamStorage, 'inspectRoot'>
): Promise<Space> {
  const { spaceId, role } = await teamApi.join(teamId, code)
  // (they are in the space now: if the Worker cannot say what it is called yet, it is just "Team")
  const root = await backend.inspectRoot(spaceId).catch(() => null)
  const space = await createSpace(await freeName(root?.name || 'Team'))
  return updateSpace(space.id, {
    rootRef: spaceId,
    team: { id: spaceId, role },
    readOnly: role === 'reader',
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
 * Bring a team space's files into step with the team's: the first sync of a space just made or
 * joined, so the songs and setlists are on this device (for a member) or in the team's folder (for
 * the owner) before anyone is told it is ready. The space is not the one in use yet, so its own
 * database is given to the sync: left to itself the sync works on the space in use. It can be long
 * (every file comes through the Worker), so the sync's progress goes to `onProgress`.
 */
export async function syncTeamSpace(space: Space, onProgress?: ProgressCallback): Promise<void> {
  if (space.team?.churchId) {
    const { syncSpaceDataFor } = await import('./space-data-runtime.ts')
    return syncSpaceDataFor(space.id, { all: true })
  }
  const { SyncManager } = await import('./sync-manager.ts')
  const db = new ChordlessDB(space.id)
  await db.init()
  try {
    const manager = await SyncManager.open(space.name, space.id, { db, storage: storageFor(space) })
    await manager.init()
    await trackSync(space.id, report =>
      manager.sync(progress => {
        report(progress)
        onProgress?.(progress)
      })
    )
  } finally {
    db.db?.close()
  }
}
