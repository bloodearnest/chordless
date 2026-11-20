/**
 * Sync Orchestrator
 *
 * Wraps the sync engine (SyncManager) for the UI: it reports progress to a callback, with the
 * time and the message of any error, and throws the error again.
 */

import { withSyncLock } from './sync-lock.ts'
import type { SyncProgress } from './sync-manager.ts'
import {
  createSyncManager,
  createUnlinkedSyncManager,
  isSyncAvailable,
  SyncManager,
} from './sync-manager.ts'
import { trackSync } from './sync-status.ts'
import { phase, traced } from './telemetry/telemetry.ts'
import { errorMessage } from './utils/errors.ts'

/** Progress as this layer sends it: with the time, and the error's message on failure */
export interface SyncBroadcast extends SyncProgress {
  timestamp: string
  error?: string
}

export type BroadcastCallback = (progress: SyncBroadcast) => void

/** What an operation says as it starts and ends (none for a reset, which has its own progress) */
interface Messages {
  starting?: string
  complete?: string
}

/**
 * Main sync orchestrator
 */
/**
 * What started a sync, as the reports tell it (docs/OBSERVABILITY.md): the person (`manual`, the Sync
 * button), the timer (`tick`), the app opening or coming back (`resume`), the device coming back
 * online (`online`), an edit made here (`edit`), another device saying it changed something (`live`),
 * or anything else (`other`).
 */
export type SyncTrigger = 'manual' | 'tick' | 'resume' | 'online' | 'edit' | 'live' | 'other'

export class SyncOrchestrator {
  spaceName: string
  spaceId: string | null
  syncManager: SyncManager | null

  constructor(spaceName: string, spaceId: string | null) {
    this.spaceName = spaceName
    this.spaceId = spaceId
    this.syncManager = null
  }

  /**
   * Initialize sync manager
   */
  async init(): Promise<void> {
    this.syncManager = await createSyncManager(this.spaceName, this.spaceId)
  }

