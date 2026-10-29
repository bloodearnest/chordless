import { expect } from '@open-wc/testing'
import { setlistHasLocalChanges } from '../src/js/sync/changes.ts'
import { deleteDatabase, suppressConsoleLogs, uniqueName } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

import {
  ChordlessDB,
  createSetlist,
  parseTempo,
  withFileFieldsRenamed,
  withOriginKept,
} from '../src/js/db.ts'
import { setlistContentHash } from '../src/js/sync/setlist-hash.ts'
import { transactionDone, transactionError } from '../src/js/utils/idb.ts'
import { makeSetlist, makeSong } from './builders.ts'
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
    const made = createSetlist({ leaderId: 'leader-1', createdBy: 'me@example.com' })
    expect(made.createdBy).to.equal('me@example.com')
    expect(made.leaderId).to.equal('leader-1')
    expect('createdBy' in createSetlist({ leaderId: 'leader-1' })).to.equal(false)
  })

  it('saves and retrieves setlist', async () => {
    const spaceName = `TEST-${uniqueName()}`
    db = new ChordlessDB(spaceName)
    await db.init()

    const setlist = createSetlist({
      date: '2024-09-01',
      time: '09:30',
      type: 'Church Service',
      name: 'Morning Service',
      leaderId: 'alice',
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
    expect(loaded.leaderId).to.equal('alice')
    expect(loaded.songs).to.have.lengthOf(1)
  })
})

