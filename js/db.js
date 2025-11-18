import { ensurePersistentStorage } from './utils/persistence.js';

// IndexedDB wrapper for Setalight
// Manages organisation-specific data: songs, chordpro content, setlists, and local state
//
// NOTE: This now stores ALL organisation data in one database per organisation.
// Organisation metadata is stored separately in SetalightDB-organisations.

const DB_VERSION = 5;

// Setlist types
export const SETLIST_TYPES = {
  CHURCH_SERVICE: 'Church Service',
  PRAYER_MEETING: 'Prayer Meeting',
  EVENT: 'Event',
  OTHER: 'Other',
};

function cloneForStorage(value, path = '') {
  if (value === null || value === undefined) {
    return value;
  }

  // Primitive values can be stored as-is
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => cloneForStorage(item, `${path}[${index}]`));
  }

  if (type === 'object') {
    if (typeof value.then === 'function' && typeof value.catch === 'function') {
      console.warn(`[SetalightDB] Dropping Promise at ${path || '<root>'} before storage`);
      return null;
    }

    const cloned = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'function' || typeof val === 'symbol') {
        console.warn(
          `[SetalightDB] Dropping non-serializable property ${path ? `${path}.` : ''}${key}`
        );
        continue;
      }
      const sanitized = cloneForStorage(val, path ? `${path}.${key}` : key);
      if (sanitized !== undefined) {
        cloned[key] = sanitized;
      }
    }
    return cloned;
  }

  // Anything else (e.g., BigInt) -> convert to string
  if (type === 'bigint') {
    return value.toString();
  }

  return value;
}

export class SetalightDB {
  constructor(organisationId) {
    if (!organisationId) {
      throw new Error('organisationId is required for SetalightDB');
    }

    // Database name is just the organisation ID
    // This allows renaming organisations without database migration
    this.dbName = organisationId;
    this.organisationId = organisationId;
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
        ensurePersistentStorage(this.organisationId);
      };

      request.onupgradeneeded = event => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;

        console.log(`[SetalightDB] Upgrading ${this.dbName} from v${oldVersion} to v${DB_VERSION}`);

        // Create Songs store (moved from global SongsDB)
        // Now uses uuid as keyPath instead of id
        if (!db.objectStoreNames.contains('songs')) {
          console.log('[SetalightDB] Creating songs store');
          const songStore = db.createObjectStore('songs', { keyPath: 'uuid' });
          songStore.createIndex('id', 'id', { unique: false });
          songStore.createIndex('ccliNumber', 'ccliNumber', { unique: false });
          songStore.createIndex('titleNormalized', 'titleNormalized', { unique: false });
          songStore.createIndex('isDefault', 'isDefault', { unique: false });
          songStore.createIndex('importDate', 'importDate', { unique: false });
        }

        // Create ChordPro store (moved from global ChordProDB)
        if (!db.objectStoreNames.contains('chordpro')) {
          console.log('[SetalightDB] Creating chordpro store');
          const chordproStore = db.createObjectStore('chordpro', { keyPath: 'id' });
          chordproStore.createIndex('contentHash', 'contentHash', { unique: false });
        }

        // Create/Update Setlists store
        if (!db.objectStoreNames.contains('setlists')) {
          console.log('[SetalightDB] Creating setlists store');
          const setlistStore = db.createObjectStore('setlists', { keyPath: 'id' });
          setlistStore.createIndex('date', 'date', { unique: false });
          setlistStore.createIndex('type', 'type', { unique: false });
          setlistStore.createIndex('owner', 'owner', { unique: false });
        } else {
          // Add owner index if upgrading from old version
          const transaction = event.target.transaction;
          const setlistStore = transaction.objectStore('setlists');
          if (!setlistStore.indexNames.contains('owner')) {
            console.log('[SetalightDB] Adding owner index to setlists');
            setlistStore.createIndex('owner', 'owner', { unique: false });
          }
        }

        // Create setlist_local store (new in v5)
        if (!db.objectStoreNames.contains('setlist_local')) {
          console.log('[SetalightDB] Creating setlist_local store');
          db.createObjectStore('setlist_local', { keyPath: 'setlistId' });
        }

