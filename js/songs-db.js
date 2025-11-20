import { ensurePersistentStorage } from './utils/persistence.js'

/**
 * Global Songs Database
 *
 * Stores song metadata (NOT chordpro content) that is shared across all organisations.
 * ChordPro content is stored separately in ChordProDB.
 *
 * Database: SetalightDB-songs (global, not organisation-specific)
 * Object Stores:
 * - songs: Song metadata with versions array
 * - chordpro: Raw chordpro content (managed by ChordProDB)
 *
 * Song records contain:
 * - Identity: id, ccliNumber, titleNormalized
 * - Versions: array of version references (each points to a chordpro file)
 * - Usage tracking: appearances, lastUsedAt
 * - Import metadata: source, sourceUrl, createdAt
 * - Sync metadata: Drive file IDs, sync status (for future)
 *
 * ChordPro records contain:
 * - content: Raw chordpro text
 * - contentHash: For deduplication
 * - Sync metadata: lastModified, Drive sync state (for future)
 */

const DB_NAME = 'SetalightDB-songs'
const DB_VERSION = 2

export class SongsDB {
  constructor() {
    this.db = null
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = event => {
        console.error('[SongsDB] Error opening database:', event.target.error)
        reject(
          new Error(
            `Failed to open Songs IndexedDB: ${event.target.error?.message || 'Unknown error'}`
          )
        )
      }

      request.onsuccess = event => {
        this.db = event.target.result
        resolve()
        ensurePersistentStorage('songs')
      }

      request.onupgradeneeded = event => {
        const db = event.target.result
        const oldVersion = event.oldVersion

        console.log('[SongsDB] Upgrading from version', oldVersion, 'to', DB_VERSION)

        // Migration from v1 to v2: Delete and recreate stores with new schema
        if (oldVersion > 0 && oldVersion < 2) {
          console.log('[SongsDB] Migrating from v1 to v2')

          // Delete old songs store (has wrong indexes)
          if (db.objectStoreNames.contains('songs')) {
            console.log('[SongsDB] Deleting old songs store')
            db.deleteObjectStore('songs')
          }
        }

        // Create Songs store (metadata only)
        if (!db.objectStoreNames.contains('songs')) {
          console.log('[SongsDB] Creating songs store')
          const songStore = db.createObjectStore('songs', { keyPath: 'id' })
          songStore.createIndex('ccliNumber', 'ccliNumber', { unique: false })
          songStore.createIndex('titleNormalized', 'titleNormalized', { unique: false })
        }

        // Create ChordPro store (content only)
        if (!db.objectStoreNames.contains('chordpro')) {
          console.log('[SongsDB] Creating chordpro store')
          const chordproStore = db.createObjectStore('chordpro', { keyPath: 'id' })
          chordproStore.createIndex('contentHash', 'contentHash', { unique: false })
        }
      }
    })
  }

  // Song operations
  async saveSong(song) {
    const tx = this.db.transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')
    await store.put(song)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  /**
   * Batch save multiple songs in one transaction (faster)
   */
  async saveSongsBatch(songs) {
    if (songs.length === 0) return

    const tx = this.db.transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')

    // Queue all puts in one transaction
    songs.forEach(song => store.put(song))

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getSong(id) {
    const tx = this.db.transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const request = store.get(id)
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async findSongByCCLI(ccliNumber) {
    const tx = this.db.transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const index = store.index('ccliNumber')
    const request = index.get(ccliNumber)
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async findSongByNormalizedTitle(titleNormalized) {
    const tx = this.db.transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const index = store.index('titleNormalized')
    const request = index.get(titleNormalized)
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async findSongByTextHash(textHash) {
    const tx = this.db.transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const index = store.index('textHash')
    const request = index.get(textHash)
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getAllSongs() {
    const tx = this.db.transaction(['songs'], 'readonly')
    const store = tx.objectStore('songs')
    const request = store.getAll()
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteSong(id) {
    const tx = this.db.transaction(['songs'], 'readwrite')
    const store = tx.objectStore('songs')
    await store.delete(id)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  // Clear all songs and chordpro files (for testing/migration)
  async clearAll() {
    const tx = this.db.transaction(['songs', 'chordpro'], 'readwrite')
    const songStore = tx.objectStore('songs')
    const chordproStore = tx.objectStore('chordpro')
    await songStore.clear()
    await chordproStore.clear()
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}

/**
 * Helper to get the global songs database instance
 */
let globalSongsDB = null

export async function getGlobalSongsDB() {
  if (!globalSongsDB) {
    globalSongsDB = new SongsDB()
    try {
      await globalSongsDB.init()
    } catch (error) {
      console.error('[SongsDB] Failed to initialize, resetting global instance')
      globalSongsDB = null
      throw error
    }
  }
  return globalSongsDB
}

/**
 * Reset the global songs database instance (for after database deletion)
 */
export function resetGlobalSongsDB() {
  if (globalSongsDB && globalSongsDB.db) {
    globalSongsDB.db.close()
  }
  globalSongsDB = null
  console.log('[SongsDB] Global instance reset')
}
