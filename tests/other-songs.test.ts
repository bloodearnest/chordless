import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import {
  addToLibrary,
  getSongsElsewhere,
  withSongsFromElsewhere,
  withSpaceName,
} from '../src/js/other-songs.ts'
import { SHARED_DB_ID } from '../src/js/share-receiver.ts'
import { addChart, getLibrarySongs, getSongWithContent } from '../src/js/song-utils.ts'
import { createSpace, deleteSpace, updateSpace } from '../src/js/space.ts'
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
  /** The database of another space, the songs of which the library can see and copy */
  let elsewhere: ChordlessDB
  let space: { id: string; name: string }
  /** What was received in shares: it stays inside them */
  let shared: ChordlessDB

  beforeEach(async () => {
    library = new ChordlessDB(libraryId)
    await library.init()
    space = await createSpace(`Elsewhere ${crypto.randomUUID().slice(0, 8)}`)
    elsewhere = new ChordlessDB(space.id)
    await elsewhere.init()
    shared = new ChordlessDB(SHARED_DB_ID)
    await shared.init()
  })

  afterEach(async () => {
    library.db?.close()
    elsewhere.db?.close()
    shared.db?.close()
    await deleteDatabase(libraryId)
    await deleteDatabase(space.id)
    await deleteDatabase(SHARED_DB_ID)
    await deleteSpace(space.id)
  })

  const fromElsewhere = async () =>
    (await getSongsElsewhere(libraryId)).filter(song => song.source?.dbId === space.id)

  it('lists the songs of another space, marked with where they are from', async () => {
    await addChart(elsewhere, BETA, ADD)
    const songs = await fromElsewhere()
    expect(songs.map(song => song.title)).to.deep.equal(['Beta'])
    expect(songs[0].source).to.deep.equal({ dbId: space.id, label: space.name })
  })

  it('keeps what was received in a share inside the share: not listed, not found, and not copied', async () => {
    const received = await addChart(shared, BETA, ADD)
    expect((await getSongsElsewhere(libraryId)).map(song => song.title)).to.not.include('Beta')
    // (even handed the song, the copy is refused, and nothing is added)
    const song = {
      ...(await getSongWithContent(received.uuid, shared)),
      source: { dbId: SHARED_DB_ID, label: 'Shared with me' },
    }
    let refused = ''
    await addToLibrary(song, library).catch(error => {
      refused = String(error.message)
    })
    expect(refused).to.contain('stays in that setlist')
    expect(await library.getAllSongs()).to.have.length(0)
  })

  it('does not copy a song into or out of a church library', async () => {
    const church = await createSpace(`Church ${crypto.randomUUID()}`)
    await updateSpace(church.id, { team: { id: 'team', churchId: 'church', role: 'writer' } })
    const churchDb = new ChordlessDB(church.id)
    await churchDb.init()
    try {
      await addChart(churchDb, ALPHA, ADD)
      await addChart(elsewhere, BETA, ADD)
      expect(await getSongsElsewhere(church.id)).to.deep.equal([])
      expect(
        (await getSongsElsewhere(libraryId)).some(song => song.source?.dbId === church.id)
      ).to.equal(false)
      const source = must((await fromElsewhere())[0])
      let failed = false
      await addToLibrary(source, churchDb).catch(() => {
        failed = true
      })
      expect(failed).to.equal(true)
    } finally {
      churchDb.db?.close()
      await deleteSpace(church.id)
    }
  })

  it('has nothing from elsewhere, and makes no shared database, when there is none', async () => {
    shared.db?.close()
    await deleteDatabase(SHARED_DB_ID)
    expect(await fromElsewhere()).to.deep.equal([])
    expect((await indexedDB.databases()).map(database => database.name)).to.not.include(
      SHARED_DB_ID
    )
  })

  it('searches the library and the others together, the library winning for a song it has', async () => {
    await addChart(library, ALPHA, ADD)
    await addChart(elsewhere, ALPHA_EDITED, ADD)
    await addChart(elsewhere, BETA, ADD)

    const merged = withSongsFromElsewhere(await getLibrarySongs(library), await fromElsewhere())
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
    // (the space's id is always kept: the library opens a song in its own space)
    expect(withSpaceName(own, 1, 'Gateway', 'g1').map(song => song.spaceId)).to.deep.equal(['g1'])
  })

  it('adds a song to the library as a copy, and leaves the original where it is', async () => {
    await addChart(elsewhere, BETA, ADD)
    const [song] = await fromElsewhere()
    const added = await addToLibrary(song, library)
    expect(added.title).to.equal('Beta')
    expect(added.source).to.equal(undefined)
    expect(added.chordpro).to.equal(BETA)
    expect(must(await library.getSong(added.uuid)).isDefault).to.equal(true)
    expect(await elsewhere.getAllSongs()).to.have.length(1)

    // The library has it now: adding again is the same song
    expect((await addToLibrary(song, library)).uuid).to.equal(added.uuid)
    expect(await library.getAllSongs()).to.have.length(1)
  })

  it('keeps where the song came from, and when, rather than saying it was copied', async () => {
    const original = await addChart(elsewhere, BETA, { ...ADD, importSource: 'songselect' })
    await elsewhere.saveSong({
      ...original,
      importDate: '2026-05-04T16:24:37.261Z',
      importUser: 'ann',
    })
    const [song] = await fromElsewhere()
    const added = await addToLibrary(song, library)
    const record = must(await library.getSong(added.uuid))
    expect(record.importSource).to.equal('songselect')
    expect(record.importDate).to.equal('2026-05-04T16:24:37.261Z')
    expect(record.importUser).to.equal('ann')
  })

  it('adds a different chart of a song the library has as a variant, not the default', async () => {
    const mine = await addChart(library, ALPHA, ADD)
    await addChart(elsewhere, ALPHA_EDITED, ADD)
    const [song] = await fromElsewhere()
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
