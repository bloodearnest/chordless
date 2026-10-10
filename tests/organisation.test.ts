import { expect } from '@esm-bundle/chai'
import {
  createOrganisation,
  ensureCurrentOrganisation,
  getCurrentOrganisation,
  getCurrentOrganisationFull,
  getOrganisationByName,
  listOrganisations,
  setCurrentOrganisation,
} from '../src/js/organisation.ts'

const { describe, it, beforeEach, afterEach } = window

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
    let error = null
    try {
      await createOrganisation(name)
    } catch (caught) {
      error = caught
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
    expect((await getOrganisationByName(org.name)).id).to.equal(org.id)
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
