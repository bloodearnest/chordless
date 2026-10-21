/**
 * Whether the user can write to the current space's Drive folder, and whether the folder
 * is still there to be found, asked of Drive when the app starts and when someone signs in (a
 * space switch reloads the app, so it starts afresh), as well as at every sync. The
 * answer to the first is kept on the space (isReadOnlySpace) for the UI; the
 * second is told to the user at once, rather than at their first sync.
 */

import type { Space } from './data-types.ts'
import { folderGoneMessage } from './drive-sync.ts'
import { GOOGLE_CLIENT_ID } from './google-auth.ts'
import { goTo } from './navigation.ts'
import { getCurrentSpaceFull, setSpaceReadOnly } from './space.ts'
import { SpaceDB } from './space-db.ts'
import { storageFor } from './storage/space-storage.ts'
import type { RootInfo, SpaceStorage } from './storage/types.ts'
import { toast } from './toast.ts'

/** The space's linked Drive folder is not there to sync with */
export interface DriveFolderProblem {
  reason: 'missing' | 'trashed'
  /** What to tell the user: what happened, that their data is safe, and the way on */
  message: string
}

/** Ask Drive about the current space's folder, if it has one yet (the first sync finds or makes it) */
async function inspectFolder(): Promise<{
  space: Space
  folder: RootInfo | null
} | null> {
  const space = await getCurrentSpaceFull()
  if (!space.rootRef) return null
  const folder = await storageFor(space).inspectRoot(space.rootRef)
  return { space, folder }
}

/** A space's files in Drive, by the folder it is linked to; throws if it has none yet */
export async function driveSpaceStorage(spaceId: string): Promise<SpaceStorage> {
  const db = new SpaceDB()
  await db.init()
  const space = await db.getSpace(spaceId)
  if (!space?.rootRef) throw new Error('This space is not in Google Drive')
  return storageFor(space).space(space.rootRef)
}

function problemWith(space: Space, folder: RootInfo | null): DriveFolderProblem | null {
  if (folder && !folder.trashed) return null
  const otherApp = Boolean(space.driveClientId && space.driveClientId !== GOOGLE_CLIENT_ID)
  return { reason: folder ? 'trashed' : 'missing', message: folderGoneMessage(folder, otherApp) }
}

/**
 * Whether the current space's Drive folder is gone (deleted, in the trash, or not visible
 * to this Google account or app: Drive says the same for all of them). Null when it is there, or
 * when that can't be told (not signed in, offline, no folder yet): sync reports those.
 */
export async function driveFolderProblem(): Promise<DriveFolderProblem | null> {
  try {
    const found = await inspectFolder()
    return found ? problemWith(found.space, found.folder) : null
  } catch {
    return null
  }
}

/** The spaces whose lost folder has been told of since the page loaded */
const toldOf = new Set<string>()

function tellOfProblem(spaceId: string, problem: DriveFolderProblem): void {
  if (toldOf.has(spaceId)) return
  toldOf.add(spaceId)
  toast(problem.message, {
    kind: 'error',
    action: { label: 'Open Drive sync', run: () => goTo('/storage') },
  })
}

/**
 * Ask Drive about the current space's folder, if it has one yet (the first sync finds
 * or makes it) and the user is signed in and online. Anything else leaves what is known as it
 * is: this never turns a user read-only on a failure. A folder that is gone is told at once.
 */
export async function refreshSpaceAccess(): Promise<void> {
  try {
    const found = await inspectFolder()
    if (!found) return
    const problem = problemWith(found.space, found.folder)
    if (problem) {
      tellOfProblem(found.space.id, problem)
      return
    }
    const canAdd = found.folder?.canWrite
    if (canAdd === undefined || canAdd === null) return
    await setSpaceReadOnly(found.space.id, !canAdd)
  } catch {
    // Not signed in, offline: sync reports those
  }
}
