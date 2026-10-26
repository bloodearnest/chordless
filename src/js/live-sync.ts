/**
 * Live sync (docs/LIVE_SYNC.md): while this device is live, the channels it needs are up. On a team
 * space's setlist that is the space's channel: when this device has sent its changes it tells the
 * others, and when another does, this one syncs at once instead of at the next tick. A setlist that
 * is shared by link has a room too: its sharer says it uploaded the update, and the recipients who
 * are live on the link fetch it again. The channels carry no content; the sync, or the share's
 * download, is what moves it, so all of their rules (conflicts, undo, the diff toast) apply as ever.
 *
 * The rules are here with everything injected (`LiveSyncDeps`); `startLiveSync` gives them the real
 * ones. The page shows the channels' state on the live button (live-sync-status.ts).
 */
import { SyncPushedEvent, syncSoon } from './auto-sync.ts'
import { DataChangeEvent } from './data-changes.ts'
import { getCurrentDB } from './db.ts'
import { getIdentityToken } from './google-auth.ts'
import { getLive, LiveChangeEvent, type LiveState } from './live.ts'
import { LiveChannel, type LiveChannelEvents, type LiveStatus } from './live-channel.ts'
import { announceLiveSyncStatus } from './live-sync-status.ts'
import { generateLiveSecret } from './share-crypto.ts'
import { reloadShare } from './share-receiver.ts'
import { getCurrentSpaceFull, SpaceChangeEvent } from './space.ts'
import { atLeast } from './team-roles.ts'

/** How long after a "changed" the update is fetched once more: Drive's feed shows a change a few seconds late */
export const FEED_LAG_MS = 5000

/** A channel this device joins while it is live, and what it is for */
export type LiveTarget =
  /** The team space's: the devices of its members tell each other of changes, to sync at once */
  | { kind: 'team'; key: string; teamId: string; canWrite: boolean }
  /** A share's room, as its sharer: tell the recipients that the share was uploaded */
  | { kind: 'share-sender'; key: string; fileId: string; secret: string }
  /** A share's room, as a recipient: fetch the share again when it is said to have been updated */
  | { kind: 'share-recipient'; key: string; fileId: string }

/** The team space in use, if it is one this person may join the channel of */
export interface LiveSpace {
  /** The space's id at the Worker */
  teamId: string
  /** Whether this person may tell the others (a reader only listens) */
  canWrite: boolean
  /** The user can only read the space's Drive folder, so nothing they edit is sent: nor is a share updated */
  readOnly: boolean
}

/** What finds the channels the live setlist needs; injected so that the rules are tested apart from the database */
export interface LiveWorld {
  live(): LiveState | null
  /** The team space in use, or null if it is not a team's */
  space(): Promise<LiveSpace | null>
  /** Whether the space in use is read-only, team's or not (a share is not updated from it) */
  readOnly(): Promise<boolean>
  /** The setlist's share, if it has one */
  share(setlistId: string): Promise<{ fileId: string; liveSecret?: string } | null>
  /** Keep the secret on the setlist's share (the setlist is saved as changed, so that the other devices have it) */
  keepLiveSecret(setlistId: string, secret: string): Promise<void>
  newSecret(): string
}

