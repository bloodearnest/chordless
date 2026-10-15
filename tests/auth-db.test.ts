import { expect } from '@open-wc/testing'
import {
  clearCompletedOperations,
  deleteBlob,
  deleteOperation,
  exportBlobBackup,
  getBlob,
  getPendingOperations,
  importBlobBackup,
  initAuthDB,
  queueOperation,
  storeBlob,
  updateOperationStatus,
} from '../src/js/auth-db.ts'
import { requestResult } from '../src/js/utils/idb.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, afterEach } = window

/** Every queued operation, whatever its status */
async function allOperations() {
  const db = await initAuthDB()
  const all = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const request = db.transaction('operation-queue').objectStore('operation-queue').getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return all
}

describe('auth-db', () => {
  afterEach(() => deleteDatabase('auth'))

  it('stores, reads and deletes the blob', async () => {
    expect(await getBlob()).to.equal(undefined)
    const stored = await storeBlob('encrypted', { access_token: 'a' })
    expect(stored.blob).to.equal('encrypted')
    const read = await getBlob()
    expect(read?.metadata.access_token).to.equal('a')
    await storeBlob('plain')
    expect((await getBlob())?.metadata).to.deep.equal({})
    await deleteBlob()
    expect(await getBlob()).to.equal(undefined)
  })

  it('queues operations, and lists the pending ones', async () => {
    const first = await queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
    const second = await queueOperation({ type: 'revoke', file_id: 'f', permission_id: 'p' })
    expect(second).to.be.greaterThan(first)
    const pending = await getPendingOperations()
    expect(pending.map(op => op.id)).to.deep.equal([first, second])
    expect(pending[0].status).to.equal('pending')
    expect(pending[0].retry_count).to.equal(0)

    await updateOperationStatus(first, 'completed')
    expect((await getPendingOperations()).map(op => op.id)).to.deep.equal([second])
  })

  it('counts a failure as a retry and keeps its error', async () => {
    const id = await queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
    await updateOperationStatus(id, 'failed', 'offline')
    await updateOperationStatus(id, 'failed', 'offline')
    const [op] = await allOperations()
    expect(op.retry_count).to.equal(2)
    expect(op.last_error).to.equal('offline')
    expect(op.updated_at).to.be.a('string')
  })

  it('counts a retry from nothing when the count is missing', async () => {
    const id = await queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
    const db = await initAuthDB()
    await new Promise<void>(resolve => {
      const tx = db.transaction('operation-queue', 'readwrite')
      const store = tx.objectStore('operation-queue')
      store.get(id).onsuccess = event => {
        const op = (event.target as IDBRequest).result
        delete op.retry_count
        store.put(op)
      }
      tx.oncomplete = () => resolve()
    })
    db.close()
    await updateOperationStatus(id, 'failed')
    expect((await allOperations())[0].retry_count).to.equal(1)
  })

  it('refuses to update an operation that is not there', async () => {
    try {
      await updateOperationStatus(99, 'completed')
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.equal('Operation 99 not found')
    }
  })

  it('deletes an operation', async () => {
    const id = await queueOperation({ type: 'revoke', file_id: 'f', permission_id: 'p' })
    await deleteOperation(id)
    expect(await allOperations()).to.have.length(0)
  })

  it('clears the operations completed more than a day ago, and no others', async () => {
    const ids: number[] = []
    for (let i = 0; i < 4; i++) {
      ids.push(await queueOperation({ type: 'revoke', file_id: 'f', permission_id: `p${i}` }))
    }
    // 0: completed long ago; 1: completed just now; 2: pending; 3: completed with no time kept
    await updateOperationStatus(ids[0], 'completed')
    await updateOperationStatus(ids[1], 'completed')
    const db = await initAuthDB()
    await new Promise<void>(resolve => {
      const tx = db.transaction('operation-queue', 'readwrite')
      const store = tx.objectStore('operation-queue')
      store.get(ids[0]).onsuccess = event => {
        const op = (event.target as IDBRequest).result
        op.updated_at = new Date(Date.now() - 2 * 86400_000).toISOString()
        store.put(op)
      }
      store.get(ids[3]).onsuccess = event => {
        const op = (event.target as IDBRequest).result
        op.status = 'completed'
        store.put(op)
      }
      tx.oncomplete = () => resolve()
    })
    db.close()

    await clearCompletedOperations()
    expect((await allOperations()).map(op => op.id)).to.deep.equal([ids[1], ids[2], ids[3]])
  })

  it('exports the blob as a backup, and imports it again', async () => {
    try {
      await exportBlobBackup()
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.equal('No auth blob found')
    }
    await storeBlob('secret', { id_token: 't' })
    const backup = await exportBlobBackup()
    expect(backup.version).to.equal(1)
    expect(backup.blob).to.equal('secret')
    await deleteBlob()
    await importBlobBackup(backup)
    expect((await getBlob())?.metadata.id_token).to.equal('t')
  })

  it('refuses a backup of the wrong shape', async () => {
    for (const bad of [null, undefined, {}, { version: 2, blob: 'x' }, { version: 1 }] as const) {
      try {
        await importBlobBackup(bad as never)
        expect.fail('should have thrown')
      } catch (error) {
        expect((error as Error).message).to.equal('Invalid backup format')
      }
    }
  })

  it('rejects with the error of a request that fails', async () => {
    const db = await initAuthDB()
    const store = db.transaction('auth-blob', 'readwrite').objectStore('auth-blob')
    await requestResult(store.add('one', 'key'))
    try {
      await requestResult(store.add('two', 'key'))
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as DOMException).name).to.equal('ConstraintError')
    }
    db.close()
  })

  it('rejects when the database cannot be opened', async () => {
    // A newer version than this code knows cannot be opened by it
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('auth', 2)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    try {
      await initAuthDB()
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as DOMException).name).to.equal('VersionError')
    }
  })
})
