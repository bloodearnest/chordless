/**
 * Putting a setlist back to what Drive holds: for a user who can only read the folder and has
 * changed a setlist on this device (docs/SPACES.md, "Read-only: local edits are never blocked").
 */
import type { Setlist } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import { withNumericTempos } from '../db.ts'
import type { SpaceStorage } from '../storage/types.ts'
import { driveMarkers, setlistHasLocalChanges } from './changes.ts'
import { setlistContent, setlistContentHash } from './setlist-hash.ts'

/**
 * Whether a setlist differs from the official one in Drive, which for a user who can only read
 * is what their changes on this device are: they never go back, and a pull leaves them.
 */
export function differsFromOfficial(setlist: Setlist, syncsBack: boolean): boolean {
  return !syncsBack && Boolean(setlist.driveFileId) && setlistHasLocalChanges(setlist)
}

/**
 * Replace the local setlist with Drive's copy, keeping its device state (the capo, the sections
 * shown). Needs Drive: it throws if the file can't be read.
 */
export async function revertSetlistToOfficial(
  db: ChordlessDB,
  setlist: Setlist,
  space: SpaceStorage
): Promise<Setlist> {
  if (!setlist.driveFileId) throw new Error('This setlist is not in Google Drive')
  const file = await space.status(setlist.driveFileId)
  if (!file || file.trashed) throw new Error('The official copy of this setlist is gone from Drive')
  const remote = withNumericTempos(JSON.parse(await space.readText(file.ref)))
  return db.saveSetlist({
    ...setlistContent(remote),
    id: setlist.id,
    driveFileId: file.ref,
    ...driveMarkers(file),
    lastSyncedAt: new Date().toISOString(),
    syncedContentHash: setlistContentHash(remote),
  })
}
