import { expect } from '@esm-bundle/chai'
import {
  createOrganisation,
  ensureCurrentOrganisation,
  listOrganisations,
} from '../public/js/organisation.js'

const { describe, it, beforeEach } = window

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

/** Delete an organisation record directly, to reset to a first visit */
function deleteOrganisation(id) {
  return new Promise((resolve, reject) => {
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
