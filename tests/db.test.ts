import { expect } from '@open-wc/testing'
import { setlistHasLocalChanges } from '../src/js/sync/changes.ts'
import { deleteDatabase, suppressConsoleLogs, uniqueName } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

import { ChordlessDB, createSetlist, parseTempo } from '../src/js/db.ts'
import { setlistContentHash } from '../src/js/sync/setlist-hash.ts'
import { transactionDone, transactionError } from '../src/js/utils/idb.ts'
import { must } from './must.ts'

describe('ChordlessDB', () => {
  let db

  afterEach(async () => {
    if (db?.dbName) {
      await deleteDatabase(db.dbName)
      db = null
    }
  })

  it('records who made a setlist, apart from its leader, only when it is known', () => {
    const made = createSetlist({
      owner: 'Leader',
      ownerId: 'leader@example.com',
      createdBy: 'me@example.com',
    })
    expect(made.createdBy).to.equal('me@example.com')
    expect(made.ownerId).to.equal('leader@example.com')
    expect('createdBy' in createSetlist({ owner: 'Leader' })).to.equal(false)
  })

  it('saves and retrieves setlist', async () => {
    const orgName = `TEST-${uniqueName()}`
    db = new ChordlessDB(orgName)
    await db.init()

    const setlist = createSetlist({
      date: '2024-09-01',
      time: '09:30',
      type: 'Church Service',
      name: 'Morning Service',
      owner: 'Alice',
    })

    setlist.songs.push({
      order: 0,
      songId: 'song-1',
      songUuid: 'uuid-1',
      key: null,
      tempo: null,
      notes: '',
    })

    await db.saveSetlist(setlist)

    const loaded = await db.getSetlist(setlist.id)
    expect(loaded.name).to.equal('Morning Service')
    expect(loaded.owner).to.equal('Alice')
    expect(loaded.songs).to.have.lengthOf(1)
  })
})

describe('ChordlessDB stores tempos as numbers', () => {
  let db

  afterEach(async () => {
    db.db.close()
    await deleteDatabase(db.dbName)
  })

  it('whatever its save methods are given, and returns what it stored', async () => {
    db = new ChordlessDB(`TEST-${uniqueName()}`)
    await db.init()

    const saved = await db.saveSong({ uuid: 'a', id: 'a', tempo: '72', originalTempo: '150 (1/8)' })
    expect([saved.tempo, saved.originalTempo]).to.deep.equal([72, 150])
    expect((await db.getSong('a')).tempo).to.equal(72)
    await db.saveSongsBatch([{ uuid: 'b', id: 'b', tempo: '96', originalTempo: null }])
    expect((await db.getSong('b')).tempo).to.equal(96)
    expect((await db.getSong('b')).originalTempo).to.equal(null)

    const entries = tempo => [{ order: 0, songId: 'a', songUuid: 'a', key: 'G', tempo }]
    const setlist = await db.saveSetlist({ id: 's1', songs: entries('80') })
    expect(setlist.songs[0].tempo).to.equal(80)
    expect((await db.getSetlist('s1')).songs[0].tempo).to.equal(80)
    await db.saveSetlistsBatch([
      { id: 's2', songs: entries('120 bpm') },
      { id: 's3', songs: entries(null) },
    ])
    expect((await db.getSetlist('s2')).songs[0].tempo).to.equal(120)
    expect((await db.getSetlist('s3')).songs[0].tempo).to.equal(null)
  })
})

