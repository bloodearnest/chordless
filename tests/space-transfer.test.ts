import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { addChart } from '../src/js/song-utils.ts'
import { copySongs, transferSetlists, transferSpace } from '../src/js/space-transfer.ts'
import { makeEntry, makeLocalState, makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const ALPHA = '{title: Alpha}\n{key: G}\n[G]Alpha line'
const ALPHA_EDITED = '{title: Alpha}\n{key: G}\n[G]Alpha line, edited'
const BETA = '{title: Beta}\n{key: D}\n[D]Beta line'
const ADD = { variantLabel: 'Test', importSource: 'test', makeDefault: 'first' } as const

describe('Copying and moving between spaces', () => {
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

  /** A setlist in the source using these songs */
  async function setlistWith(id: string, ...songs: { uuid: string; id: string }[]) {
    const setlist = makeSetlist({
      id,
      date: '2026-10-25',
      songs: songs.map((song, order) =>
        makeEntry({ order, songId: song.id, songUuid: song.uuid, key: 'A' })
      ),
    })
    await source.saveSetlist(setlist)
    return setlist
  }

  it('copies songs, and a chart the destination has is not added twice', async () => {
    await addChart(source, ALPHA, ADD)
    await addChart(source, BETA, ADD)
    await addChart(destination, BETA, ADD)
    const map = await copySongs(source, destination, null)
    expect(map.size).to.equal(2)
    expect((await destination.getAllSongs()).map(song => song.title).sort()).to.deep.equal([
      'Alpha',
      'Beta',
    ])
  })

  it('counts what it added and skipped, and a second run adds nothing', async () => {
    await addChart(source, ALPHA, ADD)
    await addChart(source, BETA, ADD)
    const first = await transferSpace(source, destination, 'copy')
    expect(first.songsAdded).to.equal(2)
    const second = await transferSpace(source, destination, 'copy')
    expect(second.songsAdded).to.equal(0)
    expect(second.songsSkipped).to.equal(2)
    expect(await destination.getAllSongs()).to.have.length(2)
  })

  it('brings a different chart of a song the destination has as a variant, not the default', async () => {
    await addChart(destination, ALPHA, ADD)
    await addChart(source, ALPHA_EDITED, ADD)
    await copySongs(source, destination, null)
    const songs = await destination.getAllSongs()
    expect(songs).to.have.length(2)
    expect(songs.filter(song => song.isDefault)).to.have.length(1)
    expect(songs.find(song => !song.isDefault)?.variantOf).to.equal(
      songs.find(song => song.isDefault)?.uuid
    )
  })

  it("keeps the library's own key for a song", async () => {
    const song = await addChart(source, ALPHA, ADD)
    await source.saveSong({ ...song, key: 'B' })
    await copySongs(source, destination, null)
    expect((await destination.getAllSongs())[0].key).to.equal('B')
  })

  it('labels a copied chart that had no label, and skips a song whose chart is missing', async () => {
    await addChart(source, ALPHA, { ...ADD, variantLabel: '' })
    await source.saveSong(makeSong({ uuid: 'broken', chordproFileId: 'nowhere' }))
    const map = await copySongs(source, destination, null)
    expect(map.has('broken')).to.equal(false)
    const copied = await destination.getAllSongs()
    expect(copied).to.have.length(1)
    expect(copied[0].variantLabel).to.equal('Copied')
  })

  it('copies a setlist with new ids, pointing at the destination songs, with nothing of Drive', async () => {
    const alpha = await addChart(source, ALPHA, ADD)
    const original = await setlistWith('set-1', alpha)
    await source.saveSetlist({
      ...original,
      driveFileId: 'drive-1',
      syncedContentHash: 'hash',
      share: {
        fileId: 'f',
        key: 'k',
        created: '2026-10-01',
        expires: '2026-11-01',
        bundleHash: 'b',
      },
    })
    const report = await transferSetlists(source, destination, null, 'copy')
    expect(report.setlistsAdded).to.equal(1)

    const [copy] = await destination.getAllSetlists()
    expect(copy.id).to.not.equal('set-1')
    expect(copy.driveFileId ?? null).to.equal(null)
    expect(copy.syncedContentHash ?? null).to.equal(null)
    expect(copy.share).to.equal(undefined)
    expect(copy.songs[0].key).to.equal('A')
    const song = must(await destination.getSong(copy.songs[0].songUuid))
    expect(song.title).to.equal('Alpha')
    // the source is untouched
    expect(await source.getSetlist('set-1')).to.not.equal(undefined)
  })

  it('does not copy the same setlist twice', async () => {
    const alpha = await addChart(source, ALPHA, ADD)
    await setlistWith('set-1', alpha)
    await transferSetlists(source, destination, null, 'copy')
    const again = await transferSetlists(source, destination, null, 'copy')
    expect(again.setlistsSkipped).to.equal(1)
    expect(await destination.getAllSetlists()).to.have.length(1)
  })

  it('copies only the setlists asked for', async () => {
    const alpha = await addChart(source, ALPHA, ADD)
    const beta = await addChart(source, BETA, ADD)
    await setlistWith('set-1', alpha)
    await setlistWith('set-2', beta)
    await transferSetlists(source, destination, ['set-2'], 'copy')
    expect(await destination.getAllSetlists()).to.have.length(1)
    expect((await destination.getAllSongs()).map(song => song.title)).to.deep.equal(['Beta'])
  })

  it('moves a setlist keeping its id, and removes it and its device state from the source', async () => {
    const alpha = await addChart(source, ALPHA, ADD)
    await setlistWith('set-1', alpha)
    await source.saveLocalState(makeLocalState('set-1'))
    const report = await transferSetlists(source, destination, null, 'move')
    expect(report.setlistsAdded).to.equal(1)
    expect(report.setlistsLeftInSource).to.equal(0)
    expect(await destination.getSetlist('set-1')).to.not.equal(undefined)
    expect(await source.getSetlist('set-1')).to.equal(undefined)
  })

  it('leaves a moved setlist that is in Drive in the source, and says so', async () => {
    const alpha = await addChart(source, ALPHA, ADD)
    const set = await setlistWith('set-1', alpha)
    await source.saveSetlist({ ...set, driveFileId: 'drive-1' })
    const report = await transferSetlists(source, destination, null, 'move')
    expect(report.setlistsLeftInSource).to.equal(1)
    expect(await destination.getSetlist('set-1')).to.not.equal(undefined)
    expect(await source.getSetlist('set-1')).to.not.equal(undefined)
  })

  it('does not move over a setlist the destination has under that id, nor delete the source', async () => {
    const alpha = await addChart(source, ALPHA, ADD)
    await setlistWith('set-1', alpha)
    await destination.saveSetlist(makeSetlist({ id: 'set-1', name: 'Theirs' }))
    const report = await transferSetlists(source, destination, null, 'move')
    expect(report.setlistsSkipped).to.equal(1)
    expect((await destination.getSetlist('set-1'))?.name).to.equal('Theirs')
    expect(await source.getSetlist('set-1')).to.not.equal(undefined)
  })

  it('does not take a received setlist or a deleted one', async () => {
    const alpha = await addChart(source, ALPHA, ADD)
    const set = await setlistWith('set-1', alpha)
    await source.saveSetlist({ ...set, id: 'gone', deletedAt: '2026-10-01T00:00:00Z' })
    await transferSetlists(source, destination, null, 'copy')
    expect((await destination.getAllSetlists()).map(setlist => setlist.name)).to.have.length(1)
  })

  it('counts an entry whose song the source does not have', async () => {
    await source.saveSetlist(
      makeSetlist({ id: 'set-1', songs: [makeEntry({ songUuid: 'missing' })] })
    )
    const report = await transferSetlists(source, destination, null, 'copy')
    expect(report.entriesWithoutSong).to.equal(1)
  })

  it('moves a whole space: every song, including those no setlist uses, and the setlists', async () => {
    const alpha = await addChart(source, ALPHA, ADD)
    await addChart(source, BETA, ADD)
    await setlistWith('set-1', alpha)
    const report = await transferSpace(source, destination, 'move')
    expect(report.songsAdded).to.equal(2)
    expect(report.setlistsAdded).to.equal(1)
    expect(await destination.getAllSongs()).to.have.length(2)
    // songs are copied, not moved
    expect(await source.getAllSongs()).to.have.length(2)
    expect(await source.getAllSetlists()).to.have.length(0)
  })
})
