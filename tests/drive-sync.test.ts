import { expect } from '@open-wc/testing'
import type { Setlist } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { setlistFileMetadata } from '../src/js/drive-metadata.ts'
import { setlistHasLocalChanges } from '../src/js/sync/changes.ts'
import { SyncManager } from '../src/js/sync-manager.ts'
import { addSong, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs, TEST_SPACE } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

describe('sync (against the memory backend)', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, editSetlist, syncDevice, driveSetlistFiles, driveSetlist } = rig

  describe('setlists', () => {
    it('uploads a new local setlist into the space setlists folder', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Harvest' })

      await syncDevice(phone)

      const [file] = driveSetlistFiles()
      expect(file.collection).to.equal('setlists')
      expect(file.root).to.equal(must(rig.storage.rootNamed(TEST_SPACE.name)).ref)
      expect(file.props.setlistId).to.equal(setlist.id)
      expect(driveSetlist(setlist.id).name).to.equal('Harvest')

      const local = must(await phone.db.getSetlist(setlist.id))
      expect(local.fileRef).to.equal(file.ref)
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
      const [file] = rig.storage.list(f => f.props.setlistId === setlist.id)
      rig.storage.edit(file.ref, file.content.replace('"tempo": 72', '"tempo": "72"'))
      expect(driveSetlist(setlist.id).songs[0].tempo).to.equal('72')

      await syncDevice(tablet)
      const onTablet = must(await tablet.db.getSetlist(setlist.id))
      expect(onTablet.songs[0].tempo).to.equal(72)
      expect(setlistHasLocalChanges(onTablet)).to.equal(false)

      rig.storage.clearCalls()
      await syncDevice(tablet)
      expect(rig.storage.writes()).to.deep.equal([])
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
      rig.storage.clearCalls()

      await syncDevice(phone)

      expect(rig.storage.writes()).to.deep.equal([])
    })

    it('never removes files when the local database is empty', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Keep me' })
      await syncDevice(phone)

      await phone.db.clearAll()
      await syncDevice(phone)

      expect(driveSetlist(setlist.id).name).to.equal('Keep me')
      expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Keep me')
      expect(driveSetlistFiles()).to.have.length(1)
    })

    it('removes a setlist whose Drive file was deleted elsewhere', async () => {
      // Deleting a file in the Drive UI sticks: a device with an unedited copy drops it
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Deleted' })
      await syncDevice(phone)

      rig.storage.remove(driveSetlistFiles()[0].ref)
      await syncDevice(phone)

      expect(await phone.db.getSetlist(setlist.id)).to.not.be.ok
      expect(driveSetlistFiles()).to.have.length(0)
    })
  })

  describe('file metadata', () => {
    const fileFor = id => rig.storage.list(f => f.props.setlistId === id)[0]

    it('creates and updates setlist files with the metadata from drive-metadata.js', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Harvest', owner: 'Ann' })
      await syncDevice(phone)
      const expected = () => setlistFileMetadata(setlist, { spaceId: TEST_SPACE.id }).appProperties

      expect(fileFor(setlist.id).props).to.deep.equal(expected())

      await editSetlist(phone, setlist.id, { name: 'Harvest Festival' })
      await syncDevice(phone)
      expect(fileFor(setlist.id).props).to.deep.equal(expected())
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
      Object.assign(fileFor(setlist.id).props, {
        resourceType: 'setlist',
        organisationId: 'old-id',
        leader: '',
        date: '2020-01-01',
      })

      await editSetlist(phone, setlist.id, { name: 'Old file, edited' })
      await syncDevice(phone)

      expect(Object.keys(fileFor(setlist.id).props).sort()).to.deep.equal([
        'appVersion',
        'setlistId',
        'spaceId',
      ])
    })
  })

  describe('conflicts: same setlist edited on two rig.devices', () => {
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
      rig.storage.clockOffsetMs = -5 * 60 * 1000 // server 5 min behind = rig.devices 5 min ahead
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
      rig.storage.clockOffsetMs = 5 * 60 * 1000 // server 5 min ahead = rig.devices 5 min behind
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
      rig.storage.file(file.ref).modified = new Date(Date.now() + 60_000).toISOString()
      rig.storage.file(file.ref).props.note = 'changed elsewhere'
      rig.storage.clearCalls()

      await syncDevice(phone)

      expect(rig.storage.calls.filter(c => c.op === 'readText')).to.deep.equal([])
      expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Original')
    })

    it('does not upload an edit that was undone', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Changed' })
      await editSetlist(phone, setlist.id, { name: 'Original' })
      rig.storage.clearCalls()

      await syncDevice(phone)

      expect(rig.storage.writes()).to.deep.equal([])
    })

    it('keeps device sync state out of the copy in Drive', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Clean' })
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Clean edit' })
      await syncDevice(phone)

      const onDrive = driveSetlist(setlist.id)
      for (const field of ['fileRef', 'fileModified', 'lastSyncedAt', 'syncedContentHash']) {
        expect(onDrive, field).not.to.have.property(field)
      }
    })

    it('syncs setlists recorded before content hashes', async () => {
      // Records synced by the previous version have no syncedContentHash or
      // fileRev, and a fileModified taken from the device clock.
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Old record' })
      await syncDevice(phone)
      const stored = must(await phone.db.getSetlist(setlist.id))
      delete stored.syncedContentHash
      delete stored.fileRev
      stored.fileModified = new Date().toISOString()
      stored._lastSyncHash = 'hash-from-old-version'
      await phone.db.saveSetlist(stored)
      rig.storage.clearCalls()

      await syncDevice(phone)
      expect(rig.storage.writes()).to.deep.equal([])
      expect(must(await phone.db.getSetlist(setlist.id)).syncedContentHash).to.be.a('string')

      await editSetlist(phone, setlist.id, { name: 'Old record, edited' })
      await syncDevice(phone)
      expect(driveSetlist(setlist.id).name).to.equal('Old record, edited')
    })
  })

  describe("after the device's database was migrated from before the file fields were renamed", () => {
    const OLD_NAMES = {
      fileRef: 'driveFileId',
      fileRev: 'driveChecksum',
      fileModified: 'driveModifiedTime',
      fileProps: 'driveProperties',
    }
    const asBefore = (record: object) =>
      Object.fromEntries(
        Object.entries(record).map(([key, value]) => [OLD_NAMES[key] ?? key, value])
      )
    let migratedName = ''

    afterEach(() => deleteDatabase(migratedName))

    it('syncs as before: the same files, nothing uploaded again, nothing taken for an edit', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 's1', title: 'One', content: '{title: One}\n[G]One' })
      const setlist = await addSetlist(phone, { name: 'Sunday' })
      await syncDevice(phone)
      const filesBefore = rig.storage.list().map(file => [file.ref, file.rev])
      const fileRefBefore = must(await phone.db.getSetlist(setlist.id)).fileRef

      // The same records as a version 6 database kept them, opened by the new code
      migratedName = `test-migrated-${crypto.randomUUID()}`
      const songs = await phone.db.getAllSongs()
      const charts = await Promise.all(
        songs.map(async song => must(await phone.db.getChordPro(song.chordproFileId)))
      )
      const setlists = await phone.db.getAllSetlists()
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(migratedName, 6)
        request.onupgradeneeded = () => {
          const db = request.result
          db.createObjectStore('songs', { keyPath: 'uuid' }).createIndex('id', 'id')
          db.createObjectStore('chordpro', { keyPath: 'id' })
          db.createObjectStore('setlists', { keyPath: 'id' })
          db.createObjectStore('setlist_local', { keyPath: 'setlistId' })
        }
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(['songs', 'chordpro', 'setlists'], 'readwrite')
          for (const song of songs) tx.objectStore('songs').put(asBefore(song))
          for (const chart of charts) tx.objectStore('chordpro').put(chart)
          for (const each of setlists) tx.objectStore('setlists').put(asBefore(each))
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
      const db = new ChordlessDB(migratedName)
      await db.init()
      const migrated = must(await db.getSetlist(setlist.id))
      expect(migrated.fileRef).to.equal(fileRefBefore)
      expect(setlistHasLocalChanges(migrated)).to.equal(false)

      const sync = await SyncManager.open(TEST_SPACE.name, TEST_SPACE.id, {
        db,
        folderLink: phone.folderLink,
        memberCache: phone.memberCache,
        storage: rig.storage,
      })
      await sync.init()
      rig.storage.clearCalls()
      await sync.sync()

      expect(rig.storage.writes()).to.deep.equal([])
      expect(rig.storage.list().map(file => [file.ref, file.rev])).to.deep.equal(filesBefore)
      expect((await db.getAllSetlists()).length).to.equal(1)
      expect((await db.getAllSongs()).length).to.equal(1)
      db.db?.close()
    })
  })
})
