import { expect, fixture, html } from '@open-wc/testing'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
  setOrganisationReadOnly,
} from '../src/js/organisation.ts'
import type { ImportSetlistView } from '../src/js/views/import-setlist-view.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/js/views/import-setlist-view.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('import-setlist-view', () => {
  let before: { id: string | null; name: string }
  let organisationId: string

  beforeEach(async () => {
    before = getCurrentOrganisation()
    const organisation = await createOrganisation(`Import ${crypto.randomUUID().slice(0, 8)}`)
    organisationId = organisation.id
    await setCurrentOrganisation(organisation.id, organisation.name)
  })

  afterEach(async () => {
    await setOrganisationReadOnly(organisationId, false)
    await deleteOrganisation(organisationId)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  it('offers the email import', async () => {
    const view = await fixture<ImportSetlistView>(html`<import-setlist-view></import-setlist-view>`)
    expect(view.querySelector('setlist-email-import')).to.not.equal(null)
  })

  it('says why it cannot import into a view-only organisation', async () => {
    await setOrganisationReadOnly(organisationId, true)
    const view = await fixture<ImportSetlistView>(html`<import-setlist-view></import-setlist-view>`)
    expect(view.querySelector('setlist-email-import')).to.equal(null)
    expect(view.textContent).to.contain('view-only access')
  })
})