/** `/setlist/<id>` is one of the space's; `/s/<fileId>` is one received by link. Anything after is a song in it, or a link's fragment */
const OWN = /^\/setlist\/([^/#]+)/
const RECEIVED = /^\/s\/([^/#]+)/

/** The channels this device needs for what is live now: none if nothing is, or the setlist is not one that has any */
export async function liveTargets(world: LiveWorld): Promise<LiveTarget[]> {
  const live = world.live()
  if (!live) return []

  const received = RECEIVED.exec(live.url)
  if (received) {
    const fileId = decodeURIComponent(received[1])
    return [{ kind: 'share-recipient', key: `receive:${fileId}`, fileId }]
  }

  const own = OWN.exec(live.url)
  if (!own) return []
  const setlistId = decodeURIComponent(own[1])
  const targets: LiveTarget[] = []
  const space = await world.space()
  if (space) {
    targets.push({
      kind: 'team',
      key: `team:${space.teamId}`,
      teamId: space.teamId,
      canWrite: space.canWrite,
    })
  }
  // (a space that is not a team's has no channel, but its setlist can still be shared by link)
  if (!(await world.readOnly())) {
    const share = await world.share(setlistId)
    if (share) {
      let secret = share.liveSecret
      if (!secret) {
        secret = world.newSecret()
        await world.keepLiveSecret(setlistId, secret)
      }
      targets.push({
        kind: 'share-sender',
        key: `send:${share.fileId}`,
        fileId: share.fileId,
        secret,
      })
    }
  }
  return targets
}

/** What a channel is made of: one object per connection of this device */
export interface LiveChannelLike {
  readonly status: LiveStatus
  start(): void
  stop(): void
  retryNow(): void
  notify(): boolean
}

export interface LiveSyncDeps {
  win: EventTarget
  doc: EventTarget
  /** The channels needed now */
  targets(): Promise<LiveTarget[]>
  channel(target: LiveTarget, events: LiveChannelEvents): LiveChannelLike
  /** Sync the space in use now */
  syncSoon(): Promise<void>
  /** Fetch a received share again, as it is now */
  reloadShare(fileId: string): Promise<void>
  visible(): boolean
  later(ms: number, fn: () => void): () => void
}

interface Joined {
  target: LiveTarget
  channel: LiveChannelLike
  cancelFollowUp: (() => void) | null
}

export class LiveSync {
  #deps: LiveSyncDeps
  #joined = new Map<string, Joined>()
  /** Counts the refreshes, so that a slow answer about the targets does not undo a later one */
  #refreshes = 0

  constructor(deps: LiveSyncDeps) {
    this.#deps = deps
  }

  start(): void {
    const { win, doc } = this.#deps
    win.addEventListener(LiveChangeEvent.type, this.#refresh)
    win.addEventListener(SpaceChangeEvent.type, this.#refresh)
    win.addEventListener(DataChangeEvent.type, this.#onData)
    win.addEventListener(SyncPushedEvent.type, this.#onPushed)
    win.addEventListener('online', this.#retry)
    doc.addEventListener('visibilitychange', this.#retry)
    void this.#refresh()
  }

  stop(): void {
    const { win, doc } = this.#deps
    win.removeEventListener(LiveChangeEvent.type, this.#refresh)
    win.removeEventListener(SpaceChangeEvent.type, this.#refresh)
    win.removeEventListener(DataChangeEvent.type, this.#onData)
    win.removeEventListener(SyncPushedEvent.type, this.#onPushed)
    win.removeEventListener('online', this.#retry)
    doc.removeEventListener('visibilitychange', this.#retry)
    this.#refreshes++
    for (const joined of [...this.#joined.values()]) this.#leave(joined)
    this.#tell()
  }

  /** A setlist was saved: it may have been shared, or no longer, since the channels were worked out */
  #onData = (event: Event): void => {
    if ((event as DataChangeEvent).change.kind === 'setlist') void this.#refresh()
  }

  /** Be in the channels of what is live, and in no others */
  #refresh = async (): Promise<void> => {
    const refresh = ++this.#refreshes
    let targets: LiveTarget[]
    try {
      targets = await this.#deps.targets()
    } catch (error) {
      // (the database or the setlist could not be read: no channels, and the tick carries on)
      console.warn('[LiveSync] Could not tell what is live:', error)
      targets = []
    }
    // (a later change of mind while it was being worked out)
    if (refresh !== this.#refreshes) return

    const wanted = new Set(targets.map(target => target.key))
    for (const [key, joined] of [...this.#joined]) if (!wanted.has(key)) this.#leave(joined)
    for (const target of targets) {
      const kept = this.#joined.get(target.key)
      if (kept) {
        // (the same channel, with what changed about it: a reader made a writer, say)
        kept.target = target
        continue
      }
      this.#join(target)
    }
    this.#tell()
  }

  #join(target: LiveTarget): void {
    const joined: Joined = {
      target,
      channel: this.#deps.channel(target, {
        status: () => this.#tell(),
        changed: () => this.#onChanged(joined),
        // (what happened while it was down is found the same way: by fetching)
        connected: () => this.#fetch(joined.target),
      }),
      cancelFollowUp: null,
    }
    this.#joined.set(target.key, joined)
    joined.channel.start()
  }

  #leave(joined: Joined): void {
    joined.cancelFollowUp?.()
    joined.channel.stop()
    this.#joined.delete(joined.target.key)
  }

  /** The channels' state together: up only when all are, and none when there are none */
  #tell(): void {
    const states = [...this.#joined.values()].map(({ channel }) => channel.status)
    const status: LiveStatus | null =
      states.length === 0
        ? null
        : states.every(state => state === 'connected')
          ? 'connected'
          : states.includes('connecting')
            ? 'connecting'
            : 'offline'
    announceLiveSyncStatus(this.#deps.win, status)
  }

  /** Read what the channel is about: the space, or the share */
  #fetch(target: LiveTarget): void {
    if (target.kind === 'team') void this.#deps.syncSoon()
    else if (target.kind === 'share-recipient') void this.#deps.reloadShare(target.fileId)
  }

  /** Another device says it changed something: read it now, and once more when Drive has caught up */
  #onChanged(joined: Joined): void {
    this.#fetch(joined.target)
    joined.cancelFollowUp?.()
    joined.cancelFollowUp = this.#deps.later(FEED_LAG_MS, () => {
      joined.cancelFollowUp = null
      this.#fetch(joined.target)
    })
  }

  /** This device's changes are in the space (and its shares): tell the others, if this person may (a reader's edits stay on the device) */
  #onPushed = (): void => {
    for (const { target, channel } of this.#joined.values()) {
      if (target.kind === 'share-sender' || (target.kind === 'team' && target.canWrite)) {
        channel.notify()
      }
    }
  }

  #retry = (): void => {
    if (!this.#deps.visible()) return
    for (const { channel } of this.#joined.values()) channel.retryNow()
  }
}

/* v8 ignore start -- wiring to the real socket, clock, database and sign-in: the Playwright tests run the app */
const ownWorld: LiveWorld = {
  live: getLive,
  async space() {
    const space = await getCurrentSpaceFull()
    if (!space.team) return null
    return {
      teamId: space.team.id,
      canWrite: atLeast(space.team.role, 'writer') && !space.readOnly,
      readOnly: Boolean(space.readOnly),
    }
  },
  async readOnly() {
    return Boolean((await getCurrentSpaceFull()).readOnly)
  },
  async share(setlistId) {
    const share = (await (await getCurrentDB()).getSetlist(setlistId))?.share
    return share ? { fileId: share.fileId, liveSecret: share.liveSecret } : null
  },
  async keepLiveSecret(setlistId, secret) {
    await (await getCurrentDB()).updateSetlist(setlistId, stored => {
      // (as it is stored now: another device may have made one meanwhile, and the first stays)
      if (!stored.share || stored.share.liveSecret) return
      stored.share = { ...stored.share, liveSecret: secret }
      stored.modifiedDate = new Date().toISOString()
    })
  },
  newSecret: generateLiveSecret,
}

function realChannel(target: LiveTarget, events: LiveChannelEvents): LiveChannel {
  const path =
    target.kind === 'team'
      ? `/api/space/${encodeURIComponent(target.teamId)}/live`
      : `/api/share/${encodeURIComponent(target.fileId)}/live`
  return new LiveChannel(
    {
      open: protocols => {
        const url = new URL(path, location.href)
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        return new WebSocket(url, protocols)
      },
      token: async () =>
        target.kind === 'team'
          ? getIdentityToken()
          : target.kind === 'share-sender'
            ? target.secret
            : null,
      later: (ms, fn) => {
        const id = setTimeout(fn, ms)
        return () => clearTimeout(id)
      },
      random: Math.random,
    },
    events
  )
}

/** Start the live channels for as long as this device is live */
export function startLiveSync(): LiveSync {
  const sync = new LiveSync({
    win: window,
    doc: document,
    targets: () => liveTargets(ownWorld),
    channel: realChannel,
    syncSoon,
    reloadShare,
    visible: () => document.visibilityState === 'visible',
    later: (ms, fn) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
  })
  sync.start()
  return sync
}
/* v8 ignore stop */
