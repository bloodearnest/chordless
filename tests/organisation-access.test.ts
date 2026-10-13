import { expect } from '@esm-bundle/chai'
import { DriveSyncManager } from '../src/js/drive-sync.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  isReadOnlyOrganisation,
  setCurrentOrganisation,
  setOrganisationReadOnly,
} from '../src/js/organisation.ts'
import { refreshOrganisationAccess } from '../src/js/organisation-access.ts'
import { READ_ONLY_CHANGE } from '../src/js/read-only-controller.ts'
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

  it('asks Drive, keeps the answer, and says when it changes', async () => {
    expect(isReadOnlyOrganisation()).to.equal(false)
    const changes: number[] = []
    const listener = () => changes.push(1)
    window.addEventListener(READ_ONLY_CHANGE, listener)

    drive.readOnly = true
    await refreshOrganisationAccess()
    expect(isReadOnlyOrganisation()).to.equal(true)
    expect(changes).to.have.length(1)

    await refreshOrganisationAccess()
    expect(changes, 'no change, no event').to.have.length(1)

    drive.readOnly = false
    await refreshOrganisationAccess()
    expect(isReadOnlyOrganisation()).to.equal(false)
    expect(changes).to.have.length(2)
    window.removeEventListener(READ_ONLY_CHANGE, listener)
  })

  it('is known again when the organisation is switched to', async () => {
    await setOrganisationReadOnly(organisationId, true)
    expect(isReadOnlyOrganisation()).to.equal(true)
    await setCurrentOrganisation(before.id ?? organisationId, before.name)
    if (before.id) expect(isReadOnlyOrganisation()).to.equal(false)
    await setCurrentOrganisation(organisationId)
    expect(isReadOnlyOrganisation()).to.equal(true)
  })

  it('leaves what is known alone when Drive cannot be asked', async () => {
    await setOrganisationReadOnly(organisationId, true)
    drive.failRequests({ method: 'GET', status: 500, times: 5 })
    await refreshOrganisationAccess()
    expect(isReadOnlyOrganisation()).to.equal(true)
  })
})
