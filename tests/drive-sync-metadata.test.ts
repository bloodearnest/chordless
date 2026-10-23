/**
 * A change to a song other than its chart (which variant is the default, what a variant is called,
 * who imported it): another device takes it on a pull, though the file's checksum did not change.
 * A field changed on both is left as it is here, and sent.
 */
import { expect } from '@open-wc/testing'
import type { SongRecord } from '../src/js/data-types.ts'
import {
  metadataOfProps,
  metadataOfSong,
  remoteMetadataChanges,
} from '../src/js/sync/song-metadata.ts'
import { makeSong } from './builders.ts'
import { addSong, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('Drive sync: a song’s metadata', () => {
  const rig = useSyncRig()
  const { makeDevice, syncDevice } = rig

  /** Change a song on a device the way the app does a change that is not its chart */
  async function change(device, uuid: string, fields: Partial<SongRecord>) {
    await device.db.saveSong({
      ...must(await device.db.getSong(uuid)),
      ...fields,
      metadataChangedAt: new Date().toISOString(),
    })
    await wait(5)
  }
  const file = (uuid: string) =>
    rig.storage.list(f => f.props.type === 'chordpro' && f.props.songUuid === uuid)[0]

  async function twoDevices() {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    await addSong(phone, {
      uuid: 'song-1',
      title: 'Amazing',
      content: '{title: Amazing}\n[G]Grace',
    })
    await syncDevice(phone)
    await syncDevice(tablet)
    return { phone, tablet }
  }

  it('takes on another device the change to who imported a song, its variant name and its default', async () => {
    const { phone, tablet } = await twoDevices()
    await change(phone, 'song-1', {
      importUser: 'Simon Davy',
      variantLabel: 'Capo 3',
      isDefault: false,
      variantOf: 'song-0',
    })
    await syncDevice(phone)
    expect(file('song-1').props.importUser).to.equal('Simon Davy')

    rig.storage.clearCalls()
    await syncDevice(tablet)
    const reads = rig.storage.calls.filter(call => call.op === 'readText' || call.op === 'readMany')

    const song = must(await tablet.db.getSong('song-1'))
    expect(song).to.include({
      importUser: 'Simon Davy',
      variantLabel: 'Capo 3',
      isDefault: false,
      variantOf: 'song-0',
    })
    // (its chart was not downloaded again: it did not change)
    expect(reads).to.deep.equal([])
    // ... and is not sent back as a change of its own
    rig.storage.clearCalls()
    await syncDevice(tablet)
    expect(rig.storage.writes()).to.deep.equal([])
  })

  it('takes on the song id a change of its identity gave it, with its CCLI number', async () => {
    const { phone, tablet } = await twoDevices()
    await change(phone, 'song-1', { id: 'ccli-3350395', ccliNumber: '3350395' })
    await syncDevice(phone)
    await syncDevice(tablet)
    expect(must(await tablet.db.getSong('song-1'))).to.include({
      id: 'ccli-3350395',
      ccliNumber: '3350395',
    })
  })

  it('goes on taking changes, one after another, as they are made', async () => {
    const { phone, tablet } = await twoDevices()
    await change(phone, 'song-1', { variantLabel: 'First' })
    await syncDevice(phone)
    await syncDevice(tablet)
    await change(phone, 'song-1', { variantLabel: 'Second' })
    await syncDevice(phone)
    await syncDevice(tablet)
    expect(must(await tablet.db.getSong('song-1')).variantLabel).to.equal('Second')
  })

  it('keeps what a device changed itself, and sends it, when the other device changed the same', async () => {
    const { phone, tablet } = await twoDevices()
    await change(phone, 'song-1', { variantLabel: 'From the phone' })
    await change(tablet, 'song-1', { variantLabel: 'From the tablet' })
    await syncDevice(phone)
    await syncDevice(tablet)
    expect(must(await tablet.db.getSong('song-1')).variantLabel).to.equal('From the tablet')
    expect(file('song-1').props.variantLabel).to.equal('From the tablet')
    await syncDevice(phone)
    expect(must(await phone.db.getSong('song-1')).variantLabel).to.equal('From the tablet')
  })

  it('takes a field another device changed even while this device changed another field', async () => {
    const { phone, tablet } = await twoDevices()
    await change(phone, 'song-1', { importUser: 'Jo' })
    await change(tablet, 'song-1', { variantLabel: 'Capo' })
    await syncDevice(phone)
    await syncDevice(tablet)
    const song = must(await tablet.db.getSong('song-1'))
    expect(song).to.include({ importUser: 'Jo', variantLabel: 'Capo' })
  })

  describe('what is taken, from the song and Drive’s properties', () => {
    const song = (fields: Partial<SongRecord> = {}) =>
      ({
        ...makeSong({ importUser: null, ...fields }),
        tempo: null,
        originalTempo: null,
      }) as SongRecord
    const props = (fields: Record<string, string> = {}) => ({
      songId: 'title-song',
      isDefault: 'true',
      variantLabel: '',
      importUser: '',
      importSource: '',
      ...fields,
    })

    it('fills an empty field from Drive, for a song synced before the last sync was kept', () => {
      const changes = remoteMetadataChanges(song(), props({ importUser: 'Jo' }))
      expect(changes).to.include({ importUser: 'Jo' })
    })

    it('does not change a field that has a value, with no record of the last sync', () => {
      expect(
        remoteMetadataChanges(song({ importUser: 'Ann' }), props({ importUser: 'Jo' }))
      ).to.equal(null)
    })

    it('remembers the metadata once it is the same as Drive’s, and has nothing to change after', () => {
      const here = song({ importUser: 'Jo' })
      const there = { ...metadataOfSong(here) }
      const first = remoteMetadataChanges(here, there)
      expect(first?.syncedMetadata).to.deep.equal(metadataOfProps(there))
      expect(
        remoteMetadataChanges({ ...here, syncedMetadata: first?.syncedMetadata }, there)
      ).to.equal(null)
    })

    it('has nothing to change when Drive changed what this song changed too, to the same', () => {
      const here = song({
        importUser: 'Jo',
        syncedMetadata: { ...metadataOfSong(song()), importUser: '' },
      })
      const changes = remoteMetadataChanges(here, props({ importUser: 'Jo' }))
      expect(changes?.importUser).to.equal(undefined)
      expect(changes?.syncedMetadata?.importUser).to.equal('Jo')
    })

    it('takes a change to who imported it as empty, as none', () => {
      const here = song({
        importUser: 'Jo',
        syncedMetadata: { ...metadataOfSong(song({ importUser: 'Jo' })) },
      })
      expect(remoteMetadataChanges(here, props({ importUser: '' }))).to.include({
        importUser: null,
      })
    })
  })
})
