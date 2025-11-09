// IndexedDB wrapper for Setalight
// Manages workspace-specific setlists and song usage tracking
//
// NOTE: Song content (ChordPro, metadata) is stored in the global SongsDB (songs-db.js)
// This workspace DB only stores:
// - Setlists
// - Song usage history (which setlists a song appears in)

const DB_NAME = 'SetalightDB';
const DB_VERSION = 3;

// Setlist types
export const SETLIST_TYPES = {
    CHURCH_SERVICE: 'Church Service',
    PRAYER_MEETING: 'Prayer Meeting',
    EVENT: 'Event',
    OTHER: 'Other'
};

export class SetalightDB {
    constructor(workspaceId = null) {
        // Use workspace-specific database name
        const dbName = workspaceId
            ? `SetalightDB-workspace-${workspaceId}`
            : DB_NAME; // Fallback for backward compatibility

        this.dbName = dbName;
        this.workspaceId = workspaceId;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, DB_VERSION);

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

                // LEGACY: Keep songs store for backward compatibility (migrate to SongsDB separately)
                if (!db.objectStoreNames.contains('songs')) {
                    const songStore = db.createObjectStore('songs', { keyPath: 'id' });
                    songStore.createIndex('ccliNumber', 'ccliNumber', { unique: false });
                    songStore.createIndex('titleNormalized', 'titleNormalized', { unique: false });
                    songStore.createIndex('textHash', 'textHash', { unique: false });
                }

