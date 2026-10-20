import { expect } from '@open-wc/testing'
import { DriveSyncManager } from '../src/js/drive-sync.ts'
import { setRouter } from '../src/js/navigation.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
  setOrganisationReadOnly,
  syncsBack,
} from '../src/js/organisation.ts'
import { driveFolderProblem, refreshOrganisationAccess } from '../src/js/organisation-access.ts'
import { OrganisationDB } from '../src/js/organisation-db.ts'
import { installFakeDrive } from './fake-drive.ts'
import { clearToasts, shownToast, suppressConsoleLogs, wait } from './test-helpers.ts'

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
    clearToasts()
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

  describe('the folder being gone', () => {
    const folderOf = () => drive.findByPath(['Chordless', getCurrentOrganisation().name])

    it('is not a problem while the folder is there', async () => {
      expect(await driveFolderProblem()).to.equal(null)
      await refreshOrganisationAccess()
      expect(shownToast()).to.equal(null)
    })

    it('is told at once, with a way on, when the folder is deleted or cannot be seen', async () => {
      drive.files.delete(folderOf().id)

      const problem = await driveFolderProblem()
      await refreshOrganisationAccess()

      expect(problem?.reason).to.equal('missing')
      expect(problem?.message).to.contain('safe on this device')
      const toast = shownToast()
      expect(toast?.kind).to.equal('error')
      expect(toast?.message).to.equal(problem?.message)
      expect(toast?.action?.label).to.equal('Open Drive sync')
      const went: string[] = []
      setRouter({
        navigate: async url => {
          went.push(url)
          return true
        },
      })
      try {
        toast?.action?.run()
        await wait(0)
      } finally {
        setRouter(null)
      }
      expect(went).to.deep.equal(['/storage'])
    })

    it('says so when the Google app that linked the folder is not this one', async () => {
      const db = new OrganisationDB()
      await db.init()
      await db.updateOrganisation(organisationId, { driveClientId: 'an-earlier-app' })
      drive.files.delete(folderOf().id)

      expect((await driveFolderProblem())?.message).to.contain(
        "earlier version of Chordless's Google app"
      )
    })

    it('says the folder is in the trash when it is', async () => {
      drive.files.get(folderOf().id).trashed = true

      const problem = await driveFolderProblem()

      expect(problem?.reason).to.equal('trashed')
      expect(problem?.message).to.contain('Restore it from the trash')
    })

    it('is told once, not at every check, and does not turn the user read-only', async () => {
      drive.files.delete(folderOf().id)
      await refreshOrganisationAccess()
      clearToasts()

      await refreshOrganisationAccess()

      expect(shownToast()).to.equal(null)
      expect(syncsBack()).to.equal(true)
    })

    it('is not guessed at when Drive cannot be asked', async () => {
      drive.failRequests({ method: 'GET', status: 500, times: 5 })
      expect(await driveFolderProblem()).to.equal(null)
    })
  })
})
