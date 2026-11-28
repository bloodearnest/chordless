import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { getLibrarySongs, getSongWithContent } from '../src/js/song-utils.ts'
import {
  type SpaceDataResponse,
  SpaceDataSync,
  type SpaceDataTransport,
  spaceDataTransport,
} from '../src/js/space-data.ts'
import { mergeSpaceRecord } from '../src/js/space-data-merge.ts'
import { type SpaceRecord, sharedRecord } from '../src/js/space-data-records.ts'
import { SpaceDataStore } from '../src/js/space-data-store.ts'
import type { SpaceData, SpaceOp, SpaceOpResult, SpaceSetlist } from '../src/js/space-data-types.ts'
import { transactionDone } from '../src/js/utils/idb.ts'
import { makeAnnotation, makeEntry, makeLocalState, makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, afterEach } = window
const handles: ChordlessDB[] = []
async function open(): Promise<ChordlessDB> {
  const db = new ChordlessDB(`test-d1-sync-${crypto.randomUUID()}`)
  await db.init()
  handles.push(db)
  return db
}
afterEach(async () => {
  for (const db of handles.splice(0)) {
    db.db?.close()
    await deleteDatabase(db.dbName)
  }
})
const remote = (overrides: Partial<SpaceSetlist> = {}): SpaceSetlist => ({
  ...(sharedRecord('setlist', makeSetlist()) as SpaceSetlist),
  version: 1,
  ...overrides,
})
const spaceData = (setlists: SpaceSetlist[] = []): SpaceData => ({
  songs: [],
  setlists,
  people: [],
  padSets: [],
  from: null,
})
const clone = <T>(value: T): T => structuredClone(value)
async function ready(data = spaceData()) {
  const db = await open()
  const store = new SpaceDataStore(db)
  await store.apply(data, 'etag-1')
  return { db, store }
}
const entry = (songId: string, key = 'C') => ({
  songId,
  songUuid: songId,
  title: songId,
  ccli: null,
  key,
  tempo: null,
  notes: '',
  annotations: [],
  extra: {},
})

class Server implements SpaceDataTransport {
  data = spaceData([remote()])
  reads: { all: boolean; etag: string | null }[] = []
  writes: SpaceOp[][] = []
  beforeWrite: (() => Promise<void>) | null = null
  failure = false
  async read(options: { all: boolean; etag: string | null }): Promise<SpaceDataResponse> {
    this.reads.push(options)
    return { data: clone(this.data), etag: 'server-tag' }
  }
  async write(ops: SpaceOp[]): Promise<SpaceOpResult[]> {
    this.writes.push(clone(ops))
    const before = this.beforeWrite
    this.beforeWrite = null
    await before?.()
    if (this.failure) throw new Error('offline')
    return ops.map(op => {
      const current = this.data.setlists.find(row => row.setlistId === op.id)
      if (current && current.version !== op.baseVersion)
        return { status: 'conflict', current: clone(current) }
      if (op.op === 'delete') {
        this.data.setlists = this.data.setlists.filter(row => row.setlistId !== op.id)
        return { status: 'ok', version: 0 }
      }
      if (!current && op.baseVersion !== null) return { status: 'missing' }
      const next = { ...clone(op.record as SpaceSetlist), version: (current?.version ?? 0) + 1 }
      this.data.setlists = this.data.setlists.filter(row => row.setlistId !== op.id).concat(next)
      return { status: 'ok', version: next.version }
    })
  }
}
function engine(
  store: SpaceDataStore,
  transport: SpaceDataTransport,
  online = () => true,
  notify = {}
) {
  return new SpaceDataSync({ store, transport, online, lock: work => work(), ...notify })
}

