// Space metadata database
// Stores metadata about spaces (workspaces) in a separate global database
// Each space then has its own ChordlessDB with songs, setlists, etc.

import type { Space } from './data-types.ts'
import { requestResult, transactionError } from './utils/idb.ts'
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

const DB_NAME = 'spaces'
const STORE = 'spaces'
const DB_VERSION = 1

// Before 2026-10-20 a space was called an organisation, and the spaces were kept under that name.
// init() moves them to the new database the first time it finds the old one.
const LEGACY_DB_NAME = 'organisations'
const LEGACY_STORE = 'organisations'

/** The old database, or null if this device never had one (and none is made for the asking) */
function openLegacyDatabase(name: string): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    const request = indexedDB.open(name)
    // It did not exist: stop it being made
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

/** A space as the old database kept it: the Drive folder it was linked to had another name */
type LegacySpace = Space & { driveFolderId?: string | null }

export class SpaceDB {
  db: IDBDatabase | null = null
  #name: string
  #legacyName: string

  /** (Tests give names of their own, so they do not touch the spaces of the page they run in) */
  constructor({ name = DB_NAME, legacyName = LEGACY_DB_NAME } = {}) {
    this.#name = name
    this.#legacyName = legacyName
  }

  #transaction(mode: IDBTransactionMode): IDBTransaction {
    if (!this.db) throw new Error('SpaceDB is not initialised')
    return this.db.transaction([STORE], mode)
  }

  async init(): Promise<void> {
    if (this.db) {
      return // Already initialized
    }

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.#name, DB_VERSION)

      request.onerror = () => {
        console.error('[SpaceDB] Error opening database:', request.error)
        reject(
          new Error(`Failed to open Spaces IndexedDB: ${request.error?.message || 'Unknown error'}`)
        )
      }

      request.onsuccess = () => {
        this.db = request.result
        ensurePersistentStorage(this.#name)
        this.#moveFromLegacy().then(() => resolve(), reject)
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
   * Bring the spaces of the database they used to be kept in (and the Drive folder link under its
   * new name), then remove that database. A space already here (by id) is left as it is, so this
   * is safe to run again, or in two tabs at once. One whose name another space has taken since is
   * kept under "Name (2)" and so on, so none is lost. If any cannot be kept, the old database
   * stays, to try again next time.
   */
  async #moveFromLegacy(): Promise<void> {
    const legacy = await openLegacyDatabase(this.#legacyName)
    if (!legacy) return
    let allKept = true
    try {
      const old: LegacySpace[] = legacy.objectStoreNames.contains(LEGACY_STORE)
        ? await requestResult(legacy.transaction([LEGACY_STORE]).objectStore(LEGACY_STORE).getAll())
        : []
      for (const { driveFolderId, ...space } of old) {
        const moved: Space = { ...space }
        const rootRef = space.rootRef ?? driveFolderId
        if (rootRef) moved.rootRef = rootRef
        allKept = (await this.#keep(moved)) && allKept
      }
    } finally {
      legacy.close()
    }
    if (!allKept) {
      console.error('[SpaceDB] Some spaces were not moved: the old database is kept')
      return
    }
    await new Promise<void>(resolve => {
      const request = indexedDB.deleteDatabase(this.#legacyName)
      // Blocked by another tab still on the old database: it is removed when that closes
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })
  }

  /** Whether the space is here now: already, or added (under "Name (2)" and so on if need be) */
  async #keep(space: Space): Promise<boolean> {
    if (await this.getSpace(space.id)) return true
    for (let n = 1; n <= 20; n++) {
      const named = n === 1 ? space : { ...space, name: `${space.name} (${n})` }
      if (await this.#tryAdd(named)) {
        if (n > 1) console.warn(`[SpaceDB] "${space.name}" was taken: moved as "${named.name}"`)
        return true
      }
    }
    return false
  }

  /** Add a space; false when it cannot be (its name is another space's, or its id is here) */
  #tryAdd(space: Space): Promise<boolean> {
    return new Promise(resolve => {
      const tx = this.#transaction('readwrite')
      let added = true
      tx.objectStore(STORE).add(space).onerror = event => {
        added = false
        event.preventDefault()
      }
      tx.oncomplete = tx.onabort = () => resolve(added)
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