describe('ChordlessDB when another window upgrades the database', () => {
  it('lets go of the database, so the upgrade is not left waiting', async () => {
    const name = `TEST-${uniqueName()}`
    const db = new ChordlessDB(name)
    await db.init()

    const upgraded = await new Promise<IDBDatabase | 'blocked'>((resolve, reject) => {
      const request = indexedDB.open(name, 99)
      request.onblocked = () => resolve('blocked')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    expect(upgraded).to.not.equal('blocked')
    ;(upgraded as IDBDatabase).close()
    indexedDB.deleteDatabase(name)
  })
})

describe('ChordlessDB forgetting Drive', () => {
  let db: ChordlessDB

  beforeEach(async () => {
    db = new ChordlessDB(`test-forget-${crypto.randomUUID()}`)
    await db.init()
  })

  afterEach(async () => {
    await deleteDatabase(db.dbName)
  })

  it('leaves every setlist and song as one Drive has never seen, with its content', async () => {
    const synced = {
      fileRef: 'file-1',
      fileModified: '2026-10-11T10:00:00.000Z',
      fileRev: 'abc',
      lastSyncedAt: '2026-10-11T10:00:00.000Z',
      syncedContentHash: 'hash',
    }
    await db.saveSetlist(
      makeSetlist({
        id: 'setlist-1',
        name: 'Sunday',
        ...synced,
        share: {
          fileId: 's',
          key: 'k',
          created: '2026-10-01',
          expires: '2026-12-01',
          bundleHash: 'h',
        },
      })
    )
    await db.saveSong(makeSong({ uuid: 'song-1', title: 'Amazing', ...synced, fileProps: null }))

    await db.clearFileLinks()

    const setlist = must(await db.getSetlist('setlist-1'))
    expect(setlist.name).to.equal('Sunday')
    expect(setlist.fileRef).to.equal(null)
    expect(setlist.syncedContentHash).to.equal(null)
    expect(setlist.share).to.equal(null)
    const song = must(await db.getSong('song-1'))
    expect(song.title).to.equal('Amazing')
    expect(song.fileRef).to.equal(null)
    expect(song.fileRev).to.equal(null)
    expect(song.lastSyncedAt).to.equal(null)
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
    const spaceId = `TEST-${uniqueName()}`
    dbName = spaceId
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

    const db = new ChordlessDB(spaceId)
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
    // (and on through the next version: the file fields have their new names)
    expect(migratedInSync.fileRef).to.equal('drive-1')
    expect(migratedInSync).not.to.have.property('driveFileId')
    must(db.db).close()
  })
})

describe("ChordlessDB version 7: the fields about a record's file are named for any storage", () => {
  let dbName: string

  afterEach(async () => {
    await deleteDatabase(dbName)
  })

  /** A version 6 database, as it was, with these songs and setlists */
  function makeVersion6({ songs, setlists }: { songs: object[]; setlists: object[] }) {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 6)
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

  it("moves the old names of a song's and a setlist's file fields to the new, keeping the rest", async () => {
    dbName = `TEST-${uniqueName()}`
    const fileProps = { songId: 'song-1', title: 'One' }
    await makeVersion6({
      songs: [
        {
          uuid: 'uuid-1',
          id: 'song-1',
          title: 'One',
          driveFileId: 'f-song',
          driveChecksum: 'sum-song',
          driveModifiedTime: '2026-10-01T00:00:00Z',
          driveProperties: fileProps,
          syncedContentHash: 'h',
        },
        { uuid: 'uuid-2', id: 'song-2', title: 'Never synced' },
      ],
      setlists: [
        {
          id: 'set-1',
          name: 'Sunday',
          driveFileId: 'f-set',
          driveChecksum: 'sum-set',
          driveModifiedTime: '2026-10-02T00:00:00Z',
          lastSyncedAt: '2026-10-02T01:00:00Z',
          syncedContentHash: 'hash',
          songs: [],
        },
        // A record that already has the new names (made by a newer version) keeps them
        { id: 'set-2', name: 'Both', driveFileId: 'old', fileRef: 'new', songs: [] },
      ],
    })

    const db = new ChordlessDB(dbName)
    await db.init()

    const song = must(await db.getSong('uuid-1'))
    expect(song).to.include({
      fileRef: 'f-song',
      fileRev: 'sum-song',
      fileModified: '2026-10-01T00:00:00Z',
      syncedContentHash: 'h',
      title: 'One',
    })
    expect(song.fileProps).to.deep.equal(fileProps)
    for (const old of ['driveFileId', 'driveChecksum', 'driveModifiedTime', 'driveProperties']) {
      expect(song, old).not.to.have.property(old)
    }
    expect(must(await db.getSong('uuid-2'))).not.to.have.property('fileRef')

    const setlist = must(await db.getSetlist('set-1'))
    expect(setlist).to.include({
      fileRef: 'f-set',
      fileRev: 'sum-set',
      fileModified: '2026-10-02T00:00:00Z',
      lastSyncedAt: '2026-10-02T01:00:00Z',
      syncedContentHash: 'hash',
    })
    expect(setlist).not.to.have.property('driveFileId')
    const both = must(await db.getSetlist('set-2'))
    expect(both.fileRef).to.equal('new')
    expect(both).not.to.have.property('driveFileId')
    must(db.db).close()
  })

  it('leaves a record that has none of them as it is', () => {
    const record = { id: 'x', name: 'Plain' }
    expect(withFileFieldsRenamed(record)).to.equal(record)
  })
})

describe('ChordlessDB version 8: a song’s source is where it came from, not how it arrived', () => {
  let dbName: string

  afterEach(async () => {
    await deleteDatabase(dbName)
  })

  /** A version 7 database, as it was, with these songs */
  function makeVersion7(songs: object[]) {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 7)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('songs', { keyPath: 'uuid' }).createIndex('id', 'id')
        db.createObjectStore('chordpro', { keyPath: 'id' })
        db.createObjectStore('setlists', { keyPath: 'id' })
        db.createObjectStore('setlist_local', { keyPath: 'setlistId' })
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['songs'], 'readwrite')
        for (const song of songs) tx.objectStore('songs').put(song)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }

  it('empties a source that says Drive, a copy or an import, and keeps any real one', async () => {
    dbName = `TEST-${uniqueName()}`
    await makeVersion7([
      { uuid: 'a', id: 'a', title: 'A', importSource: 'drive' },
      { uuid: 'b', id: 'b', title: 'B', importSource: 'copy' },
      { uuid: 'c', id: 'c', title: 'C', importSource: 'import' },
      { uuid: 'd', id: 'd', title: 'D', importSource: 'songselect' },
      { uuid: 'e', id: 'e', title: 'E', importSource: 'paste' },
      { uuid: 'f', id: 'f', title: 'F' },
    ])
    const db = new ChordlessDB(dbName)
    await db.init()
    const sources = Object.fromEntries(
      (await db.getAllSongs()).map(song => [song.uuid, song.importSource])
    )
    expect(sources).to.deep.equal({
      a: '',
      b: '',
      c: '',
      d: 'songselect',
      e: 'paste',
      f: undefined,
    })
    must(db.db).close()
  })

  it('leaves a song that has a real source, or none recorded, as it is', () => {
    const real = { importSource: 'songselect' }
    expect(withOriginKept(real)).to.equal(real)
    const none = {}
    expect(withOriginKept(none)).to.equal(none)
  })
})

