import { expect } from '@open-wc/testing'
import { transactionError } from '../src/js/utils/idb.ts'

const { describe, it } = window

describe('transactionError', () => {
  it("is the failed request's error, not the transaction's null", async () => {
    const name = `idb-test-${crypto.randomUUID()}`
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1)
      open.onupgradeneeded = () => {
        open.result.createObjectStore('things', { keyPath: 'id' }).createIndex('name', 'name', {
          unique: true,
        })
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })

    const tx = db.transaction('things', 'readwrite')
    tx.objectStore('things').put({ id: 1, name: 'same' })
    tx.objectStore('things').put({ id: 2, name: 'same' })
    const error = await new Promise<unknown>(resolve => {
      tx.onerror = event => resolve(transactionError(event, tx))
    })

    db.close()
    indexedDB.deleteDatabase(name)
    expect(error).to.be.instanceOf(DOMException)
    expect((error as DOMException).name).to.equal('ConstraintError')
  })
})
