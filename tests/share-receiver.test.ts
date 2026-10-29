import { expect } from '@open-wc/testing'
import { type DataChange, DataChangeEvent } from '../src/js/data-changes.ts'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { buildShareBundle } from '../src/js/share-bundle.ts'
import { encryptBundle, generateShareKey, setlistCode } from '../src/js/share-crypto.ts'
import {
  databaseExists,
  forgetShare,
  LEGACY_SHARE_DB_PREFIX,
  listSharedWithMe,
  openShare,
  ownSetlistFor,
  reloadShare,
  SHARED_DB_ID,
  shareSetlistId,
  tidySharedWithMe,
} from '../src/js/share-receiver.ts'
import { createSpace, deleteSpace, getCurrentSpace, setCurrentSpace } from '../src/js/space.ts'
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
      { date: '2026-10-11', time: '10:30', type: 'Church Service', name: '' },
      'Ann Smith',
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
    expect(setlist).to.include({ date: '2026-10-11', time: '10:30' })
    expect(setlist.songs).to.have.length(1)
    expect(setlist.songs[0]).to.include({ key: 'A', notes: 'repeat 4x', order: 0 })
    expect(setlist.received).to.deep.equal({
      fileId: FILE,
      key,
      etag: '"e1"',
      expires: '2099-01-01',
      leaderName: 'Ann Smith',
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

  describe('when the live channel says the share was updated', () => {
    /** The setlist changes the page showing the share would hear of */
    const heard = () => {
      const changes: DataChange[] = []
      const listener = (event: DataChangeEvent) => changes.push(event.change)
      window.addEventListener(DataChangeEvent.type, listener)
      return { changes, stop: () => window.removeEventListener(DataChangeEvent.type, listener) }
    }

    it('fetches it as it is now, not as the worker’s cache has it, and keeps it as a sync would', async () => {
      await open(key, (await worker()).fetchFile)
      const updated = await worker(
        bundle({ chart: '{title: Alpha}\n{key: G}\n[G]Alpha, fixed' }),
        '"e2"'
      )
      const urls: string[] = []
      const fetchFile = ((url: string, init?: RequestInit) => {
        urls.push(url)
        return updated.fetchFile(url, init)
      }) as unknown as typeof fetch

      const listening = heard()
      await reloadShare(FILE, { fetchFile, today: '2026-10-12' })
      listening.stop()

      expect(urls).to.deep.equal([`/api/share/${FILE}?fresh=1`])
      const setlist = must((await inside()).setlists[0])
      expect(setlist.received?.etag).to.equal('"e2"')
      const changed = listening.changes.filter(change => change.kind === 'setlist')
      expect(changed).to.have.length(1)
      expect(changed[0]).to.include({ origin: 'sync', spaceId: SHARED_DB_ID })
      expect(changed[0].ids).to.deep.equal([shareSetlistId(FILE)])
    })

    it('does nothing to the setlist when it has not changed (the worker says 304)', async () => {
      await open(key, (await worker()).fetchFile)
      const before = must((await inside()).setlists[0])
      const listening = heard()
      await reloadShare(FILE, { fetchFile: (await worker()).fetchFile, today: '2026-10-12' })
      listening.stop()
      expect(listening.changes).to.deep.equal([])
      expect(must((await inside()).setlists[0])).to.deep.equal(before)
    })

    it('keeps the day the setlist was first received, so that a page sees only what changed', async () => {
      await open(key, (await worker()).fetchFile)
      const first = must((await inside()).setlists[0])
      const updated = await worker(bundle({ key: 'B' }), '"e2"')
      await new Promise(resolve => setTimeout(resolve, 5))
      await reloadShare(FILE, { fetchFile: updated.fetchFile, today: '2026-10-12' })
      const second = must((await inside()).setlists[0])
      expect(second.createdDate).to.equal(first.createdDate)
      expect(second.songs[0].key).to.equal('B')
    })

    it('has nothing to do for a share this device has no copy or key for', async () => {
      const { fetchFile, calls } = await worker()
      await reloadShare(FILE, { fetchFile, today: '2026-10-12' })
      expect(calls).to.have.length(0)
      expect((await inside()).setlists).to.have.length(0)
    })

    it('lets the share go when the worker says it has ended', async () => {
      await open(key, (await worker()).fetchFile)
      await reloadShare(FILE, { fetchFile: status(404), today: '2026-10-12' })
      expect((await inside()).setlists).to.have.length(0)
    })
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

  it('keeps the share with no ETag when the worker sent none', async () => {
    const body = await encryptBundle(key, bundle())
    const fetchFile = (async () =>
      new Response(body, {
        headers: { 'Content-Type': 'application/octet-stream' },
      })) as unknown as typeof fetch
    const result = await open(key, fetchFile)
    expect(result.state).to.equal('ready')
    const { setlists } = await inside()
    expect(setlists[0].received?.etag).to.equal('')
  })

  describe('forgetting a share', () => {
    it('removes its setlist from the database it is given', async () => {
      const result = await openShare(FILE, key, {
        fetchFile: (await worker()).fetchFile,
        today: '2026-10-12',
      })
      if (result.state !== 'ready') throw new Error(result.state)
      await forgetShare(FILE, result.db)
      expect(await result.db.getSetlist(shareSetlistId(FILE))).to.equal(undefined)
      result.db.db?.close()
    })

    it('removes it from the shared database when not given one, and does nothing if there is none', async () => {
      await forgetShare(FILE)
      expect((await indexedDB.databases()).map(database => database.name)).to.not.include(
        SHARED_DB_ID
      )

      await open(key, (await worker()).fetchFile)
      await forgetShare(FILE)
      expect((await inside()).setlists).to.deep.equal([])
    })
  })

  describe('finding the setlist a link is of in the space', () => {
    let spaceId: string
    let before: { id: string | null; name: string }

    afterEach(async () => {
      if (spaceId) {
        await deleteSpace(spaceId)
        await deleteDatabase(spaceId)
        spaceId = ''
      }
      if (before?.id) await setCurrentSpace(before.id, before.name)
    })

    async function spaceWith(setlistId: string) {
      before = getCurrentSpace()
      const space = await createSpace(`Share ${crypto.randomUUID().slice(0, 8)}`)
      spaceId = space.id
      await setCurrentSpace(space.id, space.name)
      const db = new ChordlessDB(space.id)
      await db.init()
      await db.saveSetlist({ ...createSetlist({ date: '2026-10-11' }), id: setlistId })
      db.db?.close()
    }

    it('gives its id, for a link made from it', async () => {
      const id = crypto.randomUUID()
      await spaceWith(id)
      expect(await ownSetlistFor(setlistCode(id))).to.equal(id)
      expect(await ownSetlistFor(setlistCode(crypto.randomUUID()))).to.equal(null)
    })

    it('gives nothing when the space has no database yet', async () => {
      before = getCurrentSpace()
      const space = await createSpace(`Share ${crypto.randomUUID().slice(0, 8)}`)
      spaceId = space.id
      await setCurrentSpace(space.id, space.name)
      expect(await ownSetlistFor('abcdef')).to.equal(null)
    })

    it('gives nothing, and says why, when the database will not open', async () => {
      await spaceWith(crypto.randomUUID())
      const realInit = ChordlessDB.prototype.init
      const realError = console.error
      const errors: unknown[][] = []
      console.error = (...args) => errors.push(args)
      ChordlessDB.prototype.init = async () => {
        throw new Error('damaged')
      }
      try {
        expect(await ownSetlistFor('abcdef')).to.equal(null)
      } finally {
        ChordlessDB.prototype.init = realInit
        console.error = realError
      }
      expect(errors).to.have.length(1)
    })
  })

  it('takes a database to exist where the browser cannot list them', async () => {
    const real = indexedDB.databases
    ;(indexedDB as { databases?: unknown }).databases = undefined
    try {
      expect(await databaseExists('anything')).to.equal(true)
    } finally {
      indexedDB.databases = real
    }
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

      expect(await tidySharedWithMe({ today: '2026-10-19', spaceIds: [] })).to.deep.equal({
        expired: 0,
        joined: 0,
      })
      expect((await inside()).setlists).to.have.length(2)
      expect(await tidySharedWithMe({ today: '2026-10-21', spaceIds: [] })).to.deep.equal({
        expired: 1,
        joined: 0,
      })
      const { setlists, songs } = await inside()
      expect(setlists.map(setlist => setlist.id)).to.deep.equal([shareSetlistId(OTHER_FILE)])
      expect(songs).to.have.length(1)
    })

    it('removes a setlist the user now has in a space', async () => {
      const space = new ChordlessDB(`org-${crypto.randomUUID()}`)
      extraDatabases.push(space.dbName)
      await space.init()
      const mine = await space.saveSetlist(createSetlist({ date: '2026-10-11' }))
      space.db?.close()

      // One share is of that setlist (it carries its id), the other of another
      await open(key, (await worker(bundle({ setlistId: mine.id }))).fetchFile)
      await open(
        key,
        (await worker(bundle({ setlistId: 'somebody-elses' }))).fetchFile,
        '2026-10-12',
        OTHER_FILE
      )

      expect(
        await tidySharedWithMe({ today: '2026-10-12', spaceIds: [space.dbName] })
      ).to.deep.equal({ expired: 0, joined: 1 })
      const { setlists, songs } = await inside()
      expect(setlists.map(setlist => setlist.id)).to.deep.equal([shareSetlistId(OTHER_FILE)])
      expect(songs).to.have.length(1)
    })

    it('looks past a space that has no database here, or one that will not open', async () => {
      const ours = new ChordlessDB(`org-${crypto.randomUUID()}`)
      const broken = new ChordlessDB(`org-${crypto.randomUUID()}`)
      extraDatabases.push(ours.dbName, broken.dbName)
      await ours.init()
      const mine = await ours.saveSetlist(createSetlist({ date: '2026-10-11' }))
      ours.db?.close()
      await broken.init()
      broken.db?.close()
      await open(key, (await worker(bundle({ setlistId: mine.id }))).fetchFile)

      const realInit = ChordlessDB.prototype.init
      const realError = console.error
      const errors: unknown[][] = []
      console.error = (...args) => errors.push(args)
      ChordlessDB.prototype.init = async function () {
        if (this.dbName === broken.dbName) throw new Error('damaged')
        return realInit.call(this)
      }
      try {
        const tidied = await tidySharedWithMe({
          today: '2026-10-12',
          spaceIds: ['org-with-no-database', broken.dbName, ours.dbName],
        })
        expect(tidied).to.deep.equal({ expired: 0, joined: 1 })
      } finally {
        ChordlessDB.prototype.init = realInit
        console.error = realError
      }
      expect(errors).to.have.length(1)
    })

    it('gives up quietly, and keeps what was received, if it cannot tidy', async () => {
      await open(key, (await worker()).fetchFile)
      const realError = console.error
      const realList = ChordlessDB.prototype.getAllSetlists
      const errors: unknown[][] = []
      console.error = (...args) => errors.push(args)
      ChordlessDB.prototype.getAllSetlists = async () => {
        throw new Error('database closed')
      }
      try {
        const tidied = await tidySharedWithMe({ today: '2026-10-12', spaceIds: [] })
        expect(tidied).to.deep.equal({ expired: 0, joined: 0 })
      } finally {
        ChordlessDB.prototype.getAllSetlists = realList
        console.error = realError
      }
      expect(errors).to.have.length(1)
      expect((await inside()).setlists).to.have.length(1)
    })

    it('deletes the per-share databases of before there was one for all', async () => {
      const legacy = new ChordlessDB(`${LEGACY_SHARE_DB_PREFIX}${FILE}`)
      await legacy.init()
      legacy.db?.close()
      await tidySharedWithMe({ spaceIds: [] })
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
