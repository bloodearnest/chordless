// Organisation metadata database
// Stores metadata about organisations (workspaces) in a separate global database
// Each organisation then has its own ChordlessDB with songs, setlists, etc.

import { ensurePersistentStorage } from './utils/persistence.js'

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
  constructor() {
    this.db = null
  }

  async init() {
    if (this.db) {
      return // Already initialized
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = event => {
        console.error('[OrganisationDB] Error opening database:', event.target.error)
        reject(
          new Error(
            `Failed to open Organisations IndexedDB: ${event.target.error?.message || 'Unknown error'}`
          )
        )
      }

      request.onsuccess = event => {
        this.db = event.target.result
        console.log('[OrganisationDB] Database initialized successfully')
        ensurePersistentStorage('organisations')
        resolve()
      }

      request.onupgradeneeded = event => {
        const db = event.target.result

        console.log('[OrganisationDB] Creating database schema')

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
  async createOrganisation(name) {
    const organisation = {
      id: crypto.randomUUID(),
      name: name,
      createdDate: new Date().toISOString(),
      modifiedDate: new Date().toISOString(),
    }

    const tx = this.db.transaction(['organisations'], 'readwrite')
    const store = tx.objectStore('organisations')
    await store.put(organisation)

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(organisation)
      tx.onerror = () => reject(tx.error)
    })
  }

  /**
   * Get organisation by ID
   */
  async getOrganisation(id) {
    const tx = this.db.transaction(['organisations'], 'readonly')
    const store = tx.objectStore('organisations')
    const request = store.get(id)

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get organisation by name
   */
  async getOrganisationByName(name) {
    const tx = this.db.transaction(['organisations'], 'readonly')
    const store = tx.objectStore('organisations')
    const index = store.index('name')
    const request = index.get(name)

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get all organisations
   */
  async getAllOrganisations() {
    const tx = this.db.transaction(['organisations'], 'readonly')
    const store = tx.objectStore('organisations')
    const request = store.getAll()

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Update organisation
   */
  async updateOrganisation(id, updates) {
    const org = await this.getOrganisation(id)
    if (!org) {
      throw new Error(`Organisation ${id} not found`)
    }

    const updated = {
      ...org,
      ...updates,
      id: org.id, // Prevent ID changes
      modifiedDate: new Date().toISOString(),
    }

    const tx = this.db.transaction(['organisations'], 'readwrite')
    const store = tx.objectStore('organisations')
    await store.put(updated)

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(updated)
      tx.onerror = () => reject(tx.error)
    })
  }

  /**
   * Delete organisation (does not delete its data database)
   */
  async deleteOrganisation(id) {
    const tx = this.db.transaction(['organisations'], 'readwrite')
    const store = tx.objectStore('organisations')
    await store.delete(id)

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