        // Clean up old stores
        if (db.objectStoreNames.contains('song_usage')) {
          console.log('[SetalightDB] Removing song_usage store');
          db.deleteObjectStore('song_usage');
        }
      };
    });
  }

  // Setlist operations
  async saveSetlist(setlist) {
    const tx = this.db.transaction(['setlists'], 'readwrite');
    const store = tx.objectStore('setlists');
    await store.put(cloneForStorage(setlist));
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
    setlists.forEach(setlist => store.put(cloneForStorage(setlist)));

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

  // Song operations (per-organisation)
  async saveSong(song) {
    const tx = this.db.transaction(['songs'], 'readwrite');
    const store = tx.objectStore('songs');
    await store.put(song);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveSongsBatch(songs) {
    if (songs.length === 0) return;

    const tx = this.db.transaction(['songs'], 'readwrite');
    const store = tx.objectStore('songs');

    songs.forEach(song => store.put(song));

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getSong(uuid) {
    const tx = this.db.transaction(['songs'], 'readonly');
    const store = tx.objectStore('songs');
    const request = store.get(uuid);
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
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async findSongByCCLI(ccliNumber) {
    const tx = this.db.transaction(['songs'], 'readonly');
    const store = tx.objectStore('songs');
    const index = store.index('ccliNumber');
    const request = index.getAll(ccliNumber);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async findSongByNormalizedTitle(titleNormalized) {
    const tx = this.db.transaction(['songs'], 'readonly');
    const store = tx.objectStore('songs');
    const index = store.index('titleNormalized');
    const request = index.getAll(titleNormalized);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getSongVariants(songId) {
    const tx = this.db.transaction(['songs'], 'readonly');
    const store = tx.objectStore('songs');
    const index = store.index('id');
    const request = index.getAll(songId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getDefaultSongVariant(songId) {
    const variants = await this.getSongVariants(songId);
    return variants.find(v => v.isDefault) || variants[0] || null;
  }

  async deleteSong(uuid) {
    const tx = this.db.transaction(['songs'], 'readwrite');
    const store = tx.objectStore('songs');
    await store.delete(uuid);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ChordPro operations (per-organisation)
  async saveChordPro(chordpro) {
    const tx = this.db.transaction(['chordpro'], 'readwrite');
    const store = tx.objectStore('chordpro');
    await store.put(chordpro);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getChordPro(id) {
    const tx = this.db.transaction(['chordpro'], 'readonly');
    const store = tx.objectStore('chordpro');
    const request = store.get(id);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteChordPro(id) {
    const tx = this.db.transaction(['chordpro'], 'readwrite');
    const store = tx.objectStore('chordpro');
    await store.delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async findChordProByContentHash(contentHash) {
    const tx = this.db.transaction(['chordpro'], 'readonly');
    const store = tx.objectStore('chordpro');
    const index = store.index('contentHash');
    const request = index.get(contentHash);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Local state operations (per-setlist, per-user)
  async getLocalState(setlistId) {
    const tx = this.db.transaction(['setlist_local'], 'readonly');
    const store = tx.objectStore('setlist_local');
    const request = store.get(setlistId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        // Return defaults if not found
        resolve(
          request.result || {
            setlistId,
            padsEnabled: false,
            padSound: null,
            clickEnabled: false,
            sectionVisibility: {},
            lastUsedDate: new Date().toISOString(),
          }
        );
      };
      request.onerror = () => reject(request.error);
    });
  }

  async saveLocalState(localState) {
    const tx = this.db.transaction(['setlist_local'], 'readwrite');
    const store = tx.objectStore('setlist_local');
    await store.put(localState);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async updateLastUsed(setlistId) {
    const state = await this.getLocalState(setlistId);
    state.lastUsedDate = new Date().toISOString();
    return this.saveLocalState(state);
  }

  async deleteLocalState(setlistId) {
    const tx = this.db.transaction(['setlist_local'], 'readwrite');
    const store = tx.objectStore('setlist_local');
    await store.delete(setlistId);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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
              leader: setlist.owner || setlist.leader, // Support both old and new schema
              type: setlist.type,
              playedInKey:
                song.key !== undefined ? song.key : song.modifications?.targetKey || null, // Support both schemas
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

  // Migrate a setlist from old schema to new schema
  migrateSetlist(oldSetlist) {
    // Generate UUID if setlist has date-based ID
    const needsNewId = /^\d{4}-\d{2}-\d{2}/.test(oldSetlist.id);

    const newSetlist = {
      id: needsNewId ? crypto.randomUUID() : oldSetlist.id,
      date: oldSetlist.date,
      time: oldSetlist.time || '10:30',
      type: oldSetlist.type || 'Church Service',
      name: oldSetlist.name || '',
      owner: oldSetlist.owner || oldSetlist.leader || '', // Rename leader → owner
      songs: (oldSetlist.songs || []).map(song => ({
        order: song.order,
        songId: song.songId,
        songUuid: song.songUuid || song.songId, // Use songId as fallback if songUuid missing
        key: song.key !== undefined ? song.key : song.modifications?.targetKey || null,
        tempo: song.tempo !== undefined ? song.tempo : song.modifications?.bpmOverride || null,
        notes: song.notes || '',
      })),
      createdDate: oldSetlist.createdDate || oldSetlist.createdAt || new Date().toISOString(),
      modifiedDate: oldSetlist.modifiedDate || oldSetlist.updatedAt || new Date().toISOString(),
      driveFileId: oldSetlist.driveFileId || null,
      driveModifiedTime: oldSetlist.driveModifiedTime || null,
      lastSyncedAt: oldSetlist.lastSyncedAt || null,
      _lastSyncHash: oldSetlist._lastSyncHash || null,
    };

    return newSetlist;
  }

  // Migrate all setlists in database to new schema
  async migrateAllSetlists() {
    const allSetlists = await this.getAllSetlists();
    let migratedCount = 0;

    for (const setlist of allSetlists) {
      // Check if setlist needs migration
      const needsMigration =
        setlist.leader !== undefined ||
        setlist.createdAt !== undefined ||
        setlist.updatedAt !== undefined ||
        (setlist.songs && setlist.songs.some(s => s.modifications !== undefined));

      if (needsMigration) {
        const migrated = this.migrateSetlist(setlist);

        // If ID changed, delete old one and save new one
        if (migrated.id !== setlist.id) {
          await this.deleteSetlist(setlist.id);
        }

        await this.saveSetlist(migrated);
        migratedCount++;
        console.log(
          `[Migration] Migrated setlist: ${setlist.date} (${setlist.id} → ${migrated.id})`
        );
      }
    }

    console.log(`[Migration] Migrated ${migratedCount} setlists`);
    return migratedCount;
  }

  // Clear all data (for re-import)
  async clearAll() {
    const tx = this.db.transaction(['setlists', 'songs', 'chordpro', 'setlist_local'], 'readwrite');

    const setlistStore = tx.objectStore('setlists');
    const songStore = tx.objectStore('songs');
    const chordproStore = tx.objectStore('chordpro');
    const localStore = tx.objectStore('setlist_local');

    await setlistStore.clear();
    await songStore.clear();
    await chordproStore.clear();
    await localStore.clear();

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
  const { ensureCurrentOrganisation } = await import('./organisation.js');
  const { id } = await ensureCurrentOrganisation();
  const db = new SetalightDB(id);
  await db.init();
  return db;
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
export function createSetlist({ date, time, type, name, owner, leader } = {}) {
  const setlistDate = date || getNextSunday();
  const dateString =
    typeof setlistDate === 'string' ? setlistDate : setlistDate.toISOString().split('T')[0];

  return {
    id: crypto.randomUUID(), // Use UUID instead of date-based ID
    date: dateString,
    time: time || '10:30',
    type: type || determineSetlistType(dateString, name),
    name: name || '',
    owner: owner || leader || '', // Support both owner and leader (backward compat)
    songs: [],
    createdDate: new Date().toISOString(), // Renamed from createdAt
    modifiedDate: new Date().toISOString(), // Renamed from updatedAt
  };
}
