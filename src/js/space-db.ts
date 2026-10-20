// Space metadata database
// Stores metadata about spaces (workspaces) in a separate global database
// Each space then has its own ChordlessDB with songs, setlists, etc.

import type { Space } from './data-types.ts'
import { transactionError } from './utils/idb.ts'
import { ensurePersistentStorage } from './utils/persistence.ts'

/**
 * Global Spaces Database
 *
 * Stores space metadata that is shared across all spaces.
 * Each space has its own data database (SPACEID)
 * but metadata about all spaces is stored here.
 * Object Store: organisations (the name it was given when a space was called an organisation)
 *
 * Space records contain:
 * - Identity: id (UUID), name (unique)
 * - Timestamps: createdDate, modifiedDate
 */

// The names the browser stores this under were chosen when a space was called an organisation.
// They stay, so that spaces already on a device are found: renaming means copying every record.
const DB_NAME = 'organisations'
const STORE = 'organisations'
const DB_VERSION = 1

export class SpaceDB {
  db: IDBDatabase | null = null

  #transaction(mode: IDBTransactionMode): IDBTransaction {
    if (!this.db) throw new Error('SpaceDB is not initialised')
    return this.db.transaction([STORE], mode)
  }

  async init(): Promise<void> {
    if (this.db) {
      return // Already initialized
    }

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('[SpaceDB] Error opening database:', request.error)
        reject(
          new Error(`Failed to open Spaces IndexedDB: ${request.error?.message || 'Unknown error'}`)
        )
      }

      request.onsuccess = () => {
        this.db = request.result
        ensurePersistentStorage(DB_NAME)
        resolve()
      }

      request.onupgradeneeded = () => {
        const db = request.result

        // Create spaces store
        if (!db.objectStoreNames.contains(STORE)) {
          const spaceStore = db.createObjectStore(STORE, { keyPath: 'id' })
          spaceStore.createIndex('name', 'name', { unique: true })
        }
      }
    })
  }

  /**
   * Create a new space
   */
  async createSpace(name: string): Promise<Space> {
    const space: Space = {
      id: crypto.randomUUID(),
      name: name,
      createdDate: new Date().toISOString(),
      modifiedDate: new Date().toISOString(),
    }

    return new Promise<Space>((resolve, reject) => {
      const tx = this.#transaction('readwrite')
      tx.objectStore(STORE).put(space)
      tx.oncomplete = () => resolve(space)
      // The failure is the request's (e.g. ConstraintError for a name in use)
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  /**
   * Get space by ID
   */
  async getSpace(id: string): Promise<Space | undefined> {
    const tx = this.#transaction('readonly')
    const store = tx.objectStore(STORE)
    const request = store.get(id)

    return new Promise<Space | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get space by name
   */
  async getSpaceByName(name: string): Promise<Space | undefined> {
    const tx = this.#transaction('readonly')
    const store = tx.objectStore(STORE)
    const index = store.index('name')
    const request = index.get(name)

    return new Promise<Space | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get all spaces
   */
  async getAllSpaces(): Promise<Space[]> {
    const tx = this.#transaction('readonly')
    const store = tx.objectStore(STORE)
    const request = store.getAll()

    return new Promise<Space[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Update space
   */
  async updateSpace(id: string, updates: Partial<Omit<Space, 'id'>>): Promise<Space> {
    const space = await this.getSpace(id)
    if (!space) {
      throw new Error(`Space ${id} not found`)
    }

    const updated: Space = {
      ...space,
      ...updates,
      id: space.id, // Prevent ID changes
      modifiedDate: new Date().toISOString(),
    }

    const tx = this.#transaction('readwrite')
    const store = tx.objectStore(STORE)
    await store.put(updated)

    return new Promise<Space>((resolve, reject) => {
      tx.oncomplete = () => resolve(updated)
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  /**
   * Delete space (does not delete its data database)
   */
  async deleteSpace(id: string): Promise<void> {
    const tx = this.#transaction('readwrite')
    const store = tx.objectStore(STORE)
    await store.delete(id)

    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }
}