describe('D1 device data sync and outbox', () => {
  it('keeps Drive-only writes out of the outbox, including after a not-moved probe', async () => {
    const db = await open()
    const store = new SpaceDataStore(db)
    await db.saveSetlist(makeSetlist())
    expect(await store.pending()).to.deep.equal([])
    await store.probe()
    await db.updateSetlist('setlist-1', row => {
      row.name = 'During probe'
    })
    expect(await store.pending()).to.have.length(1)
    await engine(store, { read: async () => ({ moved: false }), write: async () => [] }).sync()
    expect((await store.state()).enabled).to.equal(false)
    expect(await store.pending()).to.deep.equal([])
    expect(must(await db.getSetlist('setlist-1')).name).to.equal('During probe')
  })

  it('queues before the first space data response so an edit made during the request survives it', async () => {
    const db = await open()
    await db.saveSetlist(makeSetlist())
    const store = new SpaceDataStore(db)
    let reads = 0
    const server = new Server()
    const transport: SpaceDataTransport = {
      write: ops => server.write(ops),
      read: async options => {
        if (!reads++)
          await db.updateSetlist('setlist-1', row => {
            row.name = 'Edited during fetch'
          })
        return server.read(options)
      },
    }
    await engine(store, transport).sync()
    expect(server.data.setlists[0].name).to.equal('Edited during fetch')
    expect(await store.pending()).to.deep.equal([])
    expect(server.reads[0].all).to.equal(true)
  })

  it('coalesces offline edits durably, retaining the original base and keeping them when server data arrives', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.name = 'First'
    })
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Second'
    })
    const queued = await store.pending()
    expect(queued).to.have.length(1)
    expect((queued[0].base as SpaceSetlist).name).to.equal('')
    expect(queued[0].change.baseVersion).to.equal(1)
    const server = new Server()
    await engine(store, server, () => false).sync()
    expect(server.writes).to.have.length(0)
    await store.apply(spaceData([remote({ name: 'Remote', version: 2 })]), 'later')
    expect(must(await db.getSetlist('setlist-1')).name).to.equal('Second')
    const another = new ChordlessDB(db.spaceId)
    await another.init()
    expect(await new SpaceDataStore(another).pending()).to.deep.equal(queued)
    another.db?.close()
  })

  it('applies window deletions while retaining old history, pending creations, and personal state', async () => {
    const { db, store } = await ready(
      spaceData([remote(), remote({ setlistId: 'old', date: '2020-01-01' })])
    )
    await db.saveLocalState(makeLocalState('setlist-1'))
    await db.saveSetlist(makeSetlist({ id: 'offline-new' }))
    await store.apply({ ...spaceData(), from: '2026-01-01' }, 'window')
    expect(await db.getSetlist('setlist-1')).to.equal(undefined)
    expect(await db.getSetlist('old')).to.exist
    expect(await db.getSetlist('offline-new')).to.exist
    expect((await db.getLocalState('setlist-1')).padsEnabled).to.equal(true)
    await store.apply(spaceData(), 'all')
    expect(await db.getSetlist('old')).to.equal(undefined)
  })

  it('keeps personal additions on a shared pull and excludes them and Drive links from writes', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.songs.push(makeEntry({ local: true }))
      row.fileRef = 'private-drive-link'
    })
    expect(await store.pending()).to.deep.equal([])
    await store.apply(spaceData([remote({ name: 'Server edit' })]), 'next')
    expect(must(await db.getSetlist('setlist-1')).songs[0].local).to.equal(true)
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Shared edit'
    })
    const record = (await store.pending())[0].change.record as SpaceSetlist
    expect(record.songs).to.deep.equal([])
    expect(record).not.to.have.property('fileRef')
    expect(record.body).not.to.have.property('fileRef')
  })

  it('does not overwrite a newer local edit with the acknowledgement for an earlier one', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Sent'
    })
    const sent = (await store.pending())[0]
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Newer'
      row.time = '11:00'
    })
    await store.settle(sent, { status: 'ok', version: 2 })
    expect(must(await db.getSetlist('setlist-1')).name).to.equal('Newer')
    const queued = (await store.pending())[0]
    expect(queued.change.baseVersion).to.equal(2)
    expect((queued.base as SpaceSetlist).name).to.equal('Sent')
    expect((queued.change.record as SpaceSetlist).name).to.equal('Newer')
  })

  it('handles a create removed during its request and a delete undone during its request', async () => {
    const { db, store } = await ready()
    await db.saveSetlist(makeSetlist())
    const create = (await store.pending())[0]
    await db.deleteSetlist('setlist-1')
    await store.settle(create, { status: 'ok', version: 1 })
    const deletion = (await store.pending())[0]
    expect(deletion.change).to.include({ op: 'delete', baseVersion: 1 })
    expect(await db.getSetlist('setlist-1')).to.equal(undefined)
    await db.saveSetlist(makeSetlist({ name: 'Restored' }))
    await store.settle(deletion, { status: 'ok', version: 0 })
    expect((await store.pending())[0].change).to.include({ op: 'put', baseVersion: null })
    expect(must(await db.getSetlist('setlist-1')).name).to.equal('Restored')
  })

  it('sends an edit, merges a conflict and sends edits made while the request was in flight', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    const server = new Server()
    server.data.setlists[0] = remote({ name: 'Other device', time: '12:00', version: 2 })
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Mine'
    })
    server.beforeWrite = () =>
      db
        .updateSetlist('setlist-1', row => {
          row.type = 'Evening'
        })
        .then(() => undefined)
    let notices = 0
    let pushed = 0
    await engine(store, server, () => true, {
      conflict: () => notices++,
      pushed: () => pushed++,
    }).sync()
    expect(server.data.setlists[0]).to.include({
      name: 'Mine',
      time: '12:00',
      type: 'Evening',
      version: 3,
    })
    expect(notices).to.equal(1)
    expect(pushed).to.equal(1)
    expect(await store.pending()).to.deep.equal([])
  })

  it('recovers a lost acknowledgement without duplicating a create', async () => {
    const { db, store } = await ready()
    const server = new Server()
    server.data = spaceData()
    await db.saveSetlist(makeSetlist({ name: 'Only once' }))
    const sent = (await store.pending())[0]
    await server.write([sent.change])
    await engine(store, server).sync()
    expect(server.data.setlists).to.have.length(1)
    expect(server.data.setlists[0].version).to.equal(1)
    expect(await store.pending()).to.deep.equal([])
  })

  it('retains edits on network failure, then sends them on reconnect', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    const server = new Server()
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Offline'
    })
    server.failure = true
    let failed = false
    try {
      await engine(store, server).sync()
    } catch {
      failed = true
    }
    expect(failed).to.equal(true)
    expect(await store.pending()).to.have.length(1)
    server.failure = false
    await engine(store, server).sync()
    expect(server.data.setlists[0].name).to.equal('Offline')
    expect(await store.pending()).to.deep.equal([])
  })

  for (const status of ['forbidden', 'invalid', 'missing'] as const) {
    it(`keeps a ${status} edit local and retries only when asked`, async () => {
      const { db, store } = await ready(spaceData([remote()]))
      await db.updateSetlist('setlist-1', row => {
        row.name = 'Local choice'
      })
      const sent = (await store.pending())[0]
      const refused: SpaceOpResult =
        status === 'missing' ? { status } : { status, error: 'Refused' }
      await store.settle(sent, refused)
      await store.apply(spaceData([remote({ name: 'Server', version: 2 })]), 'updated')
      expect(must(await db.getSetlist('setlist-1')).name).to.equal('Local choice')
      expect((await store.pending())[0].refusal?.status).to.equal(status)
      await store.retryRefused()
      expect((await store.pending())[0].refusal).to.equal(undefined)
    })
  }

  it('sends a setlist queued with only song ids under the songs the library holds, also one refused for it', async () => {
    const { db, store } = await ready()
    await db.saveSong(makeSong({ uuid: 'held-uuid', id: 'ccli-1' }))
    const record = remote({
      setlistId: 'old-setlist',
      songs: [entry('ccli-1', 'G'), entry('placeholder-hash-1')],
    })
    const tx = must(db.db).transaction('space_outbox', 'readwrite')
    tx.objectStore('space_outbox').put({
      id: 'queued',
      base: null,
      change: { kind: 'setlist', id: 'old-setlist', op: 'put', baseVersion: null, record },
      refusal: { status: 'invalid', reason: 'a song that the church library does not have yet' },
    })
    await transactionDone(tx)
    const setlistOf = async () =>
      must((await store.pending()).find(waiting => waiting.change.kind === 'setlist'))
    const sent = await setlistOf()
    const songs = (sent.change.record as SpaceSetlist).songs
    expect(songs.map(song => song.songUuid)).to.deep.equal(['held-uuid', 'placeholder-hash-1'])
    expect(songs[0]).to.include({ songId: 'ccli-1', key: 'G' })
    expect(sent.refusal).to.equal(undefined)
    // (kept so: the next look is the same, and a song not held is not asked about again)
    expect(await setlistOf()).to.deep.equal(sent)
  })

  it('does not retry or disclose a record whose id belongs to another space', async () => {
    const { db, store } = await ready()
    await db.saveSetlist(makeSetlist())
    const sent = (await store.pending())[0]
    await store.settle(sent, { status: 'conflict', current: null })
    expect((await store.pending())[0].refusal?.status).to.equal('conflict')
    expect(must(await db.getSetlist('setlist-1')).id).to.equal('setlist-1')
  })

  it('indexes remote songs without charts and exposes them to the library and setlists', async () => {
    const indexed = {
      ...(sharedRecord('song', {
        songUuid: 'song-uuid',
        songId: 'title-song',
        title: 'Known song',
        ccli: '12345',
        key: 'D',
        licence: '42',
        isDefault: true,
        variantOf: null,
        variantLabel: '',
        contentHash: 'hash',
        fileRef: 'drive-file',
        version: 2,
        modifiedAt: '2026-11-20T10:00:00Z',
      }) as SpaceRecord),
    }
    const { db } = await ready({ ...spaceData(), songs: [indexed as SpaceData['songs'][number]] })
    expect(await db.getSong('song-uuid')).to.equal(undefined)
    const song = await getSongWithContent('song-uuid', db)
    expect(song).to.include({ missing: true, title: 'Known song', ccliNumber: '12345' })
    expect((await getLibrarySongs(db))[0].uuid).to.equal('song-uuid')
  })

  it('queues song and person changes but never chart content or personal state', async () => {
    const { db, store } = await ready()
    const song = await db.saveSong(makeSong())
    await db.savePeople([
      { id: 'person', name: 'Leader', emails: [], modifiedDate: song.modifiedDate },
    ])
    await db.saveChordPro({
      id: song.chordproFileId,
      content: '[C]Private words',
      contentHash: 'hash',
    })
    await db.saveLocalState(makeLocalState('setlist-1'))
    const pending = await store.pending()
    expect(pending.map(row => row.change.kind).sort()).to.deep.equal(['person', 'song'])
    expect(JSON.stringify(pending)).not.to.contain('Private words')
    await db.deleteSong(song.uuid)
    expect((await store.pending()).find(row => row.change.kind === 'song')?.change.op).to.equal(
      'delete'
    )
  })

  it('does not queue records written through a sync handle or erase local charts on pull', async () => {
    const { db, store } = await ready()
    const sync = new ChordlessDB(db.spaceId, 'sync')
    await sync.init()
    await sync.saveSetlist(makeSetlist())
    expect(await store.pending()).to.deep.equal([])
    await db.saveChordPro({ id: 'chart', content: 'Kept', contentHash: 'hash' })
    await store.apply(spaceData(), 'new')
    expect(must(await db.getChordPro('chart')).content).to.equal('Kept')
    sync.db?.close()
  })

  it('refuses malformed space data responses before deleting anything', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    let failed = false
    try {
      await store.apply({ ...spaceData(), songs: undefined } as unknown as SpaceData, null)
    } catch {
      failed = true
    }
    expect(failed).to.equal(true)
    expect(await db.getSetlist('setlist-1')).to.exist
  })

  it('remembers complete history and uses conditional reads on later runs', async () => {
    const db = await open()
    const store = new SpaceDataStore(db)
    const server = new Server()
    const sync = engine(store, server)
    await sync.sync()
    expect(server.reads[0]).to.deep.equal({ all: true, etag: null })
    expect((await store.state()).complete).to.equal(true)
    await sync.sync()
    expect(server.reads.at(-1)).to.deep.equal({ all: false, etag: 'server-tag' })
    await sync.sync({ all: true })
    expect(server.reads.at(-1)).to.deep.equal({ all: true, etag: null })
  })
})

