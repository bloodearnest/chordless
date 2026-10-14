import { expect } from '@esm-bundle/chai'
import type { SetlistLocalState } from '../src/js/data-types.ts'
import { hashText } from '../src/js/song-utils.ts'
import { makeLocalState, makeSong } from './builders.ts'
import { useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('Drive sync: reset from Drive', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, editSetlist, syncDevice, driveSetlistFiles } = rig

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
      const removedFile = rig.drive.listFiles(f => f.appProperties.setlistId === removed.id)[0]
      rig.drive.files.get(removedFile.id).trashed = true

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
      await wait(5)
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
      rig.drive.failRequests({ method: 'GET', path: /files\(id,name,mimeType\)&pageSize/ })

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
})
