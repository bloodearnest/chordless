import { expect } from '@open-wc/testing'
import { SyncPushedEvent } from '../src/js/auto-sync.ts'
import { DataChangeEvent } from '../src/js/data-changes.ts'
import { LiveChangeEvent, type LiveState } from '../src/js/live.ts'
import type { LiveChannelEvents, LiveStatus } from '../src/js/live-channel.ts'
import {
  FEED_LAG_MS,
  type LiveChannelLike,
  type LiveSpace,
  LiveSync,
  type LiveTarget,
  type LiveWorld,
  liveTargets,
} from '../src/js/live-sync.ts'
import { getLiveSyncStatus, LiveSyncStatusEvent } from '../src/js/live-sync-status.ts'
import { SpaceChangeEvent } from '../src/js/space.ts'

const { describe, it } = window

const live = (url: string): LiveState => ({ url, title: 'Sunday', startedAt: 0 })
const team = (over: Partial<LiveSpace> = {}): LiveSpace => ({
  teamId: 'team-1',
  canWrite: true,
  readOnly: false,
  ...over,
})
const kinds = (targets: LiveTarget[]) => targets.map(target => target.key)

/** Where the channels come from: what is live, the space in use, and the setlist's share */
function world(over: Partial<LiveWorld> = {}) {
  const kept: { setlistId: string; secret: string }[] = []
  const w: LiveWorld = {
    live: () => live('/setlist/abc'),
    space: async () => team(),
    readOnly: async () => false,
    share: async () => null,
    keepLiveSecret: async (setlistId, secret) => {
      kept.push({ setlistId, secret })
    },
    newSecret: () => 'a-new-secret',
    ...over,
  }
  return { w, kept }
}

describe('Which channels a device needs', () => {
  it('is none when nothing is live', async () => {
    expect(await liveTargets(world({ live: () => null }).w)).to.deep.equal([])
  })

  it('is the team space’s when the live setlist is one of its own', async () => {
    const targets = await liveTargets(world().w)
    expect(targets).to.deep.equal([
      { kind: 'team', key: 'team:team-1', teamId: 'team-1', canWrite: true },
    ])
  })

  it('is none for an own setlist in a space that is not a team’s, with no share', async () => {
    expect(await liveTargets(world({ space: async () => null }).w)).to.deep.equal([])
  })

  it('knows a song in the setlist, or a path that is not a setlist’s', async () => {
    for (const url of ['/setlist/abc/song/2', '/setlist/abc#x']) {
      expect(kinds(await liveTargets(world({ live: () => live(url) }).w)), url).to.deep.equal([
        'team:team-1',
      ])
    }
    expect(await liveTargets(world({ live: () => live('/account') }).w)).to.deep.equal([])
  })

  it('is the share’s room, as a listener, for a setlist received by link, and not the team’s', async () => {
    const targets = await liveTargets(
      world({ live: () => live('/s/file%20id12345/song/1#key=abc') }).w
    )
    expect(targets).to.deep.equal([
      { kind: 'share-recipient', key: 'receive:file id12345', fileId: 'file id12345' },
    ])
  })

  it('adds the share’s room, as its sender, when the setlist is shared: for a team’s and for a personal space’s', async () => {
    const share = async () => ({ fileId: 'file-1234567', liveSecret: 'the-secret' })
    const sender: LiveTarget = {
      kind: 'share-sender',
      key: 'send:file-1234567',
      fileId: 'file-1234567',
      secret: 'the-secret',
    }
    expect(kinds(await liveTargets(world({ share }).w))).to.deep.equal([
      'team:team-1',
      'send:file-1234567',
    ])
    expect(await liveTargets(world({ share, space: async () => null }).w)).to.deep.equal([sender])
  })

  it('makes the sender’s secret the first time, and keeps it on the setlist', async () => {
    const { w, kept } = world({ share: async () => ({ fileId: 'file-1234567' }) })
    const [, sender] = await liveTargets(w)
    expect(sender).to.include({ kind: 'share-sender', secret: 'a-new-secret' })
    expect(kept).to.deep.equal([{ setlistId: 'abc', secret: 'a-new-secret' }])
  })

  it('does not keep a secret it already has', async () => {
    const { w, kept } = world({
      share: async () => ({ fileId: 'f'.repeat(12), liveSecret: 'old' }),
    })
    await liveTargets(w)
    expect(kept).to.deep.equal([])
  })

  it('does not send for a share from a space the user can only read: a sync would not update it', async () => {
    const { w } = world({
      readOnly: async () => true,
      share: async () => ({ fileId: 'file-1234567', liveSecret: 'x' }),
    })
    expect(kinds(await liveTargets(w))).to.deep.equal(['team:team-1'])
  })
})

