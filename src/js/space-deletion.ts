/**
 * Deleting a space (docs/SPACES.md, "Deleting a space"). Two ways: **from this device** (its
 * database here; its Drive folder is not touched), and **everywhere**: the Drive folder, with
 * everything in it, goes to the Drive trash (recoverable there for thirty days), and then it is
 * gone from this device. For a Team, "everywhere" is the Worker's: it trashes the team's folder with
 * the team's own credential and ends sharing, and only an admin or the owner may ask.
 *
 * Either way the space may be the one in use: it is not a reason to refuse. Another space is made
 * the one in use, or none (Personal is made again the next time the app needs one).
 */
import type { Space } from './data-types.ts'
import { trashFile } from './drive-api.ts'
import { forgetSync } from './last-sync.ts'
import { deleteSpace, getCurrentSpace, listSpaces, setCurrentSpace } from './space.ts'
import { storageFor } from './storage/space-storage.ts'
import { teamApi } from './team-client.ts'
import { atLeast } from './team-roles.ts'

/** Whether this person may delete the space everywhere: a Team's admin or owner, or whoever has a personal space */
export function mayDeleteEverywhere(space: Pick<Space, 'team'>): boolean {
  return !space.team || atLeast(space.team.role, 'admin')
}

/**
 * Put a personal space's Drive folder in the trash. 'none' if there is no folder to trash: it was
 * never synced from here, and no folder of its name is in the account's Drive. A folder already in
 * the trash is fine.
 */
async function trashPersonalFolder(space: Space): Promise<'trashed' | 'none'> {
  const ref = space.rootRef ?? (await storageFor(space).findRootByName(space.name))?.ref
  if (!ref) return 'none'
  await trashFile(ref)
  return 'trashed'
}

/**
 * Remove a space from this device, and make another the one in use if it was. Returns whether it
 * was the one in use, so the page showing it can start again in the other.
 */
export async function removeSpaceFromDevice(
  space: Space,
  /** The spaces on this device (a test gives its own) */
  spacesHere: () => Promise<Space[]> = listSpaces
): Promise<{ wasCurrent: boolean }> {
  const wasCurrent = getCurrentSpace().id === space.id
  await deleteSpace(space.id)
  forgetSync(space.id)
  if (wasCurrent) {
    const next = (await spacesHere()).find(other => other.id !== space.id)
    if (next) await setCurrentSpace(next.id, next.name)
  }
  return { wasCurrent }
}

/**
 * Delete a space everywhere: its Drive folder to the trash first (so a failure leaves the space as it
 * was, and it can be tried again), then from this device. The caller has asked for a backup and a
 * confirmation; this checks only who may.
 * @throws if the person may not, or the folder could not be trashed
 */
export async function deleteSpaceEverywhere(space: Space): Promise<{ wasCurrent: boolean }> {
  if (!mayDeleteEverywhere(space)) throw new Error('Only an admin can delete a Team everywhere')
  if (space.team) await teamApi.deleteEverything(space.team.id)
  else await trashPersonalFolder(space)
  return removeSpaceFromDevice(space)
}