describe('three-way space record merges', () => {
  it('combines independent fields and entry edits, removals, additions and moves', () => {
    const base = remote({ songs: [entry('a'), entry('b'), entry('c')] })
    const mine = { ...base, name: 'Mine', songs: [entry('c'), entry('a', 'D'), entry('new')] }
    const theirs = {
      ...base,
      time: '12:00',
      songs: [entry('server'), entry('a'), entry('b'), { ...entry('c'), notes: 'Remote note' }],
    }
    const merged = mergeSpaceRecord('setlist', base, mine, theirs)
    const result = merged.record as SpaceSetlist
    expect(result).to.include({ name: 'Mine', time: '12:00' })
    expect(result.songs.map(song => song.songId)).to.deep.equal(['server', 'c', 'a', 'new'])
    expect(result.songs.find(song => song.songId === 'a')?.key).to.equal('D')
    expect(result.songs.find(song => song.songId === 'c')?.notes).to.equal('Remote note')
    expect(merged.conflict).to.equal(false)
  })
  it('combines independent body fields without a spurious conflict', () => {
    const base = remote({ body: { owner: 'Ann', share: null } })
    const result = mergeSpaceRecord(
      'setlist',
      base,
      { ...base, body: { ...base.body, owner: 'Bob' } },
      { ...base, body: { ...base.body, share: { fileId: 'file' } } }
    )
    expect((result.record as SpaceSetlist).body).to.deep.equal({
      owner: 'Bob',
      share: { fileId: 'file' },
    })
    expect(result.conflict).to.equal(false)
  })
})