describe('ChordlessDB version 6: tempos become numbers', () => {
  let dbName

  afterEach(async () => {
    await deleteDatabase(dbName)
  })

  /** A version 5 database, as before, holding these songs and setlists */
  function makeVersion5({ songs, setlists }) {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 5)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('songs', { keyPath: 'uuid' }).createIndex('id', 'id')
        db.createObjectStore('chordpro', { keyPath: 'id' })
        db.createObjectStore('setlists', { keyPath: 'id' })
        db.createObjectStore('setlist_local', { keyPath: 'setlistId' })
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['songs', 'setlists'], 'readwrite')
        for (const song of songs) tx.objectStore('songs').put(song)
        for (const setlist of setlists) tx.objectStore('setlists').put(setlist)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }

  it("converts songs' and setlist entries' tempos, keeping in-sync setlists in sync", async () => {
    const orgId = `TEST-${uniqueName()}`
    dbName = orgId
    const entries = tempo => [{ order: 0, songId: 'song-1', songUuid: 'uuid-1', key: 'G', tempo }]
    const inSync: any = { id: 'in-sync', driveFileId: 'drive-1', songs: entries('72') }
    inSync.syncedContentHash = setlistContentHash(inSync)
    const edited: any = { id: 'edited', driveFileId: 'drive-2', songs: entries('80') }
    edited.syncedContentHash = 'hash-of-something-else'
    await makeVersion5({
      songs: [
        { uuid: 'uuid-1', id: 'song-1', tempo: '150 (1/8)', originalTempo: '150 (1/8)' },
        { uuid: 'uuid-2', id: 'song-2', tempo: 96, originalTempo: null },
      ],
      setlists: [inSync, edited],
    })

    const db = new ChordlessDB(orgId)
    await db.init()
    const song = must(await db.getSong('uuid-1'))
    expect([song.tempo, song.originalTempo]).to.deep.equal([150, 150])
    expect(must(await db.getSong('uuid-2')).tempo).to.equal(96)

    const migratedInSync = must(await db.getSetlist('in-sync'))
    expect(migratedInSync.songs[0].tempo).to.equal(72)
    expect(setlistHasLocalChanges(migratedInSync)).to.equal(false)
    const migratedEdited = must(await db.getSetlist('edited'))
    expect(migratedEdited.songs[0].tempo).to.equal(80)
    expect(setlistHasLocalChanges(migratedEdited)).to.equal(true)
    must(db.db).close()
  })
})

describe('transactionError', () => {
  it("is the failed request's error, not the transaction's null", async () => {
    const name = `idb-test-${crypto.randomUUID()}`
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1)
      open.onupgradeneeded = () => {
        open.result.createObjectStore('things', { keyPath: 'id' }).createIndex('name', 'name', {
          unique: true,
        })
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })

    const tx = db.transaction('things', 'readwrite')
    tx.objectStore('things').put({ id: 1, name: 'same' })
    tx.objectStore('things').put({ id: 2, name: 'same' })
    const error = await new Promise<unknown>(resolve => {
      tx.onerror = event => resolve(transactionError(event, tx))
    })

    db.close()
    indexedDB.deleteDatabase(name)
    expect(error).to.be.instanceOf(DOMException)
    expect((error as DOMException).name).to.equal('ConstraintError')
  })
})

describe('ChordlessDB usage aggregation', () => {
  let db

  afterEach(async () => {
    if (db?.dbName) {
      await deleteDatabase(db.dbName)
      db = null
    }
  })

  it('aggregates song appearances across setlists', async () => {
    const orgName = `TEST-${uniqueName()}`
    db = new ChordlessDB(orgName)
    await db.init()

    const setlists = [
      {
        id: crypto.randomUUID(),
        date: '2024-01-01',
        name: 'New Year',
        owner: 'Leader A',
        songs: [
          { order: 0, songId: 'song-1', songUuid: 'uuid-1', key: 'C', tempo: null, notes: '' },
          { order: 1, songId: 'song-2', songUuid: 'uuid-2', key: 'G', tempo: null, notes: '' },
        ],
        createdDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      },
      {
        id: crypto.randomUUID(),
        date: '2024-02-01',
        name: 'February',
        owner: 'Leader B',
        songs: [
          { order: 0, songId: 'song-1', songUuid: 'uuid-1', key: 'D', tempo: null, notes: '' },
        ],
        createdDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      },
    ]

    for (const setlist of setlists) {
      await db.saveSetlist(setlist)
    }

    const usage = await db.getSongUsageFromSetlists('song-1')
    expect(usage).to.have.lengthOf(2)
    expect(usage[0].leader).to.equal('Leader B') // sorted by date desc
    expect(usage[1].leader).to.equal('Leader A')
  })
})

describe('transactionDone', () => {
  const open = (name: string) =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('things', { keyPath: 'id' }).createIndex('name', 'name', {
          unique: true,
        })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

  it('resolves with what it is given once the transaction has committed', async () => {
    const name = `idb-test-${crypto.randomUUID()}`
    const db = await open(name)
    const tx = db.transaction('things', 'readwrite')
    tx.objectStore('things').put({ id: 1, name: 'one' })
    expect(await transactionDone(tx, 'kept')).to.equal('kept')
    const again = db.transaction('things', 'readwrite')
    again.objectStore('things').put({ id: 2, name: 'two' })
    expect(await transactionDone(again)).to.equal(undefined)
    db.close()
    await deleteDatabase(name)
  })

  it('rejects with why the transaction failed', async () => {
    const name = `idb-test-${crypto.randomUUID()}`
    const db = await open(name)
    const tx = db.transaction('things', 'readwrite')
    tx.objectStore('things').put({ id: 1, name: 'same' })
    tx.objectStore('things').put({ id: 2, name: 'same' })
    let error: unknown
    try {
      await transactionDone(tx)
    } catch (caught) {
      error = caught
    }
    db.close()
    await deleteDatabase(name)
    expect((error as DOMException).name).to.equal('ConstraintError')
  })
})

