import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { type LeaderNames, personalDataTransport } from '../src/js/space-data.ts'
import { sharedRecord } from '../src/js/space-data-records.ts'
import { SpaceDataStore } from '../src/js/space-data-store.ts'
import type { SpaceSetlist } from '../src/js/space-data-types.ts'
import {
  type MoveSteps,
  moveToServer,
  ServerHasDataError,
  serverSteps,
} from '../src/js/space-move.ts'
import { makeSetlist } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, afterEach } = window

const handles: ChordlessDB[] = []
async function open(): Promise<ChordlessDB> {
  const db = new ChordlessDB(`test-move-${crypto.randomUUID()}`)
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

const PERSONAL = { readKinds: ['setlist' as const], writeKinds: ['setlist' as const] }

describe('moving a Personal space to the server', () => {
  const steps = (log: string[], over: Partial<MoveSteps> = {}): MoveSteps => ({
    makeLibrary: async () => {
      log.push('library')
      return 'lib-1'
    },
    serverHasData: async id => {
      log.push(`has-data ${id}`)
      return false
    },
    seed: async () => {
      log.push('seed')
    },
    mark: async (id, at) => {
      log.push(`mark ${id} ${at}`)
    },
    sync: async () => {
      log.push('sync')
    },
    now: () => '2026-11-25T10:00:00.000Z',
    ...over,
  })

  it('makes the library, checks the server is empty, queues the setlists, marks the space, then sends', async () => {
    const log: string[] = []
    expect(await moveToServer(steps(log))).to.equal('lib-1')
    expect(log).to.deep.equal([
      'library',
      'has-data lib-1',
      'seed',
      'mark lib-1 2026-11-25T10:00:00.000Z',
      'sync',
    ])
  })

  it('moves nothing, and marks nothing, when the account already has data', async () => {
    const log: string[] = []
    let error: unknown
    try {
      await moveToServer(steps(log, { serverHasData: async () => true }))
    } catch (caught) {
      error = caught
    }
    expect(error).to.be.instanceOf(ServerHasDataError)
    // (the library is made, which is harmless and the same each time: nothing is queued, marked or sent)
    expect(log).to.deep.equal(['library'])
  })
})

describe('what the server is asked for a move', () => {
  const connection = (answer: (url: URL, init?: RequestInit) => Response) => ({
    token: async () => 'token',
    origin: 'https://chordless.test',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
      answer(new URL(String(input)), init)) as typeof fetch,
  })

  it('makes the personal library, and says its id', async () => {
    const calls: string[] = []
    const { makeLibrary } = serverSteps(
      connection((url, init) => {
        calls.push(`${init?.method} ${url.pathname}`)
        return Response.json({ libraryId: 'lib-9' })
      })
    )
    expect(await makeLibrary()).to.equal('lib-9')
    expect(calls).to.deep.equal(['PUT /api/account/library'])
    const { makeLibrary: broken } = serverSteps(connection(() => Response.json({})))
    let error: unknown
    try {
      await broken()
    } catch (caught) {
      error = caught
    }
    expect((error as Error).message).to.match(/did not name a library/)
  })

  it('says whether the library or the setlists hold anything', async () => {
    const held = (songs: unknown[], setlists: unknown[]) =>
      serverSteps(
        connection(url => Response.json(url.pathname.endsWith('/songs') ? { songs } : { setlists }))
      ).serverHasData('lib 1')
    expect(await held([], [])).to.equal(false)
    expect(await held([{}], [])).to.equal(true)
    expect(await held([], [{}])).to.equal(true)
  })
})

const noLeaders: LeaderNames = {
  names: async () => new Map(),
  idFor: async name => `person-of-${name}`,
}

