/**
 * Sharing a space with a team, and joining one: what changes on this device
 * (docs/SPACES.md, "Setting up and joining a team space"). The Worker does the rest
 * (team-client.ts); the space's files are synced as any space's, by whichever backend
 * `storageFor` gives it.
 */
import type { Space, TeamRole } from './data-types.ts'
import { getStoredBlob } from './google-auth.ts'
import { createSpace, deleteSpace, getSpaceById, listSpaces, updateSpace } from './space.ts'
import type { TeamStorage } from './storage/team-storage.ts'
import { teamApi } from './team-client.ts'

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
export async function createTeamSpace(
  name: string,
  parentId: string,
  folders: TeamFolders
): Promise<Space> {
  const teamName = name.trim()
  if (!teamName) throw new Error('A team space needs a name')
  const stored = await getStoredBlob()
  if (!stored) throw new Error('Sign in with Google first')

  const rootRef = await folders.createTeamFolder(parentId, teamName)
  const { spaceId, role } = await teamApi.createSpace({
    blob: stored.blob,
    rootRef,
    name: teamName,
  })
  const space = await createSpace(await freeName(teamName))
  return updateSpace(space.id, { rootRef, team: { id: spaceId, role } })
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
export async function joinSpace(
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

const RANK: Record<TeamRole, number> = { reader: 0, writer: 1, admin: 2, owner: 3 }

/** The roles that can be given to someone, which are the ones below the owner */
export const GRANTABLE_ROLES = ['reader', 'writer', 'admin'] as const

/** Whether a role may act on another (change it, remove it, invite to it): only on those below it */
export function outranks(mine: TeamRole, target: TeamRole): boolean {
  return RANK[mine] > RANK[target]
}

/** The link to send someone an invite: the space and the code are in the fragment, which is never sent to a server */
export function inviteLink(origin: string, teamId: string, code: string): string {
  return `${origin}/join#${teamId}.${code}`
}

/** Stop sharing a space of this person's: the Worker forgets it, and it is theirs alone again */
export async function stopSharing(spaceId: string): Promise<Space> {
  const space = await getSpaceById(spaceId)
  if (!space?.team) throw new Error('This space is not shared')
  await teamApi.endSharing(space.team.id)
  return updateSpace(spaceId, { team: undefined })
}

/**
 * Leave a team space this person joined. The Worker removes them, and the copy on this device
 * goes (it would never sync again): the caller starts the app afresh.
 */
export async function leaveSpace(spaceId: string): Promise<void> {
  const space = await getSpaceById(spaceId)
  if (!space?.team) throw new Error('This space is not shared')
  await teamApi.leave(space.team.id)
  await deleteSpace(spaceId)
}
