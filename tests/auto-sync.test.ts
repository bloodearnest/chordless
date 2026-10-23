import { expect } from '@open-wc/testing'
import {
  AutoSync,
  type AutoSyncDeps,
  OFFLINE_LONG_MS,
  STALE_AFTER_MS,
  type SyncState,
  TICK_MS,
} from '../src/js/auto-sync.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

/** Let what start() and an event began run to its end */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** An AutoSync on a clock, a network and a sync the test controls */
function rig(initial: { state?: SyncState; lastSync?: number | null; online?: boolean } = {}) {
  const win = new EventTarget()
  const doc = new EventTarget()
  const world = {
    now: 1_000_000_000_000,
    visible: true,
    online: initial.online ?? true,
    state: (initial.state ?? 'feed') as SyncState,
    lastSyncAgo: initial.lastSync === undefined ? 0 : initial.lastSync,
    runs: 0,
    failNext: false,
    tick: null as null | (() => void),
    stopped: false,
  }
  const deps: AutoSyncDeps = {
    win,
    doc,
    now: () => world.now,
    visible: () => world.visible,
    online: () => world.online,
    lastSync: () =>
      world.lastSyncAgo === null ? null : new Date(world.now - world.lastSyncAgo).toISOString(),
    state: async () => world.state,
    run: async () => {
      world.runs++
      if (world.failNext) {
        world.failNext = false
        throw new Error('offline')
      }
    },
    every: (_ms, fn) => {
      world.tick = fn
      return () => {
        world.stopped = true
      }
    },
  }
  const auto = new AutoSync(deps)
  return { auto, world, win, doc }
}

describe('Syncing by itself while the app is open', () => {
  it('syncs when the app opens, if it never has or not for a while, whatever the storage can do', async () => {
    for (const lastSync of [null, STALE_AFTER_MS + 1000]) {
      for (const state of ['feed', 'no-feed'] as SyncState[]) {
        const { auto, world } = rig({ state, lastSync })
        auto.start()
        await settle()
        expect(world.runs, `${state}, last ${lastSync}`).to.equal(1)
        auto.stop()
      }
    }
  })

  it('makes a quick sync on opening soon after a sync, but only where that is cheap', async () => {
    const quick = rig({ state: 'feed', lastSync: 60_000 })
    quick.auto.start()
    await settle()
    expect(quick.world.runs).to.equal(1)

    const slow = rig({ state: 'no-feed', lastSync: 60_000 })
    slow.auto.start()
    await settle()
    expect(slow.world.runs).to.equal(0)
  })

  it('never syncs when there is nothing to sync with', async () => {
    const { auto, world } = rig({ state: 'unavailable', lastSync: null })
    auto.start()
    await settle()
    world.tick?.()
    await settle()
    expect(world.runs).to.equal(0)
  })

  it('syncs every minute while on screen and online, for a storage with a feed', async () => {
    const { auto, world } = rig({ state: 'feed' })
    auto.start()
    await settle()
    world.tick?.()
    world.tick?.()
    await settle()
    expect(world.runs).to.equal(3)

    world.visible = false
    world.tick?.()
    await settle()
    world.visible = true
    world.online = false
    world.tick?.()
    await settle()
    expect(world.runs).to.equal(3)
  })

  it('does not list a whole space every minute: a storage with no feed waits to be opened', async () => {
    const { auto, world } = rig({ state: 'no-feed', lastSync: 0 })
    auto.start()
    await settle()
    world.tick?.()
    await settle()
    expect(world.runs).to.equal(0)
  })

  it('syncs when the app is shown again, unless it has just tried', async () => {
    const { auto, world, doc } = rig({ state: 'feed' })
    auto.start()
    await settle()
    expect(world.runs).to.equal(1)

    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(world.runs).to.equal(1)

    world.now += TICK_MS
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(world.runs).to.equal(2)

    world.visible = false
    world.now += TICK_MS
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(world.runs).to.equal(2)
  })

  it('does everything a sync can when the app is shown again after a long time', async () => {
    const { auto, world, doc } = rig({ state: 'no-feed', lastSync: 0 })
    auto.start()
    await settle()
    expect(world.runs).to.equal(0)

    world.now += STALE_AFTER_MS + 1000
    world.lastSyncAgo = STALE_AFTER_MS + 1000
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(world.runs).to.equal(1)
  })

  it('syncs as if opened when the device is back online after a long time, and quickly after a short one', async () => {
    const { auto, world, win } = rig({ state: 'no-feed', lastSync: 0 })
    auto.start()
    await settle()

    win.dispatchEvent(new Event('offline'))
    world.online = false
    world.now += 10_000
    win.dispatchEvent(new Event('offline'))
    world.now += 20_000
    world.online = true
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(world.runs, 'a short time offline: no list of everything').to.equal(0)

    win.dispatchEvent(new Event('offline'))
    world.online = false
    world.now += OFFLINE_LONG_MS + 1000
    world.online = true
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(world.runs, 'a long time offline').to.equal(1)
  })

  it('counts a start with no network as offline from then, and syncs on coming back if it is stale', async () => {
    const { auto, world, win } = rig({ state: 'no-feed', online: false, lastSync: null })
    auto.start()
    await settle()
    expect(world.runs).to.equal(0)

    world.now += 1000
    world.online = true
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(world.runs).to.equal(1)
  })

  it('does not stop for a failed sync, and tries again on the next tick', async () => {
    const { auto, world } = rig({ state: 'feed' })
    world.failNext = true
    auto.start()
    await settle()
    expect(world.runs).to.equal(1)
    world.tick?.()
    await settle()
    expect(world.runs).to.equal(2)
  })

  it('stops listening and ticking when stopped', async () => {
    const { auto, world, win, doc } = rig({ state: 'feed' })
    auto.start()
    await settle()
    auto.stop()
    auto.stop()
    expect(world.stopped).to.equal(true)

    world.now += TICK_MS * 2
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(world.runs).to.equal(1)
  })
})
