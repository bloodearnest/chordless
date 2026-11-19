/**
 * Sharing a space with a team, and joining one: what changes on this device
 * (docs/SPACES.md, "Setting up and joining a team space"). The Worker does the rest
 * (team-client.ts); the space's files are synced as any space's, by whichever backend
 * `storageFor` gives it.
 */

import { cleanLicence } from './ccli-licence.ts'
import type { Person, Setlist, Space } from './data-types.ts'
import { ChordlessDB } from './db.ts'
import { getStoredBlob } from './google-auth.ts'
import { resolvePerson } from './leaders.ts'
import { createSpace, deleteSpace, getSpaceById, listSpaces, updateSpace } from './space.ts'
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
  const stored = await getStoredBlob()
  if (!stored) throw new UserError(t('team-sign-in-first'))

  const ccliLicence = cleanLicence(options.ccliLicence)
  const rootRef = await folders.createTeamFolder(parentId, teamFolderName(teamName))
  // (the Worker keeps the number with the team; this device keeps a copy to show)
  const { spaceId, role } = await teamApi.createSpace({
    blob: stored.blob,
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
}): Promise<Space> {
  const space = await createSpace(await freeName(team.name || 'Team'))
  return updateSpace(space.id, {
    rootRef: team.role === 'owner' ? team.rootRef : team.spaceId,
    team: { id: team.spaceId, role: team.role },
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
 * The page that shows how to make a Google account with an address from somewhere else, step by
 * step with pictures (src/google-account.html: a static page, no app and no service worker, so that
 * it opens the same from a message in WhatsApp or Gmail). On the same site as the invite's link.
 */
export function googleAccountGuideUrl(inviteUrl: string): string {
  return new URL('/google-account.html', inviteUrl).href
}

/**
 * Whether an address is certainly a Google account's: Gmail's. Any other might be one too (a Google
 * Workspace domain, or an address made a Google account), and nothing public says; so this is
 * only for leaving out the how-to-make-one text, never for refusing an invite.
 */
export function isGmailAddress(email: string): boolean {
  return /@(gmail|googlemail)\.com$/i.test(email.trim())
}

/**
 * What to say with an invite's link, to the person it is for. The address it was sent to is a label for a
 * team member or a worship leader: they sign in with any Google account, and the page they open helps
 * them make one. An **admin** invite only works with its address, so for one that may not be a Google
 * account yet, the message says to make it one *before* opening the link, and where to see how.
 */
export function inviteMessage(
  teamName: string,
  role: TeamRole,
  email: string,
  inviteUrl: string
): string {
  const intro = t('invite-message-intro', { team: teamName, role: roleWithArticle(role) })
  if (isGmailAddress(email)) return `${intro} ${t('invite-message-gmail', { email })}`
  if (role !== 'admin') return `${intro} ${t('invite-message-any', { email })}`
  return `${intro} ${t('invite-message-admin', { email, guide: googleAccountGuideUrl(inviteUrl) })}`
}

/** The ways to hand an invite on where the browser has no share sheet: WhatsApp, and Gmail's compose window (a mailto: link does nothing on a desktop with no mail app) */
export function inviteSendLinks(
  teamName: string,
  role: TeamRole,
  email: string,
  url: string
): { whatsapp: string; gmail: string } {
  const message = inviteMessage(teamName, role, email, url)
  const subject = t('invite-subject', { team: teamName })
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${message}\n\n${url}`)}`,
    gmail: `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${message}\n\n${url}\n`)}`,
  }
}

/**
 * Reach a team space's folder with this person's own Google sign-in again, after team-managed
 * storage (or when Google no longer honours the sign-in the space holds): they are its owner
 */
export async function returnToOwnSignIn(teamId: string): Promise<void> {
  const stored = await getStoredBlob()
  if (!stored) throw new UserError(t('team-sign-in-first'))
  await teamApi.replaceCredential(teamId, stored.blob)
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
export function leadersOf(setlists: Setlist[], people: Person[], own?: string | null): Leader[] {
  const mine = own?.trim().toLowerCase()
  const seen = new Set<string>()
  const leaders: Leader[] = []
  for (const setlist of setlists) {
    const person = resolvePerson(people, setlist.leaderId)
    if (!person || seen.has(person.id)) continue
    seen.add(person.id)
    if (mine && person.emails.includes(mine)) continue
    leaders.push({ name: person.name, email: person.emails[0] ?? null })
  }
  return leaders.sort((a, b) => Number(Boolean(b.email)) - Number(Boolean(a.email)))
}

/**
 * Bring a team space's files into step with the team's: the first sync of a space just made or
 * joined, so the songs and setlists are on this device (for a member) or in the team's folder (for
 * the owner) before anyone is told it is ready. The space is not the one in use yet, so its own
 * database is given to the sync: left to itself the sync works on the space in use. It can be long
 * (every file comes through the Worker), so the sync's progress goes to `onProgress`.
 */
export async function syncTeamSpace(space: Space, onProgress?: ProgressCallback): Promise<void> {
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