describe('the Personal space on the server, as the device sends and reads it', () => {
  it('reads the setlists as a space and says when they are unchanged', async () => {
    const seen: (string | null)[] = []
    const transport = personalDataTransport(
      {
        token: async () => 't',
        origin: 'https://chordless.test',
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const headers = new Headers(init?.headers)
          seen.push(headers.get('If-None-Match'))
          if (headers.get('If-None-Match') === '"tag"') return new Response(null, { status: 304 })
          expect(new URL(String(input)).pathname).to.equal('/api/account/setlists')
          return Response.json({ setlists: [] }, { headers: { ETag: '"tag"' } })
        }) as typeof fetch,
      },
      noLeaders
    )
    expect(await transport.read({ all: true, etag: null })).to.deep.equal({
      data: { songs: [], setlists: [], people: [], padSets: [], from: null },
      etag: '"tag"',
    })
    expect(await transport.read({ all: false, etag: '"tag"' })).to.deep.equal({ unchanged: true })
    expect(seen).to.deep.equal([null, '"tag"'])
  })

  it('writes changes as a batch, and refuses an answer that does not match them', async () => {
    let answer: unknown = { results: [{ status: 'ok', version: 1 }] }
    const transport = personalDataTransport(
      {
        token: async () => 't',
        origin: 'https://chordless.test',
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(new URL(String(input)).pathname).to.equal('/api/account/setlists/batch')
          expect(init?.method).to.equal('POST')
          return Response.json(answer)
        }) as typeof fetch,
      },
      noLeaders
    )
    const op = { kind: 'setlist' as const, op: 'delete' as const, id: 'x' }
    expect(await transport.write([op])).to.deep.equal([{ status: 'ok', version: 1 }])
    answer = { results: [] }
    let error: unknown
    try {
      await transport.write([op])
    } catch (caught) {
      error = caught
    }
    expect((error as Error).message).to.match(/Invalid space write response/)
  })
})

describe('the leaders of a Personal space, told to the server by name', () => {
  const people = new Map([['person-1', 'Sam']])
  const leaders: LeaderNames = {
    names: async () => people,
    idFor: async name => `person-of-${name}`,
  }
  const sent: unknown[] = []
  const serverSays = (response: unknown) =>
    personalDataTransport(
      {
        token: async () => 't',
        origin: 'https://chordless.test',
        fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === 'POST') sent.push(JSON.parse(String(init.body)))
          return Response.json(response)
        }) as typeof fetch,
      },
      leaders
    )
  const record = (over: Partial<SpaceSetlist>): SpaceSetlist => ({
    ...(sharedRecord('setlist', makeSetlist({ id: 'x' })) as SpaceSetlist),
    version: 1,
    ...over,
  })

  it('names the leader on the way out, and sends nothing of the person but the name', async () => {
    const transport = serverSays({
      results: [
        { status: 'ok', version: 1 },
        { status: 'ok', version: 1 },
        { status: 'ok', version: 1 },
      ],
    })
    await transport.write([
      {
        kind: 'setlist',
        op: 'put',
        id: 'a',
        baseVersion: null,
        record: record({ setlistId: 'a', leaderId: 'person-1' }),
      },
      {
        kind: 'setlist',
        op: 'put',
        id: 'b',
        baseVersion: null,
        record: record({ setlistId: 'b', leaderId: 'gone' }),
      },
      { kind: 'setlist', op: 'delete', id: 'c' },
    ])
    const ops = (sent.at(-1) as { ops: { id: string; record?: SpaceSetlist }[] }).ops
    expect([ops[0].record?.leaderId, ops[0].record?.leaderName]).to.deep.equal([null, 'Sam'])
    expect([ops[1].record?.leaderId, ops[1].record?.leaderName]).to.deep.equal(
      [null, null],
      'a person who is no longer there'
    )
    expect(ops[2]).to.deep.equal({ kind: 'setlist', op: 'delete', id: 'c' })
  })

  it('makes the leader a person of the space on the way in, in what is read and in a conflict', async () => {
    const read = await serverSays({
      setlists: [
        record({ setlistId: 'a', leaderId: null, leaderName: 'Anna' }),
        record({ setlistId: 'b', leaderId: null, leaderName: null }),
      ],
    }).read({ all: true, etag: null })
    expect('data' in read).to.equal(true)
    const setlists = ('data' in read ? read.data.setlists : []) as SpaceSetlist[]
    expect([setlists[0].leaderId, setlists[0].leaderName]).to.deep.equal(['person-of-Anna', null])
    expect([setlists[1].leaderId, setlists[1].leaderName]).to.deep.equal([null, null])
    const results = await serverSays({
      results: [
        { status: 'conflict', current: record({ setlistId: 'a', leaderName: 'Anna' }) },
        { status: 'conflict', current: null },
        { status: 'missing' },
      ],
    }).write([
      { kind: 'setlist', op: 'put', id: 'a', baseVersion: 1, record: record({ setlistId: 'a' }) },
      {
        kind: 'setlist',
        op: 'put',
        id: 'z',
        baseVersion: null,
        record: record({ setlistId: 'z' }),
      },
      { kind: 'setlist', op: 'delete', id: 'q' },
    ])
    expect((results[0] as { current: SpaceSetlist }).current.leaderId).to.equal('person-of-Anna')
    expect(results[1]).to.deep.equal({ status: 'conflict', current: null })
    expect(results[2]).to.deep.equal({ status: 'missing' })
  })
})

