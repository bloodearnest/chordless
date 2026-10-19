import { expect } from '@open-wc/testing'
import { DriveSyncManager } from '../src/js/drive-sync.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
  setOrganisationReadOnly,
  syncsBack,
} from '../src/js/organisation.ts'
import { refreshOrganisationAccess } from '../src/js/organisation-access.ts'
import { installFakeDrive } from './fake-drive.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('Knowing whether the user can write to the organisation folder', () => {
  let drive
  let before: { id: string | null; name: string }
  let organisationId: string

  beforeEach(async () => {
    drive = installFakeDrive()
    before = getCurrentOrganisation()
    const organisation = await createOrganisation(`Access ${crypto.randomUUID().slice(0, 8)}`)
    organisationId = organisation.id
    await setCurrentOrganisation(organisation.id, organisation.name)
    // The first sync finds or makes the Drive folder and links it
    const sync = new DriveSyncManager(organisation.name, organisation.id)
    await sync.init()
    sync.organisationDb?.db?.close()
  })

  afterEach(async () => {
    drive.uninstall()
    await deleteOrganisation(organisationId)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  it('asks Drive and keeps the answer', async () => {
    expect(syncsBack()).to.equal(true)

    drive.readOnly = true
    await refreshOrganisationAccess()
    expect(syncsBack()).to.equal(false)

    drive.readOnly = false
    await refreshOrganisationAccess()
    expect(syncsBack()).to.equal(true)
  })

  it('is known again when the organisation is switched to', async () => {
    await setOrganisationReadOnly(organisationId, true)
    expect(syncsBack()).to.equal(false)
    await setCurrentOrganisation(before.id ?? organisationId, before.name)
    if (before.id) expect(syncsBack()).to.equal(true)
    await setCurrentOrganisation(organisationId)
    expect(syncsBack()).to.equal(false)
  })

  it('leaves what is known alone when Drive cannot be asked', async () => {
    await setOrganisationReadOnly(organisationId, true)
    drive.failRequests({ method: 'GET', status: 500, times: 5 })
    await refreshOrganisationAccess()
    expect(syncsBack()).to.equal(false)
  })

  it('leaves what is known alone when Drive does not say what the user can do', async () => {
    await setOrganisationReadOnly(organisationId, true)
    drive.omitCapabilities = true
    await refreshOrganisationAccess()
    expect(syncsBack()).to.equal(false)
  })

  it('does not ask Drive about an organisation that has no folder yet', async () => {
    const fresh = await createOrganisation(`Fresh ${crypto.randomUUID().slice(0, 8)}`)
    try {
      await setCurrentOrganisation(fresh.id, fresh.name)
      const asked = drive.requests.length
      await refreshOrganisationAccess()
      expect(drive.requests.length).to.equal(asked)
    } finally {
      await setCurrentOrganisation(organisationId)
      await deleteOrganisation(fresh.id)
    }
  })
})
