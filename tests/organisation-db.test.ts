/** The organisations database: the list of organisations on this device (src/js/organisation-db.ts) */

import { expect } from '@open-wc/testing'
import { OrganisationDB } from '../src/js/organisation-db.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('OrganisationDB', () => {
  let store: OrganisationDB
  let made: string[]
  const name = () => `Church ${crypto.randomUUID().slice(0, 8)}`

  async function make(churchName = name()) {
    const organisation = await store.createOrganisation(churchName)
    made.push(organisation.id)
    return organisation
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
    store = new OrganisationDB()
    await store.init()
  })

  afterEach(async () => {
    for (const id of made) await store.deleteOrganisation(id)
    store.db?.close()
  })

  it('is used after it is opened, and says so if it is not', async () => {
    const closed = new OrganisationDB()
    let message = ''
    try {
      await closed.getAllOrganisations()
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.equal('OrganisationDB is not initialised')
  })

  it('can be opened twice', async () => {
    const db = store.db
    await store.init()
    expect(store.db).to.equal(db)
  })

  it('keeps an organisation by id and by name, and lists it', async () => {
    const organisation = await make()
    expect(await store.getOrganisation(organisation.id)).to.deep.equal(organisation)
    expect(await store.getOrganisationByName(organisation.name)).to.deep.equal(organisation)
    expect((await store.getAllOrganisations()).map(each => each.id)).to.include(organisation.id)
    expect(await store.getOrganisation('nobody')).to.equal(undefined)
  })

  it('refuses a second organisation with the same name', async () => {
    const organisation = await make()
    let error: unknown
    try {
      await make(organisation.name)
    } catch (caught) {
      error = caught
    }
    expect((error as DOMException).name).to.equal('ConstraintError')
  })

  it('changes an organisation, keeping its id, and stamps when', async () => {
    const organisation = await make()
    const updated = await store.updateOrganisation(organisation.id, {
      name: `${organisation.name} renamed`,
      id: 'other',
    } as never)
    expect(updated.id).to.equal(organisation.id)
    expect(updated.name).to.equal(`${organisation.name} renamed`)
    expect(updated.modifiedDate >= organisation.modifiedDate).to.equal(true)
    expect((await store.getOrganisation(organisation.id))?.name).to.equal(updated.name)
  })

  it('says so when asked to change one that is not there', async () => {
    let message = ''
    await store.updateOrganisation('nobody', { name: 'x' }).catch(error => {
      message = error.message
    })
    expect(message).to.equal('Organisation nobody not found')
  })

  it('refuses to rename one to the name of another', async () => {
    const first = await make()
    const second = await make()
    let error: unknown
    await store.updateOrganisation(second.id, { name: first.name }).catch(caught => {
      error = caught
    })
    expect((error as DOMException).name).to.equal('ConstraintError')
  })

  it('forgets an organisation', async () => {
    const organisation = await make()
    await store.deleteOrganisation(organisation.id)
    expect(await store.getOrganisation(organisation.id)).to.equal(undefined)
  })

  it('reports a read that the browser could not do', async () => {
    const reads = [
      () => store.getOrganisation('x'),
      () => store.getOrganisationByName('x'),
      () => store.getAllOrganisations(),
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
    const organisation = await make()
    const writes = [
      () => store.createOrganisation(name()),
      () => store.updateOrganisation(organisation.id, { name: name() }),
      () => store.deleteOrganisation(organisation.id),
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