  /**
   * Run one of the manager's operations, one sync at a time (a press of Sync waits for one that is
   * running; see sync-lock.ts)
   */
  async #run(
    name: string,
    messages: Messages,
    progressCallback: BroadcastCallback | null,
    operation: (
      syncManager: SyncManager,
      progress: (progress: SyncProgress) => void
    ) => Promise<unknown>,
    trigger: SyncTrigger = 'other'
  ): Promise<{ success: true }> {
    await withSyncLock(() => this.#execute(name, messages, progressCallback, operation, trigger))
    return { success: true }
  }

  /**
   * Run one of the manager's operations, reporting its progress to the callback: what it says as it
   * starts and ends, then what the manager reports, and its error if it fails (thrown again)
   */
  async #execute(
    name: string,
    messages: Messages,
    progressCallback: BroadcastCallback | null,
    operation: (
      syncManager: SyncManager,
      progress: (progress: SyncProgress) => void
    ) => Promise<unknown>,
    trigger: SyncTrigger
  ): Promise<{ success: true }> {
    // One span for the whole operation: how long, what it was, how it ended, and the calls made
    // to Drive and the Worker meanwhile, counted on it (docs/OBSERVABILITY.md)
    return traced(
      'chordless.sync.run',
      { 'chordless.sync.operation': name, 'chordless.sync.trigger': trigger },
      () =>
        // (told to the pages that say a space is syncing, and noted as the space's last sync)
        trackSync(this.spaceId, async report => {
          if (!this.syncManager) await phase('chordless.sync.init', {}, () => this.init())
          if (this.spaceId) {
            const { syncSpaceDataFor } = await import('./space-data-runtime.ts')
            await syncSpaceDataFor(this.spaceId, {
              all: trigger === 'manual',
              retryRefused: trigger === 'manual',
            })
          }
          const syncManager = this.syncManager as SyncManager
          const send = (progress: SyncProgress) => {
            report(progress)
            progressCallback?.({ ...progress, timestamp: new Date().toISOString() })
          }

          try {
            if (messages.starting) send({ stage: 'starting', message: messages.starting })
            await operation(syncManager, send)
            if (messages.complete) send({ stage: 'complete', message: messages.complete })
            return { success: true } as const
          } catch (error) {
            console.error(`[SyncOrchestrator] ${name} failed:`, error)
            progressCallback?.({
              stage: 'error',
              message: errorMessage(error),
              error: errorMessage(error),
              timestamp: new Date().toISOString(),
            })
            throw error
          }
        }),
      // (the timer's syncs are the many, and mostly find nothing: the sampler reports one in ten of
      // them, going by the trigger above)
      { trackCalls: true }
    )
  }

  /**
   * Perform full sync with progress reporting
   * @param progressCallback - Optional callback
   * @param trigger - What started it, for the reports: `manual` for the Sync button
   */
  sync(
    progressCallback: BroadcastCallback | null = null,
    trigger: SyncTrigger = 'other'
  ): Promise<{ success: true }> {
    return this.#run(
      'Sync',
      { starting: 'Starting sync...', complete: 'Sync complete!' },
      progressCallback,
      async (manager, progress) => {
        await manager.sync(progress)
      },
      trigger
    )
  }

  /**
   * Sync from the storage's feed of changes (see SyncManager.incrementalSync): what the app
   * does by itself while it is open. With `skipIfBusy`, nothing is done if a sync is running.
   * @returns whether it ran
   */
  async incrementalSync(
    progressCallback: BroadcastCallback | null = null,
    {
      push = true,
      skipIfBusy = false,
      trigger = 'other',
    }: { push?: boolean; skipIfBusy?: boolean; trigger?: SyncTrigger } = {}
  ): Promise<boolean> {
    const result = await withSyncLock(
      () =>
        this.#execute(
          'Incremental sync',
          {},
          progressCallback,
          async (manager, progress) => {
            await manager.incrementalSync(progress, { push })
          },
          trigger
        ),
      { skipIfBusy }
    )
    return result.ran
  }

  /**
   * Replace this device's local data with what's in Drive (see
   * SyncManager.resetLocalFromDrive). Throws UnsyncedChangesError, changing
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
   * Use the Drive folder an AdoptFolderError named for this space, and sync into it
   * @param ref - the folder's id
   * @param progressCallback - Optional callback
   */
  async adoptFolder(
    ref: string,
    progressCallback: BroadcastCallback | null = null
  ): Promise<{ success: true }> {
    await (await SyncManager.open(this.spaceName, this.spaceId)).adoptFolder(ref)
    this.syncManager = null
    return this.sync(progressCallback, 'manual')
  }

  /**
   * Make a new folder for the space, not using the one an AdoptFolderError named, and sync into it
   * @param progressCallback - Optional callback
   */
  async declineAdoption(
    progressCallback: BroadcastCallback | null = null
  ): Promise<{ success: true }> {
    ;(await SyncManager.open(this.spaceName, this.spaceId)).declineAdoption()
    this.syncManager = null
    return this.sync(progressCallback, 'manual')
  }

  /**
   * Let go of the space's Drive folder, which is gone (DriveFolderGoneError), and sync into a new
   * one: everything on this device is uploaded again (see SyncManager.startOver). It works
   * without the old folder, which init() would not.
   * @param progressCallback - Optional callback
   */
  async startOverInDrive(
    progressCallback: BroadcastCallback | null = null
  ): Promise<{ success: true }> {
    await (await SyncManager.open(this.spaceName, this.spaceId)).startOver()
    this.syncManager = null
    return this.sync(progressCallback)
  }

  /**
   * Replace this device's data with the copy in the Drive folder of this space's name that can be
   * seen, and link to it (see SyncManager.resetFromFolderByName). For when the linked folder is
   * gone, which init() would stop at. Whatever is only on this device is lost.
   * @param progressCallback - Optional callback
   */
  async resetFromFolderByName(
    progressCallback: BroadcastCallback | null = null
  ): Promise<{ success: true }> {
    this.syncManager = await createUnlinkedSyncManager(this.spaceName, this.spaceId)
    try {
      return await this.#run(
        'Reset from a Drive folder',
        {},
        progressCallback,
        (manager, progress) => manager.resetFromFolderByName(progress)
      )
    } finally {
      // (the next operation looks for the folder afresh)
      this.syncManager = null
    }
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
      }
    )
  }
}

/**
 * Helper to create an orchestrator instance
 */
export async function createSyncOrchestrator(
  spaceName: string,
  spaceId: string | null
): Promise<SyncOrchestrator> {
  const orchestrator = new SyncOrchestrator(spaceName, spaceId)
  await orchestrator.init()
  return orchestrator
}

/**
 * Check if sync is available (user authenticated)
 */
export { isSyncAvailable }
