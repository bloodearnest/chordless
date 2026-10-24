import { expect } from '@open-wc/testing'
import { DriveSyncManager, MEMBERS_REFRESH_MS } from '../src/js/drive-sync.ts'
import { createSpace, deleteSpace } from '../src/js/space.ts'
import { SpaceDB } from '../src/js/space-db.ts'
import {
  addSong,
  editSong,
  memoryChangeToken,
  memoryFolderLink,
  useSyncRig,
} from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, TEST_SPACE } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('Drive sync: from the feed of changes', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, editSetlist, syncDevice } = rig

  /** The calls that list or read the whole space (an incremental sync makes none) */
  const listings = () =>
    rig.storage.calls.filter(call => ['list', 'inventory', 'members'].includes(call.op))

  /** Two devices that have synced the same space, and a place in the feed on each */
  async function twoDevices() {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await syncDevice(phone)
    await syncDevice(tablet)
    return { phone, tablet }
  }

  it('does a full sync when no place is kept, and keeps one for next time', async () => {
    const phone = await makeDevice('phone')
    await addSetlist(phone, { name: 'Sunday' })
    expect(phone.changeToken.value).to.equal(null)

    const first = await phone.sync.incrementalSync()
    expect(first.full).to.equal(true)
    expect(phone.changeToken.value).to.be.a('string')
    expect(rig.driveSetlistFiles()).to.have.length(1)

    rig.storage.clearCalls()
    const second = await phone.sync.incrementalSync()
    expect(second.full).to.equal(false)
    expect(listings()).to.deep.equal([])
  })

  it('asks nothing but the feed when nothing changed and nothing is to be pushed', async () => {
    const { phone } = await twoDevices()
    rig.storage.clearCalls()
    const reads = rig.storage.feedReads

    const result = await phone.sync.incrementalSync(null, { push: false })

    expect(result).to.deep.equal({ success: true, full: false })
    expect(rig.storage.calls).to.deep.equal([])
    expect(rig.storage.feedReads).to.equal(reads + 1)
  })

  it('brings down a setlist and a song made elsewhere, without listing anything', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'New one' })
    await addSong(tablet, {
      uuid: 'song-1',
      title: 'Amazing',
      content: '{title: Amazing}\n[G]Amazing',
    })
    await syncDevice(tablet)
    rig.storage.clearCalls()

    await phone.sync.incrementalSync()

    expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('New one')
    expect(must(await phone.db.getSong('song-1')).title).to.equal('Amazing')
    expect(listings()).to.deep.equal([])
  })

  it('brings down an edit made elsewhere, to a setlist and to a song', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'Before' })
    await addSong(tablet, {
      uuid: 'song-1',
      title: 'Amazing',
      content: '{title: Amazing}\n[G]Before',
    })
    await syncDevice(tablet)
    await phone.sync.incrementalSync()

    await editSetlist(tablet, setlist.id, { name: 'After' })
    await editSong(tablet, 'song-1', '{title: Amazing}\n[G]After')
    await syncDevice(tablet)
    await phone.sync.incrementalSync()

    expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('After')
    const song = must(await phone.db.getSong('song-1'))
    expect(must(await phone.db.getChordPro(song.chordproFileId)).content).to.contain('After')
  })

  it('downloads nothing for what this device itself sent', async () => {
    const { phone } = await twoDevices()
    await addSetlist(phone, { name: 'Mine' })
    await phone.sync.incrementalSync()
    rig.storage.clearCalls()

    await phone.sync.incrementalSync()

    expect(rig.storage.calls.filter(call => call.op === 'readMany')).to.deep.equal([])
    expect(rig.storage.writes()).to.deep.equal([])
  })

  it('removes a setlist and a song that were deleted elsewhere, when they were not edited here', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'Gone soon' })
    await addSong(tablet, { uuid: 'song-1', title: 'Amazing', content: '{title: Amazing}\n[G]x' })
    await syncDevice(tablet)
    await phone.sync.incrementalSync()
    expect(await phone.db.getSetlist(setlist.id)).to.not.equal(undefined)

    for (const file of rig.storage.list(f => f.collection !== 'shares')) rig.storage.trash(file.ref)
    await phone.sync.incrementalSync()

    expect(await phone.db.getSetlist(setlist.id)).to.equal(undefined)
    expect(await phone.db.getSong('song-1')).to.equal(undefined)
  })

  it('keeps a setlist edited here whose file was deleted elsewhere, and sends it again', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'Edited here' })
    await syncDevice(tablet)
    await phone.sync.incrementalSync()
    await editSetlist(phone, setlist.id, { name: 'Edited here, again' })
    for (const file of rig.driveSetlistFiles()) rig.storage.trash(file.ref)

    await phone.sync.incrementalSync()

    expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Edited here, again')
    expect(rig.driveSetlist(setlist.id).name).to.equal('Edited here, again')
  })

  it('lets go of the file of a setlist kept because it was edited here, so a later push makes a new one', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'Edited here' })
    await syncDevice(tablet)
    await phone.sync.incrementalSync()
    await editSetlist(phone, setlist.id, { name: 'Edited here, again' })
    const gone = must(await phone.db.getSetlist(setlist.id)).fileRef
    for (const file of rig.driveSetlistFiles()) rig.storage.trash(file.ref)

    // (the feed tells of the missing file once: this sync only pulls)
    await phone.sync.incrementalSync(null, { push: false })
    expect(must(await phone.db.getSetlist(setlist.id)).fileRef).to.equal(null)

    rig.storage.clearCalls()
    await phone.sync.incrementalSync()
    expect(rig.storage.writes().map(call => call.op)).to.not.include('update')
    expect(rig.driveSetlist(setlist.id).name).to.equal('Edited here, again')
    expect(must(await phone.db.getSetlist(setlist.id)).fileRef).to.not.equal(gone)
  })

  it('sends local changes, unless told only to pull', async () => {
    const { phone } = await twoDevices()
    const setlist = await addSetlist(phone, { name: 'Local' })

    await phone.sync.incrementalSync(null, { push: false })
    expect(rig.driveSetlistFiles()).to.have.length(0)

    await phone.sync.incrementalSync()
    expect(rig.driveSetlist(setlist.id).name).to.equal('Local')
  })

  it('leaves a user who can only read to find that out, and sends nothing', async () => {
    const { phone, tablet } = await twoDevices()
    await addSetlist(phone, { name: 'Local' })
    const fromTablet = await addSetlist(tablet, { name: 'Leader’s' })
    await syncDevice(tablet)
    rig.storage.readOnly = true

    rig.storage.clearCalls()
    await phone.sync.incrementalSync()

    expect(rig.storage.writes()).to.deep.equal([])
    expect(must(await phone.db.getSetlist(fromTablet.id)).name).to.equal('Leader’s')
  })

  it('does a full sync, and a new place, when the feed has forgotten the old one', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'While away' })
    await syncDevice(tablet)
    rig.storage.forgetFeedPositions()

    const result = await phone.sync.incrementalSync()

    expect(result.full).to.equal(true)
    expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('While away')
    rig.storage.clearCalls()
    expect((await phone.sync.incrementalSync()).full).to.equal(false)
  })

  it('does a full sync when the storage has no feed', async () => {
    const { phone } = await twoDevices()
    Object.defineProperty(phone.sync.space, 'changes', { value: null })

    expect((await phone.sync.incrementalSync()).full).to.equal(true)
  })

  it('does not go on when the feed fails for another reason, and keeps its place', async () => {
    const { phone } = await twoDevices()
    const place = phone.changeToken.value
    rig.storage.feedError = new Error('offline')

    let thrown: Error | null = null
    try {
      await phone.sync.incrementalSync()
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).to.equal('offline')
    expect(phone.changeToken.value).to.equal(place)
  })

  it('keeps its place when a file could not be downloaded, and tries that file again', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'Late' })
    await addSong(tablet, { uuid: 'song-1', title: 'Amazing', content: '{title: Amazing}\n[G]x' })
    await syncDevice(tablet)
    const place = phone.changeToken.value
    rig.storage.fail('readMany', { times: 2 })

    await phone.sync.incrementalSync()
    expect(phone.changeToken.value).to.equal(place)
    expect(await phone.db.getSetlist(setlist.id)).to.equal(undefined)
    expect(await phone.db.getSong('song-1')).to.equal(undefined)

    await phone.sync.incrementalSync()
    expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Late')
    expect(must(await phone.db.getSong('song-1')).title).to.equal('Amazing')
    expect(phone.changeToken.value).to.not.equal(place)
  })

  it('says how it failed, and keeps its place, when it cannot save what it pulled', async () => {
    const { phone, tablet } = await twoDevices()
    await addSetlist(tablet, { name: 'Late' })
    await syncDevice(tablet)
    const place = phone.changeToken.value
    phone.db.saveSetlistsBatch = async () => {
      throw new Error('disk full')
    }
    const stages: string[] = []

    let thrown: Error | null = null
    try {
      await phone.sync.incrementalSync(progress => stages.push(progress.stage))
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).to.equal('disk full')
    expect(stages.at(-1)).to.equal('error')
    expect(phone.changeToken.value).to.equal(place)
  })

  it('keeps the old place after a full sync that could not download a file, so the file is named again', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'Late' })
    await syncDevice(tablet)
    const place = phone.changeToken.value
    rig.storage.fail('readMany', { times: 1 })

    await phone.sync.sync()
    expect(await phone.db.getSetlist(setlist.id)).to.equal(undefined)
    expect(phone.changeToken.value).to.equal(place)

    await phone.sync.incrementalSync()
    expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Late')
  })

  it('keeps no place after a reset that could not download a file', async () => {
    const { phone, tablet } = await twoDevices()
    await addSetlist(tablet, { name: 'Late' })
    await syncDevice(tablet)
    await phone.sync.sync()
    rig.storage.fail('readMany', { times: 1 })

    await phone.sync.resetLocalFromDrive()

    expect(phone.changeToken.value).to.equal(null)
  })

  it('keeps the old place after a full sync that could not list the folder: it could not see what was removed', async () => {
    const { phone, tablet } = await twoDevices()
    await addSetlist(tablet, { name: 'Soon gone' })
    await syncDevice(tablet)
    await phone.sync.incrementalSync()
    const place = phone.changeToken.value
    for (const file of rig.driveSetlistFiles()) rig.storage.trash(file.ref)
    rig.storage.fail('inventory', { times: 1 })

    await phone.sync.sync()
    expect(phone.changeToken.value).to.equal(place)
  })

  it('names a setlist it sent among those pulled, so a page holding an old copy takes the link to its file', async () => {
    const { phone } = await twoDevices()
    const setlist = await addSetlist(phone, { name: 'New' })

    await phone.sync.incrementalSync()

    expect(phone.sync.takePulledSetlistIds()).to.deep.equal([setlist.id])
  })

  it('names a setlist it removed among those pulled, so open pages read the list again', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'Soon gone' })
    await syncDevice(tablet)
    await phone.sync.incrementalSync()
    phone.sync.takePulledSetlistIds()
    for (const file of rig.driveSetlistFiles()) rig.storage.trash(file.ref)

    await phone.sync.incrementalSync()

    expect(phone.sync.takePulledSetlistIds()).to.deep.equal([setlist.id])
  })

  it('leaves no place when a reset stops short after clearing the device', async () => {
    const { phone, tablet } = await twoDevices()
    await addSetlist(tablet, { name: 'Late' })
    await syncDevice(tablet)
    await phone.sync.incrementalSync()
    expect(phone.changeToken.value).to.be.a('string')
    rig.storage.fail('list', { on: 'setlists' })

    let thrown: Error | null = null
    try {
      await phone.sync.resetLocalFromDrive()
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown).to.be.instanceOf(Error)
    expect(phone.changeToken.value).to.equal(null)
  })

  it('removes what was deleted elsewhere after a reset left its list of live files behind', async () => {
    const { phone, tablet } = await twoDevices()
    const setlist = await addSetlist(tablet, { name: 'Soon gone' })
    await syncDevice(tablet)
    await phone.sync.resetLocalFromDrive()
    expect(await phone.db.getSetlist(setlist.id)).to.not.equal(undefined)
    for (const file of rig.driveSetlistFiles()) rig.storage.trash(file.ref)

    await phone.sync.incrementalSync()

    expect(await phone.db.getSetlist(setlist.id)).to.equal(undefined)
  })

  it('forgets its place when the space’s folder changes, and when it starts over', async () => {
    const phone = await makeDevice('phone')
    await syncDevice(phone)
    expect(phone.changeToken.value).to.be.a('string')

    await phone.sync.startOver()

    expect(phone.changeToken.value).to.equal(null)
  })

  it('keeps no place from a full sync of a storage with no feed', async () => {
    const phone = await makeDevice('phone')
    phone.changeToken.value = 'stale'
    Object.defineProperty(phone.sync.space, 'changes', { value: null })

    await phone.sync.sync()

    expect(phone.changeToken.value).to.equal(null)
  })

  it('keeps a place after a reset from Drive', async () => {
    const phone = await makeDevice('phone')
    await addSetlist(phone, { name: 'One' })
    await syncDevice(phone)
    phone.changeToken.value = null

    await phone.sync.resetLocalFromDrive()

    expect(phone.changeToken.value).to.be.a('string')
  })

  it('lets go of the file of a song kept because it was edited here, and of one with no chart', async () => {
    const { phone, tablet } = await twoDevices()
    await addSong(tablet, { uuid: 'edited', title: 'Edited', content: '{title: Edited}\n[G]one' })
    await addSong(tablet, { uuid: 'bare', title: 'Bare', content: '{title: Bare}\n[G]two' })
    await syncDevice(tablet)
    await phone.sync.incrementalSync()
    await editSong(phone, 'edited', '{title: Edited}\n[G]one, changed')
    const bare = must(await phone.db.getSong('bare'))
    await phone.db.saveSong({ ...bare, chordproFileId: 'a-chart-that-is-gone' })
    // (and one never sent, which has no file to let go of)
    await addSong(phone, { uuid: 'local', title: 'Local', content: '{title: Local}\n[G]three' })
    for (const file of rig.storage.list(f => f.collection === 'songs')) rig.storage.trash(file.ref)

    await phone.sync.incrementalSync(null, { push: false })

    expect(must(await phone.db.getSong('edited')).fileRef).to.equal(null)
    expect(must(await phone.db.getSong('bare')).fileRef).to.equal(null)
  })

  it('tells how it went, and says so when something other than an error was thrown', async () => {
    const { phone, tablet } = await twoDevices()
    await addSetlist(tablet, { name: 'Late' })
    await syncDevice(tablet)
    const stages: string[] = []
    await phone.sync.incrementalSync(progress => stages.push(progress.stage))
    expect(stages.at(0)).to.equal('starting')
    expect(stages.at(-1)).to.equal('complete')

    await addSetlist(tablet, { name: 'Later' })
    await syncDevice(tablet)
    phone.db.saveSetlistsBatch = () => Promise.reject('a plain string')
    const messages: string[] = []
    let thrown: unknown
    try {
      await phone.sync.incrementalSync(progress => messages.push(progress.message))
    } catch (error) {
      thrown = error
    }
    expect(thrown).to.equal('a plain string')
    expect(messages.at(-1)).to.equal('Sync failed: a plain string')
  })

  it('keeps no place from a full sync when it cannot be told where the feed stands', async () => {
    const { phone } = await twoDevices()
    expect(phone.changeToken.value).to.be.a('string')
    rig.storage.feedStartError = new Error('offline')

    await phone.sync.sync()

    expect(phone.changeToken.value).to.equal(null)
  })

  describe('the people the folder is shared with', () => {
    /** Give the device's member cache a time, as the space's record has */
    function timed(device: Awaited<ReturnType<typeof makeDevice>>, at: string | null) {
      const cache = device.memberCache as {
        set(members: unknown): Promise<void>
        refreshedAt?: () => Promise<string | null>
      }
      const set = cache.set.bind(cache)
      let stamp = at
      cache.set = async members => {
        stamp = new Date().toISOString()
        await set(members)
      }
      cache.refreshedAt = async () => stamp
    }
    const reads = () => rig.storage.calls.filter(call => call.op === 'members').length

    it('are read on an incremental sync when they never were, and then not again soon', async () => {
      const { phone } = await twoDevices()
      timed(phone, null)
      rig.storage.clearCalls()

      await phone.sync.incrementalSync(null, { push: false })
      expect(reads()).to.equal(1)
      expect(phone.memberCache.value).to.be.an('array')

      await phone.sync.incrementalSync(null, { push: false })
      expect(reads()).to.equal(1)
    })

    it('are read again when they were last read long ago, and not when recently', async () => {
      const { phone } = await twoDevices()
      timed(phone, new Date(Date.now() - MEMBERS_REFRESH_MS - 60_000).toISOString())
      rig.storage.clearCalls()
      await phone.sync.incrementalSync(null, { push: false })
      expect(reads()).to.equal(1)

      timed(phone, new Date(Date.now() - 60_000).toISOString())
      rig.storage.clearCalls()
      await phone.sync.incrementalSync(null, { push: false })
      expect(reads()).to.equal(0)
    })

    it('are not read by an incremental sync where the cache cannot say how old they are', async () => {
      const { phone } = await twoDevices()
      rig.storage.clearCalls()
      await phone.sync.incrementalSync(null, { push: false })
      expect(reads()).to.equal(0)
    })
  })

  it('keeps its place in the space’s own record, where a failure to keep it is only a warning', async () => {
    const space = await createSpace(`Feed ${crypto.randomUUID().slice(0, 8)}`)
    try {
      const sync = new DriveSyncManager(space.name, space.id, { storage: rig.storage })
      await sync.init()
      // (what a sync saves is not a change to send)
      expect(sync.spaceDb?.quiet).to.equal(true)
      expect((await sync.incrementalSync()).full).to.equal(true)
      const place = (await sync.changeToken?.get()) ?? null
      expect(place).to.be.a('string')
      // (the members are cached with the time they were read)
      expect(await sync.memberCache?.refreshedAt?.()).to.be.a('string')
      expect((await sync.incrementalSync()).full).to.equal(false)
      sync.spaceDb?.db?.close()

      const realUpdate = SpaceDB.prototype.updateSpace
      SpaceDB.prototype.updateSpace = () => Promise.reject(new Error('read only'))
      try {
        const next = new DriveSyncManager(space.name, space.id, { storage: rig.storage })
        await next.init()
        await next.sync()
        next.spaceDb?.db?.close()
      } finally {
        SpaceDB.prototype.updateSpace = realUpdate
      }
    } finally {
      await deleteSpace(space.id)
    }
  })

  it('cannot forget a place before it has been set up', async () => {
    const sync = new DriveSyncManager(TEST_SPACE.name, TEST_SPACE.id, {
      folderLink: memoryFolderLink(),
      storage: rig.storage,
    })

    let thrown: Error | null = null
    try {
      await sync.resolveDriveFolder()
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).to.contain('not initialised')
  })

  it('has a store of its own that remembers a place', async () => {
    const store = memoryChangeToken()
    await store.set('7')
    expect(await store.get()).to.equal('7')
    await store.clear()
    expect(await store.get()).to.equal(null)
  })
})
