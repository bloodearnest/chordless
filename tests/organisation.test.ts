import { expect } from '@open-wc/testing'
import {
  createOrganisation,
  deleteOrganisation as deleteOrganisationAndData,
  ensureCurrentOrganisation,
  getCurrentOrganisation,
  getCurrentOrganisationFull,
  getOrganisationByName,
  listOrganisations,
  renameOrganisation,
  setCurrentOrganisation,
  switchOrganisation,
} from '../src/js/organisation.ts'
import { OrganisationDB } from '../src/js/organisation-db.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

// Other test files, run alongside these, use the current organisation's
// database: put it back after each test that changes it
const KEYS = ['current-organisation-id', 'current-organisation-name']
let saved
beforeEach(() => {
  saved = KEYS.map(key => localStorage.getItem(key))
})
afterEach(() => {
  KEYS.forEach((key, i) => {
    if (saved[i] === null) localStorage.removeItem(key)
    else localStorage.setItem(key, saved[i])
  })
})

describe('ensureCurrentOrganisation', () => {
  beforeEach(async () => {
    // As on a first visit: no current organisation, and no default one yet
    localStorage.removeItem('current-organisation-id')
    localStorage.removeItem('current-organisation-name')
    for (const org of await listOrganisations()) {
      if (org.name === 'Personal') await deleteOrganisation(org.id)
    }
  })

  it('creates the default organisation once when called twice at the same time', async () => {
    const [first, second] = await Promise.all([
      ensureCurrentOrganisation(),
      ensureCurrentOrganisation(),
    ])
    expect(first.name).to.equal('Personal')
    expect(second.id).to.equal(first.id)
    const personal = (await listOrganisations()).filter(org => org.name === 'Personal')
    expect(personal).to.have.length(1)
  })

  it('refuses a name already in use with a ConstraintError, not a bare null', async () => {
    const { name } = await ensureCurrentOrganisation()
    let error: Error | null = null
    try {
      await createOrganisation(name)
    } catch (caught) {
      error = caught as Error
    }
    expect(error?.name).to.equal('ConstraintError')
  })
})

describe('the current organisation', () => {
  const unique = name => `${name} ${crypto.randomUUID().slice(0, 8)}`

  it('is remembered with its name, fetched when not given', async () => {
    const org = await createOrganisation(unique('Church'))
    await setCurrentOrganisation(org.id, org.name)
    expect(getCurrentOrganisation()).to.deep.equal({ id: org.id, name: org.name })

    const other = await createOrganisation(unique('Other'))
    await setCurrentOrganisation(other.id)
    expect(getCurrentOrganisation()).to.deep.equal({ id: other.id, name: other.name })
  })

  it('is found by name', async () => {
    const org = await createOrganisation(unique('Named'))
    expect(must(await getOrganisationByName(org.name)).id).to.equal(org.id)
    expect(await getOrganisationByName(unique('Nobody'))).to.equal(undefined)
  })

  it('falls back to the default organisation when the remembered one is gone', async () => {
    localStorage.setItem('current-organisation-id', 'deleted-organisation')
    localStorage.setItem('current-organisation-name', 'Deleted')
    const org = await getCurrentOrganisationFull()
    expect(org.name).to.equal('Personal')
    expect(getCurrentOrganisation()).to.deep.equal({ id: org.id, name: 'Personal' })
  })
})

describe('creating the default organisation beside another page', () => {
  const realByName = OrganisationDB.prototype.getOrganisationByName
  afterEach(() => {
    OrganisationDB.prototype.getOrganisationByName = realByName
  })

  it('reads back the one the other page made, when the name is taken', async () => {
    localStorage.removeItem('current-organisation-id')
    const { id } = await ensureCurrentOrganisation()
    localStorage.removeItem('current-organisation-id')
    // The first look finds nothing (the other page had not made it yet); making it is refused
    let looks = 0
    OrganisationDB.prototype.getOrganisationByName = function (name) {
      return looks++ === 0 ? Promise.resolve(undefined) : realByName.call(this, name)
    }
    expect((await ensureCurrentOrganisation()).id).to.equal(id)
  })

  it('gives up when the name is taken and then cannot be found', async () => {
    localStorage.removeItem('current-organisation-id')
    await ensureCurrentOrganisation()
    localStorage.removeItem('current-organisation-id')
    OrganisationDB.prototype.getOrganisationByName = () => Promise.resolve(undefined)
    let error: Error | null = null
    try {
      await ensureCurrentOrganisation()
    } catch (caught) {
      error = caught as Error
    }
    expect(error?.name).to.equal('ConstraintError')
  })

  it('passes on any other failure', async () => {
    localStorage.removeItem('current-organisation-id')
    const realCreate = OrganisationDB.prototype.createOrganisation
    OrganisationDB.prototype.getOrganisationByName = () => Promise.resolve(undefined)
    OrganisationDB.prototype.createOrganisation = () => Promise.reject(new Error('disk full'))
    try {
      let message = ''
      try {
        await ensureCurrentOrganisation()
      } catch (caught) {
        message = (caught as Error).message
      }
      expect(message).to.equal('disk full')
    } finally {
      OrganisationDB.prototype.createOrganisation = realCreate
    }
  })
})

