/**
 * Upgrading a database (docs/MIGRATIONS.md): from every version this build upgrades, it becomes the
 * database a new device gets. The snapshot of what each version had is written out in
 * old-database.ts, so a change to the stores that skips it, or a version without a snapshot, fails here.
 */
import { expect } from '@open-wc/testing'
import { ChordlessDB, DB_VERSION, OLDEST_UPGRADABLE } from '../src/js/db.ts'
import { oldDatabase, SCHEMA_V14, type StoreShape, schemaOf } from './old-database.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it } = window

const OLDEST = OLDEST_UPGRADABLE

/** What each version below the current one had: add one when DB_VERSION goes up */
const SCHEMAS: Record<number, StoreShape[]> = { 14: SCHEMA_V14 }

async function schemaAfterOpening(name: string): Promise<StoreShape[]> {
  const db = new ChordlessDB(name)
  await db.init()
  try {
    return schemaOf(db.db as IDBDatabase)
  } finally {
    db.db?.close()
    await deleteDatabase(name)
  }
}

describe('ChordlessDB upgrading', () => {
  it('has a snapshot of every version it upgrades from', () => {
    const expected = Array.from({ length: DB_VERSION - OLDEST }, (_, i) => OLDEST + i)
    expect(Object.keys(SCHEMAS).map(Number)).to.deep.equal(expected)
  })

  for (const [version, schema] of Object.entries(SCHEMAS)) {
    it(`gives a database of version ${version} the stores and indexes a new one has`, async () => {
      const fresh = await schemaAfterOpening(`test-fresh-${crypto.randomUUID()}`)
      const old = await oldDatabase(Number(version), schema)
      expect(await schemaAfterOpening(old)).to.deep.equal(fresh)
    })
  }

  it('is of the current version once opened', async () => {
    const name = await oldDatabase(OLDEST, SCHEMAS[OLDEST])
    const db = new ChordlessDB(name)
    await db.init()
    try {
      expect(db.db?.version).to.equal(DB_VERSION)
    } finally {
      db.db?.close()
      await deleteDatabase(name)
    }
  })
})