describe('space-data HTTP transport', () => {
  it('carries account authentication, conditional reads, all history and batch results', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    const transport = spaceDataTransport('team/id', {
      origin: 'https://chordless.test',
      token: async () => 'account-token',
      fetch: (async (input, init) => {
        requests.push({ url: String(input), init: init ?? {} })
        if (init?.method === 'POST')
          return Response.json({ results: [{ status: 'ok', version: 2 }] })
        return new Response(null, { status: 304 })
      }) as typeof fetch,
    })
    expect(await transport.read({ all: true, etag: 'tag' })).to.deep.equal({ unchanged: true })
    expect(requests[0].url).to.equal('https://chordless.test/api/space/team%2Fid/data?all=1')
    expect(new Headers(requests[0].init.headers).get('Authorization')).to.equal(
      'Bearer account-token'
    )
    expect(new Headers(requests[0].init.headers).get('If-None-Match')).to.equal('tag')
    expect(
      await transport.write([{ kind: 'setlist', op: 'delete', id: 'setlist-1', baseVersion: 1 }])
    ).to.deep.equal([{ status: 'ok', version: 2 }])
  })
})

describe('space-data retries and record kinds', () => {
  it('persists people, merged-person links and deletions, and pad-set edits/deletions', async () => {
    const { db, store } = await ready({
      ...spaceData(),
      people: [
        {
          personId: 'leader',
          name: 'Ann',
          emails: ['ann@example.com'],
          teamMember: 'google:ann',
          mergedInto: null,
          version: 3,
          modifiedAt: '2026-11-20T10:00:00Z',
        },
      ],
      padSets: [{ padSetId: 'pads', name: 'Warm', version: 2, modifiedAt: '2026-11-20T10:00:00Z' }],
    })
    expect(must(await db.getPerson('leader')).teamMember).to.equal('google:ann')
    await db.savePeople([{ ...must(await db.getPerson('leader')), mergedInto: 'other' }])
    expect((await store.pending())[0].change).to.include({ kind: 'person', baseVersion: 3 })
    await db.savePeople([{ ...must(await db.getPerson('leader')), deleted: true }])
    expect((await store.pending())[0].change.op).to.equal('delete')
    await store.savePadSet({ ...(await store.padSets())[0], name: 'Soft' })
    const pad = must((await store.pending()).find(row => row.change.kind === 'pad-set'))
    expect(pad.change.record).to.include({ padSetId: 'pads', name: 'Soft' })
    await store.settle(pad, { status: 'ok', version: 3 })
    expect((await store.padSets())[0].version).to.equal(3)
    await store.deletePadSet('pads')
    const deleted = must((await store.pending()).find(row => row.change.kind === 'pad-set'))
    await store.settle(deleted, { status: 'missing' })
    expect(await store.padSets()).to.deep.equal([])
    expect(await store.settle(deleted, { status: 'ok', version: 0 })).to.deep.equal({
      conflict: false,
    })
    // Undo restores a person from a tombstone as a new row, not as an update to the deleted row.
    const person = must((await store.pending()).find(row => row.change.kind === 'person'))
    await store.settle(person, { status: 'ok', version: 0 })
    await db.addPeople([
      { id: 'added', name: 'New', emails: [], modifiedDate: '2026-11-20T10:00:00Z' },
    ])
    expect((await store.pending())[0].change.op).to.equal('put')
  })

  it('keeps indexed song metadata and Drive file acknowledgements in step without copying chart text', async () => {
    const db = await open()
    const song = await db.saveSong(makeSong({ licence: '123' }))
    await db.saveChordPro({
      id: song.chordproFileId,
      content: '{title: Private}\n[C]Lyrics',
      contentHash: 'old',
    })
    const store = new SpaceDataStore(db)
    const indexed = {
      ...(sharedRecord(
        'song',
        must(await db.getSongIndex(song.uuid))
      ) as SpaceData['songs'][number]),
      title: 'Indexed title',
      version: 4,
      modifiedAt: '2026-11-20T10:00:00Z',
    }
    await store.apply({ ...spaceData(), songs: [indexed] }, 'tag')
    expect(must(await db.getSong(song.uuid))).to.include({ title: 'Indexed title', version: 4 })
    const sync = new ChordlessDB(db.spaceId, 'sync')
    await sync.init()
    try {
      await sync.saveSongsSent([{ ...must(await db.getSong(song.uuid)), fileRef: 'uploaded-file' }])
    } finally {
      sync.db?.close()
    }
    const pending = (await store.pending())[0]
    expect(pending.change.baseVersion).to.equal(4)
    expect(pending.change.record).to.include({ fileRef: 'uploaded-file' })
    expect(JSON.stringify(pending)).not.to.contain('Lyrics')
    await store.settle(pending, { status: 'ok', version: 5 })
    await db.unlinkFiles(new Set(['uploaded-file']))
    expect((await store.pending())[0].change.record).to.include({ fileRef: null })
    await store.apply(spaceData(), 'removed')
    // A pending local link edit remains protected even when absent from the space data response.
    expect(await db.getSongIndex(song.uuid)).to.exist
    await store.settle((await store.pending())[0], { status: 'missing' })
    await store.retryRefused()
  })

  it('retains a reader’s local changes while still incorporating later shared fields', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Local name'
    })
    await store.settle((await store.pending())[0], { status: 'forbidden', error: 'Reader' })
    await store.apply(
      spaceData([remote({ name: 'Server name', time: '19:00', version: 3 })]),
      'new'
    )
    expect(must(await db.getSetlist('setlist-1'))).to.include({ name: 'Local name', time: '19:00' })
    expect((await store.pending())[0].change.baseVersion).to.equal(3)
    expect((await store.pending())[0].refusal?.status).to.equal('forbidden')
  })

  it('does not block a corrected edit because an older in-flight request was invalid', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Bad'
    })
    const sent = (await store.pending())[0]
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Corrected'
    })
    await store.settle(sent, { status: 'invalid', error: 'Old value was invalid' })
    expect((await store.pending())[0].refusal).to.equal(undefined)
    await engine(store, new Server()).sync()
    expect(await store.pending()).to.deep.equal([])
  })

  it('rebases deletions against the current version and never recreates a remotely removed record', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    const removed = must(await db.removeSetlist('setlist-1'))
    const sent = (await store.pending())[0]
    const conflict = await store.settle(sent, {
      status: 'conflict',
      current: remote({ name: 'Updated', version: 2 }),
    })
    expect(conflict.conflict).to.equal(true)
    const next = (await store.pending())[0]
    expect(next.change).to.include({ op: 'delete', baseVersion: 2 })
    expect(await db.getSetlist('setlist-1')).to.equal(undefined)
    await store.settle(next, { status: 'ok', version: 0 })
    await db.restoreSetlist(removed)
    expect((await store.pending())[0].change.baseVersion).to.equal(null)
  })

  it('preserves unrecognised shared metadata, and removes body fields explicitly removed here', () => {
    const base = remote({
      body: { owner: 'Ann', ownerId: 'ann@example.com', share: { fileId: 'file' }, future: 'kept' },
      songs: [{ ...entry('a'), extra: { future: 'entry' } }],
    })
    const local = { ...base, body: { ...base.body } }
    delete local.body.owner
    const merged = mergeSpaceRecord('setlist', base, local, { ...base, time: '12:00' })
    expect((merged.record as SpaceSetlist).body).to.deep.equal({
      ownerId: 'ann@example.com',
      share: { fileId: 'file' },
      future: 'kept',
    })
  })

  it('merges people by edited field and handles restored, deleted and concurrently added entries', () => {
    const base = {
      personId: 'p',
      name: 'Ann',
      emails: ['ann@example.com'],
      teamMember: null,
      mergedInto: null,
      version: 1,
      modifiedAt: 'now',
    }
    const merged = mergeSpaceRecord(
      'person',
      base,
      { ...base, name: 'Anne' },
      { ...base, emails: ['new@example.com'], version: 2 }
    )
    expect(merged.record).to.include({ name: 'Anne' })
    expect((merged.record as typeof base).emails).to.deep.equal(['new@example.com'])
    const list = remote({ songs: [entry('a'), entry('b')] })
    const mine = { ...list, songs: [{ ...entry('a'), notes: 'Restored' }, entry('new')] }
    const theirs = {
      ...list,
      songs: [
        { ...entry('b'), notes: 'Edited before removal' },
        { ...entry('new'), notes: 'Theirs' },
      ],
    }
    const result = mergeSpaceRecord('setlist', list, mine, theirs)
    expect((result.record as SpaceSetlist).songs.map(song => song.songId)).to.deep.equal([
      'a',
      'new',
    ])
    expect(result.conflict).to.equal(true)
    const reordered = mergeSpaceRecord(
      'setlist',
      remote({ songs: [entry('a'), entry('b')] }),
      remote({ songs: [entry('b'), entry('a')] }),
      remote({ songs: [entry('b'), entry('a')] })
    )
    expect(reordered.conflict).to.equal(false)
    const created = mergeSpaceRecord('setlist', null, remote(), remote({ name: 'Other create' }))
    expect(created.conflict).to.equal(true)
  })

  it('keeps a trailing sync when asked during a request and bounds repeated contention', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Mine'
    })
    const server = new Server()
    const sync = engine(store, server)
    let trailing: Promise<void> | undefined
    server.beforeWrite = async () => {
      trailing = sync.sync({ all: true, retryRefused: true })
    }
    await sync.sync()
    await trailing
    expect(server.reads.at(-1)?.all).to.equal(true)
    let calls = 0
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Still mine'
    })
    const contended: SpaceDataTransport = {
      read: options => server.read(options),
      write: async () => {
        calls++
        return [
          {
            status: 'conflict',
            current: remote({ name: `Concurrent ${calls}`, version: calls + 10 }),
          },
        ]
      },
    }
    await engine(store, contended).sync()
    expect(calls).to.equal(10)
    expect(await store.pending()).to.have.length(1)
  })

  it('refuses a missing first space data response and a rollback from D1 to Drive', async () => {
    const db = await open()
    const store = new SpaceDataStore(db)
    const fails = async (read: () => Promise<SpaceDataResponse>) => {
      let error = ''
      try {
        await engine(store, { read, write: async () => [] }).sync()
      } catch (caught) {
        error = (caught as Error).message
      }
      return error
    }
    expect(await fails(async () => ({ unchanged: true }))).to.contain('First space data response')
    await store.apply(spaceData(), 'tag')
    expect(await fails(async () => ({ moved: false }))).to.contain('may not revert')
  })

  it('rejects a malformed batch response without dropping the queued edits', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Pending'
    })
    for (const results of [[], [{ status: 'unknown' }] as unknown as SpaceOpResult[]]) {
      let failed = false
      try {
        await engine(store, {
          read: async () => ({ unchanged: true }),
          write: async () => results,
        }).sync()
      } catch {
        failed = true
      }
      expect(failed).to.equal(true)
      expect(await store.pending()).to.have.length(1)
    }
  })

  it('honours an explicit retry of a refused write through the engine', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.name = 'Retry'
    })
    const transport: SpaceDataTransport = {
      read: async () => ({ unchanged: true }),
      write: async () => [{ status: 'forbidden', error: 'Role changed' }],
    }
    let notified = ''
    await engine(store, transport, () => true, {
      refused: (reason: string) => {
        notified = reason
      },
    }).sync()
    expect(notified).to.equal('Role changed')
    const server = new Server()
    const sync = engine(store, server)
    await sync.sync()
    expect(server.writes).to.deep.equal([])
    await sync.sync({ retryRefused: true })
    expect(server.data.setlists[0].name).to.equal('Retry')
  })
})

