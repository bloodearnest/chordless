import { expect } from '@esm-bundle/chai'
import { ChordlessDB } from '../src/js/db.ts'
import { buildShareBundle } from '../src/js/share-bundle.ts'
import { encryptBundle, generateShareKey } from '../src/js/share-crypto.ts'
import {
  deleteExpiredShares,
  forgetShare,
  openShare,
  SHARE_DB_PREFIX,
  SHARED_SETLIST_ID,
} from '../src/js/share-receiver.ts'
import { makeEntry } from './builders.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

describe('Receiving a share link', () => {
  const opened: string[] = []
  const FILE = `file-${crypto.randomUUID()}`
  const key = generateShareKey()

  const bundle = (over: { chart?: string; expires?: string; key?: string } = {}) =>
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
      { expires: over.expires ?? '2099-01-01' }
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

  const open = async (hashKey: string, fetchFile: typeof fetch, today = '2026-10-12') => {
    const result = await openShare(FILE, hashKey, { fetchFile, today })
    if (result.state === 'ready') opened.push(FILE)
    return result
  }

  afterEach(async () => {
    await forgetShare(FILE)
    opened.length = 0
  })

  const databases = async () =>
    (await indexedDB.databases()).map(d => d.name).filter(n => n?.startsWith(SHARE_DB_PREFIX))

  it('downloads the setlist, decrypts it and keeps it in a database of its own', async () => {
    const { fetchFile } = await worker()
    const result = await open(key, fetchFile)
    if (result.state !== 'ready') throw new Error(result.state)

    expect(result.fresh).to.equal(true)
    expect(await databases()).to.include(`${SHARE_DB_PREFIX}${FILE}`)
    const setlist = must(await result.db.getSetlist(SHARED_SETLIST_ID))
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
    expect((await result.db.getChordPro(song.chordproFileId))?.content).to.include('[G]Alpha line')
    result.db.db?.close()
  })

  it('opens again from the copy, asking the worker whether it changed', async () => {
    const { fetchFile, calls } = await worker()
    const first = await open(key, fetchFile)
    if (first.state === 'ready') first.db.db?.close()

    // No key in the link this time (a reload of /s/<id>): the kept one is used
    const second = await open('', fetchFile)
    if (second.state !== 'ready') throw new Error(second.state)
    expect(second.fresh).to.equal(false)
    expect(new Headers(calls[1]?.headers).get('If-None-Match')).to.equal('"e1"')
    second.db.db?.close()
  })

  it('replaces the copy when the worker has a new version', async () => {
    const first = await open(key, (await worker()).fetchFile)
    if (first.state === 'ready') first.db.db?.close()

    const updated = await worker(
      bundle({ chart: '{title: Alpha}\n{key: G}\n[G]Alpha, fixed' }),
      '"e2"'
    )
    const second = await open('', updated.fetchFile)
    if (second.state !== 'ready') throw new Error(second.state)
    expect(second.fresh).to.equal(true)
    const song = must(await second.db.getDefaultSongVariant(second.setlist.songs[0].songId))
    expect((await second.db.getChordPro(song.chordproFileId))?.content).to.include('fixed')
    expect(second.setlist.received?.etag).to.equal('"e2"')
    expect(await second.db.getAllSetlists()).to.have.length(1)
    second.db.db?.close()
  })

  it('shows the copy when offline, or when the worker is failing', async () => {
    const first = await open(key, (await worker()).fetchFile)
    if (first.state === 'ready') first.db.db?.close()

    for (const fetchFile of [offline, status(502)]) {
      const again = await open('', fetchFile)
      expect(again.state).to.equal('ready')
      if (again.state === 'ready') again.db.db?.close()
    }
  })

  it('has nothing to show offline the first time', async () => {
    expect(await open(key, offline)).to.deep.equal({ state: 'unavailable', offline: true })
    expect(await open(key, status(502))).to.deep.equal({ state: 'unavailable', offline: false })
    expect(await databases()).to.not.include(`${SHARE_DB_PREFIX}${FILE}`)
  })

  it('deletes the copy when the share has ended (a 404)', async () => {
    const first = await open(key, (await worker()).fetchFile)
    if (first.state === 'ready') first.db.db?.close()

    expect(await open('', status(404))).to.deep.equal({ state: 'ended' })
    expect(await databases()).to.not.include(`${SHARE_DB_PREFIX}${FILE}`)
    // ...and it stays ended
    expect(await open(key, status(404))).to.deep.equal({ state: 'ended' })
  })

  it('deletes the copy once it is past its end date, without asking the worker', async () => {
    const first = await open(key, (await worker(bundle({ expires: '2026-10-20' }))).fetchFile)
    if (first.state === 'ready') first.db.db?.close()

    const { fetchFile, calls } = await worker()
    expect(await open('', fetchFile, '2026-10-21')).to.deep.equal({ state: 'ended' })
    expect(calls).to.have.length(0)
    expect(await databases()).to.not.include(`${SHARE_DB_PREFIX}${FILE}`)
  })

  it('does not keep a share that arrives already ended', async () => {
    const { fetchFile } = await worker(bundle({ expires: '2026-10-01' }))
    expect(await open(key, fetchFile)).to.deep.equal({ state: 'ended' })
    expect(await databases()).to.not.include(`${SHARE_DB_PREFIX}${FILE}`)
  })

  it('needs the key the first time, and a key that fits', async () => {
    const { fetchFile, calls } = await worker()
    expect(await open('', fetchFile)).to.deep.equal({ state: 'needs-key' })
    expect(calls).to.have.length(0)
    expect(await open(generateShareKey(), fetchFile)).to.deep.equal({ state: 'bad-key' })
    expect(await databases()).to.not.include(`${SHARE_DB_PREFIX}${FILE}`)
  })

  it("isn't a bad key when what came back isn't the file", async () => {
    const html = (async () =>
      new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html' },
      })) as unknown as typeof fetch
    expect(await open(key, html)).to.deep.equal({ state: 'unavailable', offline: false })
  })

  it('removes the copies of ended shares at start-up, and only those', async () => {
    const first = await open(key, (await worker(bundle({ expires: '2026-10-20' }))).fetchFile)
    if (first.state === 'ready') first.db.db?.close()
    const other = new ChordlessDB('not-a-share-db')
    await other.init()
    other.db?.close()

    expect(await deleteExpiredShares('2026-10-19')).to.equal(0)
    expect(await databases()).to.include(`${SHARE_DB_PREFIX}${FILE}`)
    expect(await deleteExpiredShares('2026-10-21')).to.equal(1)
    expect(await databases()).to.not.include(`${SHARE_DB_PREFIX}${FILE}`)
    expect((await indexedDB.databases()).map(d => d.name)).to.include('not-a-share-db')
    indexedDB.deleteDatabase('not-a-share-db')
  })

  it('leaves a share that is still being opened (no setlist saved yet) alone', async () => {
    const name = `${SHARE_DB_PREFIX}${FILE}`
    const db = new ChordlessDB(name)
    await db.init()
    expect(await deleteExpiredShares('2026-10-21')).to.equal(0)
    expect(await databases()).to.include(name)
    db.db?.close()
    await forgetShare(FILE)
  })
})
