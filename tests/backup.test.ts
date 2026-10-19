import { expect } from '@open-wc/testing'
import {
  backupFileName,
  createBackup,
  readBackup,
  readPadSetsForBackup,
  restoreBackup,
  restorePadSets,
} from '../src/js/backup.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { PAD_FILE_KEYS } from '../src/js/pad-keys.ts'
import { listPadSets, padSetSize, uploadPadSet } from '../src/js/pad-set-service.ts'
import { addChart } from '../src/js/song-utils.ts'
import { readZip, writeZip } from '../src/js/utils/zip.ts'
import { makeEntry, makeSetlist } from './builders.ts'
import { binaryStringToBytes, installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'
import { buildZip } from './zip.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const ALPHA = '{title: Alpha}\n{key: G}\n[G]Alpha line'
const ALPHA_EDITED = '{title: Alpha}\n{key: G}\n[G]Alpha line, edited'
const BETA = '{title: Beta}\n{key: D}\n[D]Beta line'
const ADD = { variantLabel: 'Original', importSource: 'test', makeDefault: 'first' } as const

describe('Backing up a space, and restoring one', () => {
  const sourceId = `space-${crypto.randomUUID()}`
  const destinationId = `space-${crypto.randomUUID()}`
  let source: ChordlessDB
  let destination: ChordlessDB

  beforeEach(async () => {
    source = new ChordlessDB(sourceId)
    await source.init()
    destination = new ChordlessDB(destinationId)
    await destination.init()
  })

  afterEach(async () => {
    source.db?.close()
    destination.db?.close()
    await deleteDatabase(sourceId)
    await deleteDatabase(destinationId)
  })

  /** A space with two songs (one with a second chart), and a setlist using them */
  async function fill() {
    const alpha = await addChart(source, ALPHA, ADD)
    await addChart(source, ALPHA_EDITED, { ...ADD, variantLabel: 'Edited', makeDefault: 'first' })
    const beta = await addChart(source, BETA, ADD)
    await source.saveSong({ ...beta, key: 'E' })
    const setlist = makeSetlist({
      id: 'set-1',
      date: '2026-10-25',
      name: 'Harvest',
      songs: [
        makeEntry({ order: 0, songId: alpha.id, songUuid: alpha.uuid, key: 'A', tempo: 100 }),
        makeEntry({ order: 1, songId: beta.id, songUuid: beta.uuid, key: 'E', tempo: 80 }),
      ],
    })
    await source.saveSetlist({
      ...setlist,
      driveFileId: 'drive-1',
      syncedContentHash: 'h',
      share: {
        fileId: 'f',
        key: 'k',
        created: '2026-10-01',
        expires: '2026-11-01',
        bundleHash: 'b',
      },
    })
    return { alpha, beta }
  }

  it('makes a zip of the charts and setlists, with nothing of Drive in it', async () => {
    await fill()
    const zip = await readZip(await createBackup(source, 'Grace Church'))
    const names = zip.entries.map(entry => entry.fileName)
    expect(names).to.include('manifest.json')
    expect(names).to.include('songs.json')
    expect(names.filter(name => name.startsWith('songs/') && name.endsWith('.cho'))).to.have.length(
      3
    )
    expect(names.filter(name => name.startsWith('setlists/'))).to.deep.equal([
      `setlists/2026-10-25-Harvest-set1.json`,
    ])
    expect(names.some(name => name.startsWith('pads/'))).to.equal(false)

    const everything = await Promise.all(
      zip.entries.map(async entry => new TextDecoder().decode(await zip.read(entry)))
    )
    const all = everything.join('\n')
    expect(all).to.not.contain('drive-1')
    expect(all).to.not.contain('bundleHash')
    expect(all).to.not.contain('driveFileId')
  })

  it('says in its manifest what it holds and where from', async () => {
    await fill()
    const backup = await readBackup(
      await createBackup(source, 'Grace Church', [], new Date('2026-10-19T21:00:00Z'))
    )
    expect(backup.manifest).to.deep.include({
      format: 'chordless-backup',
      version: 1,
      space: 'Grace Church',
      created: '2026-10-19T21:00:00.000Z',
      counts: { songs: 3, setlists: 1, padSets: 0 },
    })
  })

  it('restores the charts, their variants and keys, and the setlist with its id and songs', async () => {
    await fill()
    const backup = await readBackup(await createBackup(source, 'Grace Church'))
    const report = await restoreBackup(backup, destination)
    expect(report.songsAdded).to.equal(3)
    expect(report.setlistsAdded).to.equal(1)

    const songs = await destination.getAllSongs()
    expect(songs.map(song => song.title).sort()).to.deep.equal(['Alpha', 'Alpha', 'Beta'])
    expect(songs.filter(song => song.id === 'title-alpha' && song.isDefault)).to.have.length(1)
    expect(songs.find(song => song.title === 'Beta')?.key).to.equal('E')
    expect(songs.every(song => song.importSource === 'backup')).to.equal(true)

    const setlist = must(await destination.getSetlist('set-1'))
    expect(setlist.name).to.equal('Harvest')
    expect(setlist.driveFileId ?? null).to.equal(null)
    expect(setlist.share).to.equal(undefined)
    expect(setlist.songs.map(entry => entry.key)).to.deep.equal(['A', 'E'])
    for (const entry of setlist.songs) {
      expect(await destination.getSong(entry.songUuid), 'the song is in the space').to.not.equal(
        undefined
      )
    }
  })

  it('adds nothing the second time, and leaves what the space has', async () => {
    await fill()
    const backup = await readBackup(await createBackup(source, 'Grace Church'))
    await restoreBackup(backup, destination)
    const again = await restoreBackup(backup, destination)
    expect(again.songsAdded).to.equal(0)
    expect(again.songsSkipped).to.equal(3)
    expect(again.setlistsAdded).to.equal(0)
    expect(again.setlistsSkipped).to.equal(1)
    expect(await destination.getAllSongs()).to.have.length(3)
    expect(await destination.getAllSetlists()).to.have.length(1)

    // A setlist the space has under that id is left as it is
    await destination.saveSetlist({ ...must(await destination.getSetlist('set-1')), name: 'Mine' })
    await restoreBackup(backup, destination)
    expect(must(await destination.getSetlist('set-1')).name).to.equal('Mine')
  })

  it('leaves out a setlist that was received by link or deleted', async () => {
    await fill()
    await source.saveSetlist(makeSetlist({ id: 'gone', deletedAt: '2026-10-01T00:00:00Z' }))
    await source.saveSetlist(
      makeSetlist({
        id: 'share-1',
        received: { key: 'k', etag: 'e', expires: '2026-11-01', setlistId: 's' } as never,
      })
    )
    const backup = await readBackup(await createBackup(source, 'Grace Church'))
    expect(backup.setlists.map(setlist => setlist.id)).to.deep.equal(['set-1'])
  })

  it('leaves out a chart whose text is missing, and restores a list that names one that is', async () => {
    await fill()
    await source.saveSong({ ...must((await source.getAllSongs())[0]), chordproFileId: 'nowhere' })
    const backup = await readBackup(await createBackup(source, 'Grace Church'))
    expect(backup.songs).to.have.length(2)

    // A backup in memory whose list names a chart it does not hold: that chart is skipped
    const damaged = { ...backup, chordpro: new Map() }
    const report = await restoreBackup(damaged, destination)
    expect(report.songsAdded).to.equal(0)
    expect(await destination.getAllSongs()).to.have.length(0)
  })

  it('names the file by the space and the day', () => {
    expect(backupFileName('Grace Church – Évry!', new Date('2026-10-19T21:00:00Z'))).to.equal(
      'chordless-backup-Grace-Church-Evry-2026-10-19.zip'
    )
    expect(backupFileName('???', new Date('2026-10-19T21:00:00Z'))).to.equal(
      'chordless-backup-untitled-2026-10-19.zip'
    )
  })

  describe('refuses a file that is not a backup of this version', () => {
    const reason = async (blob: Blob) => {
      try {
        await readBackup(blob)
      } catch (error) {
        return (error as Error).message
      }
      return null
    }
    const manifest = (changes: object = {}) => ({
      format: 'chordless-backup',
      version: 1,
      created: 'x',
      space: 'S',
      counts: { songs: 0, setlists: 0, padSets: 0 },
      padSets: [],
      ...changes,
    })

    it('says so for something that is not a zip, or has no manifest', async () => {
      expect(await reason(new Blob(['hello']))).to.contain('not a ZIP file')
      expect(await reason(await writeZip([{ name: 'a.txt', data: 'x' }]))).to.contain(
        'manifest.json is missing'
      )
      expect(
        await reason(await writeZip([{ name: 'manifest.json', data: '{not json' }]))
      ).to.contain('manifest cannot be read')
    })

    it('says so for another kind of file, and for a newer version', async () => {
      const zip = (m: object) =>
        writeZip([
          { name: 'manifest.json', data: JSON.stringify(m) },
          { name: 'songs.json', data: '[]' },
        ])
      expect(await reason(await zip(manifest({ format: 'something-else' })))).to.contain(
        'not a Chordless backup'
      )
      expect(await reason(await zip(manifest({ version: 2 })))).to.contain('newer Chordless')
      expect(await reason(await zip(manifest()))).to.equal(null)
    })

    it('says so for a chart the songs list names but the zip lacks', async () => {
      const blob = await writeZip([
        { name: 'manifest.json', data: JSON.stringify(manifest()) },
        { name: 'songs.json', data: JSON.stringify([{ file: 'songs/gone.cho' }]) },
      ])
      expect(await reason(blob)).to.contain('songs/gone.cho is missing')
    })
  })

  describe('with pad sets', () => {
    let drive: ReturnType<typeof installFakeDrive>
    const audioOf = (key: string) =>
      new Uint8Array([...new TextEncoder().encode(`audio:${key}`), 0, 255])
    const PAD_CACHE_NAME = 'padsets-cache-v1'

    beforeEach(() => {
      drive = installFakeDrive()
    })

    afterEach(async () => {
      drive.uninstall()
      await caches.delete(PAD_CACHE_NAME)
      localStorage.removeItem('padset-cache-state')
      localStorage.removeItem('padset-selection')
    })

    async function uploadSet(name: string) {
      const zip = await buildZip(
        PAD_FILE_KEYS.map(key => ({ name: `${name} - ${key}.mp3`, data: audioOf(key) })),
        `${name}.zip`
      )
      return uploadPadSet(zip, name)
    }

    it('are left out unless asked for, and their size is known beforehand', async () => {
      await fill()
      const set = await uploadSet('Warm')
      expect(await padSetSize(set)).to.equal(
        PAD_FILE_KEYS.reduce((total, key) => total + audioOf(key).length, 0)
      )
      const zip = await readZip(await createBackup(source, 'S'))
      expect(zip.entries.some(entry => entry.fileName.startsWith('pads/'))).to.equal(false)
    })

    it('are put in the zip when asked, and restored to Drive from it', async () => {
      await fill()
      const set = await uploadSet('Warm Pad')
      const blob = await createBackup(source, 'S', await readPadSetsForBackup([set]))
      const backup = await readBackup(blob)
      expect(backup.manifest.counts.padSets).to.equal(1)
      expect(backup.manifest.padSets.map(each => each.name)).to.deep.equal(['Warm Pad'])
      const audio = await backup.padAudio(must(backup.manifest.padSets[0]).dir)
      expect([...audio.keys()].sort()).to.deep.equal([...PAD_FILE_KEYS].sort())

      // Gone from Drive, then restored from the backup (only the sets asked for)
      for (const file of drive.listFiles((f: any) => f.parents?.includes(set.id))) {
        drive.files.delete(file.id)
      }
      drive.files.delete(set.id)
      expect(await restorePadSets(backup, ['Not in it'])).to.deep.equal([])
      expect(await restorePadSets(backup, ['Warm Pad'])).to.deep.equal(['Warm Pad'])

      const restored = must((await listPadSets(true)).find(each => each.name === 'Warm Pad'))
      const files = drive.listFiles((f: any) => f.parents?.includes(restored.id))
      expect(files).to.have.length(PAD_FILE_KEYS.length)
      for (const file of files) {
        const key = file.name.replace('.mp3', '')
        expect([...binaryStringToBytes(file.content)]).to.deep.equal([...audioOf(key)])
      }
    })

    it('has a pad set with a pad missing in the zip restored as far as the set allows', async () => {
      const backup = await readBackup(
        await createBackup(source, 'S', [{ name: 'Short', audio: new Map([['C', audioOf('C')]]) }])
      )
      let message = ''
      try {
        await restorePadSets(backup, ['Short'])
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.contain('Missing keys')
    })
  })
})
