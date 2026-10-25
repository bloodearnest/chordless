import { expect } from '@open-wc/testing'
import { DriveFolderGoneError } from '../src/js/sync-manager.ts'
import { addSong, useSyncRig } from './drive-harness.ts'
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
  const rig = useSyncRig()
  const { makeDevice, addSetlist, syncDevice } = rig
  const spaceFolder = () => must(rig.storage.rootNamed(TEST_SPACE.name))

  /** What another Google app sees of the first one's folder: nothing at all */
  const folderGoneFromDrive = () => rig.storage.removeRoot(spaceFolder().ref)

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
    rig.storage.trash(spaceFolder().ref)

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
    const oldFolderId = spaceFolder().ref
    const oldFileId = must(await phone.db.getSetlist(setlist.id)).fileRef
    folderGoneFromDrive()

    await phone.sync.startOver()
    await phone.sync.init()
    await syncDevice(phone)

    // Nothing was lost on the device: not the setlist (it is not "deleted in Drive")...
    const kept = must(await phone.db.getSetlist(setlist.id))
    expect(kept.name).to.equal('Sunday')
    expect(must(await phone.db.getSong('song-1')).title).to.equal('Amazing')
    // ...and all of it is in a new folder, under new files
    expect(spaceFolder().ref).to.not.equal(oldFolderId)
    expect(kept.fileRef).to.be.a('string').and.not.equal(oldFileId)
    const live = rig.storage.list(file => file.props.setlistId === setlist.id)
    expect(live.filter(file => file.ref === kept.fileRef)).to.have.length(1)
  })

  it('asks nothing of Drive and changes nothing in it', async () => {
    const phone = await makeDevice('phone')
    await addSetlist(phone)
    await syncDevice(phone)
    folderGoneFromDrive()
    rig.storage.clearCalls()

    await phone.sync.startOver()

    expect(rig.storage.calls).to.deep.equal([])
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

    const live = rig.storage.list(file => file.props.setlistId === setlist.id)
    expect(live).to.have.length(1)
    expect(must(await phone.db.getSetlist(setlist.id)).fileRef).to.equal(live[0].ref)
  })

  describe('replacing this device’s data with the copy in a folder it finds by name', () => {
    /** A phone whose link went stale (the old app's folder), and a tablet that has synced to the folder of this name */
    async function staleLinkedPhone() {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const shared = await addSetlist(tablet, { name: 'Shared' })
      await addSong(tablet, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Amazing',
      })
      await syncDevice(tablet)
      const own = await addSetlist(phone, { name: 'Only on the phone' })
      await addSong(phone, { uuid: 'old-song', title: 'Old', content: '{title: Old}\n[C]Old' })
      phone.folderLink.value = 'a-folder-this-account-cannot-see'
      return { phone, shared, own }
    }

    it('replaces what is on the device, though it has changes that are not in Drive', async () => {
      const { phone, shared, own } = await staleLinkedPhone()
      expect(await failure(phone.sync)).to.be.instanceOf(DriveFolderGoneError)

      await phone.sync.resetFromFolderByName()

      expect(must(await phone.db.getSetlist(shared.id)).name).to.equal('Shared')
      expect(must(await phone.db.getSong('song-1')).title).to.equal('Amazing')
      expect(await phone.db.getSetlist(own.id)).to.equal(undefined)
      expect(await phone.db.getSong('old-song')).to.equal(undefined)
    })

    it('links the folder it found, so the next sync is an ordinary one, with no duplicates', async () => {
      const { phone, shared } = await staleLinkedPhone()

      await phone.sync.resetFromFolderByName()
      await phone.sync.init()
      await syncDevice(phone)

      expect(phone.folderLink.value).to.equal(spaceFolder().ref)
      const live = rig.storage.list(file => file.props.setlistId === shared.id)
      expect(live).to.have.length(1)
      expect(must(await phone.db.getSetlist(shared.id)).fileRef).to.equal(live[0].ref)
    })

    it('changes nothing, and makes no folder, when no folder of that name can be seen', async () => {
      const { phone, own } = await staleLinkedPhone()
      folderGoneFromDrive()
      rig.storage.clearCalls()

      let error: Error | null = null
      try {
        await phone.sync.resetFromFolderByName()
      } catch (thrown) {
        error = thrown as Error
      }

      expect(error?.message).to.contain('nothing was changed')
      expect(must(await phone.db.getSetlist(own.id)).name).to.equal('Only on the phone')
      expect(phone.folderLink.value).to.equal('a-folder-this-account-cannot-see')
      expect(rig.storage.writes()).to.deep.equal([])
    })

    it('leaves the device with no link, as it was, when Drive cannot be read', async () => {
      const { phone } = await staleLinkedPhone()
      phone.folderLink.value = null
      rig.storage.fail('inventory', { times: 10 })

      let error: Error | null = null
      try {
        await phone.sync.resetFromFolderByName()
      } catch (thrown) {
        error = thrown as Error
      }
      rig.storage.clearFailures()

      expect(error).to.not.equal(null)
      expect(phone.folderLink.value).to.equal(null)
    })

    it('changes nothing, and puts the old link back, when Drive cannot be read', async () => {
      const { phone, own } = await staleLinkedPhone()
      rig.storage.fail('inventory', { times: 10 })

      let error: Error | null = null
      try {
        await phone.sync.resetFromFolderByName()
      } catch (thrown) {
        error = thrown as Error
      }
      rig.storage.clearFailures()

      expect(error).to.not.equal(null)
      expect(must(await phone.db.getSetlist(own.id)).name).to.equal('Only on the phone')
      expect(phone.folderLink.value).to.equal('a-folder-this-account-cannot-see')
    })
  })
})
