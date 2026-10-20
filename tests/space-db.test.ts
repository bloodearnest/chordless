/** The spaces database: the list of spaces on this device (src/js/space-db.ts) */

import { expect } from '@open-wc/testing'
import { SpaceDB } from '../src/js/space-db.ts'
import { must } from './must.ts'
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

describe('SpaceDB: spaces kept as organisations', () => {
  let names: { name: string; legacyName: string }
  const toDelete: string[] = []

  beforeEach(() => {
    const id = crypto.randomUUID().slice(0, 8)
    names = { name: `test-spaces-${id}`, legacyName: `test-organisations-${id}` }
    toDelete.push(names.name, names.legacyName)
  })

  afterEach(async () => {
    for (const name of toDelete.splice(0)) {
      await new Promise<void>(resolve => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = request.onerror = request.onblocked = () => resolve()
      })
    }
  })

  /** The database as the last version left it: an `organisations` store of spaces */
  function makeLegacy(spaces: object[]) {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(names.legacyName, 1)
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore('organisations', { keyPath: 'id' })
          .createIndex('name', 'name', { unique: true })
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['organisations'], 'readwrite')
        for (const space of spaces) tx.objectStore('organisations').put(space)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }

  it('lets go of the database when another window upgrades it, so that is not left waiting', async () => {
    await new SpaceDB(names).init()

    const upgraded = await new Promise<IDBDatabase | 'blocked'>((resolve, reject) => {
      const request = indexedDB.open(names.name, 99)
      request.onblocked = () => resolve('blocked')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    expect(upgraded).to.not.equal('blocked')
    ;(upgraded as IDBDatabase).close()
  })

  const databases = async () => (await indexedDB.databases()).map(db => db.name)

  it('brings them to the new database, with the Drive folder link under its new name, and removes the old one', async () => {
    await makeLegacy([
      { id: 'a', name: 'Grace', driveFolderId: 'folder-a', driveClientId: 'client', members: [] },
      { id: 'b', name: 'Personal' },
    ])

    const store = new SpaceDB(names)
    await store.init()

    const grace = must(await store.getSpace('a'))
    expect(grace).to.include({ name: 'Grace', rootRef: 'folder-a', driveClientId: 'client' })
    expect(grace).not.to.have.property('driveFolderId')
    expect(must(await store.getSpace('b'))).not.to.have.property('rootRef')
    expect((await store.getAllSpaces()).map(space => space.id).sort()).to.deep.equal(['a', 'b'])
    expect(await databases()).to.not.include(names.legacyName)
    store.db?.close()
  })

  it('removes an old database that holds no spaces', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(names.legacyName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('something-else')
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })

    const store = new SpaceDB(names)
    await store.init()

    expect(await store.getAllSpaces()).to.deep.equal([])
    expect(await databases()).to.not.include(names.legacyName)
    store.db?.close()
  })

  it('keeps the old database when a space cannot be kept, to try again next time', async () => {
    const store = new SpaceDB(names)
    await store.init()
    // Every name "Taken", "Taken (2)" ... up to the last one tried is another space's
    await store.createSpace('Taken')
    for (let n = 2; n <= 20; n++) await store.createSpace(`Taken (${n})`)
    await makeLegacy([
      { id: 'a', name: 'Fine' },
      { id: 'z', name: 'Taken' },
    ])

    const again = new SpaceDB(names)
    await again.init()

    expect(await again.getSpace('a')).to.be.ok
    expect(await again.getSpace('z')).to.equal(undefined)
    expect(await databases()).to.include(names.legacyName)
    store.db?.close()
    again.db?.close()
  })

  it('makes nothing of the old database when there never was one', async () => {
    const store = new SpaceDB(names)
    await store.init()
    expect(await databases()).to.include(names.name)
    expect(await databases()).to.not.include(names.legacyName)
    store.db?.close()
  })

  it('keeps a space already in the new database, and adds the rest, under another name if need be, when it runs again', async () => {
    await makeLegacy([
      { id: 'a', name: 'Grace', driveFolderId: 'old-link' },
      { id: 'c', name: 'Taken' },
    ])
    const first = new SpaceDB(names)
    await first.init()
    await first.updateSpace('a', { rootRef: 'newer-link' })
    // The old database comes back (another tab, an old build) with the same space and a new one
    await makeLegacy([
      { id: 'a', name: 'Grace', driveFolderId: 'old-link' },
      { id: 'd', name: 'Later' },
      { id: 'e', name: 'Taken' },
    ])

    const second = new SpaceDB(names)
    await second.init()

    expect(must(await second.getSpace('a')).rootRef).to.equal('newer-link')
    expect(await second.getSpace('d')).to.be.ok
    // (the name was taken by another space: it comes under another, and is not lost)
    expect(must(await second.getSpace('e')).name).to.equal('Taken (2)')
    expect(await databases()).to.not.include(names.legacyName)
    first.db?.close()
    second.db?.close()
  })
})
