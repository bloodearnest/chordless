import { expect } from '@esm-bundle/chai'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { buildShareBundle } from '../src/js/share-bundle.ts'
import { encryptBundle, generateShareKey } from '../src/js/share-crypto.ts'
import {
  LEGACY_SHARE_DB_PREFIX,
  listSharedWithMe,
  openShare,
  SHARED_DB_ID,
  shareSetlistId,
  tidySharedWithMe,
} from '../src/js/share-receiver.ts'
import { makeEntry } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

describe('Receiving a share link', () => {
  const FILE = `file-${crypto.randomUUID()}`
  const OTHER_FILE = `file-${crypto.randomUUID()}`
  const key = generateShareKey()
  const extraDatabases: string[] = []

  const bundle = (
    over: { chart?: string; expires?: string; key?: string; setlistId?: string } = {}
  ) =>
    buildShareBundle(
      { date: '2026-10-11', time: '10:30', type: 'Church Service', name: '', owner: 'Ann Smith' },
      [
        {
          entry: makeEntry({ order: 0, songId: 'x', key: over.key ?? 'A', notes: 'repeat 4x' }),
          title: 'Alpha',
          songKey: 'G',
          chordpro: over.chart ?? '{title: Alpha}\n{key: G}\n[G]Alpha line',
        },
      ],
      { expires: over.expires ?? '2099-01-01', setlistId: over.setlistId }
    )

  /** The worker, as far as a recipient sees it */
  const worker = async (b = bundle(), etag = '"e1"') => {
    const body = await encryptBundle(key, b)
    const calls: (RequestInit | undefined)[] = []
    const fetchFile = (async (_url: string, init?: RequestInit) => {
      calls.push(init)
      const headers = new Headers(init?.headers)
      if (headers.get('If-None-Match') === etag) return new Response(null, { status: 304 })
      return new Response(body, {
        headers: { ETag: etag, 'Content-Type': 'application/octet-stream' },
      })
    }) as unknown as typeof fetch
    return { fetchFile, calls }
  }
  const status = (code: number) =>
    (async () => new Response(null, { status: code })) as unknown as typeof fetch
  const offline = (async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch

  /** Open a share, and let go of the database (the tests look in it themselves) */
  const open = async (
    hashKey: string,
    fetchFile: typeof fetch,
    today = '2026-10-12',
    fileId = FILE
  ) => {
    const result = await openShare(fileId, hashKey, { fetchFile, today })
    if (result.state === 'ready') result.db.db?.close()
    return result
  }

  /** What the shared database holds now */
  const inside = async () => {
    const db = new ChordlessDB(SHARED_DB_ID)
    await db.init()
    const contents = { setlists: await db.getAllSetlists(), songs: await db.getAllSongs(), db }
    db.db?.close()
    return contents
  }

  afterEach(async () => {
    await deleteDatabase(SHARED_DB_ID)
    for (const name of extraDatabases.splice(0)) await deleteDatabase(name)
  })

  it('downloads the setlist, decrypts it and keeps it in the shared database', async () => {
    const { fetchFile } = await worker()
    const result = await openShare(FILE, key, { fetchFile, today: '2026-10-12' })
    if (result.state !== 'ready') throw new Error(result.state)

    expect(result.fresh).to.equal(true)
    const setlist = must(await result.db.getSetlist(shareSetlistId(FILE)))
    expect(setlist).to.include({ date: '2026-10-11', owner: 'Ann Smith', time: '10:30' })
    expect(setlist.songs).to.have.length(1)
    expect(setlist.songs[0]).to.include({ key: 'A', notes: 'repeat 4x', order: 0 })
    expect(setlist.received).to.deep.equal({
      fileId: FILE,
      key,
      etag: '"e1"',
      expires: '2099-01-01',
    })

    const song = must(await result.db.getDefaultSongVariant(setlist.songs[0].songId))
    expect(song.title).to.equal('Alpha')
    expect(song.id).to.equal('title-alpha')
    expect((await result.db.getChordPro(song.chordproFileId))?.content).to.include('[G]Alpha line')
    result.db.db?.close()
  })

  it('opens again from the copy, asking the worker whether it changed', async () => {
    const { fetchFile, calls } = await worker()
    await open(key, fetchFile)

    // No key in the link this time (a reload of /s/<id>): the kept one is used
    const second = await open('', fetchFile)
    if (second.state !== 'ready') throw new Error(second.state)
    expect(second.fresh).to.equal(false)
    expect(new Headers(calls[1]?.headers).get('If-None-Match')).to.equal('"e1"')
  })

  it('replaces the setlist when the worker has a new version, keeping the earlier chart', async () => {
    await open(key, (await worker()).fetchFile)

    const updated = await worker(
      bundle({ chart: '{title: Alpha}\n{key: G}\n[G]Alpha, fixed' }),
      '"e2"'
    )
    const second = await openShare(FILE, '', { fetchFile: updated.fetchFile, today: '2026-10-12' })
    if (second.state !== 'ready') throw new Error(second.state)
    expect(second.fresh).to.equal(true)
    const song = must(await second.db.getDefaultSongVariant(second.setlist.songs[0].songId))
    expect((await second.db.getChordPro(song.chordproFileId))?.content).to.include('fixed')
    expect(second.setlist.received?.etag).to.equal('"e2"')
    expect(await second.db.getAllSetlists()).to.have.length(1)
    // Both charts are kept, the newer as the default of the song
    const songs = await second.db.getAllSongs()
    expect(songs).to.have.length(2)
    expect(songs.filter(each => each.isDefault)).to.have.length(1)
    second.db.db?.close()
  })

  it('reuses a song it already has the chart of, in another share', async () => {
    await open(key, (await worker()).fetchFile)
    await open(key, (await worker()).fetchFile, '2026-10-12', OTHER_FILE)
    const { setlists, songs } = await inside()
    expect(setlists).to.have.length(2)
    expect(songs).to.have.length(1)
    expect(setlists[0].songs[0].songUuid).to.equal(setlists[1].songs[0].songUuid)
  })

  it('shows the copy when offline, or when the worker is failing', async () => {
    await open(key, (await worker()).fetchFile)
    for (const fetchFile of [offline, status(502)]) {
      expect((await open('', fetchFile)).state).to.equal('ready')
    }
  })

  it('has nothing to show offline the first time', async () => {
    expect(await open(key, offline)).to.deep.equal({ state: 'unavailable', offline: true })
    expect(await open(key, status(502))).to.deep.equal({ state: 'unavailable', offline: false })
    expect((await inside()).setlists).to.have.length(0)
  })

  it('deletes the setlist, but keeps its songs, when the share has ended (a 404)', async () => {
    await open(key, (await worker()).fetchFile)

    expect(await open('', status(404))).to.deep.equal({ state: 'ended' })
    const { setlists, songs } = await inside()
    expect(setlists).to.have.length(0)
    expect(songs.map(song => song.title)).to.deep.equal(['Alpha'])
    // ...and it stays ended
    expect(await open(key, status(404))).to.deep.equal({ state: 'ended' })
  })

  it('deletes the setlist once it is past its end date, without asking the worker', async () => {
    await open(key, (await worker(bundle({ expires: '2026-10-20' }))).fetchFile)

    const { fetchFile, calls } = await worker()
    expect(await open('', fetchFile, '2026-10-21')).to.deep.equal({ state: 'ended' })
    expect(calls).to.have.length(0)
    const { setlists, songs } = await inside()
    expect(setlists).to.have.length(0)
    expect(songs).to.have.length(1)
  })

  it('does not keep a share that arrives already ended', async () => {
    const { fetchFile } = await worker(bundle({ expires: '2026-10-01' }))
    expect(await open(key, fetchFile)).to.deep.equal({ state: 'ended' })
    const { setlists, songs } = await inside()
    expect(setlists).to.have.length(0)
    expect(songs).to.have.length(0)
  })

  it('needs the key the first time, and a key that fits', async () => {
    const { fetchFile, calls } = await worker()
    expect(await open('', fetchFile)).to.deep.equal({ state: 'needs-key' })
    expect(calls).to.have.length(0)
    expect(await open(generateShareKey(), fetchFile)).to.deep.equal({ state: 'bad-key' })
    expect((await inside()).setlists).to.have.length(0)
  })

  it("isn't a bad key when what came back isn't the file", async () => {
    const html = (async () =>
      new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html' },
      })) as unknown as typeof fetch
    expect(await open(key, html)).to.deep.equal({ state: 'unavailable', offline: false })
  })

  describe('tidying what was received', () => {
    it('removes the setlists of expired shares at start-up, and only those, never songs', async () => {
      await open(key, (await worker(bundle({ expires: '2026-10-20' }))).fetchFile)
      await open(
        key,
        (await worker(bundle({ expires: '2099-01-01' }))).fetchFile,
        '2026-10-12',
        OTHER_FILE
      )

      expect(await tidySharedWithMe({ today: '2026-10-19', organisationIds: [] })).to.deep.equal({
        expired: 0,
        joined: 0,
      })
      expect((await inside()).setlists).to.have.length(2)
      expect(await tidySharedWithMe({ today: '2026-10-21', organisationIds: [] })).to.deep.equal({
        expired: 1,
        joined: 0,
      })
      const { setlists, songs } = await inside()
      expect(setlists.map(setlist => setlist.id)).to.deep.equal([shareSetlistId(OTHER_FILE)])
      expect(songs).to.have.length(1)
    })

    it('removes a setlist the user now has in an organisation', async () => {
      const organisation = new ChordlessDB(`org-${crypto.randomUUID()}`)
      extraDatabases.push(organisation.dbName)
      await organisation.init()
      const mine = await organisation.saveSetlist(createSetlist({ date: '2026-10-11' }))
      organisation.db?.close()

      // One share is of that setlist (it carries its id), the other of another
      await open(key, (await worker(bundle({ setlistId: mine.id }))).fetchFile)
      await open(
        key,
        (await worker(bundle({ setlistId: 'somebody-elses' }))).fetchFile,
        '2026-10-12',
        OTHER_FILE
      )

      expect(
        await tidySharedWithMe({ today: '2026-10-12', organisationIds: [organisation.dbName] })
      ).to.deep.equal({ expired: 0, joined: 1 })
      const { setlists, songs } = await inside()
      expect(setlists.map(setlist => setlist.id)).to.deep.equal([shareSetlistId(OTHER_FILE)])
      expect(songs).to.have.length(1)
    })

    it('deletes the per-share databases of before there was one for all', async () => {
      const legacy = new ChordlessDB(`${LEGACY_SHARE_DB_PREFIX}${FILE}`)
      await legacy.init()
      legacy.db?.close()
      await tidySharedWithMe({ organisationIds: [] })
      expect((await indexedDB.databases()).map(database => database.name)).to.not.include(
        legacy.dbName
      )
    })

    it('lists what is current, newest first, for the home page', async () => {
      await open(key, (await worker()).fetchFile)
      const listed = await listSharedWithMe()
      expect(listed.map(setlist => setlist.id)).to.deep.equal([shareSetlistId(FILE)])
    })

    it('has nothing to list, and makes no database, when nothing was received', async () => {
      expect(await listSharedWithMe()).to.deep.equal([])
      expect((await indexedDB.databases()).map(database => database.name)).to.not.include(
        SHARED_DB_ID
      )
    })
  })
})