describe('space-data record round trips and malformed replies', () => {
  it('round-trips entry extras and shared body fields while allowing them to be removed', async () => {
    const data = remote({
      body: {
        owner: 'Ann',
        ownerId: 'ann@example.com',
        share: { fileId: 'public' },
        future: 'retained',
      },
      songs: [{ ...entry('a'), extra: { future: 'entry' } }],
    })
    const { db, store } = await ready(spaceData([data]))
    const row = must(await db.getSetlist(data.setlistId))
    expect(row.owner).to.equal('Ann')
    expect(row.songs[0].spaceDataExtra).to.deep.equal({ future: 'entry' })
    await db.updateSetlist(row.id, setlist => {
      setlist.name = 'Edited'
      setlist.owner = undefined
    })
    const queued = (await store.pending())[0].change.record as SpaceSetlist
    expect(queued.songs[0].extra).to.deep.equal({ future: 'entry' })
    expect(queued.body.future).to.equal('retained')
    expect(queued.body.share).to.deep.equal({ fileId: 'public' })
    // The explicitly supported fields must not be resurrected from the retained metadata bag.
    expect(queued.body.owner).to.equal(undefined)
  })

  it('shows metadata-only songs and known songs whose local chart file is absent in runtime setlists', async () => {
    const { buildRuntimeSongs } = await import('../src/js/setlist/runtime-songs.ts')
    const { ChordProParser } = await import('../src/js/parser.ts')
    const db = await open()
    await db.saveSong(makeSong())
    const store = new SpaceDataStore(db)
    const indexed = {
      ...(sharedRecord(
        'song',
        must(await db.getSongIndex('song-uuid'))
      ) as SpaceData['songs'][number]),
      version: 2,
      key: 'D',
      title: 'Missing chart',
      modifiedAt: '2026-11-20T10:00:00Z',
    }
    await store.apply({ ...spaceData(), songs: [indexed] }, 'tag')
    expect((await getSongWithContent('song-uuid', db)).missing).to.equal(true)
    const runtime = await buildRuntimeSongs(makeSetlist({ songs: [makeEntry()] }), {
      db,
      parser: new ChordProParser(),
    })
    expect(runtime[0]).to.include({ title: 'Missing chart', missing: true, currentKey: 'D' })
    expect(runtime[0].parsed.sections).to.deep.equal([])
  })

  it('rejects malformed record identities, windows and record shapes before changing the device', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    const broken = [
      { ...spaceData(), from: 'not-a-date' },
      spaceData([remote({ version: 0 })]),
      spaceData([remote(), remote()]),
      { ...spaceData(), setlists: [{ ...remote(), setlistId: undefined }] },
      { ...spaceData(), setlists: [{ ...remote(), songs: null }] },
      { ...spaceData(), setlists: [{ ...remote(), body: null }] },
      {
        ...spaceData(),
        setlists: [{ ...remote(), songs: [{ ...entry('bad'), annotations: null }] }],
      },
      {
        ...spaceData(),
        people: [{ personId: 'p', name: 'P', emails: null, version: 1, modifiedAt: 'now' }],
      },
      {
        ...spaceData(),
        songs: [{ songUuid: 's', songId: 'song', title: 42, version: 1, modifiedAt: 'now' }],
      },
      { ...spaceData(), padSets: [{ padSetId: 'p', name: null, version: 1, modifiedAt: 'now' }] },
    ]
    for (const data of broken) {
      let failed = false
      try {
        await store.apply(data as unknown as SpaceData, null)
      } catch {
        failed = true
      }
      expect(failed).to.equal(true)
      expect(await db.getSetlist('setlist-1')).to.exist
    }
  })

  it('reads not-moved responses, JSON data, server errors and rejects malformed HTTP batches', async () => {
    let response = Response.json({ error: 'not_moved' }, { status: 409 })
    const transport = spaceDataTransport('team', {
      origin: 'https://chordless.test',
      token: async () => 'account',
      fetch: (async () => response) as typeof fetch,
    })
    expect(await transport.read({ all: false, etag: null })).to.deep.equal({ moved: false })
    response = Response.json(spaceData(), { headers: { ETag: 'tag' } })
    expect(await transport.read({ all: false, etag: null })).to.deep.equal({
      data: spaceData(),
      etag: 'tag',
    })
    response = Response.json({ error: 'Forbidden' }, { status: 403 })
    let status = 0
    try {
      await transport.read({ all: false, etag: null })
    } catch (error) {
      status = (error as { status: number }).status
    }
    expect(status).to.equal(403)
    response = Response.json({ results: [] })
    let failed = false
    try {
      await transport.write([{ kind: 'setlist', id: 's', op: 'delete' }])
    } catch {
      failed = true
    }
    expect(failed).to.equal(true)
  })
})

