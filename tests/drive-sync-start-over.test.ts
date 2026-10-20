import { expect } from '@open-wc/testing'
import { DriveFolderGoneError } from '../src/js/drive-sync.ts'
import { addSong, useFakeDriveRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, TEST_SPACE } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

/** What starting a sync says when it fails (the app makes a new manager, and so asks Drive, each time) */
async function failure(sync: { init(): Promise<unknown> }) {
  try {
    await sync.init()
  } catch (error) {
    return error as Error & { reason?: string }
  }
  return null
}

describe('Drive sync: when the space’s folder is gone, and starting over', () => {
  const rig = useFakeDriveRig()
  const { makeDevice, addSetlist, syncDevice } = rig
  const spaceFolder = () => rig.drive.findByPath(['Chordless', TEST_SPACE.name])

  /** What another Google app sees of the first one's folder: nothing at all */
  const folderGoneFromDrive = () => rig.drive.files.delete(spaceFolder().id)

  it('stops with an error that says what to do, when the folder was deleted or is not visible', async () => {
    const phone = await makeDevice('phone')
    await addSetlist(phone, { name: 'Sunday' })
    await syncDevice(phone)
    folderGoneFromDrive()

    const error = await failure(phone.sync)

    expect(error).to.be.instanceOf(DriveFolderGoneError)
    expect(error?.reason).to.equal('missing')
    expect(error?.message).to.contain('safe on this device')
    expect(error?.message).to.contain('start over in Drive')
  })

  it('says the folder is in the trash when it is, and offers to restore it', async () => {
    const phone = await makeDevice('phone')
    await syncDevice(phone)
    rig.drive.files.get(spaceFolder().id).trashed = true

    const error = await failure(phone.sync)

    expect(error).to.be.instanceOf(DriveFolderGoneError)
    expect(error?.reason).to.equal('trashed')
    expect(error?.message).to.contain('Restore it from the trash')
  })

  it('uploads everything again to a new folder, keeping all the content', async () => {
    const phone = await makeDevice('phone')
    const setlist = await addSetlist(phone, { name: 'Sunday' })
    await addSong(phone, {
      uuid: 'song-1',
      title: 'Amazing',
      content: '{title: Amazing}\n[G]Amazing',
    })
    await syncDevice(phone)
    const oldFolderId = spaceFolder().id
    const oldFileId = must(await phone.db.getSetlist(setlist.id)).driveFileId
    folderGoneFromDrive()

    await phone.sync.startOver()
    await phone.sync.init()
    await syncDevice(phone)

    // Nothing was lost on the device: not the setlist (it is not "deleted in Drive")...
    const kept = must(await phone.db.getSetlist(setlist.id))
    expect(kept.name).to.equal('Sunday')
    expect(must(await phone.db.getSong('song-1')).title).to.equal('Amazing')
    // ...and all of it is in a new folder, under new files
    expect(spaceFolder().id).to.not.equal(oldFolderId)
    expect(kept.driveFileId).to.be.a('string').and.not.equal(oldFileId)
    const live = rig.drive.listFiles(
      file => !file.trashed && file.appProperties.setlistId === setlist.id
    )
    expect(live.filter(file => file.id === kept.driveFileId)).to.have.length(1)
  })

  it('asks nothing of Drive and changes nothing in it', async () => {
    const phone = await makeDevice('phone')
    await addSetlist(phone)
    await syncDevice(phone)
    folderGoneFromDrive()
    rig.drive.requests = []

    await phone.sync.startOver()

    expect(rig.drive.requests).to.deep.equal([])
  })

  it('joins a folder of the right name that can be seen, without making duplicates', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    const setlist = await addSetlist(tablet, { name: 'Shared' })
    await syncDevice(tablet)
    await syncDevice(phone)
    // The phone's link went stale (another folder id), while the folder by name is there
    phone.folderLink.value = 'a-folder-this-account-cannot-see'
    expect(await failure(phone.sync)).to.be.instanceOf(DriveFolderGoneError)

    await phone.sync.startOver()
    await phone.sync.init()
    await syncDevice(phone)

    const live = rig.drive.listFiles(
      file => !file.trashed && file.appProperties.setlistId === setlist.id
    )
    expect(live).to.have.length(1)
    expect(must(await phone.db.getSetlist(setlist.id)).driveFileId).to.equal(live[0].id)
  })
})
