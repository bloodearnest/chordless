import { expect } from '@open-wc/testing'
import type { SpaceOutboxRecord } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { ulid } from '../src/js/ulid.ts'
import { requestResult, transactionDone } from '../src/js/utils/idb.ts'
import { makeEntry, makeLocalState, makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import { oldDatabase, SCHEMA_V15 } from './old-database.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, afterEach } = window
let db: ChordlessDB

afterEach(async () => {
  if (!db) return
  db.db?.close()
  await deleteDatabase(db.dbName)
})

async function open(): Promise<ChordlessDB> {
  db = new ChordlessDB(`test-space-data-${crypto.randomUUID()}`)
  await db.init()
  return db
}

describe('device space data', () => {
  it('upgrades existing metadata without losing charts, links, identities or local state', async () => {
    const song = makeSong({ fileRef: 'drive-chart', ccliNumber: '123' })
    const setlist = makeSetlist({ songs: [makeEntry({ key: 'D', tempo: 90, notes: 'Twice' })] })
    const local = makeLocalState(setlist.id)
    const chart = {
      id: song.chordproFileId,
      content: '{title: Song}\n{ccli_license: 456}\n[C]Words',
    }
    const name = await oldDatabase(15, SCHEMA_V15, {
      songs: [song],
      setlists: [setlist],
      chordpro: [chart],
      setlist_local: [local],
      people: [{ id: 'person', name: 'Leader', emails: [], modifiedDate: song.modifiedDate }],
    })
    db = new ChordlessDB(name)
    await db.init()
    expect(await db.getSong(song.uuid)).to.deep.equal({ ...song, version: null })
    expect(await db.getChordPro(chart.id)).to.deep.equal(chart)
    expect(await db.getLocalState(setlist.id)).to.deep.equal(local)
    expect((await db.getAllPeople())[0].version).to.equal(null)
    expect(must(await db.getSetlist(setlist.id)).songs).to.deep.equal([
      { ...setlist.songs[0], title: 'Song', ccli: '123' },
    ])
    const indexed = must(await db.getSongIndex(song.uuid))
    expect(indexed.fileRef).to.equal('drive-chart')
    expect(indexed.licence).to.equal('456')
    expect(indexed.version).to.equal(null)
    expect(indexed).not.to.have.property('copyright')
    expect(indexed).not.to.have.property('chordproFileId')
  })

  it('seeds no outbox edits during upgrade and preserves labels for songs already missing', async () => {
    const entry = makeEntry({ title: 'Missing song', ccli: '789' })
    db = new ChordlessDB(
      await oldDatabase(15, SCHEMA_V15, {
        setlists: [makeSetlist({ songs: [entry] })],
      })
    )
    await db.init()
    expect(must(await db.getSetlist('setlist-1')).songs).to.deep.equal([entry])
    const tx = must(db.db).transaction('space_outbox')
    expect(await requestResult(tx.objectStore('space_outbox').count())).to.equal(0)
  })

  it('maintains the index through individual, updated, batch and Drive-acknowledged song writes', async () => {
    await open()
    await db.saveSong(makeSong())
    await db.updateSong('song-uuid', song => {
      song.title = 'Renamed'
    })
    expect(must(await db.getSongIndex('song-uuid')).title).to.equal('Renamed')
    await db.saveSongsBatch([makeSong({ title: 'Batch', variantLabel: 'Acoustic' })])
    await db.saveSongsSent([
      makeSong({ title: 'Stale title', fileRef: 'drive-id' }) as Awaited<
        ReturnType<ChordlessDB['saveSong']>
      >,
    ])
    const indexed = must(await db.getSongIndex('song-uuid'))
    expect(indexed.title).to.equal('Batch')
    expect(indexed.variantLabel).to.equal('Acoustic')
    expect(indexed.fileRef).to.equal('drive-id')
    await db.deleteSong('song-uuid')
    expect(await db.getSongIndex('song-uuid')).to.equal(undefined)
  })

  it('keeps the index readable independently of a chart and preserves its D1 revision', async () => {
    await open()
    const song = await db.saveSong(makeSong())
    const indexed = must(await db.getSongIndex(song.uuid))
    const tx = must(db.db).transaction('song_index', 'readwrite')
    tx.objectStore('song_index').put({ ...indexed, version: 7, licence: '123' })
    await transactionDone(tx)
    await db.updateSong(song.uuid, song => {
      song.title = 'Changed'
    })
    expect(await db.getChordPro(song.chordproFileId)).to.equal(undefined)
    expect(must(await db.getSongIndex(song.uuid))).to.include({
      title: 'Changed',
      version: 7,
      licence: '123',
    })
  })

  it('fills and refreshes entry labels, keeping keys, tempos, notes and missing-song labels', async () => {
    await open()
    await db.saveSong(makeSong({ ccliNumber: '123' }))
    const missing = makeEntry({
      songId: 'title-absent',
      songUuid: 'missing',
      title: 'Absent',
      ccli: '456',
    })
    const saved = await db.saveSetlist(
      makeSetlist({ songs: [makeEntry({ key: 'E', tempo: 120, notes: 'Repeat' }), missing] })
    )
    expect(saved.songs[0]).to.include({ title: 'Song', ccli: '123' })
    await db.updateSong('song-uuid', song => {
      song.title = 'New title'
      song.ccliNumber = null
    })
    const refreshed = must(await db.refreshSetlistMetadata(saved.id))
    expect(refreshed.songs[0]).to.include({
      title: 'New title',
      ccli: null,
      key: 'E',
      tempo: 120,
      notes: 'Repeat',
    })
    expect(refreshed.songs[1]).to.deep.equal(missing)
    expect(await db.refreshSetlistMetadata('absent')).to.equal(undefined)
  })

  it('refreshes old entries and missing variants from the default, without changing their references', async () => {
    await open()
    await db.saveSongsBatch([
      makeSong({ uuid: 'variant', isDefault: false, title: 'Other arrangement' }),
      makeSong({ uuid: 'default', title: 'Default arrangement', ccliNumber: '123' }),
    ])
    const entry = makeEntry({ songUuid: 'removed-variant' })
    const saved = await db.saveSetlist(makeSetlist({ songs: [entry] }))
    expect(saved.songs[0]).to.include({
      title: 'Default arrangement',
      ccli: '123',
      songUuid: 'removed-variant',
    })
    expect(must(await db.getSetlist(saved.id, { refreshMetadata: true })).songs).to.deep.equal(
      saved.songs
    )
  })

  it('forgets index file links with the content links, retaining metadata and revisions', async () => {
    await open()
    await db.saveSongsBatch([
      makeSong({ uuid: 'first', fileRef: 'drive-first' }),
      makeSong({ uuid: 'second', fileRef: 'drive-second' }),
    ])
    await db.unlinkFiles(new Set(['drive-first']))
    expect(must(await db.getSongIndex('first')).fileRef).to.equal(null)
    expect(must(await db.getSongIndex('second')).fileRef).to.equal('drive-second')
    await db.clearFileLinks()
    expect(must(await db.getSongIndex('second'))).to.include({ title: 'Song', fileRef: null })
  })

  it('stores ordered outbox changes with their merge base, and clears new stores on a full reset', async () => {
    await open()
    const first: SpaceOutboxRecord = {
      id: ulid(),
      change: { kind: 'song', op: 'delete', id: 'song', baseVersion: 3 },
      base: { title: 'Before', version: 3 },
    }
    const second: SpaceOutboxRecord = { ...first, id: ulid() }
    const tx = must(db.db).transaction(['space_outbox', 'pad_sets'], 'readwrite')
    tx.objectStore('space_outbox').put(second)
    tx.objectStore('space_outbox').put(first)
    tx.objectStore('pad_sets').put({ padSetId: 'pad-set', name: 'Pads', version: null })
    await transactionDone(tx)
    const read = must(db.db).transaction('space_outbox')
    expect(await requestResult(read.objectStore('space_outbox').getAll())).to.deep.equal([
      first,
      second,
    ])
    await db.saveSong(makeSong())
    await db.clearAll()
    for (const name of ['space_outbox', 'pad_sets', 'song_index']) {
      const read = must(db.db).transaction(name)
      expect(await requestResult(read.objectStore(name).count())).to.equal(0)
    }
  })
})
