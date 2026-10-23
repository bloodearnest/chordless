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
