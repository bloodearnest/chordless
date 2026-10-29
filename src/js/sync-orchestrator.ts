/**
 * Sync Orchestrator
 *
 * Wraps the sync engine (SyncManager) for the UI: it reports progress to a callback, with the
 * time and the message of any error, and throws the error again.
 */

import type { SetlistEntry } from './data-types.ts'
import type { ResetSetlist, SyncReport } from './sync/session.ts'
import { describeSetlistChange } from './sync/setlist-diff.ts'
import { withSyncLock } from './sync-lock.ts'
import type { SyncProgress } from './sync-manager.ts'
import {
  createSyncManager,
  createUnlinkedSyncManager,
  isSyncAvailable,
  SyncManager,
} from './sync-manager.ts'
import { phase, traced } from './telemetry/telemetry.ts'
import { toast } from './toast.ts'
import { setlistTitle } from './utils/date-utils.ts'
import { errorMessage } from './utils/errors.ts'

/** Progress as this layer sends it: with the time, and the error's message on failure */
export interface SyncBroadcast extends SyncProgress {
  timestamp: string
  error?: string
}

export type BroadcastCallback = (progress: SyncBroadcast) => void

/** How much of what changed a toast spells out */
const SUMMARY_LIMIT = 4

/**
 * A user who can only read never uploads, so the leader's version replaced the setlists they
 * had changed on this device: tell them what the leader's version has that theirs did not, and
 * offer to put theirs back (docs/SPACES.md, "Read-only: local edits are never blocked")
 */
async function tellOfReset(
  manager: SyncManager,
  { resetSetlists: reset }: SyncReport
): Promise<void> {
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
                details: errorMessage(error),
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
      async () => {
        if (!this.syncManager) await phase('chordless.sync.init', {}, () => this.init())
        const syncManager = this.syncManager as SyncManager
        const send = (progress: SyncProgress) =>
          progressCallback?.({ ...progress, timestamp: new Date().toISOString() })

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
      },
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
        await tellOfReset(manager, await manager.sync(progress))
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
            await tellOfReset(manager, await manager.incrementalSync(progress, { push }))
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
        await tellOfReset(manager, await manager.pullFromDrive(progress))
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
