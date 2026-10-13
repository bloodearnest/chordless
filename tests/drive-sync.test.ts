import { expect } from '@esm-bundle/chai'
import type { Setlist, SetlistLocalState } from '../src/js/data-types.ts'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { setlistFileMetadata, songFileMetadata } from '../src/js/drive-metadata.ts'
import { DriveSyncManager, type FolderLink } from '../src/js/drive-sync.ts'
import { hashText } from '../src/js/song-utils.ts'
import { makeEntry, makeLocalState, makeSong } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const ORG_NAME = 'Test Church'
const ORG_ID = 'org-test-church'

/** Let the clock move on, so timestamps taken before and after differ */
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

const deleteDatabase = name =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })

describe('Drive sync (against FakeDrive)', () => {
  let drive
  let devices

  /** In-memory stand-in for the organisation's stored Drive folder link */
  const memoryFolderLink = (): FolderLink & { value: string | null } => ({
    value: null as string | null,
    async get() {
      return this.value
    },
    async set(value: string) {
      this.value = value
    },
  })

  /** A simulated device: its own local database, syncing the shared org */
  async function makeDevice(
    name,
    {
      orgName = ORG_NAME,
      folderLink = memoryFolderLink(),
    }: { orgName?: string; folderLink?: FolderLink & { value?: string | null } } = {}
  ) {
    const db = new ChordlessDB(`test-sync-${name}-${crypto.randomUUID()}`)
    await db.init()
    const memberCache = {
      value: null,
      readOnly: null as boolean | null,
      async set(members) {
        this.value = members
      },
      async setReadOnly(readOnly: boolean) {
        this.readOnly = readOnly
      },
    }
    const sync = new DriveSyncManager(orgName, ORG_ID, { db, folderLink, memberCache })
    await sync.init()
    const device = { name, db, sync, folderLink, memberCache }
    devices.push(device)
    return device
  }

  /** Rename the device's organisation: sync from then on uses the new name */
  async function renameOrganisation(device, newName) {
    device.sync = new DriveSyncManager(newName, ORG_ID, {
      db: device.db,
      folderLink: device.folderLink,
      memberCache: device.memberCache,
    })
    await device.sync.init()
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

  /** The Drive file `id` is replaced by a copy with another id, as when duplicates are cleaned up */
  function replaceDriveFile(id: string, newId: string) {
    const file = must(drive.files.get(id))
    drive.files.delete(id)
    file.id = newId
    drive.files.set(newId, file)
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

      const local = must(await phone.db.getSetlist(setlist.id))
      expect(local.driveFileId).to.equal(file.id)
    })

    it('downloads setlists created on another device', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone, { name: 'Harvest' })
      await syncDevice(phone)

      await syncDevice(tablet)

      const onTablet = must(await tablet.db.getSetlist(setlist.id))
      expect(onTablet.name).to.equal('Harvest')
    })

    it("turns a Drive setlist's text tempo into a number, without counting it as an edit", async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const songs = [{ order: 0, songId: 'song-1', songUuid: 'uuid-1', key: 'G', tempo: 72 }]
      const setlist = await addSetlist(phone, { songs })
      await syncDevice(phone)
      // As an older version uploaded them: the chart's text as the tempo
      const [file] = drive.listFiles(f => f.appProperties.setlistId === setlist.id)
      file.content = file.content.replace('"tempo": 72', '"tempo": "72"')
      expect(driveSetlist(setlist.id).songs[0].tempo).to.equal('72')

      await syncDevice(tablet)
      const onTablet = must(await tablet.db.getSetlist(setlist.id))
      expect(onTablet.songs[0].tempo).to.equal(72)
      expect(tablet.sync.setlistHasLocalChanges(onTablet)).to.equal(false)

      drive.requests = []
      await syncDevice(tablet)
      const writes = drive.requests.filter(r => r.method !== 'GET')
      expect(writes.map(r => `${r.method} ${r.path}`)).to.deep.equal([])
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
      expect(must(await tablet.db.getSetlist(setlist.id)).name).to.equal('Renamed on phone')
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
      expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Keep me')
      expect(drive.requests.filter(r => r.method === 'DELETE')).to.deep.equal([])
    })

    it('removes a setlist whose Drive file was deleted elsewhere', async () => {
      // Deleting a file in the Drive UI sticks: a device with an unedited copy drops it
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Deleted' })
      await syncDevice(phone)

      drive.files.delete(driveSetlistFiles()[0].id)
      await syncDevice(phone)

      expect(await phone.db.getSetlist(setlist.id)).to.not.be.ok
      expect(driveSetlistFiles()).to.have.length(0)
    })
  })

  describe('Drive file metadata', () => {
    const fileFor = id => drive.listFiles(f => f.appProperties.setlistId === id)[0]

    it('creates and updates setlist files with the metadata from drive-metadata.js', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Harvest', owner: 'Ann' })
      await syncDevice(phone)
      const expected = () => setlistFileMetadata(setlist, { organisationId: ORG_ID }).appProperties

      expect(fileFor(setlist.id).appProperties).to.deep.equal(expected())

      await editSetlist(phone, setlist.id, { name: 'Harvest Festival' })
      await syncDevice(phone)
      expect(fileFor(setlist.id).appProperties).to.deep.equal(expected())
    })

    it("renames a setlist's file when its date or leader changes", async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, {
        date: '2026-10-11',
        owner: '',
        type: 'Church Service',
      })
      await syncDevice(phone)
      expect(fileFor(setlist.id).name).to.equal('2026-10-11-church-service.json')

      await editSetlist(phone, setlist.id, { date: '2026-10-18', owner: 'Ann' })
      await syncDevice(phone)

      expect(fileFor(setlist.id).name).to.equal('2026-10-18-ann-church-service.json')
    })

    it('removes retired appProperties from older files when updating them', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Old file' })
      await syncDevice(phone)
      Object.assign(fileFor(setlist.id).appProperties, {
        resourceType: 'setlist',
        leader: '',
        date: '2020-01-01',
      })

      await editSetlist(phone, setlist.id, { name: 'Old file, edited' })
      await syncDevice(phone)

      expect(Object.keys(fileFor(setlist.id).appProperties).sort()).to.deep.equal([
        'appVersion',
        'organisationId',
        'setlistId',
      ])
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
      expect(must(await tablet.db.getSetlist(setlist.id)).name).to.equal('Phone edit')
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
      expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Tablet edit on top')
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
      expect(
        ((await tablet.db.getSetlist(setlist.id)) as Setlist & { leader?: string }).leader
      ).to.equal('Phone changed leader')
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

      expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Edited')
      expect(driveSetlist(setlist.id).name).to.equal('Edited')
    })
  })

  describe('change detection by content', () => {
    it('uploads an edit even if modifiedDate was not updated', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)

      const stored = must(await phone.db.getSetlist(setlist.id))
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
      expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Original')
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
      const stored = must(await phone.db.getSetlist(setlist.id))
      delete stored.syncedContentHash
      delete stored.driveChecksum
      stored.driveModifiedTime = new Date().toISOString()
      stored._lastSyncHash = 'hash-from-old-version'
      await phone.db.saveSetlist(stored)
      drive.requests = []

      await syncDevice(phone)
      expect(drive.requests.filter(r => r.method !== 'GET').map(r => r.path)).to.deep.equal([])
      expect(must(await phone.db.getSetlist(setlist.id)).syncedContentHash).to.be.a('string')

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

      const fileFor = async id => drive.files.get(must(await phone.db.getSetlist(id)).driveFileId)
      expect(must(await phone.db.getSetlist('setlist-a')).driveFileId).to.equal(undefined)
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

    it('uploads nothing from a device whose setlists are unchanged, when another adds one', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      for (let i = 0; i < 12; i++) {
        await addSetlist(phone, {
          date: `2026-09-${String(i + 1).padStart(2, '0')}`,
          songs: [makeEntry({ songId: `title-song-${i}`, key: 'G', tempo: i % 2 ? 72 : null })],
        })
      }
      await syncDevice(phone)
      await syncDevice(tablet)
      await syncDevice(phone)
      await syncDevice(tablet)

      await addSetlist(phone, { date: '2026-10-04' })
      await syncDevice(phone)
      drive.requests = []
      await syncDevice(tablet)

      expect(await tablet.db.getAllSetlists()).to.have.length(13)
      const writes = drive.requests.filter(r => r.method !== 'GET')
      expect(writes.map(r => `${r.method} ${r.path}`)).to.deep.equal([])
    })

    describe("when a device's Drive file is gone and no other file holds the setlist", () => {
      const trashAll = () => {
        for (const file of driveSetlistFiles()) drive.files.get(file.id).trashed = true
      }

      it('removes the setlists that were not edited here, without uploading anything', async () => {
        const phone = await makeDevice('phone')
        for (let i = 0; i < 8; i++) await addSetlist(phone, { date: `2026-09-0${i + 1}` })
        await syncDevice(phone)
        trashAll()
        drive.requests = []

        await syncDevice(phone)

        expect(await phone.db.getAllSetlists()).to.have.length(0)
        expect(drive.requests.filter(r => r.method !== 'GET')).to.deep.equal([])
      })

      it('keeps and uploads again a setlist edited here', async () => {
        const phone = await makeDevice('phone')
        const edited = await addSetlist(phone, { name: 'Edited' })
        const untouched = await addSetlist(phone, { name: 'Untouched' })
        await syncDevice(phone)
        trashAll()
        await editSetlist(phone, edited.id, { name: 'Edited again' })

        await syncDevice(phone)

        expect((await phone.db.getAllSetlists()).map(s => s.id)).to.deep.equal([edited.id])
        expect(await phone.db.getSetlist(untouched.id)).to.not.be.ok
        const live = drive.listFiles(f => f.appProperties.setlistId === edited.id && !f.trashed)
        expect(live.map(f => JSON.parse(f.content).name)).to.deep.equal(['Edited again'])
      })

      it('brings a restored file back, keeping the device state for it', async () => {
        const phone = await makeDevice('phone')
        const setlist = await addSetlist(phone, { name: 'Restorable' })
        await phone.db.saveLocalState(Object.assign(makeLocalState(setlist.id), { marker: 'kept' }))
        await syncDevice(phone)
        trashAll()
        await syncDevice(phone)
        for (const file of driveSetlistFiles()) drive.files.get(file.id).trashed = false

        await syncDevice(phone)

        expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Restorable')
        expect(
          ((await phone.db.getLocalState(setlist.id)) as SetlistLocalState & { marker?: string })
            .marker
        ).to.equal('kept')
      })
    })

    it("doesn't upload a copy of an edited setlist whose live file it could not read", async () => {
      // Found by the random histories: the pull's adopt download failed, then the push saw an
      // edited record with no file of its own and uploaded it as new
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      replaceDriveFile(must(await phone.db.getSetlist(setlist.id)).driveFileId as string, 'moved')
      await editSetlist(phone, setlist.id, { name: 'Edited' })
      drive.failRequests({ method: 'GET', path: /alt=media/, times: 1 })

      await syncDevice(phone)

      expect(driveSetlistFiles()).to.have.length(1)

      await syncDevice(phone)

      expect(driveSetlistFiles()).to.have.length(1)
      expect(driveSetlist(setlist.id).name).to.equal('Edited')
    })

    describe('when Drive reports other content than was sent', () => {
      it('keeps the setlist as changed, and uploads it again over the same file', async () => {
        const phone = await makeDevice('phone')
        const setlist = await addSetlist(phone, { name: 'Intact' })
        drive.corruptUploads = 1

        await syncDevice(phone)

        const afterFirst = must(await phone.db.getSetlist(setlist.id))
        expect(afterFirst.driveFileId).to.be.a('string')
        expect(phone.sync.setlistHasLocalChanges(afterFirst)).to.equal(true)

        await syncDevice(phone)

        expect(driveSetlistFiles()).to.have.length(1)
        const settled = must(await phone.db.getSetlist(setlist.id))
        expect(settled.driveFileId).to.equal(afterFirst.driveFileId)
        expect(phone.sync.setlistHasLocalChanges(settled)).to.equal(false)
      })

      it('does the same for a setlist update', async () => {
        const phone = await makeDevice('phone')
        const setlist = await addSetlist(phone, { name: 'Original' })
        await syncDevice(phone)
        await editSetlist(phone, setlist.id, { name: 'Edited' })
        drive.corruptUploads = 1

        await syncDevice(phone)
        expect(
          phone.sync.setlistHasLocalChanges(must(await phone.db.getSetlist(setlist.id)))
        ).to.equal(true)

        await syncDevice(phone)

        expect(driveSetlist(setlist.id).name).to.equal('Edited')
        expect(
          phone.sync.setlistHasLocalChanges(must(await phone.db.getSetlist(setlist.id)))
        ).to.equal(false)
      })

      it('records a good upload as synced', async () => {
        const phone = await makeDevice('phone')
        const setlist = await addSetlist(phone, { name: 'Fine' })

        await syncDevice(phone)

        const local = must(await phone.db.getSetlist(setlist.id))
        expect(phone.sync.setlistHasLocalChanges(local)).to.equal(false)
        expect(local.driveChecksum).to.equal(drive.listFiles()[0].md5Checksum)
      })
    })

    it('uploads two identical setlists made on one device', async () => {
      // The user made both; refusing one would leave their work unsynced
      const phone = await makeDevice('phone')
      const same = { date: '2026-10-11', owner: 'Sam', type: 'Church Service', name: '' }
      await addSetlist(phone, same)
      await addSetlist(phone, same)

      await syncDevice(phone)

      expect(driveSetlistFiles()).to.have.length(2)
    })

    it('uploads two setlists for the same day at different times', async () => {
      const phone = await makeDevice('phone')
      const same = { date: '2026-10-11', owner: 'Sam', type: 'Church Service', name: '' }
      await addSetlist(phone, { ...same, time: '09:00' })
      await addSetlist(phone, { ...same, time: '18:00' })

      await syncDevice(phone)

      expect(driveSetlistFiles()).to.have.length(2)
    })

    describe('when the Drive file a device knew is gone but another holds the setlist', () => {
      // Duplicates were cleaned up in Drive (the audit page trashes all but one), so a device
      // that knew a removed file points at nothing, while a live file for the setlist exists
      let phone
      let tablet
      let setlist

      beforeEach(async () => {
        phone = await makeDevice('phone')
        tablet = await makeDevice('tablet')
        setlist = await addSetlist(phone, { name: 'Original' })
        await syncDevice(phone)
        await syncDevice(tablet)
        replaceDriveFile(must(await tablet.db.getSetlist(setlist.id)).driveFileId, 'survivor')
        drive.requests = []
      })

      const writes = () =>
        drive.requests.filter(r => r.method !== 'GET').map(r => `${r.method} ${r.path}`)

      it('adopts the live file, rather than uploading a copy', async () => {
        await syncDevice(tablet)

        expect(writes()).to.deep.equal([])
        expect(driveSetlistFiles()).to.have.length(1)
        expect(must(await tablet.db.getSetlist(setlist.id)).driveFileId).to.equal('survivor')
        expect(
          tablet.sync.setlistHasLocalChanges(must(await tablet.db.getSetlist(setlist.id)))
        ).to.equal(false)
      })

      it('updates the live file with an edit made here, rather than uploading a copy', async () => {
        await editSetlist(tablet, setlist.id, { name: 'Edited on the tablet' })

        await syncDevice(tablet)

        expect(driveSetlistFiles()).to.have.length(1)
        expect(driveSetlist(setlist.id).name).to.equal('Edited on the tablet')
        expect(must(await tablet.db.getSetlist(setlist.id)).driveFileId).to.equal('survivor')
      })

      it("takes the live file's content when it is newer and nothing was edited here", async () => {
        drive.editContent(
          'survivor',
          JSON.stringify({ ...driveSetlist(setlist.id), name: 'Renamed' })
        )

        await syncDevice(tablet)

        expect(writes()).to.deep.equal([])
        expect(must(await tablet.db.getSetlist(setlist.id)).name).to.equal('Renamed')
      })
    })

    it('adopts the live file for a setlist this device never uploaded', async () => {
      // e.g. it was created here, and also reached Drive from another device
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone, { name: 'Shared' })
      await syncDevice(phone)
      await tablet.db.saveSetlist({ ...setlist })
      drive.requests = []

      await syncDevice(tablet)

      expect(drive.requests.filter(r => r.method !== 'GET')).to.deep.equal([])
      expect(driveSetlistFiles()).to.have.length(1)
      expect(must(await tablet.db.getSetlist(setlist.id)).driveFileId).to.equal(
        driveSetlistFiles()[0].id
      )
    })

    it("doesn't upload a second record of a setlist that Drive already holds", async () => {
      // e.g. a device with its own record of the same service, under another id
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const same = { date: '2026-10-11', owner: 'Sam', type: 'Church Service' }
      await addSetlist(phone, { ...same, name: '' })
      await syncDevice(phone)
      const own = await addSetlist(tablet, { ...same, name: '' })

      await syncDevice(tablet)

      expect(driveSetlistFiles()).to.have.length(1)
      expect(must(await tablet.db.getSetlist(own.id)).driveFileId).to.not.be.ok
    })

    it('still uploads a setlist that differs in its name', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const same = { date: '2026-10-11', owner: 'Sam', type: 'Event' }
      await addSetlist(phone, { ...same, name: 'Morning' })
      await syncDevice(phone)
      await addSetlist(tablet, { ...same, name: 'Evening' })

      await syncDevice(tablet)

      expect(driveSetlistFiles()).to.have.length(2)
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
      expect(must(await tablet.db.getSetlist(setlist.id)).name).to.equal('Flaky')
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

  describe('organisations', () => {
    const orgFolders = () =>
      [...drive.files.values()].filter(
        f => f.parents.includes(drive.findByPath(['Chordless']).id) && !f.trashed
      )

    it('keeps syncing the same Drive folder after a rename, and renames it', async () => {
      const phone = await makeDevice('phone', { orgName: 'Personal' })
      const setlist = await addSetlist(phone, { name: 'Harvest' })
      await syncDevice(phone)
      const folderId = drive.findByPath(['Chordless', 'Personal']).id

      await renameOrganisation(phone, 'Simon Davy')
      await editSetlist(phone, setlist.id, { name: 'Harvest edited' })
      await syncDevice(phone)

      expect(orgFolders().map(f => f.name)).to.deep.equal(['Simon Davy'])
      expect(drive.findByPath(['Chordless', 'Simon Davy']).id).to.equal(folderId)
      expect(driveSetlist(setlist.id).name).to.equal('Harvest edited')
    })

    it('keeps the linked folder, without renaming it, if the new name is taken', async () => {
      const phone = await makeDevice('phone', { orgName: 'Personal' })
      const setlist = await addSetlist(phone, { name: 'Harvest' })
      await syncDevice(phone)
      await makeDevice('tablet', { orgName: 'Simon Davy' }) // creates that folder

      await renameOrganisation(phone, 'Simon Davy')
      await editSetlist(phone, setlist.id, { name: 'Harvest edited' })
      await syncDevice(phone)

      expect(
        orgFolders()
          .map(f => f.name)
          .sort()
      ).to.deep.equal(['Personal', 'Simon Davy'])
      expect(driveSetlist(setlist.id).name).to.equal('Harvest edited')
    })

    it('joins an existing folder with the new name if nothing was synced yet', async () => {
      // e.g. a new browser syncs while still "Personal", then is renamed to the
      // Google account's name, which another device already syncs with
      const tablet = await makeDevice('tablet', { orgName: 'Simon Davy' })
      const theirs = await addSetlist(tablet, { name: 'From tablet' })
      await syncDevice(tablet)
      const phone = await makeDevice('phone', { orgName: 'Personal' })
      await syncDevice(phone) // linked to an empty "Personal" folder

      await renameOrganisation(phone, 'Simon Davy')
      await syncDevice(phone)

      expect(must(await phone.db.getSetlist(theirs.id)).name).to.equal('From tablet')
      expect(phone.folderLink.value).to.equal(drive.findByPath(['Chordless', 'Simon Davy']).id)
    })

    it('stops before changing anything if records belong to another folder', async () => {
      // A device from before folders were linked: sync found the folder by name,
      // so renaming its organisation pointed it at a different folder, and
      // everything looked "missing" and was uploaded again (6 October 2026).
      const noLink = { get: async () => null, set: async () => {} }
      const phone = await makeDevice('phone', { orgName: 'Personal', folderLink: noLink })
      await addSetlist(phone, { name: 'Mine' })
      await syncDevice(phone)
      const tablet = await makeDevice('tablet', { orgName: 'Simon Davy' })
      await addSetlist(tablet, { name: 'Theirs' })
      await syncDevice(tablet)
      drive.requests = []

      await renameOrganisation(phone, 'Simon Davy')
      let error
      try {
        await phone.sync.sync()
      } catch (e) {
        error = e
      }

      expect(error?.name).to.equal('OrganisationFolderMismatchError')
      expect(drive.requests.filter(r => r.method !== 'GET')).to.deep.equal([])
      expect((await phone.db.getAllSetlists()).map(s => s.name)).to.deep.equal(['Mine'])
    })

    it('stops instead of creating a new folder if the linked one is in the trash', async () => {
      const phone = await makeDevice('phone', { orgName: 'Personal' })
      await addSetlist(phone)
      await syncDevice(phone)
      drive.files.get(drive.findByPath(['Chordless', 'Personal']).id).trashed = true

      let error
      try {
        await renameOrganisation(phone, 'Personal')
      } catch (e) {
        error = e
      }

      expect(error?.message).to.match(/in the Drive trash/)
      expect(orgFolders()).to.deep.equal([])
    })
  })

  describe('organisation members', () => {
    it("caches the people the organisation's folder is shared with", async () => {
      const phone = await makeDevice('phone')
      const folder = drive.findByPath(['Chordless', ORG_NAME])
      drive.addPermission(folder.id, {
        emailAddress: 'simon@example.com',
        displayName: 'Simon Davy',
        role: 'owner',
      })
      drive.addPermission(folder.id, {
        emailAddress: 'ann@example.com',
        displayName: 'Ann Smith',
        role: 'writer',
      })
      drive.addPermission(folder.id, { type: 'anyone', role: 'reader' })

      await syncDevice(phone)

      expect(phone.memberCache.value).to.deep.equal([
        { email: 'simon@example.com', name: 'Simon Davy', role: 'owner' },
        { email: 'ann@example.com', name: 'Ann Smith', role: 'writer' },
      ])
    })

    it('still syncs if the members cannot be fetched', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Synced anyway' })
      drive.failRequests({ method: 'GET', path: /\/permissions/ })

      await syncDevice(phone)

      expect(driveSetlist(setlist.id).name).to.equal('Synced anyway')
      expect(phone.memberCache.value).to.equal(null)
    })
  })

  describe('a user who can only read the folder', () => {
    const writes = () => drive.requests.filter(r => r.method !== 'GET' && r.method !== 'HEAD')

    it('downloads what is in Drive, uploads nothing, and does not fail', async () => {
      const leader = await makeDevice('leader')
      const setlist = await addSetlist(leader, { name: 'Sunday' })
      await syncDevice(leader)

      drive.readOnly = true
      const member = await makeDevice('member')
      const local = await addSetlist(member, { name: 'Only here' })
      drive.requests.length = 0
      await syncDevice(member)

      expect(await member.db.getSetlist(setlist.id)).to.include({ name: 'Sunday' })
      expect(writes()).to.deep.equal([])
      expect(driveSetlistFiles().map(file => JSON.parse(file.content).name)).to.deep.equal([
        'Sunday',
      ])
      expect(member.memberCache.readOnly).to.equal(true)
      // Kept on the device
      expect(must(await member.db.getSetlist(local.id)).name).to.equal('Only here')
    })

    it('does not push when asked to push directly either', async () => {
      const member = await makeDevice('member')
      await addSetlist(member, { name: 'Only here' })
      drive.readOnly = true
      drive.requests.length = 0
      await member.sync.pushToDrive()
      expect(writes()).to.deep.equal([])
    })

    it('is found out by a refused upload when the first check could not be made', async () => {
      const member = await makeDevice('member')
      const local = await addSetlist(member, { name: 'Only here' })
      drive.readOnly = true
      drive.requests.length = 0
      // The check fails once, so the sync goes ahead and tries to upload
      drive.failRequests({ method: 'GET', path: /capabilities/, times: 1 })
      await syncDevice(member)

      expect(writes().length).to.be.greaterThan(0)
      expect(writes().every(request => request.failed === 403)).to.equal(true)
      expect(member.memberCache.readOnly).to.equal(true)
      expect(driveSetlistFiles()).to.have.length(0)
      expect(must(await member.db.getSetlist(local.id)).name).to.equal('Only here')
    })

    it('does not take a failing upload for a reader', async () => {
      const member = await makeDevice('member')
      await addSetlist(member, { name: 'Writer' })
      drive.failRequests({ method: 'POST', path: /^\/upload\//, status: 500, times: 50 })
      await syncDevice(member)
      expect(member.memberCache.readOnly).to.equal(false)
    })

    it('uploads again once the user is given write access', async () => {
      const member = await makeDevice('member')
      const local = await addSetlist(member, { name: 'Waiting' })
      drive.readOnly = true
      await syncDevice(member)
      expect(driveSetlistFiles()).to.have.length(0)

      drive.readOnly = false
      await syncDevice(member)
      expect(driveSetlist(local.id).name).to.equal('Waiting')
      expect(member.memberCache.readOnly).to.equal(false)
    })
  })

  describe('reset from Drive', () => {
    async function resetError(
      device
    ): Promise<(Error & { unsynced: { id: string; type: string }[] }) | null> {
      try {
        await device.sync.resetLocalFromDrive()
      } catch (error) {
        return error as Error & { unsynced: { id: string; type: string }[] }
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
      expect(must(await phone.db.getSetlist(keep.id)).driveFileId).to.be.a('string')
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

      expect(must(await phone.db.getSetlist(fromTablet.id)).name).to.equal('From tablet')
    })

    it('changes nothing if a setlist was edited since its last sync', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Unsynced edit' })

      const error = await resetError(phone)

      expect(error?.name).to.equal('UnsyncedChangesError')
      expect(must(error).unsynced.map(u => u.id)).to.deep.equal([setlist.id])
      expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Unsynced edit')
    })

    it('changes nothing if a setlist was never uploaded', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Local only' })

      const error = await resetError(phone)

      expect(error?.name).to.equal('UnsyncedChangesError')
      expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Local only')
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
      await phone.db.saveSong(
        makeSong({ uuid: 'song-1', id: 'title-a', title: 'A', chordproFileId })
      )
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
      expect(must(await phone.db.getChordPro(chordproFileId)).content).to.equal('v2')
    })

    it('changes nothing if Drive cannot be listed', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Safe' })
      await syncDevice(phone)
      drive.failRequests({ method: 'GET', path: /files\(id,name,mimeType\)&pageSize/ })

      const error = await resetError(phone)

      expect(error?.message).to.match(/nothing was changed/)
      expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Safe')
    })

    it('keeps per-setlist device preferences', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone)
      await syncDevice(phone)
      await phone.db.saveLocalState(Object.assign(makeLocalState(setlist.id), { marker: 'kept' }))

      await phone.sync.resetLocalFromDrive()

      expect(
        ((await phone.db.getLocalState(setlist.id)) as SetlistLocalState & { marker?: string })
          .marker
      ).to.equal('kept')
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

    it('does not upload a copy of a song whose Drive file was replaced by another', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: 'v1' })
      await syncDevice(phone)
      await syncDevice(tablet)
      const known = must(await tablet.db.getSong('song-1')).driveFileId
      replaceDriveFile(must(known), 'survivor')
      const filesBefore = drive.listFiles(f => f.appProperties.songId || f.appProperties.versionId)
      drive.requests = []

      await syncDevice(tablet)

      expect(drive.requests.filter(r => r.method !== 'GET')).to.deep.equal([])
      expect(
        drive.listFiles(f => f.appProperties.songId || f.appProperties.versionId)
      ).to.have.length(filesBefore.length)
    })

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

    it("gives a downloaded song the chart's fields, as an imported one, with its tempo a number", async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n{key: D}\n{tempo: 150 (1/8)}\n{artist: John Newton}\n[D]Grace',
      })
      await syncDevice(phone)
      await syncDevice(tablet)

      const song = await tablet.db.getSong('song-1')
      expect(song).to.include({
        key: 'D',
        originalKey: 'D',
        tempo: 150,
        originalTempo: 150,
        author: 'John Newton',
      })
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
        const song = must(await phone.db.getSong(uuid))
        expect(drive.files.get(song.driveFileId).content).to.equal(await songContent(phone, uuid))
      }
    })

    it('uploads a chart edit even if its stored contentHash is stale', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: 'v1' })
      await syncDevice(phone)

      const song = must(await phone.db.getSong('song-1'))
      const chart = must(await phone.db.getChordPro(song.chordproFileId))
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

    it('creates and updates song files with the metadata from drive-metadata.js', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: '{title: Amazing}' })
      await syncDevice(phone)
      const file = () => drive.listFiles(f => f.appProperties.type === 'chordpro')[0]
      const expected = async () => {
        const song = must(await phone.db.getSong('song-1'))
        const chart = await phone.db.getChordPro(song.chordproFileId)
        return songFileMetadata(song, chart, { organisationId: ORG_ID }).appProperties
      }
      expect(file().appProperties).to.deep.equal(await expected())

      // A variant change only shows in appProperties, so updates must send them
      const song = must(await phone.db.getSong('song-1'))
      await phone.db.saveSong({ ...song, isDefault: false, variantOf: 'song-0' })
      await editSongContent(phone, 'song-1', '{title: Amazing}\n[G]edited')
      await syncDevice(phone)

      expect(file().appProperties.isDefault).to.equal('false')
      expect(file().appProperties).to.deep.equal(await expected())
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
