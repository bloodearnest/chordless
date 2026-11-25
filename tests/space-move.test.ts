import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { personalDataTransport } from '../src/js/space-data.ts'
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

describe('the Personal space on the server, as the device sends and reads it', () => {
  it('reads the setlists as a space and says when they are unchanged', async () => {
    const seen: (string | null)[] = []
    const transport = personalDataTransport({
      token: async () => 't',
      origin: 'https://chordless.test',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        seen.push(headers.get('If-None-Match'))
        if (headers.get('If-None-Match') === '"tag"') return new Response(null, { status: 304 })
        expect(new URL(String(input)).pathname).to.equal('/api/account/setlists')
        return Response.json({ setlists: [] }, { headers: { ETag: '"tag"' } })
      }) as typeof fetch,
    })
    expect(await transport.read({ all: true, etag: null })).to.deep.equal({
      data: { songs: [], setlists: [], people: [], padSets: [], from: null },
      etag: '"tag"',
    })
    expect(await transport.read({ all: false, etag: '"tag"' })).to.deep.equal({ unchanged: true })
    expect(seen).to.deep.equal([null, '"tag"'])
  })

  it('writes changes as a batch, and refuses an answer that does not match them', async () => {
    let answer: unknown = { results: [{ status: 'ok', version: 1 }] }
    const transport = personalDataTransport({
      token: async () => 't',
      origin: 'https://chordless.test',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(new URL(String(input)).pathname).to.equal('/api/account/setlists/batch')
        expect(init?.method).to.equal('POST')
        return Response.json(answer)
      }) as typeof fetch,
    })
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

describe('queueing a Personal space for the move', () => {
  const person = {
    id: 'person-1',
    name: '  Sam ',
    emails: [],
    modifiedDate: '2026-11-01T00:00:00.000Z',
  }

  it('queues every setlist as a create, a leader who is a person of the space as their name', async () => {
    const db = await open()
    await db.savePeople([person])
    await db.saveSetlist(makeSetlist({ id: 'led', leaderId: 'person-1' }))
    await db.saveSetlist(makeSetlist({ id: 'alone', date: '2026-11-18' }))
    await db.saveSetlist(makeSetlist({ id: 'named', date: '2026-11-19', leaderName: 'Anna' }))
    await db.saveSetlist(
      makeSetlist({ id: 'gone', date: '2026-11-20', deletedAt: '2026-11-21T00:00:00.000Z' })
    )
    const store = new SpaceDataStore(db, PERSONAL)
    await store.seedPersonalMove()
    const queued = (await store.pending())
      .map(entry => entry.change)
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(queued.map(change => change.id)).to.deep.equal(['alone', 'led', 'named'])
    for (const change of queued) {
      expect(change.kind).to.equal('setlist')
      expect(change.op).to.equal('put')
      expect(change.baseVersion).to.equal(null)
    }
    const led = queued.find(change => change.id === 'led')?.record as SpaceSetlist
    expect([led.leaderId, led.leaderName]).to.deep.equal([null, 'Sam'])
    const alone = queued.find(change => change.id === 'alone')?.record as SpaceSetlist
    expect([alone.leaderId, alone.leaderName]).to.deep.equal([null, null])
    const named = queued.find(change => change.id === 'named')?.record as SpaceSetlist
    expect([named.leaderId, named.leaderName]).to.deep.equal([null, 'Anna'])
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
