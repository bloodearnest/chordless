/**
 * AuthDB - IndexedDB wrapper for Google Drive auth blob storage and operation queuing
 *
 * Used by Service Worker to:
 * - Store encrypted JWE token blobs
 * - Queue invite/revoke operations for offline support
 * - Track operation status and retry logic
 */

const DB_NAME = 'auth'
const DB_VERSION = 1

/** The encrypted token blob, as stored (the single record 'current') */
export interface StoredBlob {
  blob: string
  metadata: Record<string, unknown>
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
  metadata: Record<string, unknown>
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
export async function storeBlob(
  blob: string,
  metadata: Record<string, unknown> = {}
): Promise<StoredBlob> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.BLOB, 'readwrite')
  const store = tx.objectStore(STORES.BLOB)

  const data: StoredBlob = {
    blob,
    metadata,
    updated_at: new Date().toISOString(),
  }

  await new Promise<IDBValidKey>((resolve, reject) => {
    const request = store.put(data, 'current')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

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

  const result = await new Promise<StoredBlob | undefined>((resolve, reject) => {
    const request = store.get('current')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

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

  await new Promise<void>((resolve, reject) => {
    const request = store.delete('current')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

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

  const id = await new Promise<number>((resolve, reject) => {
    const request = store.add(queueItem)
    request.onsuccess = () => resolve(Number(request.result))
    request.onerror = () => reject(request.error)
  })

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

  const results = await new Promise<QueuedOperation[]>((resolve, reject) => {
    const request = index.getAll('pending')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

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
  const operation = await new Promise<QueuedOperation | undefined>((resolve, reject) => {
    const request = store.get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

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

  await new Promise<void>((resolve, reject) => {
    const request = store.put(operation)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

  db.close()
}

/**
 * Delete completed/failed operations
 */
export async function deleteOperation(id: number): Promise<void> {
  const db = await initAuthDB()
  const tx = db.transaction(STORES.QUEUE, 'readwrite')
  const store = tx.objectStore(STORES.QUEUE)

  await new Promise<void>((resolve, reject) => {
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

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

  const results = await new Promise<QueuedOperation[]>((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  for (const op of results) {
    if (op.status === 'completed' && op.updated_at !== undefined && op.updated_at < cutoff) {
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(op.id)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
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
