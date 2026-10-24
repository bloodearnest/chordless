import { expect } from '@open-wc/testing'
import { createSetlist } from '../../src/js/db.ts'
import { createDriveApi } from '../../src/js/drive-client.ts'
import { createDriveStorage } from '../../src/js/storage/drive-storage.ts'
import { driveToken } from './commands.ts'
import { makeRealWorld } from './real-world.ts'

const { describe, it } = window

/** The credentials work, and a setlist reaches a second device through a real Drive and back */
describe('the real-Drive suite: smoke', () => {
  it('has access to Drive', async () => {
    const storage = createDriveStorage(createDriveApi({ getAccessToken: driveToken }))
    expect(await storage.available()).to.equal(true)
  })

  it('syncs a setlist from one device to another and cleans up after itself', async function (this: {
    timeout(ms: number): void
  }) {
    this.timeout(5 * 60 * 1000)
    const world = makeRealWorld({
      getAccessToken: driveToken,
      spaceName: `chordless-drive-test smoke ${crypto.randomUUID().slice(0, 8)}`,
      settleMs: 2500,
    })
    try {
      const [a, b] = [await world.makeDevice('a'), await world.makeDevice('b')]
      const setlist = { ...createSetlist({ date: '2026-01-01' }), songs: [] }
      await a.db.saveSetlist(setlist)
      await a.sync.sync()
      await world.settle?.()
      await b.sync.sync()
      expect((await b.db.getAllSetlists()).map(s => s.id)).to.deep.equal([setlist.id])
      expect((await world.live()).map(f => f.setlistId)).to.deep.equal([setlist.id])
    } finally {
      await world.dispose()
    }
  })
})
