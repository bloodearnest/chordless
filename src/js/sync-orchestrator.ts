/**
 * Sync Orchestrator
 *
 * Wraps the sync engine (DriveSyncManager) for the UI: it reports progress to a callback, with the
 * time and the message of any error, and throws the error again.
 */

import type { DriveSyncManager, SyncProgress } from './drive-sync.ts'
import { createSyncManager, isSyncAvailable } from './drive-sync.ts'
import { toast } from './toast.ts'

/** Progress as this layer sends it: with the time, and the error's message on failure */
export interface SyncBroadcast extends SyncProgress {
  timestamp: string
  error?: string
}

export type BroadcastCallback = (progress: SyncBroadcast) => void

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A user who can only read never uploads, so the leader's version replaced the setlists they
 * had changed on this device: tell them (docs/SPACES.md, "Read-only: local edits are never blocked")
 */
function tellOfReset(manager: DriveSyncManager): void {
  const reset = manager.resetSetlists
  manager.resetSetlists = []
  if (reset.length === 0) return
  toast(
    reset.length === 1
      ? `Your changes to ${reset[0]} were replaced by the leader's version.`
      : `Your changes to ${reset.length} setlists were replaced by the leader's versions.`,
    { details: reset.join('\n') }
  )
}

/** What an operation says as it starts and ends (none for a reset, which has its own progress) */
interface Messages {
  starting?: string
  complete?: string
}

/**
 * Main sync orchestrator
 */
export class SyncOrchestrator {
  organisationName: string
  organisationId: string | null
  syncManager: DriveSyncManager | null

  constructor(organisationName: string, organisationId: string | null) {
    this.organisationName = organisationName
    this.organisationId = organisationId
    this.syncManager = null
  }

  /**
   * Initialize sync manager
   */
  async init(): Promise<void> {
    this.syncManager = await createSyncManager(this.organisationName, this.organisationId)
  }

  /**
   * Run one of the manager's operations, reporting its progress to the callback: what it says as it
   * starts and ends, then what the manager reports, and its error if it fails (thrown again)
   */
  async #run(
    name: string,
    messages: Messages,
    progressCallback: BroadcastCallback | null,
    operation: (
      syncManager: DriveSyncManager,
      progress: (progress: SyncProgress) => void
    ) => Promise<unknown>
  ): Promise<{ success: true }> {
    if (!this.syncManager) await this.init()
    const syncManager = this.syncManager as DriveSyncManager
    const send = (progress: SyncProgress) =>
      progressCallback?.({ ...progress, timestamp: new Date().toISOString() })

    try {
      if (messages.starting) send({ stage: 'starting', message: messages.starting })
      await operation(syncManager, send)
      if (messages.complete) send({ stage: 'complete', message: messages.complete })
      return { success: true }
    } catch (error) {
      console.error(`[SyncOrchestrator] ${name} failed:`, error)
      progressCallback?.({
        stage: 'error',
        message: messageOf(error),
        error: messageOf(error),
        timestamp: new Date().toISOString(),
      })
      throw error
    }
  }

  /**
   * Perform full sync with progress reporting
   * @param progressCallback - Optional callback
   */
  sync(progressCallback: BroadcastCallback | null = null): Promise<{ success: true }> {
    return this.#run(
      'Sync',
      { starting: 'Starting sync...', complete: 'Sync complete!' },
      progressCallback,
      async (manager, progress) => {
        await manager.sync(progress)
        tellOfReset(manager)
      }
    )
  }

  /**
   * Replace this device's local data with what's in Drive (see
   * DriveSyncManager.resetLocalFromDrive). Throws UnsyncedChangesError, changing
   * nothing, if local records have changes that aren't in Drive.
   * @param progressCallback - Optional callback
   */
  resetLocalFromDrive(
    progressCallback: BroadcastCallback | null = null
  ): Promise<{ success: true }> {
    return this.#run('Reset from Drive', {}, progressCallback, (manager, progress) =>
      manager.resetLocalFromDrive(progress)
    )
  }

  /**
   * Push local changes to Drive
   * @param progressCallback - Optional callback
   */
  push(progressCallback: BroadcastCallback | null = null): Promise<{ success: true }> {
    return this.#run(
      'Push',
      { starting: 'Pushing to Drive...', complete: 'Push complete!' },
      progressCallback,
      (manager, progress) => manager.pushToDrive(progress)
    )
  }

  /**
   * Pull changes from Drive
   * @param progressCallback - Optional callback
   */
  pull(progressCallback: BroadcastCallback | null = null): Promise<{ success: true }> {
    return this.#run(
      'Pull',
      { starting: 'Pulling from Drive...', complete: 'Pull complete!' },
      progressCallback,
      async (manager, progress) => {
        await manager.pullFromDrive(progress)
        tellOfReset(manager)
      }
    )
  }
}

/**
 * Helper to create an orchestrator instance
 */
export async function createSyncOrchestrator(
  organisationName: string,
  organisationId: string | null
): Promise<SyncOrchestrator> {
  const orchestrator = new SyncOrchestrator(organisationName, organisationId)
  await orchestrator.init()
  return orchestrator
}

/**
 * Check if sync is available (user authenticated)
 */
export { isSyncAvailable }
