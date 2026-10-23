/**
 * Sync Orchestrator
 *
 * Wraps the sync engine (DriveSyncManager) for the UI: it reports progress to a callback, with the
 * time and the message of any error, and throws the error again.
 */

import type { SetlistEntry } from './data-types.ts'
import type { SyncProgress } from './drive-sync.ts'
import { createSyncManager, DriveSyncManager, isSyncAvailable } from './drive-sync.ts'
import { announceSetlistsPulled } from './pulled-setlists.ts'
import type { ResetSetlist } from './sync/session.ts'
import { describeSetlistChange } from './sync/setlist-diff.ts'
import { withSyncLock } from './sync-lock.ts'
import { toast } from './toast.ts'
import { setlistTitle } from './utils/date-utils.ts'

/** Progress as this layer sends it: with the time, and the error's message on failure */
export interface SyncBroadcast extends SyncProgress {
  timestamp: string
  error?: string
}

export type BroadcastCallback = (progress: SyncBroadcast) => void

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** How much of what changed a toast spells out */
const SUMMARY_LIMIT = 4

/**
 * A user who can only read never uploads, so the leader's version replaced the setlists they
 * had changed on this device: tell them what the leader's version has that theirs did not, and
 * offer to put theirs back (docs/SPACES.md, "Read-only: local edits are never blocked")
 */
async function tellOfReset(manager: DriveSyncManager): Promise<void> {
  const reset = manager.resetSetlists
  manager.resetSetlists = []
  if (reset.length === 0) return
  const { db } = manager
  const titles = new Map<string, string>()
  for (const { before, after } of reset) {
    for (const entry of [...before.songs, ...after.songs]) {
      if (titles.has(entry.songUuid)) continue
      titles.set(entry.songUuid, (await db.getSong(entry.songUuid))?.title ?? entry.songId)
    }
  }
  const titleOf = (entry: SetlistEntry) => titles.get(entry.songUuid) ?? entry.songId

  const summary = (change: ResetSetlist) => {
    const changes = describeSetlistChange(change.before, change.after, titleOf)
    const shown = changes.slice(0, SUMMARY_LIMIT).join(', ')
    return changes.length > SUMMARY_LIMIT ? `${shown}, …` : shown
  }
  const only = reset.length === 1 ? reset[0] : null
  const what = only ? summary(only) : ''
  toast(
    only
      ? `Your changes to ${setlistTitle(only.before)} were replaced by the leader's version${what ? ` (${what})` : ''}.`
      : `Your changes to ${reset.length} setlists were replaced by the leader's versions.`,
    {
      details: reset.map(change => `${setlistTitle(change.before)}: ${summary(change)}`).join('\n'),
      action: {
        label: 'Undo',
        run: () => {
          // Back to what this device had; it is still a change here that is never uploaded
          for (const { before } of reset) {
            db.saveSetlist(before).catch(error =>
              toast("Couldn't put your changes back.", {
                kind: 'error',
                details: messageOf(error),
              })
            )
          }
        },
      },
    }
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
  spaceName: string
  spaceId: string | null
  syncManager: DriveSyncManager | null

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
      syncManager: DriveSyncManager,
      progress: (progress: SyncProgress) => void
    ) => Promise<unknown>
  ): Promise<{ success: true }> {
    await withSyncLock(() => this.#execute(name, messages, progressCallback, operation))
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
        await tellOfReset(manager)
        announceSetlistsPulled(manager.takePulledSetlistIds())
      }
    )
  }

  /**
   * Sync from the storage's feed of changes (see DriveSyncManager.incrementalSync): what the app
   * does by itself while it is open. With `skipIfBusy`, nothing is done if a sync is running.
   * @returns whether it ran
   */
  async incrementalSync(
    progressCallback: BroadcastCallback | null = null,
    { push = true, skipIfBusy = false }: { push?: boolean; skipIfBusy?: boolean } = {}
  ): Promise<boolean> {
    const result = await withSyncLock(
      () =>
        this.#execute('Incremental sync', {}, progressCallback, async (manager, progress) => {
          await manager.incrementalSync(progress, { push })
          await tellOfReset(manager)
          announceSetlistsPulled(manager.takePulledSetlistIds())
        }),
      { skipIfBusy }
    )
    return result.ran
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
   * Let go of the space's Drive folder, which is gone (DriveFolderGoneError), and sync into a new
   * one: everything on this device is uploaded again (see DriveSyncManager.startOver). It works
   * without the old folder, which init() would not.
   * @param progressCallback - Optional callback
   */
  async startOverInDrive(
    progressCallback: BroadcastCallback | null = null
  ): Promise<{ success: true }> {
    await new DriveSyncManager(this.spaceName, this.spaceId).startOver()
    this.syncManager = null
    return this.sync(progressCallback)
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
        await tellOfReset(manager)
        announceSetlistsPulled(manager.takePulledSetlistIds())
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
