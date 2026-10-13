/**
 * Whether the user can write to the current organisation's Drive folder, asked of Drive when
 * the app starts and when someone signs in (an organisation switch reloads the app, so it
 * starts afresh), as well as at every sync. The answer is kept on the organisation
 * (isReadOnlyOrganisation) for the UI.
 */

import { getFile } from './drive-api.ts'
import { getCurrentOrganisationFull, setOrganisationReadOnly } from './organisation.ts'

/**
 * Ask Drive about the current organisation's folder, if it has one yet (the first sync finds
 * or makes it) and the user is signed in and online. Anything else leaves what is known as it
 * is: this never turns a user read-only on a failure.
 */
export async function refreshOrganisationAccess(): Promise<void> {
  try {
    const organisation = await getCurrentOrganisationFull()
    if (!organisation.driveFolderId) return
    const folder = await getFile(organisation.driveFolderId, 'id,capabilities')
    const canAdd = folder?.capabilities?.canAddChildren
    if (canAdd === undefined) return
    await setOrganisationReadOnly(organisation.id, !canAdd)
  } catch (error) {
    // Not signed in, offline, or the folder is gone: sync reports those
    console.log('[Access] Could not check access to the organisation folder:', error)
  }
}
