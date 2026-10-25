/**
 * AuthDB - IndexedDB wrapper for the Google sign-in's encrypted token blob (JWE), used by the
 * service worker
 */

import { requestResult } from './utils/idb.ts'

const DB_NAME = 'auth'
const DB_VERSION = 1

/** The signed-in Google user, as the worker sent it, with the avatar cached for offline use */
export interface StoredUser {
  name: string | null
  email: string | null
  picture: string | null
  given_name: string | null
  family_name: string | null
  sub: string | null
  avatarDataUrl?: string
  avatarUpdatedAt?: string
}

/** What is kept beside the encrypted blob */
export interface AuthMetadata {
  access_token?: string
  /** ISO time */
  expires_at?: string
  user?: StoredUser | null
  id_token?: string
  /** What Google granted at the last sign-in; absent for a sign-in made before this was kept */
  scope?: string
}

/** The encrypted token blob, as stored (the single record 'current') */
export interface StoredBlob {
  blob: string
  metadata: AuthMetadata
  updated_at: string
}

/** A blob exported for the user to keep */
export interface BlobBackup {
  version: 1
  exported_at: string
  blob: string
  metadata: AuthMetadata
}

const STORES = {
  BLOB: 'auth-blob', // Stores the encrypted token blob
  // A queue of Drive invite/revoke operations that were never used: the store is still made, so
  // the schema (and DB_VERSION) stays as it is on devices, but nothing reads or writes it
  QUEUE: 'operation-queue',
}

/**
 * Initialize IndexedDB
 */
export function initAuthDB(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = () => {
      const db = request.result

      // Blob store - single record containing the encrypted token blob
      if (!db.objectStoreNames.contains(STORES.BLOB)) {
        db.createObjectStore(STORES.BLOB)
      }

      // Operation queue store - pending operations with auto-incrementing IDs
      if (!db.objectStoreNames.contains(STORES.QUEUE)) {
        const queueStore = db.createObjectStore(STORES.QUEUE, {
          keyPath: 'id',
          autoIncrement: true,
        })
        queueStore.createIndex('status', 'status', { unique: false })
        queueStore.createIndex('timestamp', 'timestamp', { unique: false })
      }
    }
  })
}

/**
 * Store encrypted token blob
 */
export async function storeBlob(blob: string, metadata: AuthMetadata = {}): Promise<StoredBlob> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.BLOB, 'readwrite')
  const store = tx.objectStore(STORES.BLOB)

  const data: StoredBlob = {
    blob,
    metadata,
    updated_at: new Date().toISOString(),
  }

  await requestResult(store.put(data, 'current'))

  db.close()
  return data
}

/**
 * Retrieve encrypted token blob
 */
export async function getBlob(): Promise<StoredBlob | undefined> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.BLOB, 'readonly')
  const store = tx.objectStore(STORES.BLOB)

  const result = await requestResult(store.get('current'))

  db.close()
  return result
}

/**
 * Delete token blob (on logout)
 */
export async function deleteBlob(): Promise<void> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.BLOB, 'readwrite')
  const store = tx.objectStore(STORES.BLOB)

  await requestResult(store.delete('current'))

  db.close()
}

/**
 * Export blob as backup (for user to save)
 */
export async function exportBlobBackup(): Promise<BlobBackup> {
  const data = await getBlob()
  if (!data) {
    throw new Error('No auth blob found')
  }

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    blob: data.blob,
    metadata: data.metadata,
  }
}

/**
 * Import blob from backup
 */
export async function importBlobBackup(
  backup: Partial<BlobBackup> | null | undefined
): Promise<void> {
  if (backup?.version !== 1 || !backup.blob) {
    throw new Error('Invalid backup format')
  }

  await storeBlob(backup.blob, backup.metadata)
}