describe('server data deletion and merge edge cases', () => {
  it('removes a remotely deleted song from the library while retaining its cached chart', async () => {
    const db = await open()
    const song = await db.saveSong(makeSong())
    await db.saveChordPro({ id: song.chordproFileId, content: 'Kept chart', contentHash: 'hash' })
    const store = new SpaceDataStore(db)
    const indexed = {
      ...(sharedRecord(
        'song',
        must(await db.getSongIndex(song.uuid))
      ) as SpaceData['songs'][number]),
      version: 1,
    }
    await store.apply({ ...spaceData(), songs: [indexed] }, 'present')
    await store.apply(spaceData(), 'deleted')
    expect(await db.getSong(song.uuid)).to.equal(undefined)
    expect(await db.getSongIndex(song.uuid)).to.equal(undefined)
    expect(must(await db.getChordPro(song.chordproFileId)).content).to.equal('Kept chart')
  })
  it('queues soft deletion as deletion and checks that the database is open', async () => {
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.deletedAt = '2026-11-20T10:00:00Z'
    })
    expect((await store.pending())[0].change.op).to.equal('delete')
    const unopened = new SpaceDataStore(new ChordlessDB('unopened-test'))
    let message = ''
    try {
      await unopened.state()
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).to.equal('Space database is not open')
  })
  it('does not reinsert a concurrently deleted entry when moving other entries', () => {
    const base = remote({ songs: [entry('a'), entry('b'), entry('c')] })
    const mine = { ...base, songs: [entry('c'), entry('a'), entry('b')] }
    const theirs = { ...base, songs: [entry('a'), entry('c')] }
    const result = mergeSpaceRecord('setlist', base, mine, theirs).record as SpaceSetlist
    expect(result.songs.map(song => song.songId)).to.deep.equal(['c', 'a'])
    expect(result.songs.every(Boolean)).to.equal(true)
    // A locally edited entry deleted remotely is restored in the local order, with its edit.
    const restored = mergeSpaceRecord(
      'setlist',
      base,
      { ...mine, songs: [entry('c'), { ...entry('b'), notes: 'Keep' }, entry('a')] },
      theirs
    ).record as SpaceSetlist
    expect(restored.songs.map(song => song.songId)).to.deep.equal(['c', 'b', 'a'])
  })
})

