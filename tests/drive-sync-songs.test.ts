import { expect } from '@open-wc/testing'
import { songFileMetadata } from '../src/js/drive-metadata.ts'
import type { SyncManager } from '../src/js/sync-manager.ts'
import { addSong, editSong, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, TEST_SPACE, wait } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('Drive sync: songs', () => {
  const rig = useSyncRig()
  const { makeDevice, syncDevice, replaceDriveFile } = rig

  describe('songs', () => {
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
      const known = must(await tablet.db.getSong('song-1')).fileRef
      replaceDriveFile(must(known), 'survivor')
      const filesBefore = rig.storage.list(f => Boolean(f.props.songId || f.props.versionId))
      rig.storage.clearCalls()

      await syncDevice(tablet)

      expect(rig.storage.writes()).to.deep.equal([])
      expect(rig.storage.list(f => Boolean(f.props.songId || f.props.versionId))).to.have.length(
        filesBefore.length
      )
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

      const [file] = rig.storage.list(f => f.props.type === 'chordpro')
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

      await editSong(phone, 'song-1', '{title: Amazing}\n[A]Grace')
      await syncDevice(phone)
      await syncDevice(tablet)

      expect(await songContent(tablet, 'song-1')).to.equal('{title: Amazing}\n[A]Grace')
    })

    it('keeps Drive file IDs matched when one song upload in a batch fails', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-a', title: 'Alpha', content: 'alpha chart' })
      await addSong(phone, { uuid: 'song-b', title: 'Beta', content: 'beta chart' })
      rig.storage.fail('create')

      await syncDevice(phone)
      await syncDevice(phone)

      for (const uuid of ['song-a', 'song-b']) {
        const song = must(await phone.db.getSong(uuid))
        expect(rig.storage.file(must(song.fileRef)).content).to.equal(
          await songContent(phone, uuid)
        )
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

      const [file] = rig.storage.list(f => f.props.type === 'chordpro')
      expect(file.content).to.equal('v2 without new hash')
    })

    it('pulls a chart edited in Drive even if its appProperties are stale', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: 'v1' })
      await syncDevice(phone)

      const [file] = rig.storage.list(f => f.props.type === 'chordpro')
      rig.storage.edit(file.ref, 'edited in Drive')
      await syncDevice(phone)

      expect(await songContent(phone, 'song-1')).to.equal('edited in Drive')
    })

    describe('deleting a song', () => {
      /** How many songs the tablet's sync removes as deleted elsewhere */
      const removedOn = async (device: { sync: SyncManager }) => {
        const run = device.sync.newRun()
        await device.sync.buildDriveInventory(run)
        await device.sync.pullFromDrive(null, run)
        return device.sync.removeSongsDeletedInDrive(run)
      }
      const songFiles = () => rig.storage.list(f => f.props.type === 'chordpro')

      it('puts its file in the Drive trash at the next sync, and does not bring it back', async () => {
        const phone = await makeDevice('phone')
        await addSong(phone, { uuid: 'keep', title: 'Keep', content: '{title: Keep}' })
        await addSong(phone, { uuid: 'drop', title: 'Drop', content: '{title: Drop}' })
        await syncDevice(phone)
        const ref = must(must(await phone.db.getSong('drop')).fileRef)

        await phone.db.deleteSong('drop')
        expect(await phone.db.getSong('drop')).to.equal(undefined)
        expect((await phone.db.getPendingDeletions()).map(entry => entry.ref)).to.deep.equal([ref])

        await syncDevice(phone)
        expect(rig.storage.file(ref).trashed).to.equal(true)
        expect(songFiles()).to.have.length(1)
        expect(await phone.db.getSong('drop')).to.equal(undefined)
        expect(await phone.db.getPendingDeletions()).to.deep.equal([])
        expect(await phone.db.getChordPro('chordpro-drop')).to.equal(undefined)
      })

      it('is not a pending deletion when the song never reached Drive', async () => {
        const phone = await makeDevice('phone')
        await addSong(phone, { uuid: 'new', title: 'New', content: '{title: New}' })
        await phone.db.deleteSong('new')
        expect(await phone.db.getPendingDeletions()).to.deep.equal([])
      })

      it('is carried out on another device, which drops its copy', async () => {
        const phone = await makeDevice('phone')
        const tablet = await makeDevice('tablet')
        await addSong(phone, { uuid: 'drop', title: 'Drop', content: '{title: Drop}' })
        await syncDevice(phone)
        await syncDevice(tablet)
        expect(await tablet.db.getSong('drop')).to.not.equal(undefined)

        await phone.db.deleteSong('drop')
        await syncDevice(phone)
        await syncDevice(tablet)

        expect(await tablet.db.getSong('drop')).to.equal(undefined)
        expect(songFiles()).to.have.length(0)
        expect(await tablet.db.getPendingDeletions()).to.deep.equal([])
      })

      it('does not take a song from a device that has changed it since: that goes back to Drive', async () => {
        const phone = await makeDevice('phone')
        const tablet = await makeDevice('tablet')
        await addSong(phone, { uuid: 'drop', title: 'Drop', content: '{title: Drop}' })
        await syncDevice(phone)
        await syncDevice(tablet)
        await editSong(tablet, 'drop', '{title: Drop}\n[G]edited here')

        await phone.db.deleteSong('drop')
        await syncDevice(phone)
        await syncDevice(tablet)

        expect(await tablet.db.getSong('drop')).to.not.equal(undefined)
        expect(songFiles()).to.have.length(1)
      })

      it('is kept to try again, and the song stays gone, when the file cannot be trashed yet', async () => {
        const phone = await makeDevice('phone')
        await addSong(phone, { uuid: 'drop', title: 'Drop', content: '{title: Drop}' })
        await syncDevice(phone)
        const ref = must(must(await phone.db.getSong('drop')).fileRef)
        await phone.db.deleteSong('drop')

        rig.storage.fail('trash', { times: 1 })
        await syncDevice(phone)
        expect(rig.storage.file(ref).trashed).to.equal(false)
        expect(await phone.db.getSong('drop')).to.equal(undefined)
        expect((await phone.db.getPendingDeletions()).length).to.equal(1)

        await syncDevice(phone)
        expect(rig.storage.file(ref).trashed).to.equal(true)
        expect(await phone.db.getPendingDeletions()).to.deep.equal([])
      })

      it('is told of as the sync goes: files put in the trash, and songs removed that were deleted elsewhere', async () => {
        const phone = await makeDevice('phone')
        const tablet = await makeDevice('tablet')
        await addSong(phone, { uuid: 'one', title: 'One', content: '{title: One}' })
        await addSong(phone, { uuid: 'two', title: 'Two', content: '{title: Two}' })
        await syncDevice(phone)
        await syncDevice(tablet)
        await phone.db.deleteSong('one')
        await phone.db.deleteSong('two')
        const phoneSaid: string[] = []
        await phone.sync.sync(progress => phoneSaid.push(progress.message))
        expect(phoneSaid).to.include('Moved 2 deleted files to the Drive trash')

        const tabletSaid: string[] = []
        await tablet.sync.sync(progress => tabletSaid.push(progress.message))
        expect(tabletSaid).to.include('Removed 2 songs that were deleted elsewhere')

        // (and one at a time)
        await addSong(phone, { uuid: 'three', title: 'Three', content: '{title: Three}' })
        await syncDevice(phone)
        await syncDevice(tablet)
        await phone.db.deleteSong('three')
        const again: string[] = []
        await phone.sync.sync(progress => again.push(progress.message))
        expect(again).to.include('Moved 1 deleted file to the Drive trash')
        const last: string[] = []
        await tablet.sync.sync(progress => last.push(progress.message))
        expect(last).to.include('Removed 1 song that was deleted elsewhere')
      })

      it('is not carried out before Drive has been listed, or on a song that was never in Drive', async () => {
        const phone = await makeDevice('phone')
        await addSong(phone, { uuid: 'new', title: 'New', content: '{title: New}' })
        const run = phone.sync.newRun()
        expect(await phone.sync.removeSongsDeletedInDrive(run)).to.equal(0)
        await phone.sync.buildDriveInventory(run)
        await phone.sync.pullFromDrive(null, run)
        expect(await phone.sync.removeSongsDeletedInDrive(run)).to.equal(0)
        expect(await phone.db.getSong('new')).to.not.equal(undefined)
      })

      it('is not carried out on a song that has another live file in Drive, which the pull could not take over', async () => {
        const phone = await makeDevice('phone')
        await addSong(phone, { uuid: 'song', title: 'Song', content: '{title: Song}' })
        await syncDevice(phone)
        replaceDriveFile(must(must(await phone.db.getSong('song')).fileRef), 'survivor')
        const run = phone.sync.newRun()
        await phone.sync.buildDriveInventory(run)
        // (the pull listed the song's new file, and could not download it)
        run.liveSongUuids = new Set(['song'])
        expect(await phone.sync.removeSongsDeletedInDrive(run)).to.equal(0)
        expect(await phone.db.getSong('song')).to.not.equal(undefined)
      })

      it('is not carried out on a song whose chart is not here, as it cannot be told whether it changed', async () => {
        const phone = await makeDevice('phone')
        const tablet = await makeDevice('tablet')
        await addSong(phone, { uuid: 'drop', title: 'Drop', content: '{title: Drop}' })
        await syncDevice(phone)
        await syncDevice(tablet)
        const song = must(await tablet.db.getSong('drop'))
        await new Promise<void>((resolve, reject) => {
          const request = must(tablet.db.db)
            .transaction('chordpro', 'readwrite')
            .objectStore('chordpro')
            .delete(song.chordproFileId)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
        await phone.db.deleteSong('drop')
        await syncDevice(phone)
        expect(await removedOn(tablet)).to.equal(0)
      })

      it('is a change that a reset from Drive would throw away, so a reset says so first', async () => {
        const phone = await makeDevice('phone')
        await addSong(phone, { uuid: 'drop', title: 'Drop', content: '{title: Drop}' })
        await syncDevice(phone)
        await phone.db.deleteSong('drop')
        const unsynced = await phone.sync.findUnsyncedChanges()
        expect(unsynced.map(change => change.label).join()).to.contain('deleted')
      })

      it('goes with the song’s chart, unless another song uses the same one', async () => {
        const phone = await makeDevice('phone')
        await addSong(phone, { uuid: 'a', title: 'A', content: '{title: A}' })
        const a = must(await phone.db.getSong('a'))
        await phone.db.saveSong({ ...a, uuid: 'b', id: 'title-b' })
        await phone.db.deleteSong('a')
        expect(await phone.db.getChordPro('chordpro-a')).to.not.equal(undefined)
        await phone.db.deleteSong('b')
        expect(await phone.db.getChordPro('chordpro-a')).to.equal(undefined)
      })
    })

    it('sends a change to a song that is not its chart, such as its source', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: '{title: Amazing}' })
      await syncDevice(phone)
      const file = () => rig.storage.list(f => f.props.type === 'chordpro')[0]
      expect(file().props.importSource).to.equal('test')

      const song = must(await phone.db.getSong('song-1'))
      await phone.db.saveSong({
        ...song,
        importSource: 'songselect',
        metadataChangedAt: new Date().toISOString(),
      })
      await wait(5)
      await syncDevice(phone)
      expect(file().props.importSource).to.equal('songselect')

      // Sent once: the next sync has nothing to send
      rig.storage.clearCalls()
      await syncDevice(phone)
      expect(rig.storage.writes()).to.deep.equal([])
    })

    describe('where a song came from', () => {
      const setSource = async (device, uuid: string, importSource: string) =>
        device.db.saveSong({ ...must(await device.db.getSong(uuid)), importSource })

      it('goes to Drive with the song, and arrives on another device unchanged', async () => {
        const phone = await makeDevice('phone')
        const tablet = await makeDevice('tablet')
        await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: '{title: Amazing}' })
        await setSource(phone, 'song-1', 'songselect')
        await syncDevice(phone)
        expect(rig.storage.list(f => f.props.type === 'chordpro')[0].props.importSource).to.equal(
          'songselect'
        )
        await syncDevice(tablet)
        expect(must(await tablet.db.getSong('song-1')).importSource).to.equal('songselect')
      })

      it('is not replaced by Drive when a change to the song is pulled', async () => {
        const phone = await makeDevice('phone')
        const tablet = await makeDevice('tablet')
        await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: '{title: Amazing}' })
        await setSource(phone, 'song-1', 'songselect')
        await syncDevice(phone)
        await syncDevice(tablet)
        await editSong(phone, 'song-1', '{title: Amazing}\n[G]edited')
        await syncDevice(phone)
        await syncDevice(tablet)
        expect(must(await tablet.db.getSong('song-1')).importSource).to.equal('songselect')
      })

      it('is never Google Drive: a song that only says it came from there has no source', async () => {
        const phone = await makeDevice('phone')
        const tablet = await makeDevice('tablet')
        await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: '{title: Amazing}' })
        await setSource(phone, 'song-1', 'drive')
        await syncDevice(phone)
        expect(rig.storage.list(f => f.props.type === 'chordpro')[0].props.importSource).to.equal(
          ''
        )
        await syncDevice(tablet)
        expect(must(await tablet.db.getSong('song-1')).importSource).to.equal('')
      })
    })

    it('creates and updates song files with the metadata from drive-metadata.js', async () => {
      const phone = await makeDevice('phone')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: '{title: Amazing}' })
      await syncDevice(phone)
      const file = () => rig.storage.list(f => f.props.type === 'chordpro')[0]
      const expected = async () => {
        const song = must(await phone.db.getSong('song-1'))
        const chart = await phone.db.getChordPro(song.chordproFileId)
        return songFileMetadata(song, chart, { spaceId: TEST_SPACE.id }).appProperties
      }
      expect(file().props).to.deep.equal(await expected())

      // A variant change only shows in appProperties, so updates must send them
      const song = must(await phone.db.getSong('song-1'))
      await phone.db.saveSong({ ...song, isDefault: false, variantOf: 'song-0' })
      await editSong(phone, 'song-1', '{title: Amazing}\n[G]edited')
      await syncDevice(phone)

      expect(file().props.isDefault).to.equal('false')
      expect(file().props).to.deep.equal(await expected())
    })

    it('keeps the Drive version when a chart is edited on two devices', async () => {
      const phone = await makeDevice('phone')
      const tablet = await makeDevice('tablet')
      await addSong(phone, { uuid: 'song-1', title: 'Amazing', content: 'v1' })
      await syncDevice(phone)
      await syncDevice(tablet)

      await editSong(phone, 'song-1', 'phone version')
      await editSong(tablet, 'song-1', 'tablet version')
      await syncDevice(phone)
      await syncDevice(tablet)

      const [file] = rig.storage.list(f => f.props.type === 'chordpro')
      expect(file.content).to.equal('phone version')
      expect(await songContent(tablet, 'song-1')).to.equal('phone version')
    })
  })
})