/** A channel the test drives */
class FakeChannel implements LiveChannelLike {
  status: LiveStatus = 'offline'
  started = false
  stopped = false
  retries = 0
  notified = 0
  target: LiveTarget
  events: LiveChannelEvents
  constructor(target: LiveTarget, events: LiveChannelEvents) {
    this.target = target
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

const teamTarget = (over: Partial<Extract<LiveTarget, { kind: 'team' }>> = {}): LiveTarget => ({
  kind: 'team',
  key: 'team:team-1',
  teamId: 'team-1',
  canWrite: true,
  ...over,
})
const sender: LiveTarget = { kind: 'share-sender', key: 'send:f1', fileId: 'f1', secret: 's' }
const recipient: LiveTarget = { kind: 'share-recipient', key: 'receive:f2', fileId: 'f2' }

/** A manager on a world the test controls */
function rig(initial: LiveTarget[] = [teamTarget()]) {
  const win = new EventTarget()
  const doc = new EventTarget()
  const state = {
    targets: initial,
    visible: true,
    syncs: 0,
    reloads: [] as string[],
    channels: [] as FakeChannel[],
    timers: [] as { ms: number; fn: () => void; cancelled: boolean }[],
    statuses: [] as (LiveStatus | null)[],
  }
  win.addEventListener(LiveSyncStatusEvent.type, event =>
    state.statuses.push((event as LiveSyncStatusEvent).status)
  )
  const sync = new LiveSync({
    win,
    doc,
    targets: async () => state.targets,
    channel: (target, events) => {
      const channel = new FakeChannel(target, events)
      state.channels.push(channel)
      return channel
    },
    syncSoon: async () => {
      state.syncs++
    },
    reloadShare: async fileId => {
      state.reloads.push(fileId)
    },
    visible: () => state.visible,
    later: (ms, fn) => {
      const timer = { ms, fn, cancelled: false }
      state.timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  const channel = (index = state.channels.length - 1) => state.channels[index]
  return { sync, state, win, doc, settle, channel }
}

describe('Live sync', () => {
  it('joins the channels of what is live', async () => {
    const { sync, state, settle } = rig([teamTarget(), sender])
    sync.start()
    await settle()
    expect(state.channels.map(channel => channel.target.key)).to.deep.equal([
      'team:team-1',
      'send:f1',
    ])
    expect(state.channels.every(channel => channel.started)).to.equal(true)
    sync.stop()
  })

  it('joins nothing when nothing is live', async () => {
    const { sync, state, settle } = rig([])
    sync.start()
    await settle()
    expect(state.channels).to.have.length(0)
    sync.stop()
  })

  it('joins when the device goes live, and leaves when it stops', async () => {
    const { sync, state, win, settle, channel } = rig([])
    sync.start()
    await settle()
    state.targets = [teamTarget()]
    win.dispatchEvent(new LiveChangeEvent(null))
    await settle()
    expect(channel().started).to.equal(true)

    state.targets = []
    win.dispatchEvent(new LiveChangeEvent(null))
    await settle()
    expect(channel().stopped).to.equal(true)
    sync.stop()
  })

  it('moves to the channels of another space when one is switched to, and stays when it is the same', async () => {
    const { sync, state, win, settle } = rig()
    sync.start()
    await settle()
    win.dispatchEvent(new SpaceChangeEvent('local-1'))
    await settle()
    expect(state.channels, 'the same space').to.have.length(1)

    state.targets = [teamTarget({ key: 'team:team-2', teamId: 'team-2' })]
    win.dispatchEvent(new SpaceChangeEvent('local-2'))
    await settle()
    expect(state.channels.map(channel => channel.target.key)).to.deep.equal([
      'team:team-1',
      'team:team-2',
    ])
    expect(state.channels[0].stopped).to.equal(true)
    sync.stop()
  })

  it('keeps a channel it is in when the person’s role changes, and goes by the new one', async () => {
    const { sync, state, win, settle } = rig([teamTarget({ canWrite: false })])
    sync.start()
    await settle()
    state.targets = [teamTarget({ canWrite: true })]
    win.dispatchEvent(new SpaceChangeEvent('same'))
    await settle()
    expect(state.channels).to.have.length(1)
    win.dispatchEvent(new SyncPushedEvent())
    expect(state.channels[0].notified).to.equal(1)
    sync.stop()
  })

  describe('in a team space', () => {
    it('syncs at once when another device says it changed something, and once more after Drive’s feed has caught up', async () => {
      const { sync, state, settle, channel } = rig()
      sync.start()
      await settle()

      channel().events.changed()
      expect(state.syncs).to.equal(1)
      expect(state.timers.at(-1)?.ms).to.equal(FEED_LAG_MS)
      state.timers.at(-1)?.fn()
      expect(state.syncs).to.equal(2)
      sync.stop()
    })

    it('asks for one follow-up, not one for each of a burst', async () => {
      const { sync, state, settle, channel } = rig()
      sync.start()
      await settle()
      channel().events.changed()
      channel().events.changed()
      channel().events.changed()
      expect(state.syncs).to.equal(3)
      expect(state.timers.filter(timer => !timer.cancelled)).to.have.length(1)
      sync.stop()
    })

    it('syncs when the channel comes up, to catch up on what it missed', async () => {
      const { sync, state, settle, channel } = rig()
      sync.start()
      await settle()
      channel().events.connected()
      expect(state.syncs).to.equal(1)
      sync.stop()
    })

    it('tells the others when its changes are in the space, if the person may write', async () => {
      const writer = rig()
      writer.sync.start()
      await writer.settle()
      writer.win.dispatchEvent(new SyncPushedEvent())
      expect(writer.channel().notified).to.equal(1)
      writer.sync.stop()

      const reader = rig([teamTarget({ canWrite: false })])
      reader.sync.start()
      await reader.settle()
      reader.win.dispatchEvent(new SyncPushedEvent())
      expect(reader.channel().notified, 'a reader only listens').to.equal(0)
      reader.sync.stop()
    })
  })

  describe('with a share', () => {
    it('tells the recipients when the sync that updated the share is done', async () => {
      const { sync, win, settle, state } = rig([sender])
      sync.start()
      await settle()
      win.dispatchEvent(new SyncPushedEvent())
      expect(state.channels[0].notified).to.equal(1)
      sync.stop()
    })

    it('does not fetch anything for a "changed" a sender hears: its own sync has the setlist', async () => {
      const { sync, state, settle, channel } = rig([sender])
      sync.start()
      await settle()
      channel().events.changed()
      channel().events.connected()
      expect(state.syncs).to.equal(0)
      expect(state.reloads).to.deep.equal([])
      sync.stop()
    })

    it('fetches the share again when told it changed, and once more after, and when it comes up', async () => {
      const { sync, state, settle, channel } = rig([recipient])
      sync.start()
      await settle()

      channel().events.connected()
      expect(state.reloads).to.deep.equal(['f2'])
      channel().events.changed()
      expect(state.reloads).to.deep.equal(['f2', 'f2'])
      state.timers.at(-1)?.fn()
      expect(state.reloads).to.deep.equal(['f2', 'f2', 'f2'])
      expect(state.syncs, 'a share is not the space').to.equal(0)
      sync.stop()
    })

    it('does not tell the others from a recipient’s device: they only listen', async () => {
      const { sync, win, settle, state } = rig([recipient])
      sync.start()
      await settle()
      win.dispatchEvent(new SyncPushedEvent())
      expect(state.channels[0].notified).to.equal(0)
      sync.stop()
    })

    it('has a channel for the team and one for the share, each doing its own', async () => {
      const { sync, state, win, settle } = rig([teamTarget(), sender])
      sync.start()
      await settle()
      win.dispatchEvent(new SyncPushedEvent())
      expect(state.channels.map(channel => channel.notified)).to.deep.equal([1, 1])
      sync.stop()
    })
  })

  it('joins a share’s room when the setlist is shared while live, and leaves it when it is not', async () => {
    const { sync, state, win, settle } = rig([teamTarget()])
    sync.start()
    await settle()
    const saved = () =>
      new DataChangeEvent({
        spaceId: 's',
        kind: 'setlist',
        ids: ['abc'],
        origin: 'local',
        remote: false,
      })

    state.targets = [teamTarget(), sender]
    win.dispatchEvent(saved())
    await settle()
    expect(state.channels.map(channel => channel.target.key)).to.deep.equal([
      'team:team-1',
      'send:f1',
    ])
    expect(state.channels[0].stopped, 'the team’s stays').to.equal(false)

    state.targets = [teamTarget()]
    win.dispatchEvent(saved())
    await settle()
    expect(state.channels[1].stopped).to.equal(true)
    sync.stop()
  })

  it('does not work out the channels again for a change that is not a setlist’s', async () => {
    const { sync, state, win, settle } = rig([])
    sync.start()
    await settle()
    state.targets = [teamTarget()]
    win.dispatchEvent(
      new DataChangeEvent({
        spaceId: 's',
        kind: 'song',
        ids: ['x'],
        origin: 'local',
        remote: false,
      })
    )
    await settle()
    expect(state.channels).to.have.length(0)
    sync.stop()
  })

  it('tries the channels again when the device is back online or the app is shown', async () => {
    const { sync, state, win, doc, settle, channel } = rig()
    sync.start()
    await settle()
    win.dispatchEvent(new Event('online'))
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(channel().retries).to.equal(2)

    state.visible = false
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(channel().retries, 'not while hidden').to.equal(2)
    sync.stop()
  })

  describe('the state shown', () => {
    it('is up only when every channel is, and none when there are none', async () => {
      const { sync, state, win, settle } = rig([teamTarget(), sender])
      sync.start()
      await settle()
      const [first, second] = state.channels
      first.status = 'connected'
      first.events.status('connected')
      second.status = 'connecting'
      second.events.status('connecting')
      expect(getLiveSyncStatus()).to.equal('connecting')

      second.status = 'offline'
      second.events.status('offline')
      expect(getLiveSyncStatus(), 'one is down').to.equal('offline')

      second.status = 'connected'
      second.events.status('connected')
      expect(getLiveSyncStatus()).to.equal('connected')

      state.targets = []
      win.dispatchEvent(new LiveChangeEvent(null))
      await settle()
      expect(getLiveSyncStatus()).to.equal(null)
      expect(state.statuses.at(-1)).to.equal(null)
      sync.stop()
    })
  })

  it('goes by the last change of mind when what is live is slow to be worked out', async () => {
    const { sync, state, win, settle } = rig()
    sync.start()
    await settle()
    state.channels.length = 0
    state.targets = [teamTarget({ key: 'team:team-9', teamId: 'team-9' })]
    win.dispatchEvent(new SpaceChangeEvent('a'))
    state.targets = []
    win.dispatchEvent(new LiveChangeEvent(null))
    await settle()
    expect(state.channels, 'it was left before the first answer came').to.have.length(0)
    sync.stop()
  })

  it('carries on with no channels when it cannot tell what is live', async () => {
    const win = new EventTarget()
    const sync = new LiveSync({
      win,
      doc: new EventTarget(),
      targets: async () => {
        throw new Error('database closed')
      },
      channel: () => {
        throw new Error('no channel wanted')
      },
      syncSoon: async () => {},
      reloadShare: async () => {},
      visible: () => true,
      later: () => () => {},
    })
    const warn = console.warn
    console.warn = () => {}
    try {
      sync.start()
      await new Promise(resolve => setTimeout(resolve, 0))
    } finally {
      console.warn = warn
    }
    sync.stop()
  })

  it('stops listening when stopped', async () => {
    const { sync, state, win, settle } = rig([])
    sync.start()
    await settle()
    sync.stop()
    state.targets = [teamTarget()]
    win.dispatchEvent(new LiveChangeEvent(null))
    await settle()
    expect(state.channels).to.have.length(0)
  })
})
