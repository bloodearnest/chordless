/**
 * Syncing a space from the Account and Teams page: any space on this device, not only the one in
 * use (docs/ACCOUNT.md), and notes when it last synced.
 */
import type { Space } from './data-types.ts'
import { recordSync } from './last-sync.ts'
import {
  type BroadcastCallback,
  createSyncOrchestrator,
  SyncOrchestrator,
} from './sync-orchestrator.ts'

/**
 * Sync the space with wherever its files are kept.
 * @returns when it finished (ISO time)
 * @throws the sync's error, for the caller to tell the person
 */
export async function syncSpaceNow(
  space: Space,
  onProgress: BroadcastCallback | null
): Promise<string> {
  const orchestrator = await createSyncOrchestrator(space.name, space.id)
  // (the Sync button of a space's card)
  await orchestrator.sync(onProgress, 'manual')
  return recordSync(space.id)
}

/**
 * Answer an AdoptFolderError (a Personal space whose Drive folder has another name): use that
 * folder (`ref`), or with none make the space's own, and sync.
 * @returns when it finished (ISO time)
 */
export async function syncSpaceAfterAdoptionAnswer(
  space: Space,
  ref: string | null,
  onProgress: BroadcastCallback | null
): Promise<string> {
  const orchestrator = new SyncOrchestrator(space.name, space.id)
  if (ref) await orchestrator.adoptFolder(ref, onProgress)
  else await orchestrator.declineAdoption(onProgress)
  return recordSync(space.id)
}
