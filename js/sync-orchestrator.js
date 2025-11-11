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

import { createSyncManager, isSyncAvailable } from './drive-sync.js';

/**
 * Detect if we're running in a Service Worker context
 */
function isServiceWorkerContext() {
    return typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
}

/**
 * Progress broadcaster - works in both contexts
 */
class ProgressBroadcaster {
    constructor(callback = null) {
        this.callback = callback;
        this.isServiceWorker = isServiceWorkerContext();
    }

    /**
     * Send progress update
     * In main thread: calls callback directly
     * In SW: broadcasts to all clients
     */
    async send(progressData) {
        // Main thread: direct callback
        if (this.callback) {
            this.callback(progressData);
        }

        // Service Worker: broadcast to all clients
        if (this.isServiceWorker && self.clients) {
            const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
            clients.forEach(client => {
                client.postMessage({
                    type: 'SYNC_PROGRESS',
                    data: progressData
                });
            });
        }
    }
}

/**
 * Main sync orchestrator
 */
export class SyncOrchestrator {
    constructor(organisationName, organisationId) {
        this.organisationName = organisationName;
        this.organisationId = organisationId;
        this.syncManager = null;
        this.isServiceWorker = isServiceWorkerContext();
    }

    /**
     * Initialize sync manager
     */
    async init() {
        this.syncManager = await createSyncManager(this.organisationName, this.organisationId);
    }

    /**
     * Perform full sync with progress broadcasting
     * @param {Function} progressCallback - Optional callback for main thread
     */
    async sync(progressCallback = null) {
        if (!this.syncManager) {
            await this.init();
        }

        const broadcaster = new ProgressBroadcaster(progressCallback);

        try {
            await broadcaster.send({
                stage: 'starting',
                message: 'Starting sync...',
                timestamp: new Date().toISOString()
            });

            await this.syncManager.sync((progress) => {
                broadcaster.send({
                    ...progress,
                    timestamp: new Date().toISOString()
                });
            });

            await broadcaster.send({
                stage: 'complete',
                message: 'Sync complete!',
                timestamp: new Date().toISOString()
            });

            return { success: true };

        } catch (error) {
            console.error('[SyncOrchestrator] Sync failed:', error);

            await broadcaster.send({
                stage: 'error',
                message: error.message,
                error: error.message,
                timestamp: new Date().toISOString()
            });

            throw error;
        }
    }

    /**
     * Clear Drive and re-upload everything
     * @param {Function} progressCallback - Optional callback for main thread
     */
    async clearAndReupload(progressCallback = null) {
        if (!this.syncManager) {
            await this.init();
        }

        const broadcaster = new ProgressBroadcaster(progressCallback);

        try {
            await broadcaster.send({
                stage: 'starting',
                message: 'Starting clear and re-upload...',
                timestamp: new Date().toISOString()
            });

            await this.syncManager.clearAndReupload((progress) => {
                broadcaster.send({
                    ...progress,
                    timestamp: new Date().toISOString()
                });
            });

            await broadcaster.send({
                stage: 'complete',
                message: 'Clear and re-upload complete!',
                timestamp: new Date().toISOString()
            });

            return { success: true };

        } catch (error) {
            console.error('[SyncOrchestrator] Clear and re-upload failed:', error);

            await broadcaster.send({
                stage: 'error',
                message: error.message,
                error: error.message,
                timestamp: new Date().toISOString()
            });

            throw error;
        }
    }

    /**
     * Push local changes to Drive
     * @param {Function} progressCallback - Optional callback for main thread
     */
    async push(progressCallback = null) {
        if (!this.syncManager) {
            await this.init();
        }

        const broadcaster = new ProgressBroadcaster(progressCallback);

        try {
            await broadcaster.send({
                stage: 'starting',
                message: 'Pushing to Drive...',
                timestamp: new Date().toISOString()
            });

            await this.syncManager.pushToDrive((progress) => {
                broadcaster.send({
                    ...progress,
                    timestamp: new Date().toISOString()
                });
            });

            await broadcaster.send({
                stage: 'complete',
                message: 'Push complete!',
                timestamp: new Date().toISOString()
            });

            return { success: true };

        } catch (error) {
            console.error('[SyncOrchestrator] Push failed:', error);

            await broadcaster.send({
                stage: 'error',
                message: error.message,
                error: error.message,
                timestamp: new Date().toISOString()
            });

            throw error;
        }
    }

    /**
     * Pull changes from Drive
     * @param {Function} progressCallback - Optional callback for main thread
     */
    async pull(progressCallback = null) {
        if (!this.syncManager) {
            await this.init();
        }

        const broadcaster = new ProgressBroadcaster(progressCallback);

        try {
            await broadcaster.send({
                stage: 'starting',
                message: 'Pulling from Drive...',
                timestamp: new Date().toISOString()
            });

            await this.syncManager.pullFromDrive((progress) => {
                broadcaster.send({
                    ...progress,
                    timestamp: new Date().toISOString()
                });
            });

            await broadcaster.send({
                stage: 'complete',
                message: 'Pull complete!',
                timestamp: new Date().toISOString()
            });

            return { success: true };

        } catch (error) {
            console.error('[SyncOrchestrator] Pull failed:', error);

            await broadcaster.send({
                stage: 'error',
                message: error.message,
                error: error.message,
                timestamp: new Date().toISOString()
            });

            throw error;
        }
    }
}

/**
 * Helper to create an orchestrator instance
 */
export async function createSyncOrchestrator(organisationName, organisationId) {
    const orchestrator = new SyncOrchestrator(organisationName, organisationId);
    await orchestrator.init();
    return orchestrator;
}

/**
 * Check if sync is available (user authenticated)
 */
export { isSyncAvailable };

/**
 * Listen for sync messages from Service Worker (for main thread UI)
 * @param {Function} callback - Called with progress data
 * @returns {Function} cleanup function to stop listening
 */
export function listenForSyncProgress(callback) {
    if (isServiceWorkerContext()) {
        console.warn('[SyncOrchestrator] listenForSyncProgress called in SW context - ignoring');
        return () => {};
    }

    const handler = (event) => {
        if (event.data && event.data.type === 'SYNC_PROGRESS') {
            callback(event.data.data);
        }
    };

    navigator.serviceWorker.addEventListener('message', handler);

    return () => {
        navigator.serviceWorker.removeEventListener('message', handler);
    };
}

/**
 * Request sync from main thread (triggers Background Sync if in SW)
 * This is a future API for when sync moves to Service Worker
 */
export async function requestBackgroundSync(organisationName, organisationId) {
    if (isServiceWorkerContext()) {
        console.warn('[SyncOrchestrator] requestBackgroundSync called in SW context');
        return;
    }

    if (!navigator.serviceWorker || !navigator.serviceWorker.ready) {
        throw new Error('Service Worker not available');
    }

    // For now, just sync on main thread
    // Later: register background sync and let SW handle it
    const orchestrator = await createSyncOrchestrator(organisationName, organisationId);
    return orchestrator.sync();

    // Future implementation:
    // const registration = await navigator.serviceWorker.ready;
    // await registration.sync.register('drive-sync');
}
