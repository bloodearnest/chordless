/**
 * Sharing a space with a team, and joining one: what changes on this device
 * (docs/SPACES.md, "Setting up and joining a team space"). The Worker does the rest
 * (team-client.ts); the space's files are synced as any space's, by whichever backend
 * `storageFor` gives it.
 */
import type { Setlist, Space } from './data-types.ts'
import { ChordlessDB } from './db.ts'
import { getStoredBlob } from './google-auth.ts'
import { createSpace, deleteSpace, getSpaceById, listSpaces, updateSpace } from './space.ts'
import { storageFor } from './storage/space-storage.ts'
import type { TeamStorage } from './storage/team-storage.ts'
import { teamApi } from './team-client.ts'
import type { TeamRole } from './team-roles.ts'

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

  const rootRef = await folders.createTeamFolder(parentId, teamFolderName(teamName))
  const { spaceId, role } = await teamApi.createSpace({
    blob: stored.blob,
    rootRef,
    name: teamName,
  })
  const space = await createSpace(await freeName(teamName))
  return updateSpace(space.id, { rootRef, team: { id: spaceId, role } })
}

/** The Drive folder's name: it says what it is, as it sits beside folders that are not Chordless's */
function teamFolderName(teamName: string): string {
  return `${teamName} Chordless`
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

/**
 * What a role is called to people: the roles are the Worker's (a reader may only read, a writer may
 * change files), but a church knows them as team members and worship leaders.
 */
export function roleLabel(role: TeamRole): string {
  return { owner: 'owner', admin: 'admin', writer: 'worship leader', reader: 'team member' }[role]
}

/** A role as part of a sentence: "a worship leader", "an admin" */
export function roleWithArticle(role: TeamRole): string {
  const label = roleLabel(role)
  return `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`
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

/** Someone a setlist names as its leader: who to suggest inviting */
export interface Leader {
  name: string
  /** Their Google account, if the setlist has it (a leader typed in by name alone has none) */
  email: string | null
}

/**
 * The people who lead these setlists, once each, for suggesting who to invite to a team space
 * (docs/SPACES.md, "Creating a team space"). Those with an email come first; `own` (the person
 * making the space) is left out, as are setlists with no leader.
 */
export function leadersOf(setlists: Setlist[], own?: string | null): Leader[] {
  const mine = own?.trim().toLowerCase()
  const seen = new Set<string>()
  const leaders: Leader[] = []
  for (const setlist of setlists) {
    const email = setlist.ownerId?.trim().toLowerCase() || null
    const name = setlist.owner.trim()
    if (email === mine && email) continue
    const key = email ?? `name:${name.toLowerCase()}`
    if ((!email && !name) || seen.has(key)) continue
    seen.add(key)
    leaders.push({ name: name || (email as string), email })
  }
  return leaders.sort((a, b) => Number(Boolean(b.email)) - Number(Boolean(a.email)))
}

/**
 * Bring a team space's files into step with the team's: the first sync of a space just made or
 * joined, so the songs and setlists are on this device (for a member) or in the team's folder (for
 * the owner) before anyone is told it is ready. The space is not the one in use yet, so its own
 * database is given to the sync: left to itself the sync works on the space in use.
 */
export async function syncTeamSpace(space: Space): Promise<void> {
  const { SyncManager } = await import('./sync-manager.ts')
  const db = new ChordlessDB(space.id)
  await db.init()
  try {
    const manager = await SyncManager.open(space.name, space.id, { db, storage: storageFor(space) })
    await manager.init()
    await manager.sync()
  } finally {
    db.db?.close()
  }
}
