// IndexedDB wrapper for Setalight
// Manages setlists and songs collections

const DB_NAME = 'SetalightDB';
const DB_VERSION = 2;

// Setlist types
export const SETLIST_TYPES = {
    CHURCH_SERVICE: 'Church Service',
    PRAYER_MEETING: 'Prayer Meeting',
    EVENT: 'Event',
    OTHER: 'Other'
};

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
                const oldVersion = event.oldVersion;

                // Create Setlists store
                if (!db.objectStoreNames.contains('setlists')) {
                    const setlistStore = db.createObjectStore('setlists', { keyPath: 'id' });
                    setlistStore.createIndex('date', 'date', { unique: false });
                    setlistStore.createIndex('type', 'type', { unique: false });
                } else if (oldVersion < 2) {
                    // Upgrade from v1 to v2: add type index
                    const transaction = event.target.transaction;
                    const setlistStore = transaction.objectStore('setlists');
                    if (!setlistStore.indexNames.contains('type')) {
                        setlistStore.createIndex('type', 'type', { unique: false });
                    }
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

// Setlist utility functions

/**
 * Get the next Sunday from today
 */
export function getNextSunday() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
    const nextSunday = new Date(today);
    nextSunday.setDate(today.getDate() + daysUntilSunday);
    nextSunday.setHours(0, 0, 0, 0);
    return nextSunday;
}

/**
 * Determine setlist type based on date and name
 */
export function determineSetlistType(dateString, name) {
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();

    // If there's a name, default to Event
    if (name && name.trim()) {
        return SETLIST_TYPES.EVENT;
    }

    // Sunday = Church Service
    if (dayOfWeek === 0) {
        return SETLIST_TYPES.CHURCH_SERVICE;
    }

    // Tuesday or Wednesday = Prayer Meeting
    if (dayOfWeek === 2 || dayOfWeek === 3) {
        return SETLIST_TYPES.PRAYER_MEETING;
    }

    // Default to Event for other days
    return SETLIST_TYPES.EVENT;
}

/**
 * Create a new setlist object with defaults
 */
export function createSetlist({ date, time, type, name, leader } = {}) {
    const setlistDate = date || getNextSunday();
    const dateString = typeof setlistDate === 'string' ? setlistDate : setlistDate.toISOString().split('T')[0];

    // Generate ID from date and optional name (matching import format)
    let id = dateString;
    if (name && name.trim()) {
        // Convert name to kebab-case for ID
        const namePart = name.trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-'); // Remove duplicate hyphens
        id = `${dateString}-${namePart}`;
    }

    return {
        id: id,
        date: dateString,
        time: time || '10:30',
        type: type || determineSetlistType(dateString, name),
        name: name || '',
        leader: leader || '',
        songs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}
