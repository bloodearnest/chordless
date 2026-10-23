import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import {
  addToLibrary,
  getSongFromAnywhere,
  getSongsElsewhere,
  withSongsFromElsewhere,
  withSpaceName,
} from '../src/js/other-songs.ts'
import { SHARED_DB_ID } from '../src/js/share-receiver.ts'
import { addChart, getLibrarySongs } from '../src/js/song-utils.ts'
import { createSpace, deleteSpace } from '../src/js/space.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

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

  it("names the space of the library's songs, when the device has more than one", async () => {
    await addChart(library, ALPHA, ADD)
    const own = await getLibrarySongs(library)
    expect(withSpaceName(own, 2, 'Gateway').map(song => song.spaceName)).to.deep.equal(['Gateway'])
    expect(withSpaceName(own, 1, 'Gateway').map(song => song.spaceName)).to.deep.equal([undefined])
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

  it('keeps where the song came from, and when, rather than saying it was copied', async () => {
    const original = await addChart(shared, BETA, { ...ADD, importSource: 'songselect' })
    await shared.saveSong({
      ...original,
      importDate: '2026-05-04T16:24:37.261Z',
      importUser: 'ann',
    })
    const [song] = await getSongsElsewhere(libraryId)
    const added = await addToLibrary(song, library)
    const record = must(await library.getSong(added.uuid))
    expect(record.importSource).to.equal('songselect')
    expect(record.importDate).to.equal('2026-05-04T16:24:37.261Z')
    expect(record.importUser).to.equal('ann')
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

describe('Songs from the other spaces', () => {
  const libraryId = `org-${crypto.randomUUID()}`
  let other: { id: string; name: string }
  let otherDb: ChordlessDB
  let realError: typeof console.error
  let errors: unknown[][]

  beforeEach(async () => {
    errors = []
    realError = console.error
    console.error = (...args) => errors.push(args)
    other = await createSpace(`Other church ${crypto.randomUUID().slice(0, 8)}`)
    otherDb = new ChordlessDB(other.id)
    await otherDb.init()
  })

  afterEach(async () => {
    console.error = realError
    otherDb.db?.close()
    await deleteDatabase(other.id)
    await deleteSpace(other.id)
  })

  it('lists the songs of a space with a database, marked with its name', async () => {
    await addChart(otherDb, BETA, ADD)
    const found = (await getSongsElsewhere(libraryId)).filter(
      song => song.source?.dbId === other.id
    )
    expect(found.map(song => song.title)).to.deep.equal(['Beta'])
    expect(found[0].source).to.deep.equal({ dbId: other.id, label: other.name })
  })

  it('does not list the songs of the space that is asking', async () => {
    await addChart(otherDb, BETA, ADD)
    const songs = await getSongsElsewhere(other.id)
    expect(songs.filter(song => song.source?.dbId === other.id)).to.deep.equal([])
  })

  it('skips a space that has no database on this device', async () => {
    const empty = await createSpace(`Empty ${crypto.randomUUID().slice(0, 8)}`)
    try {
      const sources = (await getSongsElsewhere(libraryId)).map(song => song.source?.dbId)
      expect(sources).to.not.include(empty.id)
    } finally {
      await deleteSpace(empty.id)
    }
  })

  it('marks a song copied from a space as copied, not shared', async () => {
    await addChart(otherDb, BETA, ADD)
    const library = new ChordlessDB(libraryId)
    await library.init()
    try {
      const song = (await getSongsElsewhere(libraryId)).find(each => each.source?.dbId === other.id)
      const added = await addToLibrary(must(song), library)
      expect(must(await library.getSong(added.uuid)).variantLabel).to.equal('Copied')
    } finally {
      library.db?.close()
      await deleteDatabase(libraryId)
    }
  })

  it('carries on without the songs of a database that cannot be read, and says so', async () => {
    await addChart(otherDb, BETA, ADD)
    const realInit = ChordlessDB.prototype.init
    ChordlessDB.prototype.init = async function () {
      if (this.spaceId === other.id) throw new Error('database damaged')
      return realInit.call(this)
    }
    try {
      const songs = await getSongsElsewhere(libraryId)
      expect(songs.filter(song => song.source?.dbId === other.id)).to.deep.equal([])
    } finally {
      ChordlessDB.prototype.init = realInit
    }
    expect(errors.some(args => String(args[0]).includes(other.name))).to.equal(true)
  })

  it('carries on with none when it cannot even look for them, and says so', async () => {
    const realDatabases = indexedDB.databases
    indexedDB.databases = async () => {
      throw new Error('no access')
    }
    try {
      expect(await getSongsElsewhere(libraryId)).to.deep.equal([])
    } finally {
      indexedDB.databases = realDatabases
    }
    expect(errors).to.have.length(1)
  })
})
