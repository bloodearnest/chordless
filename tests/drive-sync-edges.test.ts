/**
 * The less common turns of a Drive sync: records from before checksums, files replaced or edited in
 * Drive, charts that are copies, and what the sync says as it goes. (The main paths are in the
 * other drive-sync files.)
 */
import { expect } from '@open-wc/testing'
import type { ChordProRecord, SongRecord } from '../src/js/data-types.ts'
import type { ChordlessDB } from '../src/js/db.ts'
import {
  DriveSyncManager,
  isSyncAvailable,
  OrganisationFolderMismatchError,
  type SyncProgress,
  UnsyncedChangesError,
} from '../src/js/drive-sync.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
} from '../src/js/organisation.ts'
import { OrganisationDB } from '../src/js/organisation-db.ts'
import {
  driveMarkers,
  setlistHasLocalChanges,
  setlistIdOf,
  songHasLocalChanges,
  songUuidOf,
} from '../src/js/sync/changes.ts'
import { driveSongUuid, pullSetlists, pullSongs, titleFromFilename } from '../src/js/sync/pull.ts'
import { pushSetlist, pushSongVariant, songNeedsSync } from '../src/js/sync/push.ts'
import { makeSetlist, makeSong } from './builders.ts'
import { addSong, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, TEST_ORG } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('Drive sync: the less common turns', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, editSetlist, syncDevice, replaceDriveFile } = rig

  const driveFileOf = async (device: { db: ChordlessDB }, setlistId: string) =>
    must(must(await device.db.getSetlist(setlistId)).driveFileId)

  describe('a manager that is not ready', () => {
    it('says it has not been initialised, whatever it is asked', async () => {
      const sync = new DriveSyncManager('Church', null)
      for (const ask of [
        () => sync.hasSyncedRecords(),
        () => sync.resolveDriveFolder(),
        () => sync.songsFolder(),
      ]) {
        let message = ''
        try {
          await ask()
        } catch (error) {
          message = (error as Error).message
        }
        expect(message).to.match(/not initialised|not known yet/)
      }
    })
  })

  describe('the errors it throws', () => {
    it('lists the first five unsynced changes, and counts the rest', () => {
      const changes = Array.from({ length: 7 }, (_, i) => ({
        type: 'song' as const,
        id: `s${i}`,
        label: i === 0 ? '' : `Song ${i}`,
      }))
      const error = new UnsyncedChangesError(changes)
      expect(error.message).to.contain('7 local change(s)')
      expect(error.message).to.contain('song s0, song Song 1')
      expect(error.message).to.contain('and 2 more')
      expect(error.unsynced).to.have.length(7)
      expect(new UnsyncedChangesError(changes.slice(0, 2)).message).to.not.contain('more')
    })

    it('names the folder and the count when records belong to another folder', () => {
      const error = new OrganisationFolderMismatchError(3, 'Church')
      expect(error.name).to.equal('OrganisationFolderMismatchError')
      expect(error.message).to.contain('3 setlist(s)/song(s)')
      expect(error.message).to.contain('"Church"')
    })
  })

  describe('records from before checksums were kept', () => {
    it('are judged by their dates', () => {
      const base = makeSetlist({ id: 's', driveFileId: 'f', modifiedDate: '2026-10-05T10:00:00Z' })
      expect(setlistHasLocalChanges({ ...base, driveFileId: null })).to.equal(true)
      // never synced by the clock, so edited
      expect(setlistHasLocalChanges(base)).to.equal(true)
      expect(setlistHasLocalChanges({ ...base, lastSyncedAt: '2026-10-06T10:00:00Z' })).to.equal(
        false
      )
      expect(setlistHasLocalChanges({ ...base, lastSyncedAt: '2026-10-01T10:00:00Z' })).to.equal(
        true
      )
    })

    it('are judged by their dates and hashes, for a song', () => {
      const song = makeSong({
        driveFileId: 'f',
        modifiedDate: '2026-10-05T10:00:00Z',
      }) as never as SongRecord
      const chart = (extra: object = {}) =>
        ({ id: 'c', content: 'x', contentHash: 'h1', lastModified: 0, ...extra }) as ChordProRecord
      expect(songHasLocalChanges({ ...song, driveFileId: null }, chart())).to.equal(true)
      // synced, the chart edited since by its own date
      expect(
        songHasLocalChanges(
          {
            ...song,
            lastSyncedAt: '2026-10-01T10:00:00Z',
            driveProperties: { contentHash: 'h0' } as never,
          },
          chart({ lastModified: new Date('2026-10-06T10:00:00Z').getTime() })
        )
      ).to.equal(true)
      // ...unless its hash is the one Drive has
      expect(
        songHasLocalChanges(
          {
            ...song,
            lastSyncedAt: '2026-10-01T10:00:00Z',
            driveProperties: { contentHash: 'h1' } as never,
          },
          chart({ lastModified: new Date('2026-10-06T10:00:00Z').getTime() })
        )
      ).to.equal(false)
      // no date on the chart: the song's own is used
      expect(
        songHasLocalChanges(
          { ...song, lastSyncedAt: '2026-10-06T10:00:00Z' },
          chart({ lastModified: 0 })
        )
      ).to.equal(false)
      expect(
        songHasLocalChanges({ ...song, lastSyncedAt: null }, chart({ lastModified: 0 }))
      ).to.equal(true)
    })
  })

  describe('a setlist file replaced in Drive', () => {
    async function twoDevices() {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone, { name: 'Original' })
      await syncDevice(phone)
      await syncDevice(tablet)
      const old = await driveFileOf(tablet, setlist.id)
      replaceDriveFile(old, 'replacement')
      return { phone, tablet, setlist }
    }

    it('is taken over by a device that had not changed the setlist, keeping its content', async () => {
      const { tablet, setlist } = await twoDevices()
      await syncDevice(tablet)
      const kept = must(await tablet.db.getSetlist(setlist.id))
      expect(kept.driveFileId).to.equal('replacement')
      expect(kept.name).to.equal('Original')
      expect(kept.syncedContentHash).to.be.a('string')
    })

    it('is taken over by a device that edited the setlist, keeping the edit to be uploaded', async () => {
      const { tablet, setlist } = await twoDevices()
      await editSetlist(tablet, setlist.id, { name: 'Edited here' })
      await syncDevice(tablet)
      expect(must(await tablet.db.getSetlist(setlist.id)).name).to.equal('Edited here')
      const [file] = rig.driveSetlistFiles()
      expect(JSON.parse(file.content).name).to.equal('Edited here')
    })

    it('is taken over with what Drive has when it changed and this device did not', async () => {
      const { tablet, setlist } = await twoDevices()
      const file = must(rig.drive.files.get('replacement'))
      rig.drive.editContent(
        'replacement',
        JSON.stringify({ ...JSON.parse(file.content), name: 'Edited in Drive' })
      )
      await syncDevice(tablet)
      expect(must(await tablet.db.getSetlist(setlist.id)).name).to.equal('Edited in Drive')
    })
  })

  describe('a setlist deleted in Drive', () => {
    it('is removed here too, and the sync says so', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone)
      await syncDevice(phone)
      rig.drive.files.delete(await driveFileOf(phone, setlist.id))
      const said: SyncProgress[] = []
      await phone.sync.sync(progress => said.push(progress))
      expect(await phone.db.getSetlist(setlist.id)).to.equal(undefined)
      expect(
        said.some(progress =>
          /Removed 1 setlists that were deleted in Drive/.test(progress.message)
        )
      ).to.equal(true)
    })
  })

  describe('the Drive folder link', () => {
    it('is kept in the organisation, and a failure to keep it is only a warning', async () => {
      const before = getCurrentOrganisation()
      const organisation = await createOrganisation(`Link ${crypto.randomUUID().slice(0, 8)}`)
      await setCurrentOrganisation(organisation.id, organisation.name)
      const realUpdate = OrganisationDB.prototype.updateOrganisation
      OrganisationDB.prototype.updateOrganisation = () => Promise.reject(new Error('read only'))
      try {
        const sync = new DriveSyncManager(organisation.name, organisation.id)
        await sync.init()
        expect(sync.driveFolderId).to.be.a('string')
        sync.organisationDb?.db?.close()
      } finally {
        OrganisationDB.prototype.updateOrganisation = realUpdate
      }
      // Kept for real, the next manager finds the folder by the link
      const again = new DriveSyncManager(organisation.name, organisation.id)
      await again.init()
      const linked = again.driveFolderId
      expect(await again.hasSyncedRecords()).to.equal(false)
      again.organisationDb?.db?.close()
      const third = new DriveSyncManager(organisation.name, organisation.id)
      await third.init()
      expect(third.driveFolderId).to.equal(linked)
      third.organisationDb?.db?.close()
      await deleteOrganisation(organisation.id)
      if (before.id) await setCurrentOrganisation(before.id, before.name)
    })
  })

  describe('songs, as they are told', () => {
    it('says what it reports when there are no charts in Drive at all', async () => {
      const phone = await makeDevice('phone')
      const said: string[] = []
      await pullSongs(phone.sync, progress => said.push(progress.message))
      expect(said).to.deep.equal(['No songs found in Drive'])
    })

    it('keeps the newest of two charts for one song, whichever comes first', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })
      await syncDevice(phone)
      const [original] = rig.drive.listFiles(file => file.appProperties.type === 'chordpro')
      const copy = {
        ...original,
        id: 'copy',
        content: '{title: Amazing}\n[G]Grace, copied',
        modifiedTime: '2099-01-01T00:00:00Z',
      }
      rig.drive.files.set('copy', copy)
      const older = { ...original, id: 'older', modifiedTime: '2000-01-01T00:00:00Z' }
      rig.drive.files.set('older', older)
      const same = { ...original, id: 'same' }
      rig.drive.files.set('same', same)
      await syncDevice(tablet)
      const song = must(await tablet.db.getSong('song-1'))
      expect(song.driveFileId).to.equal('copy')
    })

    it('leaves a file that is not a chart alone', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })
      await syncDevice(phone)
      const [chart] = rig.drive.listFiles(file => file.appProperties.type === 'chordpro')
      rig.drive.files.set('other', {
        ...chart,
        id: 'other',
        appProperties: { ...chart.appProperties, type: 'notes', songUuid: 'other-song' },
      })
      const tablet = await makeDevice('tablet')
      await syncDevice(tablet)
      expect(await tablet.db.getSong('other-song')).to.equal(undefined)
    })

    it('keeps this device’s edits when Drive’s file is the one it last synced, and notes the checksum', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })
      await syncDevice(phone)
      const song = must(await phone.db.getSong('song-1'))
      // as if its checksum was never recorded
      await phone.db.saveSong({ ...song, driveChecksum: 'old' })
      await syncDevice(phone)
      expect(must(await phone.db.getSong('song-1')).driveChecksum).to.not.equal('old')
    })

    it('lets Drive win when a song was changed both here and in Drive', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })
      await syncDevice(phone)
      const song = must(await phone.db.getSong('song-1'))
      const chart = must(await phone.db.getChordPro(song.chordproFileId))
      await phone.db.saveChordPro({ ...chart, content: '{title: Amazing}\n[G]Edited here' })
      const [file] = rig.drive.listFiles(each => each.appProperties.type === 'chordpro')
      rig.drive.editContent(file.id, '{title: Amazing}\n[G]Edited in Drive')
      await pullSongs(phone.sync)
      const after = must(await phone.db.getChordPro(song.chordproFileId))
      expect(after.content).to.contain('Edited in Drive')
    })
  })

  describe('what it says as it goes', () => {
    const said = () => {
      const messages: string[] = []
      return { messages, callback: (progress: SyncProgress) => messages.push(progress.message) }
    }

    it('reports the setlists and songs it uploads and downloads, and when there is nothing to do', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSetlist(phone, { name: 'Reported' })
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })
      const up = said()
      await phone.sync.sync(up.callback)
      expect(up.messages).to.include('Starting sync...')
      expect(up.messages).to.include('Uploading 1 setlists...')
      expect(up.messages).to.include('Uploading 1 songs...')
      expect(up.messages.at(-1)).to.equal('Sync complete!')

      const down = said()
      await tablet.sync.sync(down.callback)
      expect(down.messages).to.include('Downloading 1 setlists...')
      expect(down.messages).to.include('Downloaded 1/1 setlists')
      expect(down.messages).to.include('Downloading 1 songs...')
      expect(down.messages).to.include('Downloaded 1/1 songs')

      const again = said()
      await tablet.sync.sync(again.callback)
      expect(again.messages).to.include('Setlists already up to date')
      expect(again.messages).to.include('Songs already up to date')
    })

    it('reports the updates it makes to setlists and songs', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone)
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Changed' })
      const song = must(await phone.db.getSong('song-1'))
      const chart = must(await phone.db.getChordPro(song.chordproFileId))
      await phone.db.saveChordPro({
        ...chart,
        content: '{title: Amazing}\n[G]Grace changed',
        contentHash: 'new',
      })
      const update = said()
      await phone.sync.sync(update.callback)
      expect(update.messages.some(message => /^Uploaded 1\/1 setlists/.test(message))).to.equal(
        true
      )
      expect(
        update.messages.some(message => /^Uploaded 1\/1 song variants/.test(message))
      ).to.equal(true)
    })

    it('says a sync failed, with why, and fails', async () => {
      const phone = await makeDevice('phone')
      rig.drive.failRequests({ status: 500, times: 100 })
      const failed = said()
      let error: Error | null = null
      try {
        await phone.sync.sync(failed.callback)
      } catch (caught) {
        error = caught as Error
      }
      expect(error).to.not.equal(null)
      expect(failed.messages.at(-1)).to.match(/^Sync failed: /)
    })

    it('says a failure that is not an Error as it is', async () => {
      const phone = await makeDevice('phone')
      phone.sync.refreshMembers = async () => {
        throw 'plain failure'
      }
      const failed = said()
      try {
        await phone.sync.sync(failed.callback)
      } catch {
        // (expected)
      }
      expect(failed.messages.at(-1)).to.equal('Sync failed: plain failure')
    })
  })

  describe('with a Drive that has many files', () => {
    it('follows the pages of charts', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      for (let i = 0; i < 4; i++) {
        await addSong(phone, {
          uuid: `song-${i}`,
          title: `Song ${i}`,
          content: `{title: Song ${i}}\n[G]Words ${i}`,
        })
      }
      await syncDevice(phone)
      rig.drive.maxPageSize = 2
      await syncDevice(tablet)
      expect(await tablet.db.getAllSongs()).to.have.length(4)
    })
  })

  describe('songs that are not where they were', () => {
    it('are downloaded again when this device lost the chart', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })
      await syncDevice(phone)
      const song = must(await phone.db.getSong('song-1'))
      await new Promise<void>((resolve, reject) => {
        const request = must(phone.db.db)
          .transaction('chordpro', 'readwrite')
          .objectStore('chordpro')
          .delete(song.chordproFileId)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
      await syncDevice(phone)
      expect(must(await phone.db.getChordPro(song.chordproFileId)).content).to.contain('Grace')
    })

    it('are uploaded again when their Drive file is gone', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, {
        uuid: 'song-1',
        title: 'Amazing',
        content: '{title: Amazing}\n[G]Grace',
      })
      await syncDevice(phone)
      const [file] = rig.drive.listFiles(each => each.appProperties.type === 'chordpro')
      rig.drive.files.delete(file.id)
      await syncDevice(phone)
      const [again] = rig.drive.listFiles(each => each.appProperties.type === 'chordpro')
      expect(again.id).to.not.equal(file.id)
      expect(must(await phone.db.getSong('song-1')).driveFileId).to.equal(again.id)
    })

    it('are left out of an upload when their chart is not here, and when they have none', async () => {
      const phone = await makeDevice('phone')
      await phone.db.saveSong(
        makeSong({ uuid: 'no-chart', id: 'title-no-chart', chordproFileId: 'missing' })
      )
      await phone.db.saveSong(makeSong({ uuid: 'blank', id: 'title-blank', chordproFileId: '' }))
      await syncDevice(phone)
      expect(rig.drive.listFiles(each => each.appProperties.type === 'chordpro')).to.have.length(0)
    })

    it('are uploaded one by one when saving them all together fails', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'One', content: '{title: One}\n[G]One' })
      await addSong(phone, { uuid: 'song-2', title: 'Two', content: '{title: Two}\n[G]Two' })
      const real = phone.db.saveSongsBatch.bind(phone.db)
      let failed = false
      phone.db.saveSongsBatch = async songs => {
        if (!failed) {
          failed = true
          throw new Error('disk full')
        }
        return real(songs)
      }
      await syncDevice(phone)
      expect(rig.drive.listFiles(each => each.appProperties.type === 'chordpro')).to.have.length(2)
    })

    it('are left for the next sync when they cannot be uploaded one by one either', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'One', content: '{title: One}\n[G]One' })
      phone.db.saveSongsBatch = async () => {
        throw new Error('disk full')
      }
      const real = phone.db.saveSong.bind(phone.db)
      phone.db.saveSong = async song => {
        if (song.driveFileId) throw new Error('still full')
        return real(song)
      }
      await syncDevice(phone)
    })

    it('say Drive kept other content than it was sent, and are sent again', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'One', content: '{title: One}\n[G]One' })
      rig.drive.corruptUploads = 1
      await syncDevice(phone)
      expect(must(await phone.db.getSong('song-1')).syncedContentHash).to.equal(undefined)
      rig.drive.requests = []
      await syncDevice(phone)
      expect(rig.drive.requests.some(request => request.method === 'PATCH')).to.equal(true)
      expect(must(await phone.db.getSong('song-1')).syncedContentHash).to.be.a('string')
    })
  })

  describe('setlists that cannot be uploaded in a batch', () => {
    it('are uploaded one by one, and one that cannot is left for the next sync', async () => {
      const phone = await makeDevice('phone')
      await addSetlist(phone, { id: 'a', name: 'A' })
      await addSetlist(phone, { id: 'b', name: 'B' })
      phone.db.saveSetlistsBatch = async () => {
        throw new Error('disk full')
      }
      const real = phone.db.saveSetlist.bind(phone.db)
      phone.db.saveSetlist = async setlist => {
        if (setlist.id === 'b' && setlist.driveFileId) throw new Error('still full')
        return real(setlist)
      }
      await syncDevice(phone)
      expect(rig.driveSetlistFiles().length).to.be.greaterThan(0)
    })

    it('are updated even when some updates fail', async () => {
      const phone = await makeDevice('phone')
      await addSetlist(phone, { id: 'a', name: 'A' })
      await syncDevice(phone)
      await editSetlist(phone, 'a', { name: 'A again' })
      rig.drive.failRequests({ method: 'PATCH', path: /^\/upload\//, status: 500, times: 10 })
      const update = { messages: [] as string[] }
      await phone.sync.sync(progress => update.messages.push(progress.message))
      expect(update.messages.some(message => /^Uploaded 0\/1 setlists/.test(message))).to.equal(
        true
      )
    })
  })

  describe('shares', () => {
    it('never stop a sync when they cannot be synced', async () => {
      const phone = await makeDevice('phone')
      phone.db.getAllSetlists = async () => {
        throw new Error('unreadable')
      }
      expect(await phone.sync.syncShares()).to.equal(0)
    })
  })

  describe('the markers a record keeps of its Drive file', () => {
    it('are its modified time and checksum, or nothing when Drive gave none', () => {
      expect(driveMarkers({ id: 'f', modifiedTime: 't', md5Checksum: 'm' })).to.deep.equal({
        driveModifiedTime: 't',
        driveChecksum: 'm',
      })
      expect(driveMarkers({ id: 'f' })).to.deep.equal({
        driveModifiedTime: null,
        driveChecksum: null,
      })
      expect(driveMarkers(null)).to.deep.equal({ driveModifiedTime: null, driveChecksum: null })
    })
  })

  describe('whether sync is possible', () => {
    it('is when Drive can be reached with a token, and is not otherwise', async () => {
      expect(await isSyncAvailable()).to.equal(true)
      rig.drive.failRequests({ status: 401, times: 5 })
      expect(await isSyncAvailable()).to.equal(false)
    })
  })

  describe('songs that need uploading, from before the inventory', () => {
    it('are known to be missing from Drive once the inventory is built', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'One', content: '{title: One}\n[G]One' })
      await syncDevice(phone)
      const song = must(await phone.db.getSong('song-1'))
      const chart = must(await phone.db.getChordPro(song.chordproFileId))
      expect(await songNeedsSync(phone.sync, song, chart)).to.equal(false)
      await phone.sync.buildDriveInventory()
      rig.drive.files.delete(must(song.driveFileId))
      await phone.sync.buildDriveInventory()
      expect(await songNeedsSync(phone.sync, song, chart)).to.equal(true)
      expect(await songNeedsSync(phone.sync, { ...song, driveFileId: null }, chart)).to.equal(true)
    })
  })

  describe('the user’s access to the folder', () => {
    it('is still known to be view-only when it cannot be recorded', async () => {
      const phone = await makeDevice('phone')
      phone.memberCache.setReadOnly = async () => {
        throw new Error('cannot record')
      }
      rig.drive.readOnly = true
      expect(await phone.sync.refreshAccess()).to.equal(true)
    })

    it('is found out by a refused upload when the first check could not be made', async () => {
      const phone = await makeDevice('phone')
      await addSetlist(phone, { name: 'Mine' })
      await phone.sync.sync()
      await editSetlist(phone, (await phone.db.getAllSetlists())[0].id, { name: 'Edited' })
      rig.drive.failRequests({ method: 'GET', path: /capabilities/, times: 1 })
      rig.drive.readOnly = true
      await phone.sync.pushToDrive()
      expect(phone.sync.readOnly).to.equal(true)
    })
  })

  describe('setlists in Drive', () => {
    it('are skipped, and the pull is not trusted, when one cannot be looked up', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSetlist(phone, { name: 'There' })
      await syncDevice(phone)
      const real = tablet.db.getSetlist.bind(tablet.db)
      tablet.db.getSetlist = async () => {
        throw new Error('unreadable')
      }
      await pullSetlists(tablet.sync)
      expect(tablet.sync.pullIncomplete).to.equal(true)
      tablet.db.getSetlist = real
    })

    it('keep a record that was edited here, and note the new checksum, when Drive has what was synced', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Same' })
      await syncDevice(phone)
      const record = must(await phone.db.getSetlist(setlist.id))
      await phone.db.saveSetlist({ ...record, driveChecksum: 'out of date' })
      await pullSetlists(phone.sync)
      expect(must(await phone.db.getSetlist(setlist.id)).driveChecksum).to.not.equal('out of date')
    })

    it('say which could not be downloaded, and the pull is not trusted', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSetlist(phone, { name: 'There' })
      await syncDevice(phone)
      rig.drive.failRequests({ method: 'GET', path: /alt=media/, status: 500, times: 5 })
      await pullSetlists(tablet.sync)
      expect(tablet.sync.pullIncomplete).to.equal(true)
    })
  })

  describe('charts in Drive', () => {
    const chartFile = (id: string, content: string, appProperties: Record<string, string> = {}) => {
      const [template] = rig.drive.listFiles(each => each.appProperties.type === 'chordpro')
      rig.drive.files.set(id, {
        ...template,
        id,
        name: `${id}.cho`,
        content,
        modifiedTime: '2026-10-01T00:00:00Z',
        appProperties: { type: 'chordpro', ...appProperties },
      })
    }

    it('make a song with the id the chart gives, by its CCLI number or its title', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'seed', title: 'Seed', content: '{title: Seed}\n[G]Seed' })
      await syncDevice(phone)
      chartFile('with-ccli', '{title: Has CCLI}\n{ccli: 12345}\n[G]Words', { songUuid: 'u-ccli' })
      chartFile('with-title', '{title: Only A Title}\n[G]Words', { songUuid: 'u-title' })
      chartFile('with-nothing', '[G]No title at all', { songUuid: 'u-none' })
      const tablet = await makeDevice('tablet')
      await syncDevice(tablet)
      expect(must(await tablet.db.getSong('u-ccli')).id).to.equal('ccli-12345')
      expect(must(await tablet.db.getSong('u-title')).id).to.equal('title-onlyatitle')
      expect(must(await tablet.db.getSong('u-none')).title).to.equal('with-nothing')
    })

    it('say which could not be downloaded', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSong(phone, { uuid: 'song-1', title: 'One', content: '{title: One}\n[G]One' })
      await syncDevice(phone)
      rig.drive.failRequests({ method: 'GET', path: /alt=media/, status: 500, times: 5 })
      await pullSongs(tablet.sync)
      expect(await tablet.db.getSong('song-1')).to.equal(undefined)
    })
  })

  describe('uploading one at a time', () => {
    it('makes a file for a setlist or a song that has none', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Alone' })
      await addSong(phone, { uuid: 'song-1', title: 'One', content: '{title: One}\n[G]One' })
      const song = must(await phone.db.getSong('song-1'))
      const chart = must(await phone.db.getChordPro(song.chordproFileId))
      await pushSetlist(phone.sync, setlist)
      await pushSongVariant(phone.sync, song, chart)
      expect(rig.driveSetlistFiles()).to.have.length(1)
      expect(rig.drive.listFiles(each => each.appProperties.type === 'chordpro')).to.have.length(1)
    })

    it('says so when it cannot', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone)
      rig.drive.failRequests({ method: 'POST', path: /^\/upload\//, status: 500, times: 5 })
      let failed = false
      try {
        await pushSetlist(phone.sync, setlist)
      } catch {
        failed = true
      }
      expect(failed).to.equal(true)
    })
  })

  describe('what a Drive file may leave out', () => {
    it('is told by its properties or its name, which setlist a file holds', () => {
      expect(
        setlistIdOf({ id: 'f', appProperties: { setlistId: 'by-props' }, name: 'other.json' })
      ).to.equal('by-props')
      expect(setlistIdOf({ id: 'f', name: 'by-name.json' })).to.equal('by-name')
      expect(setlistIdOf({ id: 'f' })).to.equal('')
    })

    it('is told by its properties, in order, which song a chart is, and by its name what it is called', () => {
      expect(driveSongUuid({ songUuid: 'u', versionId: 'v', songId: 's' }, 'f')).to.equal('u')
      expect(driveSongUuid({ versionId: 'v', songId: 's' }, 'f')).to.equal('v')
      expect(driveSongUuid({ songId: 's' }, 'f')).to.equal('s')
      expect(driveSongUuid({}, 'f')).to.equal('f')
      expect(titleFromFilename('Amazing Grace.cho')).to.equal('Amazing Grace')
      expect(titleFromFilename(undefined)).to.equal('Untitled')
      expect(songUuidOf({ uuid: 'u', id: 'i' })).to.equal('u')
      expect(songUuidOf({ uuid: '', id: 'i' })).to.equal('i')
    })

    it('is made up for, when a chart in Drive has no properties, dates or id', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'seed', title: 'Seed', content: '{title: Seed}\n[G]Seed' })
      await syncDevice(phone)
      const [template] = rig.drive.listFiles(each => each.appProperties.type === 'chordpro')
      rig.drive.files.set('bare', {
        ...template,
        id: 'bare',
        name: 'Bare Chart.cho',
        content: '[G]Chart with nothing in it',
        modifiedTime: undefined,
        createdTime: undefined,
        appProperties: undefined,
      })
      const tablet = await makeDevice('tablet')
      await syncDevice(tablet)
      const song = must(await tablet.db.getSong('bare'))
      expect(song.title).to.equal('Bare Chart')
      expect(song.importDate).to.be.a('string')
      expect(song.id).to.equal('title-barechart')
    })

    it('is made up for, when a setlist in Drive has no id of its own', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      const setlist = await addSetlist(phone, { name: 'No id inside' })
      await syncDevice(phone)
      const [file] = rig.driveSetlistFiles()
      const content = JSON.parse(file.content)
      content.id = ''
      rig.drive.editContent(file.id, JSON.stringify(content))
      await syncDevice(tablet)
      expect(must(await tablet.db.getSetlist(setlist.id)).name).to.equal('No id inside')
    })

    it('keeps the id a local song has when Drive’s chart gives none', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'One', content: '{title: One}\n[G]One' })
      await syncDevice(phone)
      const [file] = rig.drive.listFiles(each => each.appProperties.type === 'chordpro')
      delete file.appProperties.songId
      rig.drive.editContent(file.id, '{title: One}\n[G]One, changed in Drive')
      await syncDevice(phone)
      expect(must(await phone.db.getSong('song-1')).id).to.equal('title-one')
    })
  })

  describe('the folder', () => {
    it('is said to be gone when it was deleted, not trashed', async () => {
      const phone = await makeDevice('phone')
      await syncDevice(phone)
      rig.drive.files.delete(rig.drive.findByPath(['Chordless', TEST_ORG.name]).id)
      let message = ''
      try {
        await phone.sync.resolveDriveFolder()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.contain('no longer exists')
    })

    it('is said to be view-only when the user can only read it', async () => {
      const phone = await makeDevice('phone')
      await addSetlist(phone)
      await phone.sync.sync()
      rig.drive.readOnly = true
      const said: string[] = []
      await phone.sync.sync(progress => said.push(progress.message))
      expect(said.at(-1)).to.equal('Sync complete (view-only: your changes stay on this device)')
    })
  })

  describe('pushing and resetting', () => {
    it('finds out the user can only read when writes were refused, though the check said they could write', async () => {
      const phone = await makeDevice('phone')
      const setlist = await addSetlist(phone, { name: 'Mine' })
      await syncDevice(phone)
      await editSetlist(phone, setlist.id, { name: 'Edited' })
      phone.sync.readOnly = false
      rig.drive.readOnly = true
      await phone.sync.pushToDrive()
      expect(phone.sync.readOnly).to.equal(true)
    })

    it('stops quietly when a refused write throws and the user turns out to be a reader', async () => {
      const phone = await makeDevice('phone')
      // The folder it needs for setlists is not there, so making it is what is refused
      rig.drive.files.delete(rig.drive.findByPath(['Chordless', TEST_ORG.name, 'setlists']).id)
      await addSetlist(phone, { name: 'Mine' })
      phone.sync.readOnly = false
      rig.drive.readOnly = true
      await phone.sync.pushToDrive()
      expect(phone.sync.readOnly).to.equal(true)
    })

    it('has a manager with no member cache say so, and go on', async () => {
      const phone = await makeDevice('phone')
      const bare = new DriveSyncManager(TEST_ORG.name, TEST_ORG.id, {
        db: phone.db,
        folderLink: phone.folderLink,
      })
      bare.driveFolderId = phone.sync.driveFolderId
      expect(await bare.refreshMembers()).to.equal(null)
    })

    it('pushes without having pulled, which knows no live files', async () => {
      const phone = await makeDevice('phone')
      await addSetlist(phone)
      await phone.sync.pushToDrive()
      expect(rig.driveSetlistFiles()).to.have.length(1)
    })

    it('fails when something other than being view-only goes wrong', async () => {
      const phone = await makeDevice('phone')
      phone.db.getAllSetlists = async () => {
        throw new Error('broken')
      }
      let message = ''
      try {
        await phone.sync.pushToDrive()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('broken')
    })

    it('stops with the changes that would be lost, naming the songs, and reports as it goes', async () => {
      const phone = await makeDevice('phone')
      await syncDevice(phone)
      await addSong(phone, { uuid: 'song-1', title: '', content: '[G]Untitled' })
      await phone.db.saveSong({ ...must(await phone.db.getSong('song-1')), chordproFileId: '' })
      await addSong(phone, {
        uuid: 'song-2',
        title: 'Unsynced',
        content: '{title: Unsynced}\n[G]x',
      })
      const said: string[] = []
      let error: UnsyncedChangesError | null = null
      try {
        await phone.sync.resetLocalFromDrive(progress => said.push(progress.message))
      } catch (caught) {
        error = caught as UnsyncedChangesError
      }
      expect(error?.unsynced.map(change => change.id)).to.deep.equal(['song-2'])
      expect(said).to.include('Checking Drive files...')
      expect(said).to.include('Checking for unsynced changes...')
    })

    it('reports each step of a reset that goes through', async () => {
      const phone = await makeDevice('phone')
      await addSetlist(phone)
      await syncDevice(phone)
      const said: string[] = []
      await phone.sync.resetLocalFromDrive(progress => said.push(progress.message))
      expect(said).to.include('Clearing local copy...')
      expect(said.at(-1)).to.equal('Reset complete')
    })

    it('names an unsynced song by its id when it has no title', async () => {
      const phone = await makeDevice('phone')
      await syncDevice(phone)
      await addSong(phone, { uuid: 'song-3', title: '', content: '[G]No title' })
      const [change] = await phone.sync.findUnsyncedChanges()
      expect(change).to.deep.include({ type: 'song', id: 'song-3' })
    })
  })

  describe('legacy songs, by date', () => {
    it('are judged by the song’s own date when there is none on the chart or the song', () => {
      const song = {
        ...makeSong({ driveFileId: 'f', lastSyncedAt: '2026-10-01T00:00:00Z' }),
        modifiedDate: '',
      }
      const chart = { id: 'c', content: 'x', contentHash: 'h', lastModified: 0 }
      expect(songHasLocalChanges(song as never, chart as never)).to.equal(false)
    })
  })
})
