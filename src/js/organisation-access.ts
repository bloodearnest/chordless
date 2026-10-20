/**
 * Whether the user can write to the current organisation's Drive folder, and whether the folder
 * is still there to be found, asked of Drive when the app starts and when someone signs in (an
 * organisation switch reloads the app, so it starts afresh), as well as at every sync. The
 * answer to the first is kept on the organisation (isReadOnlyOrganisation) for the UI; the
 * second is told to the user at once, rather than at their first sync.
 */

import type { DriveFile, Organisation } from './data-types.ts'
import { getFile } from './drive-api.ts'
import { folderGoneMessage } from './drive-sync.ts'
import { GOOGLE_CLIENT_ID } from './google-auth.ts'
import { goTo } from './navigation.ts'
import { getCurrentOrganisationFull, setOrganisationReadOnly } from './organisation.ts'
import { toast } from './toast.ts'

/** The space's linked Drive folder is not there to sync with */
export interface DriveFolderProblem {
  reason: 'missing' | 'trashed'
  /** What to tell the user: what happened, that their data is safe, and the way on */
  message: string
}

/** Ask Drive about the current organisation's folder, if it has one yet (the first sync finds or makes it) */
async function inspectFolder(): Promise<{
  organisation: Organisation
  folder: DriveFile | null
} | null> {
  const organisation = await getCurrentOrganisationFull()
  if (!organisation.driveFolderId) return null
  const folder = await getFile(organisation.driveFolderId, 'id,name,trashed,capabilities')
  return { organisation, folder }
}

function problemWith(
  organisation: Organisation,
  folder: DriveFile | null
): DriveFolderProblem | null {
  if (folder && !folder.trashed) return null
  const otherApp = Boolean(
    organisation.driveClientId && organisation.driveClientId !== GOOGLE_CLIENT_ID
  )
  return { reason: folder ? 'trashed' : 'missing', message: folderGoneMessage(folder, otherApp) }
}

/**
 * Whether the current organisation's Drive folder is gone (deleted, in the trash, or not visible
 * to this Google account or app: Drive says the same for all of them). Null when it is there, or
 * when that can't be told (not signed in, offline, no folder yet): sync reports those.
 */
export async function driveFolderProblem(): Promise<DriveFolderProblem | null> {
  try {
    const found = await inspectFolder()
    return found ? problemWith(found.organisation, found.folder) : null
  } catch {
    return null
  }
}

/** The organisations whose lost folder has been told of since the page loaded */
const toldOf = new Set<string>()

function tellOfProblem(organisationId: string, problem: DriveFolderProblem): void {
  if (toldOf.has(organisationId)) return
  toldOf.add(organisationId)
  toast(problem.message, {
    kind: 'error',
    action: { label: 'Open Drive sync', run: () => goTo('/storage') },
  })
}

/**
 * Ask Drive about the current organisation's folder, if it has one yet (the first sync finds
 * or makes it) and the user is signed in and online. Anything else leaves what is known as it
 * is: this never turns a user read-only on a failure. A folder that is gone is told at once.
 */
export async function refreshOrganisationAccess(): Promise<void> {
  try {
    const found = await inspectFolder()
    if (!found) return
    const problem = problemWith(found.organisation, found.folder)
    if (problem) {
      tellOfProblem(found.organisation.id, problem)
      return
    }
    const canAdd = found.folder?.capabilities?.canAddChildren
    if (canAdd === undefined) return
    await setOrganisationReadOnly(found.organisation.id, !canAdd)
  } catch {
    // Not signed in, offline: sync reports those
  }
}