describe('queueing a Personal space for the move', () => {
  const person = {
    id: 'person-1',
    name: '  Sam ',
    emails: [],
    modifiedDate: '2026-11-01T00:00:00.000Z',
  }

  it('queues every setlist as a create, as the space has it', async () => {
    const db = await open()
    await db.savePeople([person])
    await db.saveSetlist(makeSetlist({ id: 'led', leaderId: 'person-1' }))
    await db.saveSetlist(makeSetlist({ id: 'alone', date: '2026-11-18' }))
    await db.saveSetlist(
      makeSetlist({ id: 'gone', date: '2026-11-20', deletedAt: '2026-11-21T00:00:00.000Z' })
    )
    const store = new SpaceDataStore(db, PERSONAL)
    await store.seedPersonalMove()
    const queued = (await store.pending())
      .map(entry => entry.change)
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(queued.map(change => change.id)).to.deep.equal(['alone', 'led'])
    for (const change of queued) {
      expect(change.kind).to.equal('setlist')
      expect(change.op).to.equal('put')
      expect(change.baseVersion).to.equal(null)
    }
    // (its leader is told to the server by name when it is sent: the transport's)
    expect((queued[1].record as SpaceSetlist).leaderId).to.equal('person-1')
  })

  it('keeps what is queued when the first read finds nothing on the server, and later edits are queued too', async () => {
    const db = await open()
    await db.saveSetlist(makeSetlist({ id: 'mine' }))
    const store = new SpaceDataStore(db, PERSONAL)
    await store.seedPersonalMove()
    // (the first read replaces what the server does not have, except what is waiting to be sent)
    await store.apply({ songs: [], setlists: [], people: [], padSets: [], from: null }, '"tag"')
    expect((await db.getAllSetlists()).map(setlist => setlist.id)).to.deep.equal(['mine'])
    expect((await store.state()).enabled).to.equal(true)
    expect(await store.pending()).to.have.length(1)
    await db.saveSetlist(makeSetlist({ id: 'later', date: '2026-12-01' }))
    expect(await store.pending()).to.have.length(2)
  })

  it('queues a setlist again as one create, not two, if it was already waiting', async () => {
    const db = await open()
    await db.saveSetlist(makeSetlist({ id: 'once' }))
    const store = new SpaceDataStore(db, PERSONAL)
    await store.seedPersonalMove()
    await store.seedPersonalMove()
    expect(await store.pending()).to.have.length(1)
  })
})

describe('a leader named in words', () => {
  it('goes to the server and comes back as it was', () => {
    const setlist = makeSetlist({ id: 'words', leaderName: 'Anna' })
    const shared = must(sharedRecord('setlist', setlist)) as SpaceSetlist
    expect(shared.leaderName).to.equal('Anna')
    expect((must(sharedRecord('setlist', makeSetlist())) as SpaceSetlist).leaderName).to.equal(null)
  })
})
