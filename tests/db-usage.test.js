import { expect } from '@esm-bundle/chai'
import { suppressConsoleLogs } from './test-helpers.js'

const { describe, it } = window

suppressConsoleLogs()

import { SetalightDB } from '../js/db.js'

const uniqueName = () =>
  crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)

const deleteDatabase = name =>
  new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })

describe('SetalightDB usage aggregation', () => {
  let db

  afterEach(async () => {
    if (db?.dbName) {
      await deleteDatabase(db.dbName)
      db = null
    }
  })

  it('aggregates song appearances across setlists', async () => {
    const orgName = `TEST-${uniqueName()}`
    db = new SetalightDB(orgName)
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