                // Create Song Usage store (v3)
                // Tracks which setlists a song appears in (no analytics indexes)
                if (!db.objectStoreNames.contains('song_usage')) {
                    db.createObjectStore('song_usage', { keyPath: 'songId' });
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

    // LEGACY: Song operations (deprecated - use SongsDB instead)
    // Kept for backward compatibility during migration
    async saveSong(song) {
        // console.warn('[DB] saveSong is deprecated - use SongsDB for song content');
        const tx = this.db.transaction(['songs'], 'readwrite');
        const store = tx.objectStore('songs');
        await store.put(song);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getSong(id) {
        console.warn('[DB] getSong is deprecated - use SongsDB for song content');
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const request = store.get(id);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async findSongByCCLI(ccliNumber) {
        console.warn('[DB] findSongByCCLI is deprecated - use SongsDB for song content');
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
        console.warn('[DB] findSongByNormalizedTitle is deprecated - use SongsDB for song content');
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
        console.warn('[DB] getAllSongs is deprecated - use SongsDB for song content');
        const tx = this.db.transaction(['songs'], 'readonly');
        const store = tx.objectStore('songs');
        const request = store.getAll();
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Song Usage operations (workspace-specific)
    async getSongUsage(songId) {
        const tx = this.db.transaction(['song_usage'], 'readonly');
        const store = tx.objectStore('song_usage');
        const request = store.get(songId);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveSongUsage(usage) {
        const tx = this.db.transaction(['song_usage'], 'readwrite');
        const store = tx.objectStore('song_usage');
        await store.put(usage);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async getAllSongUsage() {
        const tx = this.db.transaction(['song_usage'], 'readonly');
        const store = tx.objectStore('song_usage');
        const request = store.getAll();
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Update song usage when a setlist is saved
     * Tracks which setlists a song appears in
     */
    async updateSongUsageOnSetlistSave(setlist) {
        for (const song of setlist.songs) {
            let usage = await this.getSongUsage(song.songId) || {
                songId: song.songId,
                workspaceId: this.workspaceId,
                usageHistory: []
            };

            // Add/update this setlist in usage history
            const historyIndex = usage.usageHistory.findIndex(h => h.setlistId === setlist.id);
            const historyEntry = {
                setlistId: setlist.id,
                setlistDate: setlist.date,
                setlistName: setlist.name,
                leader: setlist.leader,
                type: setlist.type,
                playedInKey: song.modifications?.targetKey || null
            };

            if (historyIndex >= 0) {
                // Update existing entry
                usage.usageHistory[historyIndex] = historyEntry;
            } else {
                // New entry
                usage.usageHistory.push(historyEntry);
            }

            // Sort by date descending
            usage.usageHistory.sort((a, b) => b.setlistDate.localeCompare(a.setlistDate));

            await this.saveSongUsage(usage);
        }
    }

    /**
     * Update song usage when a setlist is deleted
     * Remove the setlist from song usage histories
     */
    async updateSongUsageOnSetlistDelete(setlist) {
        for (const song of setlist.songs) {
            const usage = await this.getSongUsage(song.songId);
            if (!usage) continue;

            // Remove this setlist from history
            usage.usageHistory = usage.usageHistory.filter(h => h.setlistId !== setlist.id);

            if (usage.usageHistory.length === 0) {
                // No more usage, delete the record
                const tx = this.db.transaction(['song_usage'], 'readwrite');
                const store = tx.objectStore('song_usage');
                await store.delete(song.songId);
            } else {
                // Re-sort by date descending
                usage.usageHistory.sort((a, b) => b.setlistDate.localeCompare(a.setlistDate));
                await this.saveSongUsage(usage);
            }
        }
    }

    // Clear all data (for re-import)
    async clearAll() {
        const tx = this.db.transaction(['setlists', 'songs', 'song_usage'], 'readwrite');

        const setlistStore = tx.objectStore('setlists');
        const songStore = tx.objectStore('songs');
        const usageStore = tx.objectStore('song_usage');

        await setlistStore.clear();
        await songStore.clear();
        await usageStore.clear();

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

/**
 * Parse tempo string into BPM number and note subdivision
 * Examples:
 *   "150" -> { bpm: 150, note: "1/4" }
 *   "61 bpm" -> { bpm: 61, note: "1/4" }
 *   "150 (1/8)" -> { bpm: 150, note: "1/8" }
 *   "150 (8th note)" -> { bpm: 150, note: "1/8" }
 *
 * @param {string} tempoStr - Tempo string from ChordPro metadata
 * @returns {{bpm: number|null, note: string}} - Parsed tempo and note subdivision
 */
export function parseTempo(tempoStr) {
    if (!tempoStr) {
        return { bpm: null, note: '1/4' };
    }

    const str = String(tempoStr).trim();

    // Extract base BPM number (first number in the string)
    const bpmMatch = str.match(/(\d+)/);
    const bpm = bpmMatch ? parseInt(bpmMatch[1]) : null;

    // Extract note subdivision from brackets or text
    let note = '1/4'; // Default to quarter note

    // Check for bracketed subdivision like (1/8) or (8th note)
    const bracketMatch = str.match(/\(([^)]+)\)/);
    if (bracketMatch) {
        const bracketContent = bracketMatch[1].trim().toLowerCase();

        // Check for fraction format like "1/8"
        if (bracketContent.match(/1\/\d+/)) {
            note = bracketContent;
        }
        // Check for written format like "8th note" or "16th"
        else if (bracketContent.includes('8th') || bracketContent.includes('eighth')) {
            note = '1/8';
        }
        else if (bracketContent.includes('16th') || bracketContent.includes('sixteenth')) {
            note = '1/16';
        }
        else if (bracketContent.includes('half')) {
            note = '1/2';
        }
        else if (bracketContent.includes('whole')) {
            note = '1/1';
        }
    }

    return { bpm, note };
}

/**
 * Format tempo for display as "BPM/note"
 * Examples:
 *   150, "1/4" -> "150"
 *   150, "1/8" -> "150/8"
 *   150, "1/16" -> "150/16"
 *
 * @param {number|null} bpm - The BPM number
 * @param {string} tempoNote - The note subdivision (e.g., "1/4", "1/8")
 * @returns {string} - Formatted tempo string
 */
export function formatTempo(bpm, tempoNote = '1/4') {
    if (!bpm) return '';

    // If quarter note (default), just show BPM
    if (!tempoNote || tempoNote === '1/4') {
        return `${bpm}`;
    }

    // Otherwise show BPM/denominator (e.g., "150/8" for 1/8 notes)
    const [, denominator] = tempoNote.split('/').map(Number);
    if (denominator) {
        return `${bpm}/${denominator}`;
    }

    return `${bpm}`;
}

/**
 * Helper to get current workspace database
 * Requires workspace-manager.js to be loaded
 */
export function getCurrentDB() {
    // This will be implemented when workspace-manager.js is created
    // For now, return default DB for backward compatibility
    return new SetalightDB();
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
