import { expect } from '@open-wc/testing'
import { songFileMetadata } from '../src/js/drive-metadata.ts'
import { addSong, editSong, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, TEST_SPACE } from './test-helpers.ts'

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
