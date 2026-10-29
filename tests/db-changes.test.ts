import { expect } from '@open-wc/testing'
import { DataChangeEvent, type DataOrigin } from '../src/js/data-changes.ts'
import { ChordlessDB, NO_CHANGE, openSpace } from '../src/js/db.ts'
import { hashText } from '../src/js/song-utils.ts'
import { makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs, uniqueName } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

describe('Telling of what is written (the change bus)', () => {
  let db: ChordlessDB | null = null
  afterEach(async () => {
    if (db) {
      db.db?.close()
      await deleteDatabase(db.dbName)
      db = null
    }
  })

  /** The changes announced while `work` ran, as 'kind:ids:origin' */
  async function announced(work: (db: ChordlessDB) => Promise<unknown>, origin?: DataOrigin) {
    db = new ChordlessDB(uniqueName(), origin)
    await db.init()
    const seen: string[] = []
    const listener = ({ change }: DataChangeEvent) => {
      if (change.spaceId !== db?.spaceId) return
      seen.push(
        `${change.kind}:${change.ids === null ? 'all' : change.ids.join(',')}:${change.origin}`
      )
    }
    window.addEventListener(DataChangeEvent.type, listener)
    try {
      await work(db)
    } finally {
      window.removeEventListener(DataChangeEvent.type, listener)
    }
    return seen
  }

  const chart = { id: 'c1', content: 'x', contentHash: hashText('x'), lastModified: 1 }

  it('tells of a setlist, a song and a chart saved, and of a setlist and a song deleted', async () => {
    expect(await announced(d => d.saveSetlist(makeSetlist({ id: 'setlist-1' })))).to.deep.equal([
      'setlist:setlist-1:local',
    ])
    expect(await announced(d => d.saveSong(makeSong({ uuid: 'song-1' })))).to.deep.equal([
      'song:song-1:local',
    ])
    expect(await announced(d => d.saveChordPro(chart))).to.deep.equal(['chart:c1:local'])
    expect(
      await announced(async d => {
        await d.saveSetlist(makeSetlist({ id: 'setlist-2' }))
        await d.deleteSetlist('setlist-2')
      })
    ).to.deep.equal(['setlist:setlist-2:local', 'setlist:setlist-2:local'])
    expect(
      await announced(async d => {
        await d.saveChordPro(chart)
        await d.saveSong(makeSong({ uuid: 'song-2', chordproFileId: 'c1' }))
        await d.deleteSong('song-2')
      })
    ).to.deep.equal(['chart:c1:local', 'song:song-2:local', 'chart:c1:local', 'song:song-2:local'])
  })

  it('tells of what is saved in batches, and of what is recorded as sent', async () => {
    const seen = await announced(async d => {
      await d.saveSetlistsBatch([makeSetlist({ id: 'a' }), makeSetlist({ id: 'b' })])
      await d.saveSongsBatch([makeSong({ uuid: 's1' })])
      await d.saveSetlistsSent([makeSetlist({ id: 'a', fileRef: 'f' })])
      await d.saveSongsSent([{ ...must(await d.getSong('s1')), fileRef: 'f' }])
    })
    expect(seen).to.deep.equal([
      'setlist:a,b:local',
      'song:s1:local',
      'setlist:a:local',
      'song:s1:local',
    ])
  })

  it('tells of everything cleared, and of every link let go, as all of that kind', async () => {
    expect(await announced(d => d.clearSyncedData())).to.deep.equal([
      'setlist:all:local',
      'song:all:local',
      'chart:all:local',
      'person:all:local',
    ])
    expect(await announced(d => d.clearFileLinks())).to.deep.equal([
      'setlist:all:local',
      'song:all:local',
      'person:all:local',
    ])
    expect(await announced(d => d.clearAll())).to.have.length(4)
  })

  it('tells of the records whose files were let go, and of nothing when there were none', async () => {
    expect(await announced(d => d.unlinkFiles(new Set(['no-such-file'])))).to.deep.equal([])
    const seen = await announced(async d => {
      await d.saveSetlist(makeSetlist({ id: 'linked', fileRef: 'file-1' }))
      await d.unlinkFiles(new Set(['file-1']))
    })
    expect(seen.slice(1)).to.deep.equal(['setlist:all:local', 'song:all:local'])
  })

  it('says nothing of a delete of nothing', async () => {
    expect(await announced(d => d.deleteSong('no-such-song'))).to.deep.equal([])
  })

  it('names the origin: a sync’s handle writes as the sync', async () => {
    expect(
      await announced(d => d.saveSetlist(makeSetlist({ id: 'from-storage' })), 'sync')
    ).to.deep.equal(['setlist:from-storage:sync'])
  })

  it('opens the database of a space with the origin asked for', async () => {
    const opened = await openSpace(uniqueName(), 'sync')
    try {
      expect(opened.origin).to.equal('sync')
    } finally {
      opened.db?.close()
      await deleteDatabase(opened.dbName)
    }
  })
})

