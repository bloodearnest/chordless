import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { LocalChangeEvent, noteLocalChange } from '../src/js/local-changes.ts'
import { hashText } from '../src/js/song-utils.ts'
import { makeSetlist, makeSong } from './builders.ts'
import { deleteDatabase, suppressConsoleLogs, uniqueName } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

describe('Telling the sync of changes made here', () => {
  let db: ChordlessDB | null = null
  afterEach(async () => {
    if (db) {
      db.db?.close()
      await deleteDatabase(db.dbName)
      db = null
    }
  })

  /** How many changes were told while `work` ran */
  async function told(work: (db: ChordlessDB) => Promise<unknown>, quiet = false) {
    db = new ChordlessDB(uniqueName())
    await db.init()
    db.quiet = quiet
    let count = 0
    const listener = () => count++
    window.addEventListener(LocalChangeEvent.type, listener)
    try {
      await work(db)
    } finally {
      window.removeEventListener(LocalChangeEvent.type, listener)
    }
    return count
  }

  it('tells of a setlist, a song and a chart saved, and of a setlist and a song deleted', async () => {
    const setlist = makeSetlist({ id: 'setlist-1' })
    expect(await told(d => d.saveSetlist(setlist))).to.equal(1)
    expect(await told(d => d.saveSong(makeSong({ uuid: 'song-1' })))).to.equal(1)
    expect(
      await told(d =>
        d.saveChordPro({ id: 'c1', content: 'x', contentHash: hashText('x'), lastModified: 1 })
      )
    ).to.equal(1)
    expect(
      await told(async d => {
        await d.saveSetlist(setlist)
        await d.deleteSetlist(setlist.id)
      })
    ).to.equal(2)
    expect(
      await told(async d => {
        await d.saveSong(makeSong({ uuid: 'song-2' }))
        await d.deleteSong('song-2')
      })
    ).to.equal(2)
  })

  it('says nothing of what a sync saves in batches, or of a delete of nothing', async () => {
    expect(
      await told(async d => {
        await d.saveSetlistsBatch([makeSetlist({ id: 'setlist-2' })])
        await d.saveSongsBatch([makeSong({ uuid: 'song-3' })])
        await d.deleteSong('no-such-song')
      })
    ).to.equal(0)
  })

  it('says nothing from a database that is quiet: a sync’s own', async () => {
    expect(await told(d => d.saveSetlist(makeSetlist({ id: 'setlist-3' })), true)).to.equal(0)
  })

  it('can be told of by anyone with noteLocalChange', async () => {
    let count = 0
    const listener = () => count++
    window.addEventListener(LocalChangeEvent.type, listener)
    noteLocalChange()
    window.removeEventListener(LocalChangeEvent.type, listener)
    expect(count).to.equal(1)
  })
})

describe('Saving a setlist whose copy was made before it was sent', () => {
  let db: ChordlessDB
  afterEach(async () => {
    db.db?.close()
    await deleteDatabase(db.dbName)
  })

  async function open(quiet = false) {
    db = new ChordlessDB(uniqueName())
    await db.init()
    db.quiet = quiet
  }
  const link = {
    fileRef: 'file-1',
    fileModified: '2026-10-24T08:43:31.439Z',
    fileRev: 'rev-1',
    lastSyncedAt: '2026-10-24T08:43:32.000Z',
    syncedContentHash: 'hash-1',
  }

  it('keeps the link to its file: a sync sent it after the copy was made', async () => {
    await open()
    const copy = makeSetlist({ id: 'late-link' })
    await db.saveSetlist(copy)
    // (the sync sends it: its own database is quiet, and saves the link)
    const sync = new ChordlessDB(db.dbName)
    await sync.init()
    sync.quiet = true
    await sync.saveSetlist({ ...copy, ...link })
    sync.db?.close()

    await db.saveSetlist({ ...copy, songs: [] })

    expect(await db.getSetlist('late-link')).to.include(link)
  })

  it('leaves what a sync saves as it is: it is the one that sets the link', async () => {
    await open(true)
    await db.saveSetlist({ ...makeSetlist({ id: 'sync-own' }), ...link })
    await db.saveSetlist({ ...makeSetlist({ id: 'sync-own' }), fileRef: null })
    expect((await db.getSetlist('sync-own'))?.fileRef).to.equal(null)
  })

  it('saves a setlist that is not in Drive as it is', async () => {
    await open()
    await db.saveSetlist(makeSetlist({ id: 'never-sent' }))
    await db.saveSetlist(makeSetlist({ id: 'never-sent', name: 'Renamed' }))
    const saved = await db.getSetlist('never-sent')
    expect(saved?.name).to.equal('Renamed')
    expect(saved?.fileRef).to.equal(undefined)
  })
})

describe('Saving a song whose copy was made before it was sent', () => {
  it('keeps the link to its file', async () => {
    const db = new ChordlessDB(uniqueName())
    await db.init()
    try {
      await db.saveSong(makeSong({ uuid: 'late-song', id: 'late-song' }))
      const sync = new ChordlessDB(db.dbName)
      await sync.init()
      sync.quiet = true
      await sync.saveSong({
        ...makeSong({ uuid: 'late-song', id: 'late-song' }),
        fileRef: 'file-9',
        fileRev: 'rev-9',
        lastSyncedAt: '2026-10-24T08:43:32.000Z',
      })
      sync.db?.close()

      await db.saveSong(makeSong({ uuid: 'late-song', id: 'late-song', title: 'Renamed' }))

      const saved = await db.getSong('late-song')
      expect(saved?.title).to.equal('Renamed')
      expect(saved?.fileRef).to.equal('file-9')
      expect(saved?.fileRev).to.equal('rev-9')
    } finally {
      db.db?.close()
      await deleteDatabase(db.dbName)
    }
  })
})
