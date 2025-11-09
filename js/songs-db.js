/**
 * Global Songs Database
 *
 * Stores song content (ChordPro, metadata) that is shared across all workspaces.
 * This is separate from workspace-specific song usage tracking.
 *
 * Database: SetalightDB-songs (global, not workspace-specific)
 * Object Store: songs
 *
 * Song records contain:
 * - Static content: rawChordPro, parsed metadata, title, artist, etc.
 * - Import metadata: when/where imported
 * - NO usage data (that's in workspace DBs)
 */

const DB_NAME = 'SetalightDB-songs';
const DB_VERSION = 1;

export class SongsDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                reject(new Error('Failed to open Songs IndexedDB'));
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create Songs store
                if (!db.objectStoreNames.contains('songs')) {
                    const songStore = db.createObjectStore('songs', { keyPath: 'id' });
                    songStore.createIndex('ccliNumber', 'ccliNumber', { unique: false });
                    songStore.createIndex('titleNormalized', 'titleNormalized', { unique: false });
                    songStore.createIndex('textHash', 'textHash', { unique: false });
                    songStore.createIndex('sourceWorkspace', 'sourceWorkspace', { unique: false });
                }
            };
        });
    }

    // Song operations
    async saveSong(song) {
        const tx = this.db.transaction(['songs'], 'readwrite');
        const store = tx.objectStore('songs');
        await store.put(song);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getSong(id) {
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const request = store.get(id);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async findSongByCCLI(ccliNumber) {
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const index = store.index('ccliNumber');
        const request = index.get(ccliNumber);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async findSongByNormalizedTitle(titleNormalized) {
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const index = store.index('titleNormalized');
        const request = index.get(titleNormalized);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async findSongByTextHash(textHash) {
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const index = store.index('textHash');
        const request = index.get(textHash);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllSongs() {
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const request = store.getAll();
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getSongsByWorkspace(workspaceId) {
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const index = store.index('sourceWorkspace');
        const request = index.getAll(workspaceId);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteSong(id) {
        const tx = this.db.transaction(['songs'], 'readwrite');
        const store = tx.objectStore('songs');
        await store.delete(id);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // Clear all songs (for testing/migration)
    async clearAll() {
        const tx = this.db.transaction(['songs'], 'readwrite');
        const songStore = tx.objectStore('songs');
        await songStore.clear();
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

/**
 * Helper to get the global songs database instance
 */
export async function getGlobalSongsDB() {
    const db = new SongsDB();
    await db.init();
    return db;
}
