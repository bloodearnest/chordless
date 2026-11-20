/** The real device HTTP client and two device databases against the Worker's D1 implementation. */
import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { SpaceDataSync, spaceDataTransport } from '../src/js/space-data.ts'
import { SpaceDataStore } from '../src/js/space-data-store.ts'
import type { Actor } from '../worker/src/space-data.ts'
import { handleSpaceData } from '../worker/src/space-data.ts'
import { TeamSpaceState } from '../worker/src/team-state.ts'
import { makeSetlist } from './builders.ts'
import { browserD1 } from './d1-browser.ts'
import { must } from './must.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it } = window

describe('space data through HTTP and real D1', function () {
  this.timeout(15_000)
  it('rebuilds a second device and merges an offline edit against the first device’s newer revision', async () => {
    const d1 = await browserD1()
    const team = 'team-contract'
    const identity = { provider: 'google', sub: 'owner', email: 'owner@example.com' }
    await new TeamSpaceState(d1, team).create({
      rootRef: 'drive-root',
      name: 'Team',
      owner: identity,
    })
    await d1.prepare("UPDATE teams SET storage = 'd1' WHERE space_id = ?").bind(team).run()
    let actor: Actor = { identity, role: 'owner' }
    const requests: Request[] = []
    const transport = spaceDataTransport(team, {
      origin: 'https://chordless.test',
      token: async () => 'account',
      fetch: (async (input, init) => {
        const request = new Request(String(input), init)
        requests.push(request)
        expect(request.headers.get('Authorization')).to.equal('Bearer account')
        const rest = new URL(request.url).pathname.slice(`/api/space/${team}`.length)
        return must(await handleSpaceData(request, team, rest, d1, actor))
      }) as typeof fetch,
    })
    const a = new ChordlessDB(`test-device-a-${crypto.randomUUID()}`)
    const b = new ChordlessDB(`test-device-b-${crypto.randomUUID()}`)
    await a.init()
    await b.init()
    let online = true
    const storeA = new SpaceDataStore(a)
    const storeB = new SpaceDataStore(b)
    const syncA = new SpaceDataSync({
      store: storeA,
      transport,
      online: () => true,
      lock: work => work(),
    })
    const syncB = new SpaceDataSync({
      store: storeB,
      transport,
      online: () => online,
      lock: work => work(),
    })
    try {
      await syncA.sync()
      await a.saveSetlist(makeSetlist({ id: 'service', name: 'Initial' }))
      await syncA.sync()
      await syncB.sync()
      expect(must(await b.getSetlist('service')).version).to.equal(1)
      online = false
      await b.updateSetlist('service', row => {
        row.name = 'Offline name'
      })
      await syncB.sync()
      await a.updateSetlist('service', row => {
        row.time = '18:00'
      })
      await syncA.sync()
      online = true
      await syncB.sync()
      await syncA.sync()
      for (const db of [a, b])
        expect(must(await db.getSetlist('service'))).to.include({
          name: 'Offline name',
          time: '18:00',
          version: 3,
        })
      expect(await storeB.pending()).to.deep.equal([])
      const before = requests.length
      await syncB.sync()
      expect(requests.length).to.equal(before + 1)
      expect(requests.at(-1)?.headers.has('If-None-Match')).to.equal(true)
      // Server permissions remain authoritative, and a reader's attempted change remains local.
      actor = { identity, role: 'reader' }
      await b.updateSetlist('service', row => {
        row.name = 'My local key-change context'
      })
      await syncB.sync()
      expect((await storeB.pending())[0].refusal?.status).to.equal('forbidden')
      expect(must(await b.getSetlist('service')).name).to.equal('My local key-change context')
    } finally {
      a.db?.close()
      b.db?.close()
      await deleteDatabase(a.dbName)
      await deleteDatabase(b.dbName)
    }
  })
})
