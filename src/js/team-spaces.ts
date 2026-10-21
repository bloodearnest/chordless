/**
 * Sharing a space with a team, and joining one: what changes on this device
 * (docs/SPACES.md, "Setting up and joining a team space"). The Worker does the rest
 * (team-client.ts); the space's files are synced as any space's, by whichever backend
 * `storageFor` gives it.
 */
import type { Space } from './data-types.ts'
import { getStoredBlob } from './google-auth.ts'
import { createSpace, getSpaceById, listSpaces, updateSpace } from './space.ts'
import type { TeamStorage } from './storage/team-storage.ts'
import { teamApi } from './team-client.ts'

/** Share a space of this person's with a team: it keeps its folder and files, and gets an id */
export async function shareSpace(spaceId: string): Promise<Space> {
  const space = await getSpaceById(spaceId)
  if (!space) throw new Error('No such space')
  if (space.team) throw new Error('This space is shared already')
  if (!space.rootRef) throw new Error('Sync this space to Google Drive before sharing it')
  const stored = await getStoredBlob()
  if (!stored) throw new Error('Sign in with Google first')

  const { spaceId: teamId, role } = await teamApi.createSpace({
    blob: stored.blob,
    rootRef: space.rootRef,
    name: space.name,
  })
  return updateSpace(spaceId, { team: { id: teamId, role } })
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
