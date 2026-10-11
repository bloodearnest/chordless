import { expect } from '@esm-bundle/chai'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { DriveSyncManager, setlistContentHash } from '../src/js/drive-sync.ts'
import { must } from './must.ts'

const uniqueName = () =>
  crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)

const deleteDatabase = name =>
  new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })

describe('ChordlessDB', () => {
  let db

  afterEach(async () => {
    if (db?.dbName) {
      await deleteDatabase(db.dbName)
      db = null
    }
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

    const sync = new DriveSyncManager('Test', null, { db })
    const migratedInSync = must(await db.getSetlist('in-sync'))
    expect(migratedInSync.songs[0].tempo).to.equal(72)
    expect(sync.setlistHasLocalChanges(migratedInSync)).to.equal(false)
    const migratedEdited = must(await db.getSetlist('edited'))
    expect(migratedEdited.songs[0].tempo).to.equal(80)
    expect(sync.setlistHasLocalChanges(migratedEdited)).to.equal(true)
    must(db.db).close()
  })
})