describe('Saving a setlist whose copy was made before it was sent', () => {
  let db: ChordlessDB
  afterEach(async () => {
    db.db?.close()
    await deleteDatabase(db.dbName)
  })

  async function open(origin: DataOrigin = 'local') {
    db = new ChordlessDB(uniqueName(), origin)
    await db.init()
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
    // (the sync sends it: its own handle saves the link)
    const sync = new ChordlessDB(db.dbName, 'sync')
    await sync.init()
    await sync.saveSetlist({ ...copy, ...link })
    sync.db?.close()

    await db.saveSetlist({ ...copy, songs: [] })

    expect(await db.getSetlist('late-link')).to.include(link)
  })

  it('leaves what a sync saves as it is: it is the one that sets the link', async () => {
    await open('sync')
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
      const sync = new ChordlessDB(db.dbName, 'sync')
      await sync.init()
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

describe('Changing a record as it is stored', () => {
  let db: ChordlessDB
  afterEach(async () => {
    db.db?.close()
    await deleteDatabase(db.dbName)
  })

  async function open() {
    db = new ChordlessDB(uniqueName())
    await db.init()
  }

  /** The changes announced for this database while `work` ran, as 'kind:ids' */
  async function announced(work: () => Promise<unknown>) {
    const seen: string[] = []
    const listener = ({ change }: DataChangeEvent) => {
      if (change.spaceId === db.spaceId) seen.push(`${change.kind}:${change.ids?.join(',')}`)
    }
    window.addEventListener(DataChangeEvent.type, listener)
    try {
      await work()
    } finally {
      window.removeEventListener(DataChangeEvent.type, listener)
    }
    return seen
  }

  it('changes a setlist on what is stored, so a link a sync saved meanwhile is kept', async () => {
    await open()
    const copy = makeSetlist({ id: 'updated' })
    await db.saveSetlist(copy)
    const sync = new ChordlessDB(db.dbName, 'sync')
    await sync.init()
    await sync.saveSetlist({ ...copy, fileRef: 'file-3', fileRev: 'rev-3' })
    sync.db?.close()

    let seen: string | null | undefined
    const seenAnnounced = await announced(async () => {
      const stored = await db.updateSetlist('updated', setlist => {
        seen = setlist.fileRef
        setlist.name = 'Changed'
      })
      expect(stored).to.include({ name: 'Changed', fileRef: 'file-3' })
    })

    expect(seen).to.equal('file-3')
    expect(await db.getSetlist('updated')).to.include({ name: 'Changed', fileRef: 'file-3' })
    expect(seenAnnounced).to.deep.equal(['setlist:updated'])
  })

  it('leaves a setlist as it is when the change says false, and says so of one that is not there', async () => {
    await open()
    await db.saveSetlist(makeSetlist({ id: 'kept', name: 'Kept' }))
    const told = await announced(async () => {
      const stored = await db.updateSetlist('kept', setlist => {
        setlist.name = 'Not saved'
        return NO_CHANGE
      })
      expect(stored).to.equal(undefined)
      expect(await db.updateSetlist('nothing', () => undefined)).to.equal(undefined)
    })
    expect((await db.getSetlist('kept'))?.name).to.equal('Kept')
    expect(told).to.deep.equal([])
  })

  it('changes the setlist whatever the change returns, unless it returns NO_CHANGE', async () => {
    await open()
    await db.saveSetlist(makeSetlist({ id: 'returns', name: 'Before' }))
    // (an expression that happens to be false must not be taken for "leave it")
    await db.updateSetlist('returns', setlist => {
      setlist.name = 'After'
      return false
    })
    expect((await db.getSetlist('returns'))?.name).to.equal('After')
  })

  it('changes a song the same way, and saves its tempo as a number', async () => {
    await open()
    await db.saveSong(makeSong({ uuid: 'song-u', id: 'song-u' }))
    const sync = new ChordlessDB(db.dbName, 'sync')
    await sync.init()
    await sync.saveSong({ ...makeSong({ uuid: 'song-u', id: 'song-u' }), fileRef: 'file-4' })
    sync.db?.close()

    const told = await announced(async () => {
      const stored = await db.updateSong('song-u', song => {
        song.title = 'Retitled'
        song.tempo = '96' as never
      })
      expect(stored).to.include({ title: 'Retitled', fileRef: 'file-4', tempo: 96 })
      expect(await db.updateSong('song-u', () => NO_CHANGE)).to.equal(undefined)
      expect(await db.updateSong('nothing', () => undefined)).to.equal(undefined)
    })
    expect(told).to.deep.equal(['song:song-u'])
  })
})
