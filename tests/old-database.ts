/**
 * A database as an older version of the app left it, to be upgraded by the current one
 * (docs/MIGRATIONS.md, "Tests"). A schema here is a snapshot of what that version had, written out
 * rather than read from db.ts, which is the code under test.
 */
import { deleteDatabase } from './test-helpers.ts'

export interface StoreShape {
  name: string
  keyPath: string
  indexes?: string[]
}

/** What version 14 (and 13: only the records of `melodies` differed) had: `scores` was `melodies` */
export const SCHEMA_V14: StoreShape[] = [
  {
    name: 'songs',
    keyPath: 'uuid',
    indexes: ['id', 'ccliNumber', 'titleNormalized', 'isDefault', 'importDate'],
  },
  { name: 'chordpro', keyPath: 'id', indexes: ['contentHash'] },
  { name: 'setlists', keyPath: 'id', indexes: ['date', 'type'] },
  { name: 'setlist_local', keyPath: 'setlistId' },
  { name: 'pending_deletions', keyPath: 'ref' },
  { name: 'melodies', keyPath: 'uuid' },
  { name: 'people', keyPath: 'id' },
]

/** Make a database of this schema, at this version, holding `contents` (records by store), and give its name */
export async function oldDatabase(
  version: number,
  schema: StoreShape[],
  contents: Record<string, object[]> = {}
): Promise<string> {
  const name = `test-old-v${version}-${crypto.randomUUID()}`
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      for (const { name: store, keyPath, indexes = [] } of schema) {
        const made = request.result.createObjectStore(store, { keyPath })
        for (const index of indexes) made.createIndex(index, index, { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const stores = Object.keys(contents)
  if (stores.length > 0) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite')
      for (const [store, records] of Object.entries(contents)) {
        for (const record of records) tx.objectStore(store).put(record)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
  db.close()
  return name
}

/** The stores of an open database, with their key and indexes, by name */
export function schemaOf(db: IDBDatabase): StoreShape[] {
  const stores = [...db.objectStoreNames].sort()
  const tx = db.transaction(stores, 'readonly')
  return stores.map(name => {
    const store = tx.objectStore(name)
    return {
      name,
      keyPath: store.keyPath as string,
      indexes: [...store.indexNames].sort(),
    }
  })
}

/** Open it with `open` (which upgrades it), and delete it afterwards */
export async function withDatabase<T>(name: string, open: () => Promise<T>): Promise<T> {
  try {
    return await open()
  } finally {
    await deleteDatabase(name)
  }
}
