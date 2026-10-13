import { expect } from '@esm-bundle/chai'
import { ChordlessDB } from '../src/js/db.ts'
import {
  addToLibrary,
  getSongFromAnywhere,
  getSongsElsewhere,
  withSongsFromElsewhere,
} from '../src/js/other-songs.ts'
import { SHARED_DB_ID } from '../src/js/share-receiver.ts'
import { addChart, getLibrarySongs } from '../src/js/song-utils.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const deleteDatabase = (name: string) =>
  new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })

const ALPHA = '{title: Alpha}\n{key: G}\n[G]Alpha line'
const ALPHA_EDITED = '{title: Alpha}\n{key: G}\n[G]Alpha line, edited'
const BETA = '{title: Beta}\n{key: D}\n[D]Beta line'
const ADD = { variantLabel: 'Test', importSource: 'test', makeDefault: 'first' } as const

describe('Songs from the other databases', () => {
  const libraryId = `org-${crypto.randomUUID()}`
  let library: ChordlessDB
  let shared: ChordlessDB

  beforeEach(async () => {
    library = new ChordlessDB(libraryId)
    await library.init()
    shared = new ChordlessDB(SHARED_DB_ID)
    await shared.init()
  })

  afterEach(async () => {
    library.db?.close()
    shared.db?.close()
    await deleteDatabase(libraryId)
    await deleteDatabase(SHARED_DB_ID)
  })

  it('lists the shared database songs, marked with where they are from', async () => {
    await addChart(shared, BETA, ADD)
    const songs = await getSongsElsewhere(libraryId)
    expect(songs.map(song => song.title)).to.deep.equal(['Beta'])
    expect(songs[0].source).to.deep.equal({ dbId: SHARED_DB_ID, label: 'Shared with me' })
  })

  it('has nothing from elsewhere, and makes no database, when there is none', async () => {
    shared.db?.close()
    await deleteDatabase(SHARED_DB_ID)
    expect(await getSongsElsewhere(libraryId)).to.deep.equal([])
    expect((await indexedDB.databases()).map(database => database.name)).to.not.include(
      SHARED_DB_ID
    )
  })

  it('searches the library and the others together, the library winning for a song it has', async () => {
    await addChart(library, ALPHA, ADD)
    await addChart(shared, ALPHA_EDITED, ADD)
    await addChart(shared, BETA, ADD)

    const merged = withSongsFromElsewhere(
      await getLibrarySongs(library),
      await getSongsElsewhere(libraryId)
    )
    expect(merged.map(song => `${song.title}${song.source ? ' (elsewhere)' : ''}`)).to.deep.equal([
      'Alpha',
      'Beta (elsewhere)',
    ])
  })

  it('finds a song by uuid in the library, else in another database', async () => {
    const mine = await addChart(library, ALPHA, ADD)
    const theirs = await addChart(shared, BETA, ADD)
    expect((await getSongFromAnywhere(mine.uuid, library)).source).to.equal(undefined)
    const found = await getSongFromAnywhere(theirs.uuid, library)
    expect(found.title).to.equal('Beta')
    expect(found.source?.dbId).to.equal(SHARED_DB_ID)
    let failed = false
    await getSongFromAnywhere('nobody', library).catch(() => {
      failed = true
    })
    expect(failed).to.equal(true)
  })

  it('adds a song to the library as a copy, and leaves the original where it is', async () => {
    await addChart(shared, BETA, ADD)
    const [song] = await getSongsElsewhere(libraryId)
    const added = await addToLibrary(song, library)
    expect(added.title).to.equal('Beta')
    expect(added.source).to.equal(undefined)
    expect(added.chordpro).to.equal(BETA)
    expect(must(await library.getSong(added.uuid)).isDefault).to.equal(true)
    expect(await shared.getAllSongs()).to.have.length(1)

    // The library has it now: adding again is the same song
    expect((await addToLibrary(song, library)).uuid).to.equal(added.uuid)
    expect(await library.getAllSongs()).to.have.length(1)
  })

  it('adds a different chart of a song the library has as a variant, not the default', async () => {
    const mine = await addChart(library, ALPHA, ADD)
    await addChart(shared, ALPHA_EDITED, ADD)
    const [song] = await getSongsElsewhere(libraryId)
    const added = await addToLibrary(song, library)
    expect(added.uuid).to.not.equal(mine.uuid)
    const all = await library.getAllSongs()
    expect(all).to.have.length(2)
    expect(all.filter(each => each.isDefault).map(each => each.uuid)).to.deep.equal([mine.uuid])
    expect(must(await library.getSong(added.uuid)).variantOf).to.equal(mine.uuid)
  })
})