describe('ChordlessDB opening', () => {
  it('fails when the database cannot be opened', async () => {
    const name = `TEST-${uniqueName()}`
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 99)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    let message = ''
    try {
      await new ChordlessDB(name).init()
    } catch (error) {
      message = (error as Error).message
    }
    await deleteDatabase(name)
    expect(message).to.equal('Failed to open IndexedDB')
  })

  it('needs an organisation, and to be opened before it is used', async () => {
    expect(() => new ChordlessDB('')).to.throw('organisationId is required')
    let message = ''
    try {
      await new ChordlessDB('never-opened').getSetlist('x')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.contain('not initialised')
  })

  it('removes a store an earlier version had, when it upgrades', async () => {
    const name = `TEST-${uniqueName()}`
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 5)
      request.onupgradeneeded = () => {
        const old = request.result
        old.createObjectStore('songs', { keyPath: 'uuid' })
        old.createObjectStore('chordpro', { keyPath: 'id' })
        old.createObjectStore('setlists', { keyPath: 'id' })
        old.createObjectStore('setlist_local', { keyPath: 'setlistId' })
        old.createObjectStore('song_usage', { keyPath: 'id' })
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    const db = new ChordlessDB(name)
    await db.init()
    expect([...(db.db?.objectStoreNames ?? [])]).to.not.include('song_usage')
    db.db?.close()
    await deleteDatabase(name)
  })
})

describe('ChordlessDB storing what IndexedDB cannot', () => {
  let db: ChordlessDB
  afterEach(async () => {
    db.db?.close()
    await deleteDatabase(db.dbName)
  })

  it('stores dates as text, and leaves out functions, promises and symbols', async () => {
    db = new ChordlessDB(`TEST-${uniqueName()}`)
    await db.init()
    const setlist = {
      ...createSetlist({ date: '2026-10-11' }),
      id: 'odd',
      extras: {
        when: new Date('2026-10-11T10:00:00Z'),
        later: Promise.resolve(1),
        run: () => 1,
        mark: Symbol('s'),
        big: 10n,
        list: [new Date('2026-01-01T00:00:00Z'), { fine: true }, () => 1],
        nothing: undefined,
        zero: null,
      },
    }
    await db.saveSetlist(setlist as never)
    const stored = must(await db.getSetlist('odd')) as unknown as {
      extras: Record<string, unknown>
    }
    expect(stored.extras).to.deep.equal({
      when: '2026-10-11T10:00:00.000Z',
      later: null,
      big: '10',
      list: ['2026-01-01T00:00:00.000Z', { fine: true }, undefined],
      zero: null,
    })
  })
})

describe('parseTempo', () => {
  it('takes the beats per minute, with a quarter note unless it says otherwise', () => {
    expect(parseTempo(null)).to.deep.equal({ bpm: null, note: '1/4' })
    expect(parseTempo('')).to.deep.equal({ bpm: null, note: '1/4' })
    expect(parseTempo(150)).to.deep.equal({ bpm: 150, note: '1/4' })
    expect(parseTempo('61 bpm')).to.deep.equal({ bpm: 61, note: '1/4' })
    expect(parseTempo('fast')).to.deep.equal({ bpm: null, note: '1/4' })
  })

  it('reads the note it is counted in, as a fraction or in words', () => {
    expect(parseTempo('150 (1/8)').note).to.equal('1/8')
    expect(parseTempo('150 (8th note)').note).to.equal('1/8')
    expect(parseTempo('150 (Eighth)').note).to.equal('1/8')
    expect(parseTempo('90 (16th)').note).to.equal('1/16')
    expect(parseTempo('90 (sixteenth notes)').note).to.equal('1/16')
    expect(parseTempo('60 (half note)').note).to.equal('1/2')
    expect(parseTempo('30 (whole note)').note).to.equal('1/1')
    expect(parseTempo('120 (swung)').note).to.equal('1/4')
  })
})
