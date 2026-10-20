/** The spaces database: the list of spaces on this device (src/js/space-db.ts) */

import { expect } from '@open-wc/testing'
import { SpaceDB } from '../src/js/space-db.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('SpaceDB', () => {
  let store: SpaceDB
  let made: string[]
  const name = () => `Church ${crypto.randomUUID().slice(0, 8)}`

  async function make(churchName = name()) {
    const space = await store.createSpace(churchName)
    made.push(space.id)
    return space
  }

  /** Make the next transaction abort as soon as it starts, as a browser failing would */
  function failNextTransaction() {
    const real = store.db?.transaction.bind(store.db) as IDBDatabase['transaction']
    ;(store.db as IDBDatabase).transaction = ((...args: Parameters<typeof real>) => {
      const tx = real(...args)
      queueMicrotask(() => tx.abort())
      return tx
    }) as IDBDatabase['transaction']
    return () => ((store.db as IDBDatabase).transaction = real)
  }

  beforeEach(async () => {
    made = []
    store = new SpaceDB()
    await store.init()
  })

  afterEach(async () => {
    for (const id of made) await store.deleteSpace(id)
    store.db?.close()
  })

  it('is used after it is opened, and says so if it is not', async () => {
    const closed = new SpaceDB()
    let message = ''
    try {
      await closed.getAllSpaces()
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.equal('SpaceDB is not initialised')
  })

  it('can be opened twice', async () => {
    const db = store.db
    await store.init()
    expect(store.db).to.equal(db)
  })

  it('keeps a space by id and by name, and lists it', async () => {
    const space = await make()
    expect(await store.getSpace(space.id)).to.deep.equal(space)
    expect(await store.getSpaceByName(space.name)).to.deep.equal(space)
    expect((await store.getAllSpaces()).map(each => each.id)).to.include(space.id)
    expect(await store.getSpace('nobody')).to.equal(undefined)
  })

  it('refuses a second space with the same name', async () => {
    const space = await make()
    let error: unknown
    try {
      await make(space.name)
    } catch (caught) {
      error = caught
    }
    expect((error as DOMException).name).to.equal('ConstraintError')
  })

  it('changes a space, keeping its id, and stamps when', async () => {
    const space = await make()
    const updated = await store.updateSpace(space.id, {
      name: `${space.name} renamed`,
      id: 'other',
    } as never)
    expect(updated.id).to.equal(space.id)
    expect(updated.name).to.equal(`${space.name} renamed`)
    expect(updated.modifiedDate >= space.modifiedDate).to.equal(true)
    expect((await store.getSpace(space.id))?.name).to.equal(updated.name)
  })

  it('says so when asked to change one that is not there', async () => {
    let message = ''
    await store.updateSpace('nobody', { name: 'x' }).catch(error => {
      message = error.message
    })
    expect(message).to.equal('Space nobody not found')
  })

  it('refuses to rename one to the name of another', async () => {
    const first = await make()
    const second = await make()
    let error: unknown
    await store.updateSpace(second.id, { name: first.name }).catch(caught => {
      error = caught
    })
    expect((error as DOMException).name).to.equal('ConstraintError')
  })

  it('forgets a space', async () => {
    const space = await make()
    await store.deleteSpace(space.id)
    expect(await store.getSpace(space.id)).to.equal(undefined)
  })

  it('reports a read that the browser could not do', async () => {
    const reads = [
      () => store.getSpace('x'),
      () => store.getSpaceByName('x'),
      () => store.getAllSpaces(),
    ]
    for (const read of reads) {
      const restore = failNextTransaction()
      let error: unknown
      try {
        await read()
      } catch (caught) {
        error = caught
      } finally {
        restore()
      }
      expect((error as DOMException).name).to.equal('AbortError')
    }
  })

  it('reports a write that the browser could not do', async () => {
    const space = await make()
    const writes = [
      () => store.createSpace(name()),
      () => store.updateSpace(space.id, { name: name() }),
      () => store.deleteSpace(space.id),
    ]
    for (const write of writes) {
      let error: unknown
      const restore = failNextTransaction()
      try {
        await write()
      } catch (caught) {
        error = caught
      } finally {
        restore()
      }
      expect(error, String(write)).to.be.ok
    }
  })
})
