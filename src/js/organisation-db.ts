// Organisation metadata database
// Stores metadata about organisations (workspaces) in a separate global database
// Each organisation then has its own ChordlessDB with songs, setlists, etc.

import type { Organisation } from './data-types.ts'
import { transactionError } from './utils/idb.ts'
import { ensurePersistentStorage } from './utils/persistence.ts'

/**
 * Global Organisations Database
 *
 * Stores organisation metadata that is shared across all organisations.
 * Each organisation has its own data database (ORGID)
 * but metadata about all organisations is stored here.
 * Object Store: organisations
 *
 * Organisation records contain:
 * - Identity: id (UUID), name (unique)
 * - Timestamps: createdDate, modifiedDate
 */

const DB_NAME = 'organisations'
const DB_VERSION = 1

export class OrganisationDB {
  db: IDBDatabase | null = null

  #transaction(mode: IDBTransactionMode): IDBTransaction {
    if (!this.db) throw new Error('OrganisationDB is not initialised')
    return this.db.transaction(['organisations'], mode)
  }

  async init(): Promise<void> {
    if (this.db) {
      return // Already initialized
    }

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('[OrganisationDB] Error opening database:', request.error)
        reject(
          new Error(
            `Failed to open Organisations IndexedDB: ${request.error?.message || 'Unknown error'}`
          )
        )
      }

      request.onsuccess = () => {
        this.db = request.result
        ensurePersistentStorage('organisations')
        resolve()
      }

      request.onupgradeneeded = () => {
        const db = request.result

        // Create organisations store
        if (!db.objectStoreNames.contains('organisations')) {
          const orgStore = db.createObjectStore('organisations', { keyPath: 'id' })
          orgStore.createIndex('name', 'name', { unique: true })
        }
      }
    })
  }

  /**
   * Create a new organisation
   */
  async createOrganisation(name: string): Promise<Organisation> {
    const organisation: Organisation = {
      id: crypto.randomUUID(),
      name: name,
      createdDate: new Date().toISOString(),
      modifiedDate: new Date().toISOString(),
    }

    return new Promise<Organisation>((resolve, reject) => {
      const tx = this.#transaction('readwrite')
      tx.objectStore('organisations').put(organisation)
      tx.oncomplete = () => resolve(organisation)
      // The failure is the request's (e.g. ConstraintError for a name in use)
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  /**
   * Get organisation by ID
   */
  async getOrganisation(id: string): Promise<Organisation | undefined> {
    const tx = this.#transaction('readonly')
    const store = tx.objectStore('organisations')
    const request = store.get(id)

    return new Promise<Organisation | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get organisation by name
   */
  async getOrganisationByName(name: string): Promise<Organisation | undefined> {
    const tx = this.#transaction('readonly')
    const store = tx.objectStore('organisations')
    const index = store.index('name')
    const request = index.get(name)

    return new Promise<Organisation | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get all organisations
   */
  async getAllOrganisations(): Promise<Organisation[]> {
    const tx = this.#transaction('readonly')
    const store = tx.objectStore('organisations')
    const request = store.getAll()

    return new Promise<Organisation[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Update organisation
   */
  async updateOrganisation(
    id: string,
    updates: Partial<Omit<Organisation, 'id'>>
  ): Promise<Organisation> {
    const org = await this.getOrganisation(id)
    if (!org) {
      throw new Error(`Organisation ${id} not found`)
    }

    const updated: Organisation = {
      ...org,
      ...updates,
      id: org.id, // Prevent ID changes
      modifiedDate: new Date().toISOString(),
    }

    const tx = this.#transaction('readwrite')
    const store = tx.objectStore('organisations')
    await store.put(updated)

    return new Promise<Organisation>((resolve, reject) => {
      tx.oncomplete = () => resolve(updated)
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }

  /**
   * Delete organisation (does not delete its data database)
   */
  async deleteOrganisation(id: string): Promise<void> {
    const tx = this.#transaction('readwrite')
    const store = tx.objectStore('organisations')
    await store.delete(id)

    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = event => reject(transactionError(event, tx))
    })
  }
}
