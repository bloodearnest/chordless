import { expect } from '@open-wc/testing'
import type { SetlistLocalState } from '../src/js/data-types.ts'
import { setlistHasLocalChanges } from '../src/js/sync/changes.ts'
import { makeEntry, makeLocalState } from './builders.ts'
import { useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach } = window

suppressConsoleLogs()

describe('Drive sync: errors and missing files', () => {
  const rig = useSyncRig()
  const {
    makeDevice,
    addSetlist,
    editSetlist,
    syncDevice,
    driveSetlistFiles,
    driveSetlist,
    replaceDriveFile,
  } = rig

  describe('errors partway through a sync', () => {
    it('keeps Drive file IDs matched when one upload in a batch fails', async () => {
      // Regression: batchUploadFiles used to drop failed uploads from its
      // results, shifting later setlists onto the wrong driveFileId so a later
      // edit overwrote a different setlist's file.
      const phone = await makeDevice('phone')
      await addSetlist(phone, { id: 'setlist-a', name: 'A' })
      await addSetlist(phone, { id: 'setlist-b', name: 'B' })
      await addSetlist(phone, { id: 'setlist-c', name: 'C' })
      rig.drive.failRequests({ method: 'POST', path: /^\/upload\/drive\/v3\/files/, status: 500 })

      await syncDevice(phone)

      const fileFor = async id =>
        rig.drive.files.get(must(await phone.db.getSetlist(id)).driveFileId)
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
      rig.drive.failRequests({ method: 'GET', path: /files\(id,name,mimeType\)&pageSize/ })

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
      rig.drive.requests = []
      await syncDevice(tablet)

      expect(await tablet.db.getAllSetlists()).to.have.length(13)
      const writes = rig.drive.requests.filter(r => r.method !== 'GET')
      expect(writes.map(r => `${r.method} ${r.path}`)).to.deep.equal([])
    })

    describe("when a device's Drive file is gone and no other file holds the setlist", () => {
      const trashAll = () => {
        for (const file of driveSetlistFiles()) rig.drive.files.get(file.id).trashed = true
      }

      it('removes the setlists that were not edited here, without uploading anything', async () => {
        const phone = await makeDevice('phone')
        for (let i = 0; i < 8; i++) await addSetlist(phone, { date: `2026-09-0${i + 1}` })
        await syncDevice(phone)
        trashAll()
        rig.drive.requests = []

        await syncDevice(phone)

        expect(await phone.db.getAllSetlists()).to.have.length(0)
        expect(rig.drive.requests.filter(r => r.method !== 'GET')).to.deep.equal([])
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
        const live = rig.drive.listFiles(f => f.appProperties.setlistId === edited.id && !f.trashed)
        expect(live.map(f => JSON.parse(f.content).name)).to.deep.equal(['Edited again'])
      })

      it('brings a restored file back, keeping the device state for it', async () => {
        const phone = await makeDevice('phone')
        const setlist = await addSetlist(phone, { name: 'Restorable' })
        await phone.db.saveLocalState(Object.assign(makeLocalState(setlist.id), { marker: 'kept' }))
        await syncDevice(phone)
        trashAll()
        await syncDevice(phone)
        for (const file of driveSetlistFiles()) rig.drive.files.get(file.id).trashed = false

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
      rig.drive.failRequests({ method: 'GET', path: /alt=media/, times: 1 })

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
        rig.drive.corruptUploads = 1

        await syncDevice(phone)

        const afterFirst = must(await phone.db.getSetlist(setlist.id))
        expect(afterFirst.driveFileId).to.be.a('string')
        expect(setlistHasLocalChanges(afterFirst)).to.equal(true)

        await syncDevice(phone)

        expect(driveSetlistFiles()).to.have.length(1)
        const settled = must(await phone.db.getSetlist(setlist.id))
        expect(settled.driveFileId).to.equal(afterFirst.driveFileId)
        expect(setlistHasLocalChanges(settled)).to.equal(false)
      })

      it('does the same for a setlist update', async () => {
        const phone = await makeDevice('phone')
        const setlist = await addSetlist(phone, { name: 'Original' })
        await syncDevice(phone)
        await editSetlist(phone, setlist.id, { name: 'Edited' })
        rig.drive.corruptUploads = 1

        await syncDevice(phone)
        expect(setlistHasLocalChanges(must(await phone.db.getSetlist(setlist.id)))).to.equal(true)

        await syncDevice(phone)

        expect(driveSetlist(setlist.id).name).to.equal('Edited')
        expect(setlistHasLocalChanges(must(await phone.db.getSetlist(setlist.id)))).to.equal(false)
      })

      it('records a good upload as synced', async () => {
        const phone = await makeDevice('phone')
        const setlist = await addSetlist(phone, { name: 'Fine' })

        await syncDevice(phone)

        const local = must(await phone.db.getSetlist(setlist.id))
        expect(setlistHasLocalChanges(local)).to.equal(false)
        expect(local.driveChecksum).to.equal(rig.drive.listFiles()[0].md5Checksum)
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
        rig.drive.requests = []
      })

      const writes = () =>
        rig.drive.requests.filter(r => r.method !== 'GET').map(r => `${r.method} ${r.path}`)

      it('adopts the live file, rather than uploading a copy', async () => {
        await syncDevice(tablet)

        expect(writes()).to.deep.equal([])
        expect(driveSetlistFiles()).to.have.length(1)
        expect(must(await tablet.db.getSetlist(setlist.id)).driveFileId).to.equal('survivor')
        expect(setlistHasLocalChanges(must(await tablet.db.getSetlist(setlist.id)))).to.equal(false)
      })

      it('updates the live file with an edit made here, rather than uploading a copy', async () => {
        await editSetlist(tablet, setlist.id, { name: 'Edited on the tablet' })

        await syncDevice(tablet)

        expect(driveSetlistFiles()).to.have.length(1)
        expect(driveSetlist(setlist.id).name).to.equal('Edited on the tablet')
        expect(must(await tablet.db.getSetlist(setlist.id)).driveFileId).to.equal('survivor')
      })

      it("takes the live file's content when it is newer and nothing was edited here", async () => {
        rig.drive.editContent(
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
      rig.drive.requests = []

      await syncDevice(tablet)

      expect(rig.drive.requests.filter(r => r.method !== 'GET')).to.deep.equal([])
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
      rig.drive.maxPageSize = 2
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
      rig.drive.failRequests({ method: 'PATCH', path: /^\/upload\//, network: true })

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
      rig.drive.failRequests({ method: 'GET', path: /alt=media/, status: 503 })

      await syncDevice(tablet)
      expect(await tablet.db.getSetlist(setlist.id)).to.equal(undefined)

      await syncDevice(tablet)
      expect(must(await tablet.db.getSetlist(setlist.id)).name).to.equal('Flaky')
    })

    it('fails the sync without pushing when the setlist listing fails', async () => {
      const phone = await makeDevice('phone')
      await addSetlist(phone)
      rig.drive.requests = []
      rig.drive.failRequests({ method: 'GET', path: /name contains/, status: 500 })

      let error
      try {
        await phone.sync.sync()
      } catch (e) {
        error = e
      }

      expect(error?.message).to.match(/Drive API error/)
      expect(rig.drive.requests.filter(r => r.path.startsWith('/upload/'))).to.deep.equal([])
    })
  })
})
