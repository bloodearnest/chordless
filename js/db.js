import { ensurePersistentStorage } from './utils/persistence.js';

// IndexedDB wrapper for Setalight
// Manages organisation-specific setlists.
//
// NOTE: Song content (ChordPro, metadata) is stored in the global SongsDB (songs-db.js)
// This organisation DB only stores setlists. Song usage is derived on demand.

const DB_NAME = 'SetalightDB';
const DB_VERSION = 4;

// Setlist types
export const SETLIST_TYPES = {
  CHURCH_SERVICE: 'Church Service',
  PRAYER_MEETING: 'Prayer Meeting',
  EVENT: 'Event',
  OTHER: 'Other',
};

export class SetalightDB {
  constructor(organisationName = null) {
    // Use organisation-specific database name
    const dbName = organisationName ? `SetalightDB-${organisationName}` : DB_NAME; // Fallback for backward compatibility

    this.dbName = dbName;
    this.organisationName = organisationName;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = event => {
        this.db = event.target.result;
        resolve();
        ensurePersistentStorage('setlists');
      };

      request.onupgradeneeded = event => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;

        // Create Setlists store
        if (!db.objectStoreNames.contains('setlists')) {
          const setlistStore = db.createObjectStore('setlists', { keyPath: 'id' });
          setlistStore.createIndex('date', 'date', { unique: false });
          setlistStore.createIndex('type', 'type', { unique: false });
        } else if (oldVersion < 2) {
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

        // v4: remove song_usage store (usage derived from setlists now)
        if (db.objectStoreNames.contains('song_usage')) {
          db.deleteObjectStore('song_usage');
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

  /**
   * Batch save multiple setlists in one transaction (faster)
   */
  async saveSetlistsBatch(setlists) {
    if (setlists.length === 0) return;

    const tx = this.db.transaction(['setlists'], 'readwrite');
    const store = tx.objectStore('setlists');

    // Queue all puts in one transaction
    setlists.forEach(setlist => store.put(setlist));

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
  async getSongUsageFromSetlists(songId) {
    if (!songId) return [];

    const tx = this.db.transaction(['setlists'], 'readonly');
    const store = tx.objectStore('setlists');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const setlists = request.result || [];
        const appearances = [];

        for (const setlist of setlists) {
          if (!Array.isArray(setlist.songs)) continue;

          setlist.songs.forEach((song, index) => {
            if (song.songId !== songId) return;

            appearances.push({
              setlistId: setlist.id,
              setlistDate: setlist.date,
              setlistName: setlist.name,
              leader: setlist.leader,
              type: setlist.type,
              playedInKey: song.modifications?.targetKey || null,
              order: index,
            });
          });
        }

        appearances.sort((a, b) => (b.setlistDate || '').localeCompare(a.setlistDate || ''));
        resolve(appearances);
      };
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
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, '') // Remove all whitespace
    .trim();
}

export function hashText(text) {
  // Simple hash for conflict detection
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
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
    } else if (bracketContent.includes('16th') || bracketContent.includes('sixteenth')) {
      note = '1/16';
    } else if (bracketContent.includes('half')) {
      note = '1/2';
    } else if (bracketContent.includes('whole')) {
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
 * Helper to get current organisation database
 * Returns a database instance for the currently active organisation
 */
export async function getCurrentDB() {
  const { getCurrentOrganisation } = await import('./workspace.js');
  return new SetalightDB(getCurrentOrganisation());
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
  const dateString =
    typeof setlistDate === 'string' ? setlistDate : setlistDate.toISOString().split('T')[0];

  // Generate ID from date and optional name (matching import format)
  let id = dateString;
  if (name && name.trim()) {
    // Convert name to kebab-case for ID
    const namePart = name
      .trim()
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
    updatedAt: new Date().toISOString(),
  };
}
