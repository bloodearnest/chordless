import { expect } from '@open-wc/testing'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
  setOrganisationReadOnly,
} from '../src/js/organisation.ts'
import '../src/js/views/import-song-view.ts'
import type { ImportSongView } from '../src/js/views/import-song-view.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('the import song view', () => {
  let before: { id: string | null; name: string }
  let organisationId: string
  let view: ImportSongView

  beforeEach(async () => {
    before = getCurrentOrganisation()
    const organisation = await createOrganisation(`Import ${crypto.randomUUID().slice(0, 8)}`)
    organisationId = organisation.id
    await setCurrentOrganisation(organisation.id, organisation.name)
  })

  afterEach(async () => {
    view?.remove()
    await deleteOrganisation(organisationId)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  async function show() {
    view = document.createElement('import-song-view')
    document.body.append(view)
    await view.updateComplete
  }

  it('offers the import form', async () => {
    await show()
    expect(view.querySelector('song-import')).to.not.equal(null)
  })

  it('says so, and offers no form, when the organisation is view-only', async () => {
    await setOrganisationReadOnly(organisationId, true)
    await show()
    expect(view.querySelector('song-import')).to.equal(null)
    expect(view.textContent).to.contain('view-only access')
  })
})
