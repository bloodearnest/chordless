/**
 * ChordPro Content Database
 *
 * Stores raw chordpro file content only.
 * All metadata lives in SongsDB.
 *
 * Database: SetalightDB-songs (global, shared with SongsDB)
 * Object Store: chordpro
 *
 * ChordPro records contain:
 * - content: Raw chordpro text
 * - contentHash: SHA-256 hash for deduplication and change detection
 * - lastModified: Local modification timestamp
 * - Sync metadata (for future Drive sync)
 */

const DB_NAME = 'SetalightDB-songs'
const DB_VERSION = 2

export class ChordProDB {
  constructor() {
    this.db = null
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        reject(new Error('Failed to open ChordPro IndexedDB'))
      }

      request.onsuccess = event => {
        this.db = event.target.result
        resolve()
      }

      request.onupgradeneeded = event => {
        const db = event.target.result
        const oldVersion = event.oldVersion

        console.log('[ChordProDB] Upgrading from version', oldVersion, 'to', DB_VERSION)

        // Migration from v1 to v2
        if (oldVersion > 0 && oldVersion < 2) {
          console.log('[ChordProDB] Migrating from v1 to v2')

          // Delete old songs store (has wrong indexes)
          if (db.objectStoreNames.contains('songs')) {
            console.log('[ChordProDB] Deleting old songs store')
            db.deleteObjectStore('songs')
          }
        }

        // Create Songs store if needed (in case SongsDB hasn't created it yet)
        if (!db.objectStoreNames.contains('songs')) {
          console.log('[ChordProDB] Creating songs store')
          const songStore = db.createObjectStore('songs', { keyPath: 'id' })
          songStore.createIndex('ccliNumber', 'ccliNumber', { unique: false })
          songStore.createIndex('titleNormalized', 'titleNormalized', { unique: false })
        }

        // Create ChordPro store if it doesn't exist
        if (!db.objectStoreNames.contains('chordpro')) {
          console.log('[ChordProDB] Creating chordpro store')
          const chordproStore = db.createObjectStore('chordpro', { keyPath: 'id' })
          chordproStore.createIndex('contentHash', 'contentHash', { unique: false })
        }
      }
    })
  }

  async save(chordproFile) {
    const tx = this.db.transaction(['chordpro'], 'readwrite')
    const store = tx.objectStore('chordpro')
    await store.put(chordproFile)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async get(id) {
    const tx = this.db.transaction(['chordpro'], 'readonly')
    const store = tx.objectStore('chordpro')
    const request = store.get(id)
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async delete(id) {
    const tx = this.db.transaction(['chordpro'], 'readwrite')
    const store = tx.objectStore('chordpro')
    await store.delete(id)
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async findByHash(contentHash) {
    const tx = this.db.transaction(['chordpro'], 'readonly')
    const store = tx.objectStore('chordpro')
    const index = store.index('contentHash')
    const request = index.get(contentHash)
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async clearAll() {
    const tx = this.db.transaction(['chordpro'], 'readwrite')
    const store = tx.objectStore('chordpro')
    await store.clear()
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}

/**
 * Helper to get the global chordpro database instance
 */
let globalChordProDB = null

export async function getGlobalChordProDB() {
  if (!globalChordProDB) {
    globalChordProDB = new ChordProDB()
    await globalChordProDB.init()
  }
  return globalChordProDB
}