describe('keeping the current organisation when it cannot be read', () => {
  const realGet = OrganisationDB.prototype.getOrganisation
  afterEach(() => {
    OrganisationDB.prototype.getOrganisation = realGet
  })

  it('still remembers it', async () => {
    OrganisationDB.prototype.getOrganisation = () => Promise.reject(new Error('unreadable'))
    await setCurrentOrganisation('some-id', 'Some name')
    expect(getCurrentOrganisation()).to.deep.equal({ id: 'some-id', name: 'Some name' })
  })
})

describe('switching organisation', () => {
  const unique = name => `${name} ${crypto.randomUUID().slice(0, 8)}`

  it('makes it the current one, with its name, and starts the app afresh', async () => {
    const org = await createOrganisation(unique('Switch'))
    let reloads = 0
    await switchOrganisation(org.id, () => reloads++)
    expect(getCurrentOrganisation()).to.deep.equal({ id: org.id, name: org.name })
    expect(reloads).to.equal(1)
  })

  it('switches to one it has no record of, too', async () => {
    let reloads = 0
    await switchOrganisation('unknown-id', () => reloads++)
    expect(getCurrentOrganisation().id).to.equal('unknown-id')
    expect(reloads).to.equal(1)
  })

  it('still switches when the organisation cannot be read', async () => {
    const realGet = OrganisationDB.prototype.getOrganisation
    let calls = 0
    OrganisationDB.prototype.getOrganisation = function (id) {
      return calls++ === 0 ? Promise.reject(new Error('unreadable')) : realGet.call(this, id)
    }
    try {
      let reloads = 0
      await switchOrganisation('another-id', () => reloads++)
      expect(getCurrentOrganisation().id).to.equal('another-id')
      expect(reloads).to.equal(1)
    } finally {
      OrganisationDB.prototype.getOrganisation = realGet
    }
  })
})

describe('renaming an organisation', () => {
  const unique = name => `${name} ${crypto.randomUUID().slice(0, 8)}`

  it('keeps its id, and the remembered name if it is the current one', async () => {
    const org = await createOrganisation(unique('Before'))
    await setCurrentOrganisation(org.id, org.name)
    const after = unique('After')
    const renamed = await renameOrganisation(org.id, after)
    expect(renamed.id).to.equal(org.id)
    expect(renamed.name).to.equal(after)
    expect(getCurrentOrganisation().name).to.equal(after)
  })

  it('leaves the remembered name when it is not the current one', async () => {
    const current = await createOrganisation(unique('Current'))
    await setCurrentOrganisation(current.id, current.name)
    const other = await createOrganisation(unique('Other'))
    await renameOrganisation(other.id, unique('Renamed'))
    expect(getCurrentOrganisation().name).to.equal(current.name)
  })

  it('may be given its own name again', async () => {
    const org = await createOrganisation(unique('Same'))
    expect((await renameOrganisation(org.id, org.name)).name).to.equal(org.name)
  })

  it('refuses one that is not there, or a name already in use', async () => {
    const first = await createOrganisation(unique('First'))
    const second = await createOrganisation(unique('Second'))
    let message = ''
    try {
      await renameOrganisation('nobody', 'x')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.equal('Organisation nobody not found')
    try {
      await renameOrganisation(second.id, first.name)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.equal(`Organisation "${first.name}" already exists`)
  })
})

describe('deleting an organisation and its data', () => {
  it('refuses one that is not there', async () => {
    let message = ''
    try {
      await deleteOrganisationAndData('nobody')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.equal('Organisation nobody not found')
  })
})

/** Delete an organisation record directly, to reset to a first visit */
function deleteOrganisation(id) {
  return new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('organisations')
    open.onsuccess = () => {
      const tx = open.result.transaction(['organisations'], 'readwrite')
      tx.objectStore('organisations').delete(id)
      tx.oncomplete = () => {
        open.result.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
}