describe('ChordlessDB version 10: a setlist’s leader is a person of the space', () => {
  let dbName: string

  afterEach(async () => {
    await deleteDatabase(dbName)
  })

  /** A version 9 database, as it was, with these setlists */
  function makeVersion9(setlists: object[]) {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 9)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('songs', { keyPath: 'uuid' }).createIndex('id', 'id')
        db.createObjectStore('chordpro', { keyPath: 'id' })
        const store = db.createObjectStore('setlists', { keyPath: 'id' })
        store.createIndex('owner', 'owner')
        db.createObjectStore('setlist_local', { keyPath: 'setlistId' })
        db.createObjectStore('pending_deletions', { keyPath: 'ref' })
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['setlists'], 'readwrite')
        for (const setlist of setlists) tx.objectStore('setlists').put(setlist)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }

  it('makes a person of each leader, joins the spellings of one, and drops owner and ownerId', async () => {
    dbName = `TEST-${uniqueName()}`
    const old = (id: string, owner: string, ownerId?: string) => ({
      id,
      date: '2026-10-11',
      songs: [],
      modifiedDate: '2026-01-01T00:00:00Z',
      owner,
      ...(ownerId === undefined ? {} : { ownerId }),
    })
    await makeVersion9([
      old('a', 'Tom', 'Tom@Example.com'),
      old('b', 'Tom Smith', 'tom@example.com'),
      old('f', 'Tom Smith', 'tom@example.com'),
      old('c', 'tom smith'),
      old('d', 'Visiting Vic'),
      old('e', ''),
    ])
    const db = new ChordlessDB(dbName)
    await db.init()
    const people = await db.getAllPeople()
    const setlists = Object.fromEntries((await db.getAllSetlists()).map(each => [each.id, each]))

    expect(people.map(each => [each.name, each.emails]).sort()).to.deep.equal([
      ['Tom Smith', ['tom@example.com']],
      ['Visiting Vic', []],
    ])
    const tom = must(people.find(each => each.name === 'Tom Smith')).id
    const vic = must(people.find(each => each.name === 'Visiting Vic')).id
    expect(
      [setlists.a, setlists.b, setlists.c, setlists.f].map(each => each.leaderId)
    ).to.deep.equal([tom, tom, tom, tom])
    expect(setlists.d.leaderId).to.equal(vic)
    expect('leaderId' in setlists.e).to.equal(false)
    for (const each of Object.values(setlists)) {
      expect('owner' in each).to.equal(false)
      expect('ownerId' in each).to.equal(false)
      expect(each.modifiedDate).to.not.equal('2026-01-01T00:00:00Z')
    }
    must(db.db).close()
  })

  it('leaves a database with no leaders without people, and does not run again', async () => {
    dbName = `TEST-${uniqueName()}`
    await makeVersion9([{ id: 'x', date: '2026-10-11', songs: [], modifiedDate: 'then' }])
    const db = new ChordlessDB(dbName)
    await db.init()
    expect(await db.getAllPeople()).to.deep.equal([])
    expect(must(await db.getSetlist('x')).modifiedDate).to.equal('then')
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
    const spaceName = `TEST-${uniqueName()}`
    db = new ChordlessDB(spaceName)
    await db.init()

    const setlists = [
      {
        id: crypto.randomUUID(),
        date: '2024-01-01',
        name: 'New Year',
        leaderId: 'leader-a',
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
        leaderId: 'leader-b',
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
    const now = new Date().toISOString()
    await db.savePeople([
      { id: 'leader-a', name: 'Leader A', emails: [], modifiedDate: now },
      { id: 'leader-b', name: 'Leader B', emails: [], modifiedDate: now },
    ])

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

  it('needs a space, and to be opened before it is used', async () => {
    expect(() => new ChordlessDB('')).to.throw('spaceId is required')
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
