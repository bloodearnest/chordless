import { expect } from '@open-wc/testing'
import {
  deleteBlob,
  exportBlobBackup,
  getBlob,
  importBlobBackup,
  initAuthDB,
  storeBlob,
} from '../src/js/auth-db.ts'
import { requestResult } from '../src/js/utils/idb.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, afterEach } = window

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
