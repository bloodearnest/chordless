import { expect } from '@esm-bundle/chai'
import { ChordlessDB, createSetlist } from '../public/js/db.js'
import { DriveSyncManager } from '../public/js/drive-sync.js'
import { hashText } from '../public/js/song-utils.js'
import { installFakeDrive } from './fake-drive.js'
import { suppressConsoleLogs } from './test-helpers.js'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const ORG_NAME = 'Test Church'
const ORG_ID = 'org-test-church'

/** Let the clock move on, so timestamps taken before and after differ */
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

const deleteDatabase = name =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })

describe('Drive sync (against FakeDrive)', () => {
  let drive
  let devices

  /** A simulated device: its own local database, syncing the shared org */
  async function makeDevice(name) {
    const db = new ChordlessDB(`test-sync-${name}-${crypto.randomUUID()}`)
    await db.init()
    const sync = new DriveSyncManager(ORG_NAME, ORG_ID, { db })
    await sync.init()
    const device = { name, db, sync }
    devices.push(device)
    return device
  }

  async function addSetlist(device, fields = {}) {
    const setlist = { ...createSetlist({ date: '2026-10-11' }), ...fields }
    await device.db.saveSetlist(setlist)
    await tick()
    return setlist
  }

  /** Edit a setlist the way the app does: change it, stamp modifiedDate, save */
  async function editSetlist(device, id, changes) {
    const setlist = await device.db.getSetlist(id)
    Object.assign(setlist, changes, { modifiedDate: new Date().toISOString() })
    await device.db.saveSetlist(setlist)
    await tick()
  }

  async function syncDevice(device) {
    await device.sync.sync()
    await tick()
  }

  function driveSetlistFiles() {
    return drive.listFiles(f => f.appProperties.setlistId)
  }

  function driveSetlist(setlistId) {
    const files = drive.listFiles(f => f.appProperties.setlistId === setlistId)
    expect(files, `Drive files for setlist ${setlistId}`).to.have.length(1)
    return JSON.parse(files[0].content)
  }

  beforeEach(() => {
    drive = installFakeDrive()
    devices = []
  })

  afterEach(async () => {
    drive.uninstall()
    for (const device of devices) {
      device.db.db?.close()
      await deleteDatabase(device.db.dbName)
    }
    expect(
      drive.errors.map(e => e.message),
      'FakeDrive errors'
    ).to.deep.equal([])
  })

  describe('setlists', () => {
    it('uploads a new local setlist into the org setlists folder', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Harvest' })

      await syncDevice(phone)

      const folder = drive.findByPath(['Chordless', ORG_NAME, 'setlists'])
      const [file] = driveSetlistFiles()
      expect(file.parents).to.deep.equal([folder.id])
      expect(file.appProperties.setlistId).to.equal(setlist.id)
      expect(driveSetlist(setlist.id).name).to.equal('Harvest')

      const local = await phone.db.getSetlist(setlist.id)
      expect(local.driveFileId).to.equal(file.id)
    })

    it('downloads setlists created on another device', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone, { name: 'Harvest' })
      await syncDevice(phone)

      await syncDevice(tablet)

      const onTablet = await tablet.db.getSetlist(setlist.id)
      expect(onTablet.name).to.equal('Harvest')
    })

    it('downloads every setlist when the listing spans several pages', async () => {
      drive.maxPageSize = 2
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlists = [await addSetlist(phone), await addSetlist(phone), await addSetlist(phone)]
      await syncDevice(phone)

      await syncDevice(tablet)

      const onTablet = await tablet.db.getAllSetlists()
      expect(onTablet.map(s => s.id).sort()).to.deep.equal(setlists.map(s => s.id).sort())
    })

    it('propagates an edit from one device to another', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone)
      await syncDevice(phone)
      await syncDevice(tablet)

      await editSetlist(phone, setlist.id, { name: 'Renamed on phone' })
      await syncDevice(phone)
      await syncDevice(tablet)

      expect(driveSetlist(setlist.id).name).to.equal('Renamed on phone')
      expect((await tablet.db.getSetlist(setlist.id)).name).to.equal('Renamed on phone')
    })

    it('makes no writes to Drive when nothing changed', async () => {
      const phone = await makeDevice('phone')
      await addSetlist(phone)
      await syncDevice(phone)
      await syncDevice(phone) // settle any post-upload bookkeeping
      drive.requests = []

      await syncDevice(phone)

      const writes = drive.requests.filter(r => r.method !== 'GET')
      expect(writes.map(r => `${r.method} ${r.path}`)).to.deep.equal([])
    })

    it('never removes Drive files when the local database is empty', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Keep me' })
      await syncDevice(phone)

      await phone.db.clearAll()
      await syncDevice(phone)

      expect(driveSetlist(setlist.id).name).to.equal('Keep me')
      expect((await phone.db.getSetlist(setlist.id)).name).to.equal('Keep me')
      expect(drive.requests.filter(r => r.method === 'DELETE')).to.deep.equal([])
    })

    it('re-uploads a setlist whose Drive file was deleted elsewhere', async () => {
      // Current behaviour: deleting a file in the Drive UI doesn't stick while
      // any device still has a local copy.
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Resurrected' })
      await syncDevice(phone)

      drive.files.delete(driveSetlistFiles()[0].id)
      await editSetlist(phone, setlist.id, { name: 'Resurrected' })
      await syncDevice(phone)

      expect(driveSetlist(setlist.id).name).to.equal('Resurrected')
    })
  })

  describe('conflicts: same setlist edited on two devices', () => {
    it('keeps the Drive version and discards the local edit', async () => {
      // Current behaviour: no merge, and the losing edit is only console.warn'd.
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      await syncDevice(tablet)

      await editSetlist(phone, setlist.id, { name: 'Phone edit' })
      await editSetlist(tablet, setlist.id, { name: 'Tablet edit' })
      await syncDevice(phone)
      await syncDevice(tablet)

      expect(driveSetlist(setlist.id).name).to.equal('Phone edit')
      expect((await tablet.db.getSetlist(setlist.id)).name).to.equal('Phone edit')
    })

    it("doesn't lose an edit made after a remote change was pulled", async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      await syncDevice(tablet)

      await editSetlist(phone, setlist.id, { name: 'Phone edit' })
      await syncDevice(phone)
      await syncDevice(tablet) // tablet pulls the phone edit
      await editSetlist(tablet, setlist.id, { name: 'Tablet edit on top' })
      await syncDevice(tablet)
      await syncDevice(phone)

      expect(driveSetlist(setlist.id).name).to.equal('Tablet edit on top')
      expect((await phone.db.getSetlist(setlist.id)).name).to.equal('Tablet edit on top')
    })

    it('detects a remote edit when the device clock is ahead of Drive', async () => {
      // Regression: lastSyncedAt (device clock) used to be compared with Drive's
      // modifiedTime (server clock), so with the device ahead, a remote edit
      // looked older than the last sync and was silently overwritten.
      drive.clockOffsetMs = -5 * 60 * 1000 // server 5 min behind = devices 5 min ahead
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone, { name: 'Original', leader: 'Ann' })
      await syncDevice(phone)
      await syncDevice(tablet)

      await editSetlist(phone, setlist.id, { leader: 'Phone changed leader' })
      await syncDevice(phone)
      await editSetlist(tablet, setlist.id, { name: 'Tablet renamed' })
      await syncDevice(tablet)

      // Detected as a conflict, resolved like any other (Drive wins)
      const onDrive = driveSetlist(setlist.id)
      expect(onDrive.leader).to.equal('Phone changed leader')
      expect((await tablet.db.getSetlist(setlist.id)).leader).to.equal('Phone changed leader')
    })

    it('keeps a local edit when the device clock is behind Drive', async () => {
      // Regression: the device's own upload looked like a newer remote change,
      // so an edit made within the skew window was replaced by the old version.
      drive.clockOffsetMs = 5 * 60 * 1000 // server 5 min ahead = devices 5 min behind
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)

      await editSetlist(phone, setlist.id, { name: 'Edited' })
      await syncDevice(phone)

      expect((await phone.db.getSetlist(setlist.id)).name).to.equal('Edited')
      expect(driveSetlist(setlist.id).name).to.equal('Edited')
    })
  })

  describe('change detection by content', () => {
    it('uploads an edit even if modifiedDate was not updated', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)

      const stored = await phone.db.getSetlist(setlist.id)
      await phone.db.saveSetlist({ ...stored, name: 'Edited, same modifiedDate' })
      await syncDevice(phone)

      expect(driveSetlist(setlist.id).name).to.equal('Edited, same modifiedDate')
    })

    it('does not download when only Drive metadata changed', async () => {
      // Drive's md5Checksum only changes with content, so e.g. an appProperties
      // update (or anything else that moves modifiedTime) isn't a remote change.
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      const [file] = driveSetlistFiles()
      drive.files.get(file.id).modifiedTime = new Date(Date.now() + 60_000).toISOString()
      drive.files.get(file.id).appProperties.note = 'changed elsewhere'
      drive.requests = []

      await syncDevice(phone)

      expect(drive.requests.filter(r => r.params.get('alt') === 'media')).to.deep.equal([])
      expect((await phone.db.getSetlist(setlist.id)).name).to.equal('Original')
    })

    it('does not upload an edit that was undone', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Changed' })
      await editSetlist(phone, setlist.id, { name: 'Original' })
      drive.requests = []

      await syncDevice(phone)

      expect(drive.requests.filter(r => r.method !== 'GET').map(r => r.path)).to.deep.equal([])
    })

    it('keeps device sync state out of the copy in Drive', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Clean' })
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Clean edit' })
      await syncDevice(phone)

      const onDrive = driveSetlist(setlist.id)
      for (const field of [
        'driveFileId',
        'driveModifiedTime',
        'lastSyncedAt',
        'syncedContentHash',
      ]) {
        expect(onDrive, field).not.to.have.property(field)
      }
    })

    it('syncs setlists recorded before content hashes', async () => {
      // Records synced by the previous version have no syncedContentHash or
      // driveChecksum, and a driveModifiedTime taken from the device clock.
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Old record' })
      await syncDevice(phone)
      const stored = await phone.db.getSetlist(setlist.id)
      delete stored.syncedContentHash
      delete stored.driveChecksum
      stored.driveModifiedTime = new Date().toISOString()
      stored._lastSyncHash = 'hash-from-old-version'
      await phone.db.saveSetlist(stored)
      drive.requests = []

      await syncDevice(phone)
      expect(drive.requests.filter(r => r.method !== 'GET').map(r => r.path)).to.deep.equal([])
      expect((await phone.db.getSetlist(setlist.id)).syncedContentHash).to.be.a('string')

      await editSetlist(phone, setlist.id, { name: 'Old record, edited' })
      await syncDevice(phone)
      expect(driveSetlist(setlist.id).name).to.equal('Old record, edited')
    })
  })

  describe('errors partway through a sync', () => {
    it('keeps Drive file IDs matched when one upload in a batch fails', async () => {
      // Regression: batchUploadFiles used to drop failed uploads from its
      // results, shifting later setlists onto the wrong driveFileId so a later
      // edit overwrote a different setlist's file.
      const phone = await makeDevice('phone')
      await addSetlist(phone, { id: 'setlist-a', name: 'A' })
      await addSetlist(phone, { id: 'setlist-b', name: 'B' })
      await addSetlist(phone, { id: 'setlist-c', name: 'C' })
      drive.failRequests({ method: 'POST', path: /^\/upload\/drive\/v3\/files/, status: 500 })

      await syncDevice(phone)

      const fileFor = async id => drive.files.get((await phone.db.getSetlist(id)).driveFileId)
      expect((await phone.db.getSetlist('setlist-a')).driveFileId).to.equal(undefined)
      expect((await fileFor('setlist-b')).appProperties.setlistId).to.equal('setlist-b')
      expect((await fileFor('setlist-c')).appProperties.setlistId).to.equal('setlist-c')

      // The failed one is uploaded next sync, and editing it only touches its own file
      await syncDevice(phone)
      expect((await fileFor('setlist-a')).appProperties.setlistId).to.equal('setlist-a')
      await editSetlist(phone, 'setlist-a', { name: 'A edited' })
      await syncDevice(phone)

      expect(driveSetlist('setlist-a').name).to.equal('A edited')
      expect(driveSetlist('setlist-b').name).to.equal('B')
      expect(driveSetlist('setlist-c').name).to.equal('C')
    })

    it("doesn't duplicate setlists when the Drive inventory fails", async () => {
      // Regression: buildDriveInventory used to swallow errors but keep its
      // (empty) file set, so every synced setlist looked "missing from Drive"
      // and was uploaded again as a new file.
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone)
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Edited' })
      drive.failRequests({ method: 'GET', path: /files\(id,name,mimeType\)&pageSize/ })

      await syncDevice(phone)

      expect(driveSetlist(setlist.id).name).to.equal('Edited')
    })

    it("doesn't duplicate setlists when the inventory spans several pages", async () => {
      // Regression: the inventory only read the first page of each folder, so
      // files on later pages looked missing and were re-uploaded.
      drive.maxPageSize = 2
      const phone = await makeDevice('phone')
      const setlists = [await addSetlist(phone), await addSetlist(phone), await addSetlist(phone)]
      await syncDevice(phone)
      for (const { id } of setlists) await editSetlist(phone, id, { name: `Edited ${id}` })

      await syncDevice(phone)

      for (const { id } of setlists) expect(driveSetlist(id).name).to.equal(`Edited ${id}`)
    })

    it('reports success when a setlist update fails, and retries next sync', async () => {
      // Current behaviour: pushSetlists uses Promise.allSettled, so a failed
      // update is only logged and sync() still resolves as successful.
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Edited' })
      drive.failRequests({ method: 'PATCH', path: /^\/upload\//, network: true })

      await syncDevice(phone) // resolves despite the failure

      expect(driveSetlist(setlist.id).name).to.equal('Original')
      await syncDevice(phone)
      expect(driveSetlist(setlist.id).name).to.equal('Edited')
    })

    it('skips a setlist whose download fails, and gets it next sync', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone, { name: 'Flaky' })
      await syncDevice(phone)
      drive.failRequests({ method: 'GET', path: /alt=media/, status: 503 })

      await syncDevice(tablet)
      expect(await tablet.db.getSetlist(setlist.id)).to.equal(undefined)

      await syncDevice(tablet)
      expect((await tablet.db.getSetlist(setlist.id)).name).to.equal('Flaky')
    })

    it('fails the sync without pushing when the setlist listing fails', async () => {
      const phone = await makeDevice('phone')
      await addSetlist(phone)
      drive.requests = []
      drive.failRequests({ method: 'GET', path: /name contains/, status: 500 })

      let error
      try {
        await phone.sync.sync()
      } catch (e) {
        error = e
      }

      expect(error?.message).to.match(/Drive API error/)
      expect(drive.requests.filter(r => r.path.startsWith('/upload/'))).to.deep.equal([])
    })
  })

  describe('reset from Drive', () => {
    async function resetError(device) {
      try {
        await device.sync.resetLocalFromDrive()
      } catch (error) {
        return error
      }
      return null
    }

    it('drops setlists removed from Drive instead of re-uploading them', async () => {
      const phone = await makeDevice('phone')
      const keep = await addSetlist(phone, { name: 'Keep' })
      const removed = await addSetlist(phone, { name: 'Duplicate' })
      await syncDevice(phone)
      const removedFile = drive.listFiles(f => f.appProperties.setlistId === removed.id)[0]
      drive.files.get(removedFile.id).trashed = true

      await phone.sync.resetLocalFromDrive()

      expect((await phone.db.getAllSetlists()).map(s => s.name)).to.deep.equal(['Keep'])
      expect((await phone.db.getSetlist(keep.id)).driveFileId).to.be.a('string')
      // And a normal sync afterwards doesn't bring it back
      await syncDevice(phone)
      expect(driveSetlistFiles().filter(f => !f.trashed)).to.have.length(1)
    })

    it('restores everything in Drive, including setlists this device never had', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const fromTablet = await addSetlist(tablet, { name: 'From tablet' })
      await syncDevice(tablet)

      await phone.sync.resetLocalFromDrive()

      expect((await phone.db.getSetlist(fromTablet.id)).name).to.equal('From tablet')
    })

    it('changes nothing if a setlist was edited since its last sync', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Unsynced edit' })

      const error = await resetError(phone)

      expect(error?.name).to.equal('UnsyncedChangesError')
      expect(error.unsynced.map(u => u.id)).to.deep.equal([setlist.id])
      expect((await phone.db.getSetlist(setlist.id)).name).to.equal('Unsynced edit')
    })

    it('changes nothing if a setlist was never uploaded', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Local only' })

      const error = await resetError(phone)

      expect(error?.name).to.equal('UnsyncedChangesError')
      expect((await phone.db.getSetlist(setlist.id)).name).to.equal('Local only')
    })

    it('changes nothing if a song chart was edited since its last sync', async () => {
      const phone = await makeDevice('phone')
      const chordproFileId = 'chordpro-song-1'
      await phone.db.saveChordPro({
        id: chordproFileId,
        content: 'v1',
        contentHash: hashText('v1'),
        lastModified: Date.now(),
      })
      await phone.db.saveSong({
        uuid: 'song-1',
        id: 'title-a',
        title: 'A',
        isDefault: true,
        chordproFileId,
        modifiedDate: new Date().toISOString(),
      })
      await tick()
      await syncDevice(phone)
      await phone.db.saveChordPro({
        id: chordproFileId,
        content: 'v2',
        contentHash: hashText('v2'),
        lastModified: Date.now(),
      })

      const error = await resetError(phone)

      expect(error?.unsynced.map(u => u.type)).to.deep.equal(['song'])
      expect((await phone.db.getChordPro(chordproFileId)).content).to.equal('v2')
    })

    it('changes nothing if Drive cannot be listed', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Safe' })
      await syncDevice(phone)
      drive.failRequests({ method: 'GET', path: /files\(id,name,mimeType\)&pageSize/ })

      const error = await resetError(phone)

      expect(error?.message).to.match(/nothing was changed/)
      expect((await phone.db.getSetlist(setlist.id)).name).to.equal('Safe')
    })

    it('keeps per-setlist device preferences', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone)
      await syncDevice(phone)
      await phone.db.saveLocalState({ setlistId: setlist.id, marker: 'kept' })

      await phone.sync.resetLocalFromDrive()

      expect((await phone.db.getLocalState(setlist.id)).marker).to.equal('kept')
    })
  })

  describe('songs', () => {
    async function addSong(device, { uuid, title, content }) {
      const chordproFileId = `chordpro-${uuid}`
      await device.db.saveChordPro({
        id: chordproFileId,
        content,
        contentHash: hashText(content),
        lastModified: Date.now(),
      })
      await device.db.saveSong({
        uuid,
        id: `title-${title.toLowerCase()}`,
        title,
        titleNormalized: title.toLowerCase(),
        isDefault: true,
        variantOf: null,
        chordproFileId,
        modifiedDate: new Date().toISOString(),
      })
      await tick()
    }

    async function editSongContent(device, uuid, content) {
      const song = await device.db.getSong(uuid)
      await device.db.saveChordPro({
        id: song.chordproFileId,
        content,
        contentHash: hashText(content),
        lastModified: Date.now(),
      })
      song.modifiedDate = new Date().toISOString()
      await device.db.saveSong(song)
      await tick()
    }

    const songContent = async (device, uuid) => {
      const song = await device.db.getSong(uuid)
      return (await device.db.getChordPro(song.chordproFileId)).content
    }

    it('uploads a song and downloads it on another device', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })

      await syncDevice(phone)
      await syncDevice(tablet)

      const [file] = drive.listFiles(f => f.appProperties.type === 'chordpro')
      expect(file.content).to.equal('{title: Amazing}\n[G]Grace')
      expect(await songContent(tablet, 'song-1')).to.equal('{title: Amazing}\n[G]Grace')
    })

    it('propagates a chord chart edit', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })
      await syncDevice(phone)
      await syncDevice(tablet)

      await editSongContent(phone, 'song-1', '{title: Amazing}\n[A]Grace')
      await syncDevice(phone)
      await syncDevice(tablet)

      expect(await songContent(tablet, 'song-1')).to.equal('{title: Amazing}\n[A]Grace')
    })

    it('keeps Drive file IDs matched when one song upload in a batch fails', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-a', title: 'Alpha', content: 'alpha chart' })
      await addSong(phone, { uuid: 'song-b', title: 'Beta', content: 'beta chart' })
      drive.failRequests({ method: 'POST', path: /^\/upload\/drive\/v3\/files/, status: 500 })

      await syncDevice(phone)
      await syncDevice(phone)

      for (const uuid of ['song-a', 'song-b']) {
        const song = await phone.db.getSong(uuid)
        expect(drive.files.get(song.driveFileId).content).to.equal(await songContent(phone, uuid))
      }
    })

    it('uploads a chart edit even if its stored contentHash is stale', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: 'v1' })
      await syncDevice(phone)

      const song = await phone.db.getSong('song-1')
      const chart = await phone.db.getChordPro(song.chordproFileId)
      await phone.db.saveChordPro({ ...chart, content: 'v2 without new hash' })
      await syncDevice(phone)

      const [file] = drive.listFiles(f => f.appProperties.type === 'chordpro')
      expect(file.content).to.equal('v2 without new hash')
    })

    it('pulls a chart edited in Drive even if its appProperties are stale', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: 'v1' })
      await syncDevice(phone)

      const [file] = drive.listFiles(f => f.appProperties.type === 'chordpro')
      drive.editContent(file.id, 'edited in Drive')
      await syncDevice(phone)

      expect(await songContent(phone, 'song-1')).to.equal('edited in Drive')
    })

    it('keeps the Drive version when a chart is edited on two devices', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: 'v1' })
      await syncDevice(phone)
      await syncDevice(tablet)

      await editSongContent(phone, 'song-1', 'phone version')
      await editSongContent(tablet, 'song-1', 'tablet version')
      await syncDevice(phone)
      await syncDevice(tablet)

      const [file] = drive.listFiles(f => f.appProperties.type === 'chordpro')
      expect(file.content).to.equal('phone version')
      expect(await songContent(tablet, 'song-1')).to.equal('phone version')
    })
  })
})