describe('a Team first opened offline', () => {
  it('queues edits before knowing its server mode and stops this provisional queue for a known Drive Team', async () => {
    const { createSpace, updateSpace, deleteSpace } = await import('../src/js/space.ts')
    const { openSpace } = await import('../src/js/db.ts')
    const space = await createSpace(`Offline Team ${crypto.randomUUID()}`)
    await updateSpace(space.id, { team: { id: 'offline-team', role: 'writer' } })
    const db = await openSpace(space.id)
    try {
      const store = new SpaceDataStore(db)
      await db.saveSetlist(makeSetlist({ name: 'Created offline' }))
      expect(await store.pending()).to.have.length(1)
      await engine(
        store,
        { read: async () => ({ moved: false }), write: async () => [] },
        () => false
      ).sync()
      expect(await store.pending()).to.have.length(1)
      await engine(store, { read: async () => ({ moved: false }), write: async () => [] }).sync()
      expect(await store.pending()).to.deep.equal([])
      const reopened = await openSpace(space.id)
      try {
        await reopened.updateSetlist('setlist-1', row => {
          row.name = 'Drive owns this edit'
        })
      } finally {
        reopened.db?.close()
      }
      expect(await store.pending()).to.deep.equal([])
      expect(must(await db.getSetlist('setlist-1')).name).to.equal('Drive owns this edit')
      // An already enabled checkpoint is not turned back into a probe by another handle.
      await store.apply(spaceData([remote()]), 'active')
      await store.probe({ onlyUnknown: true })
      expect((await store.state()).probing).to.equal(false)
    } finally {
      db.db?.close()
      await deleteSpace(space.id)
    }
  })
})

