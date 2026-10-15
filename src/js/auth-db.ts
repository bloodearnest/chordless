/**
 * AuthDB - IndexedDB wrapper for Google Drive auth blob storage and operation queuing
 *
 * Used by Service Worker to:
 * - Store encrypted JWE token blobs
 * - Queue invite/revoke operations for offline support
 * - Track operation status and retry logic
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
}

/** The encrypted token blob, as stored (the single record 'current') */
export interface StoredBlob {
  blob: string
  metadata: AuthMetadata
  updated_at: string
}

/** A queued request for the worker to make once the device is online and signed in */
export type OperationRequest =
  | { type: 'invite'; file_id: string; email: string }
  | { type: 'revoke'; file_id: string; permission_id: string }

export type OperationStatus = 'pending' | 'completed' | 'failed'

export type QueuedOperation = OperationRequest & {
  id: number
  status: OperationStatus
  timestamp: string
  retry_count: number
  last_error: string | null
  updated_at?: string
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
  QUEUE: 'operation-queue', // Stores pending operations
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
 * Queue an operation (invite or revoke)
 */
export async function queueOperation(operation: OperationRequest): Promise<number> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.QUEUE, 'readwrite')
  const store = tx.objectStore(STORES.QUEUE)

  const queueItem = {
    ...operation,
    status: 'pending',
    timestamp: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
  }

  const id = Number(await requestResult(store.add(queueItem)))

  db.close()
  return id
}

/**
 * Get all pending operations
 */
export async function getPendingOperations(): Promise<QueuedOperation[]> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.QUEUE, 'readonly')
  const store = tx.objectStore(STORES.QUEUE)
  const index = store.index('status')

  const results = await requestResult(index.getAll('pending'))

  db.close()
  return results
}

/**
 * Update operation status
 */
export async function updateOperationStatus(
  id: number,
  status: OperationStatus,
  error: string | null = null
): Promise<void> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.QUEUE, 'readwrite')
  const store = tx.objectStore(STORES.QUEUE)

  // Get current operation
  const operation = await requestResult(store.get(id))

  if (!operation) {
    db.close()
    throw new Error(`Operation ${id} not found`)
  }

  // Update status
  operation.status = status
  operation.last_error = error
  if (status === 'failed') {
    operation.retry_count = (operation.retry_count || 0) + 1
  }
  operation.updated_at = new Date().toISOString()

  await requestResult(store.put(operation))

  db.close()
}

/**
 * Delete completed/failed operations
 */
export async function deleteOperation(id: number): Promise<void> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.QUEUE, 'readwrite')
  const store = tx.objectStore(STORES.QUEUE)

  await requestResult(store.delete(id))

  db.close()
}

/**
 * Clear all completed operations (older than 24 hours)
 */
export async function clearCompletedOperations(): Promise<void> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.QUEUE, 'readwrite')
  const store = tx.objectStore(STORES.QUEUE)

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const results = await requestResult(store.getAll())

  for (const op of results) {
    if (op.status === 'completed' && op.updated_at !== undefined && op.updated_at < cutoff) {
      await requestResult(store.delete(op.id))
    }
  }

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
