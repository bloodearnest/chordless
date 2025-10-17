// IndexedDB wrapper for Setalight
// Manages setlists and songs collections

const DB_NAME = 'SetalightDB';
const DB_VERSION = 1;

export class SetalightDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                reject(new Error('Failed to open IndexedDB'));
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create Setlists store
                if (!db.objectStoreNames.contains('setlists')) {
                    const setlistStore = db.createObjectStore('setlists', { keyPath: 'id' });
                    setlistStore.createIndex('date', 'date', { unique: false });
                }

                // Create Songs store
                if (!db.objectStoreNames.contains('songs')) {
                    const songStore = db.createObjectStore('songs', { keyPath: 'id' });
                    songStore.createIndex('ccliNumber', 'ccliNumber', { unique: false });
                    songStore.createIndex('titleNormalized', 'titleNormalized', { unique: false });
                    songStore.createIndex('textHash', 'textHash', { unique: false });
                }
            };
        });
    }

    // Setlist operations
    async saveSetlist(setlist) {
        const tx = this.db.transaction(['setlists'], 'readwrite');
        const store = tx.objectStore('setlists');
        await store.put(setlist);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getSetlist(id) {
        const tx = this.db.transaction(['setlists'], 'readonly');
        const store = tx.objectStore('setlists');
        const request = store.get(id);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllSetlists() {
        const tx = this.db.transaction(['setlists'], 'readonly');
        const store = tx.objectStore('setlists');
        const request = store.getAll();
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteSetlist(id) {
        const tx = this.db.transaction(['setlists'], 'readwrite');
        const store = tx.objectStore('setlists');
        await store.delete(id);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
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

    async getAllSongs() {
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const request = store.getAll();
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Clear all data (for re-import)
    async clearAll() {
        const tx = this.db.transaction(['setlists', 'songs'], 'readwrite');

        const setlistStore = tx.objectStore('setlists');
        const songStore = tx.objectStore('songs');

        await setlistStore.clear();
        await songStore.clear();

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

// Utility functions
export function normalizeTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')  // Remove punctuation
        .replace(/\s+/g, '')      // Remove all whitespace
        .trim();
}

export function hashText(text) {
    // Simple hash for conflict detection
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
}

export function generateSongId(parsed) {
    // Prefer CCLI number as deterministic ID
    if (parsed.metadata.ccliSongNumber || parsed.metadata.ccli) {
        const ccli = parsed.metadata.ccliSongNumber || parsed.metadata.ccli;
        return `ccli-${ccli}`;
    }
    // Fallback to normalized title
    if (parsed.metadata.title) {
        return `title-${normalizeTitle(parsed.metadata.title)}`;
    }
    // Last resort: random ID
    return `song-${crypto.randomUUID()}`;
}

export function extractLyricsText(parsed) {
    // Extract lyrics from parsed structure for search
    const lyrics = [];
    for (const section of parsed.sections) {
        for (const line of section.lines) {
            for (const segment of line.segments) {
                if (segment.lyrics && segment.lyrics.trim()) {
                    lyrics.push(segment.lyrics.trim());
                }
            }
        }
    }
    return lyrics.join(' ').toLowerCase();
}