describe('acknowledgements in a live chart', () => {
  it('does not turn sync bookkeeping into a visible content change', async () => {
    const { setlistContentHash, setlistContent } = await import('../src/js/sync/setlist-hash.ts')
    const { db, store } = await ready(spaceData([remote()]))
    await db.updateSetlist('setlist-1', row => {
      row.songs = [makeEntry({ title: 'Known', ccli: null })]
    })
    const before = must(await db.getSetlist('setlist-1'))
    const hash = setlistContentHash(before)
    const pending = (await store.pending())[0]
    await store.settle(pending, { status: 'ok', version: 2 })
    const after = must(await db.getSetlist('setlist-1'))
    expect(after.version).to.equal(2)
    expect(setlistContentHash(after)).to.equal(hash)
    expect(setlistContent(after)).not.to.have.property('spaceDataBody')
    expect(setlistContent(after).songs[0]).not.to.have.property('spaceDataExtra')
  })
})

describe('shared annotations and private sync metadata', () => {
  it('applies annotations and their removal while excluding retained metadata from content', async () => {
    const annotation = makeAnnotation('repeat')
    const row = remote({
      songs: [{ ...entry('song-1'), annotations: [annotation], extra: { future: true } }],
    })
    const { db, store } = await ready(spaceData([row]))
    const annotated = must(await db.getSetlist('setlist-1'))
    expect(annotated.songs[0].annotations).to.deep.equal([annotation])
    const { setlistContent } = await import('../src/js/sync/setlist-hash.ts')
    expect(setlistContent(annotated).songs[0]).not.to.have.property('spaceDataExtra')
    expect(annotated.songs[0].spaceDataExtra).to.deep.equal({ future: true })
    await store.apply(
      spaceData([{ ...row, version: 2, songs: [{ ...entry('song-1') }] }]),
      'etag-2'
    )
    expect(must(await db.getSetlist('setlist-1')).songs[0].annotations).to.deep.equal([])
  })
})
