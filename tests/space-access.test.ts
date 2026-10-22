import { expect } from '@open-wc/testing'
import { DriveSyncManager } from '../src/js/drive-sync.ts'
import { setRouter } from '../src/js/navigation.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  setCurrentSpace,
  setSpaceReadOnly,
  syncsBack,
} from '../src/js/space.ts'
import {
  driveFolderProblem,
  driveSpaceStorage,
  refreshSpaceAccess,
} from '../src/js/space-access.ts'
import { SpaceDB } from '../src/js/space-db.ts'
import { installFakeDrive } from './fake-drive.ts'
import { clearToasts, shownToast, suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('Knowing whether the user can write to the space folder', () => {
  let drive
  let before: { id: string | null; name: string }
  let spaceId: string

  beforeEach(async () => {
    drive = installFakeDrive()
    before = getCurrentSpace()
    const space = await createSpace(`Access ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
    // The first sync finds or makes the Drive folder and links it
    const sync = new DriveSyncManager(space.name, space.id)
    await sync.init()
    sync.spaceDb?.db?.close()
  })

  afterEach(async () => {
    clearToasts()
    drive.uninstall()
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  it('gives the files of the space in the folder it is linked to', async () => {
    const storage = await driveSpaceStorage(spaceId)
    const { file } = await storage.create(
      'setlists',
      { name: 'a.json', props: {}, type: 'application/json' },
      '{}'
    )
    expect((await storage.list('setlists')).map(f => f.ref)).to.deep.equal([file.ref])
  })

  it('has no files to give for a space that is not linked to a folder', async () => {
    const unlinked = await createSpace(`Unlinked ${crypto.randomUUID().slice(0, 8)}`)
    let message = ''
    await driveSpaceStorage(unlinked.id).catch(error => {
      message = error.message
    })
    await deleteSpace(unlinked.id)
    expect(message).to.contain('not in Google Drive')
  })

  it('asks Drive and keeps the answer', async () => {
    expect(syncsBack()).to.equal(true)

    drive.readOnly = true
    await refreshSpaceAccess()
    expect(syncsBack()).to.equal(false)

    drive.readOnly = false
    await refreshSpaceAccess()
    expect(syncsBack()).to.equal(true)
  })

  it('is known again when the space is switched to', async () => {
    await setSpaceReadOnly(spaceId, true)
    expect(syncsBack()).to.equal(false)
    await setCurrentSpace(before.id ?? spaceId, before.name)
    if (before.id) expect(syncsBack()).to.equal(true)
    await setCurrentSpace(spaceId)
    expect(syncsBack()).to.equal(false)
  })

  it('leaves what is known alone when Drive cannot be asked', async () => {
    await setSpaceReadOnly(spaceId, true)
    drive.failRequests({ method: 'GET', status: 500, times: 5 })
    await refreshSpaceAccess()
    expect(syncsBack()).to.equal(false)
  })

  it('leaves what is known alone when Drive does not say what the user can do', async () => {
    await setSpaceReadOnly(spaceId, true)
    drive.omitCapabilities = true
    await refreshSpaceAccess()
    expect(syncsBack()).to.equal(false)
  })

  it('does not ask Drive about a space that has no folder yet', async () => {
    const fresh = await createSpace(`Fresh ${crypto.randomUUID().slice(0, 8)}`)
    try {
      await setCurrentSpace(fresh.id, fresh.name)
      const asked = drive.requests.length
      await refreshSpaceAccess()
      expect(drive.requests.length).to.equal(asked)
    } finally {
      await setCurrentSpace(spaceId)
      await deleteSpace(fresh.id)
    }
  })

  describe('the folder being gone', () => {
    const folderOf = () => drive.findByPath(['Chordless', getCurrentSpace().name])

    it('is not a problem while the folder is there', async () => {
      expect(await driveFolderProblem()).to.equal(null)
      await refreshSpaceAccess()
      expect(shownToast()).to.equal(null)
    })

    it('is told at once, with a way on, when the folder is deleted or cannot be seen', async () => {
      drive.files.delete(folderOf().id)

      const problem = await driveFolderProblem()
      await refreshSpaceAccess()

      expect(problem?.reason).to.equal('missing')
      expect(problem?.message).to.contain('safe on this device')
      const toast = shownToast()
      expect(toast?.kind).to.equal('error')
      expect(toast?.message).to.equal(problem?.message)
      expect(toast?.action?.label).to.equal('Open Account and Teams')
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
      expect(went).to.deep.equal(['/account'])
    })

    it('says so when the Google app that linked the folder is not this one', async () => {
      const db = new SpaceDB()
      await db.init()
      await db.updateSpace(spaceId, { driveClientId: 'an-earlier-app' })
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
      await refreshSpaceAccess()
      clearToasts()

      await refreshSpaceAccess()

      expect(shownToast()).to.equal(null)
      expect(syncsBack()).to.equal(true)
    })

    it('is not guessed at when Drive cannot be asked', async () => {
      drive.failRequests({ method: 'GET', status: 500, times: 5 })
      expect(await driveFolderProblem()).to.equal(null)
    })
  })
})
