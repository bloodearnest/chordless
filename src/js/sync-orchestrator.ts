/**
 * Sync Orchestrator
 *
 * Service Worker-compatible sync coordination layer.
 * Can run in both main thread and Service Worker contexts.
 *
 * Architecture:
 * - Core sync logic is in DriveSyncManager (SW-compatible)
 * - This orchestrator handles context detection and progress broadcasting
 * - UI components use this interface rather than calling DriveSyncManager directly
 */

import type { DriveSyncManager, SyncProgress } from './drive-sync.ts'
import { createSyncManager, isSyncAvailable } from './drive-sync.ts'

/** Progress as this layer sends it: with the time, and the error's message on failure */
export interface SyncBroadcast extends SyncProgress {
  timestamp: string
  error?: string
}

export type BroadcastCallback = (progress: SyncBroadcast) => void

/** The part of a service worker's global scope used here (this module runs in both contexts) */
interface WorkerScope {
  clients?: {
    matchAll(options: {
      includeUncontrolled: boolean
      type: 'window'
    }): Promise<{ postMessage(message: unknown): void }[]>
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Detect if we're running in a Service Worker context
 */
function isServiceWorkerContext(): boolean {
  const scope = globalThis as { WorkerGlobalScope?: abstract new () => unknown }
  return scope.WorkerGlobalScope !== undefined && self instanceof scope.WorkerGlobalScope
}

/**
 * Progress broadcaster - works in both contexts
 */
class ProgressBroadcaster {
  callback: BroadcastCallback | null
  isServiceWorker: boolean

  constructor(callback: BroadcastCallback | null = null) {
    this.callback = callback
    this.isServiceWorker = isServiceWorkerContext()
  }

  /**
   * Send progress update
   * In main thread: calls callback directly
   * In SW: broadcasts to all clients
   */
  async send(progressData: SyncBroadcast): Promise<void> {
    // Main thread: direct callback
    if (this.callback) {
      this.callback(progressData)
    }

    // Service Worker: broadcast to all clients
    const { clients: workerClients } = self as unknown as WorkerScope
    if (this.isServiceWorker && workerClients) {
      const clients = await workerClients.matchAll({ includeUncontrolled: true, type: 'window' })
      clients.forEach(client => {
        client.postMessage({
          type: 'SYNC_PROGRESS',
          data: progressData,
        })
      })
    }
  }
}

/**
 * Main sync orchestrator
 */
export class SyncOrchestrator {
  organisationName: string
  organisationId: string | null
  syncManager: DriveSyncManager | null
  isServiceWorker: boolean

  constructor(organisationName: string, organisationId: string | null) {
    this.organisationName = organisationName
    this.organisationId = organisationId
    this.syncManager = null
    this.isServiceWorker = isServiceWorkerContext()
  }

  /**
   * Initialize sync manager
   */
  async init(): Promise<void> {
    await this.#init()
  }

  async #init(): Promise<DriveSyncManager> {
    this.syncManager = await createSyncManager(this.organisationName, this.organisationId)
    return this.syncManager
  }

  /**
   * Perform full sync with progress broadcasting
   * @param progressCallback - Optional callback for main thread
   */
  async sync(progressCallback: BroadcastCallback | null = null): Promise<{ success: true }> {
    const syncManager = this.syncManager ?? (await this.#init())

    const broadcaster = new ProgressBroadcaster(progressCallback)

    try {
      await broadcaster.send({
        stage: 'starting',
        message: 'Starting sync...',
        timestamp: new Date().toISOString(),
      })

      await syncManager.sync(progress => {
        broadcaster.send({
          ...progress,
          timestamp: new Date().toISOString(),
        })
      })

      await broadcaster.send({
        stage: 'complete',
        message: 'Sync complete!',
        timestamp: new Date().toISOString(),
      })

      return { success: true }
    } catch (error) {
      console.error('[SyncOrchestrator] Sync failed:', error)

      await broadcaster.send({
        stage: 'error',
        message: messageOf(error),
        error: messageOf(error),
        timestamp: new Date().toISOString(),
      })

      throw error
    }
  }

  /**
   * Replace this device's local data with what's in Drive (see
   * DriveSyncManager.resetLocalFromDrive). Throws UnsyncedChangesError, changing
   * nothing, if local records have changes that aren't in Drive.
   * @param progressCallback - Optional callback for main thread
   */
  async resetLocalFromDrive(
    progressCallback: BroadcastCallback | null = null
  ): Promise<{ success: true }> {
    const syncManager = this.syncManager ?? (await this.#init())

    const broadcaster = new ProgressBroadcaster(progressCallback)

    try {
      await syncManager.resetLocalFromDrive(progress => {
        broadcaster.send({
          ...progress,
          timestamp: new Date().toISOString(),
        })
      })
      return { success: true }
    } catch (error) {
      console.error('[SyncOrchestrator] Reset from Drive failed:', error)
      await broadcaster.send({
        stage: 'error',
        message: messageOf(error),
        error: messageOf(error),
        timestamp: new Date().toISOString(),
      })
      throw error
    }
  }

  /**
   * Push local changes to Drive
   * @param progressCallback - Optional callback for main thread
   */
  async push(progressCallback: BroadcastCallback | null = null): Promise<{ success: true }> {
    const syncManager = this.syncManager ?? (await this.#init())

    const broadcaster = new ProgressBroadcaster(progressCallback)

    try {
      await broadcaster.send({
        stage: 'starting',
        message: 'Pushing to Drive...',
        timestamp: new Date().toISOString(),
      })

      await syncManager.pushToDrive(progress => {
        broadcaster.send({
          ...progress,
          timestamp: new Date().toISOString(),
        })
      })

      await broadcaster.send({
        stage: 'complete',
        message: 'Push complete!',
        timestamp: new Date().toISOString(),
      })

      return { success: true }
    } catch (error) {
      console.error('[SyncOrchestrator] Push failed:', error)

      await broadcaster.send({
        stage: 'error',
        message: messageOf(error),
        error: messageOf(error),
        timestamp: new Date().toISOString(),
      })

      throw error
    }
  }

  /**
   * Pull changes from Drive
   * @param progressCallback - Optional callback for main thread
   */
  async pull(progressCallback: BroadcastCallback | null = null): Promise<{ success: true }> {
    const syncManager = this.syncManager ?? (await this.#init())

    const broadcaster = new ProgressBroadcaster(progressCallback)

    try {
      await broadcaster.send({
        stage: 'starting',
        message: 'Pulling from Drive...',
        timestamp: new Date().toISOString(),
      })

      await syncManager.pullFromDrive(progress => {
        broadcaster.send({
          ...progress,
          timestamp: new Date().toISOString(),
        })
      })

      await broadcaster.send({
        stage: 'complete',
        message: 'Pull complete!',
        timestamp: new Date().toISOString(),
      })

      return { success: true }
    } catch (error) {
      console.error('[SyncOrchestrator] Pull failed:', error)

      await broadcaster.send({
        stage: 'error',
        message: messageOf(error),
        error: messageOf(error),
        timestamp: new Date().toISOString(),
      })

      throw error
    }
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

/**
 * Listen for sync messages from Service Worker (for main thread UI)
 * @param callback - Called with progress data
 * @returns cleanup function to stop listening
 */
export function listenForSyncProgress(callback: BroadcastCallback): () => void {
  if (isServiceWorkerContext()) {
    console.warn('[SyncOrchestrator] listenForSyncProgress called in SW context - ignoring')
    return () => {
      // No-op: Service workers don't need cleanup
    }
  }

  const handler = (event: MessageEvent) => {
    if (event.data && event.data.type === 'SYNC_PROGRESS') {
      callback(event.data.data)
    }
  }

  navigator.serviceWorker.addEventListener('message', handler)

  return () => {
    navigator.serviceWorker.removeEventListener('message', handler)
  }
}

/**
 * Request sync from main thread (triggers Background Sync if in SW)
 * This is a future API for when sync moves to Service Worker
 */
export async function requestBackgroundSync(
  organisationName: string,
  organisationId: string | null
): Promise<{ success: true } | undefined> {
  if (isServiceWorkerContext()) {
    console.warn('[SyncOrchestrator] requestBackgroundSync called in SW context')
    return
  }

  if (!navigator.serviceWorker?.ready) {
    throw new Error('Service Worker not available')
  }

  // For now, just sync on main thread
  // Later: register background sync and let SW handle it
  const orchestrator = await createSyncOrchestrator(organisationName, organisationId)
  return orchestrator.sync()

  // Future implementation:
  // const registration = await navigator.serviceWorker.ready;
  // await registration.sync.register('drive-sync');
}
