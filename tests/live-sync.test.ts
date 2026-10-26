import { expect } from '@open-wc/testing'
import { SyncPushedEvent } from '../src/js/auto-sync.ts'
import { LiveChangeEvent } from '../src/js/live.ts'
import type { LiveChannelEvents, LiveStatus } from '../src/js/live-channel.ts'
import { FEED_LAG_MS, type LiveChannelLike, type LiveSpace, LiveSync } from '../src/js/live-sync.ts'
import { getLiveSyncStatus, LiveSyncStatusEvent } from '../src/js/live-sync-status.ts'
import { SpaceChangeEvent } from '../src/js/space.ts'

const { describe, it } = window

/** A channel the test drives */
class FakeChannel implements LiveChannelLike {
  status: LiveStatus = 'offline'
  started = false
  stopped = false
  retries = 0
  notified = 0
  teamId: string
  events: LiveChannelEvents
  constructor(teamId: string, events: LiveChannelEvents) {
    this.teamId = teamId
    this.events = events
  }
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
  }
  retryNow() {
    this.retries++
  }
  notify() {
    this.notified++
    return true
  }
}

/** A manager on a world the test controls */
function rig(initial: { live?: boolean; space?: LiveSpace | null } = {}) {
  const win = new EventTarget()
  const doc = new EventTarget()
  const world = {
    live: initial.live ?? true,
    space: initial.space === undefined ? { teamId: 'team-1', canWrite: true } : initial.space,
    visible: true,
    syncs: 0,
    channels: [] as FakeChannel[],
    timers: [] as { ms: number; fn: () => void; cancelled: boolean }[],
    statuses: [] as (LiveStatus | null)[],
  }
  win.addEventListener(LiveSyncStatusEvent.type, event =>
    world.statuses.push((event as LiveSyncStatusEvent).status)
  )
  const sync = new LiveSync({
    win,
    doc,
    isLive: () => world.live,
    space: async () => world.space,
    channel: (teamId, events) => {
      const channel = new FakeChannel(teamId, events)
      world.channels.push(channel)
      return channel
    },
    syncSoon: async () => {
      world.syncs++
    },
    visible: () => world.visible,
    later: (ms, fn) => {
      const timer = { ms, fn, cancelled: false }
      world.timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  const channel = () => world.channels.at(-1)
  return { sync, world, win, doc, settle, channel }
}

describe('Live sync', () => {
  it('joins the space’s channel when the device is live on a team space', async () => {
    const { sync, world, settle, channel } = rig()
    sync.start()
    await settle()
    expect(world.channels).to.have.length(1)
    expect(channel()?.teamId).to.equal('team-1')
    expect(channel()?.started).to.equal(true)
    sync.stop()
  })

  it('joins nothing when the device is not live, or the space is not a team’s', async () => {
    for (const initial of [{ live: false }, { space: null }]) {
      const { sync, world, settle } = rig(initial)
      sync.start()
      await settle()
      expect(world.channels, JSON.stringify(initial)).to.have.length(0)
      sync.stop()
    }
  })

  it('joins when the device goes live, and leaves when it stops', async () => {
    const { sync, world, win, settle, channel } = rig({ live: false })
    sync.start()
    await settle()
    world.live = true
    win.dispatchEvent(new LiveChangeEvent(null))
    await settle()
    expect(channel()?.started).to.equal(true)

    world.live = false
    win.dispatchEvent(new LiveChangeEvent(null))
    await settle()
    expect(channel()?.stopped).to.equal(true)
    sync.stop()
  })

  it('moves to the channel of another space when one is switched to, and stays when it is the same', async () => {
    const { sync, world, win, settle } = rig()
    sync.start()
    await settle()
    win.dispatchEvent(new SpaceChangeEvent('local-1'))
    await settle()
    expect(world.channels, 'the same space').to.have.length(1)

    world.space = { teamId: 'team-2', canWrite: true }
    win.dispatchEvent(new SpaceChangeEvent('local-2'))
    await settle()
    expect(world.channels.map(channel => channel.teamId)).to.deep.equal(['team-1', 'team-2'])
    expect(world.channels[0].stopped).to.equal(true)
    sync.stop()
  })

  it('syncs at once when another device says it changed something, and once more after Drive’s feed has caught up', async () => {
    const { sync, world, settle, channel } = rig()
    sync.start()
    await settle()

    channel()?.events.changed()
    expect(world.syncs).to.equal(1)
    expect(world.timers.at(-1)?.ms).to.equal(FEED_LAG_MS)
    world.timers.at(-1)?.fn()
    expect(world.syncs).to.equal(2)
    sync.stop()
  })

  it('asks for one follow-up, not one for each of a burst', async () => {
    const { sync, world, settle, channel } = rig()
    sync.start()
    await settle()

    channel()?.events.changed()
    channel()?.events.changed()
    channel()?.events.changed()
    expect(world.syncs).to.equal(3)
    expect(world.timers.filter(timer => !timer.cancelled)).to.have.length(1)
    sync.stop()
  })

  it('syncs when the channel comes up, to catch up on what it missed', async () => {
    const { sync, world, settle, channel } = rig()
    sync.start()
    await settle()
    channel()?.events.connected()
    expect(world.syncs).to.equal(1)
    sync.stop()
  })

  it('tells the others when its changes are in the space, if the person may write', async () => {
    const writer = rig()
    writer.sync.start()
    await writer.settle()
    writer.win.dispatchEvent(new SyncPushedEvent())
    expect(writer.channel()?.notified).to.equal(1)
    writer.sync.stop()

    const reader = rig({ space: { teamId: 'team-1', canWrite: false } })
    reader.sync.start()
    await reader.settle()
    reader.win.dispatchEvent(new SyncPushedEvent())
    expect(reader.channel()?.notified, 'a reader only listens').to.equal(0)
    reader.sync.stop()
  })

  it('tells nothing when there is no channel', async () => {
    const { sync, win, settle } = rig({ live: false })
    sync.start()
    await settle()
    win.dispatchEvent(new SyncPushedEvent())
    sync.stop()
  })

  it('tries the channel again when the device is back online or the app is shown', async () => {
    const { sync, world, win, doc, settle, channel } = rig()
    sync.start()
    await settle()
    win.dispatchEvent(new Event('online'))
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(channel()?.retries).to.equal(2)

    world.visible = false
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(channel()?.retries, 'not while hidden').to.equal(2)
    sync.stop()
  })

  it('shows the channel’s state, and none when it is left', async () => {
    const { sync, world, win, settle, channel } = rig()
    sync.start()
    await settle()
    channel()?.events.status('connecting')
    channel()?.events.status('connected')
    expect(getLiveSyncStatus()).to.equal('connected')

    world.live = false
    win.dispatchEvent(new LiveChangeEvent(null))
    await settle()
    expect(getLiveSyncStatus()).to.equal(null)
    expect(world.statuses.at(-1)).to.equal(null)
    sync.stop()
  })

  it('goes by the last change of mind when the space is slow to be read', async () => {
    const { sync, world, win, settle } = rig()
    sync.start()
    await settle()
    world.channels.length = 0
    world.space = { teamId: 'team-9', canWrite: true }
    win.dispatchEvent(new SpaceChangeEvent('a'))
    world.live = false
    win.dispatchEvent(new LiveChangeEvent(null))
    await settle()
    expect(world.channels, 'it was left before the first answer came').to.have.length(0)
    sync.stop()
  })

  it('stops listening when stopped', async () => {
    const { sync, world, win, settle } = rig({ live: false })
    sync.start()
    await settle()
    sync.stop()
    world.live = true
    win.dispatchEvent(new LiveChangeEvent(null))
    await settle()
    expect(world.channels).to.have.length(0)
  })
})
