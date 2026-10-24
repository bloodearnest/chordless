/**
 * Random histories of several devices that share one Drive: the engine, and what must hold of any
 * history. It runs against a `World` (the place the files are kept, and what can happen to them
 * there): `drive-sync-random.test.ts` runs it against an in-memory fake, fast and exact;
 * `tests/drive/` runs the same histories against a real Drive.
 *
 * What must hold, whatever the history:
 *
 * - Drive never holds two live files for one setlist, or for one date/leader/type/name
 * - once quiet, every device has exactly the setlists Drive has, with the same contents
 * - an edit is never lost: the last edit of a setlist (made by its one owner) is what everyone
 *   ends up with, unless someone trashed the setlist in Drive at some point
 *
 * The `mode` loosens or adds to that (see `Mode`). A failure names its seed: the same seed makes
 * the same random choices again.
 */
import { expect } from '@open-wc/testing'
import type { Setlist } from '../src/js/data-types.ts'
import { createSetlist } from '../src/js/db.ts'
import { makeEntry } from './builders.ts'

/** A small seeded random number generator, so a failing history can be replayed */
export function random(seed: number) {
  let a = seed
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: T[]): T => items[Math.floor(next() * items.length)],
  }
}

/**
 * - `owner`: each setlist is edited only by the device that made it, so edits never conflict
 * - `conflicts`: any device edits any setlist (Drive wins a conflict, so only the first two promises hold)
 * - `collisions`: devices make setlists for the same date, leader, type and name (a device keeps its
 *   own record of one Drive already holds, so devices can't match Drive exactly: only the first holds)
 * - `incremental`: devices sync from the feed of changes (sometimes only pulling), and the feed
 *   sometimes forgets its positions; the promises are those of `owner`
 * - `concurrent`: as `owner`, and devices sometimes sync at the same moment
 */
export type Mode = 'owner' | 'conflicts' | 'collisions' | 'incremental' | 'concurrent'

/** A setlist file in Drive, with what it holds */
export interface HistoryFile {
  ref: string
  setlistId: string
  content: string
}

/** A simulated device, as the sync rigs make them */
export interface HistoryDevice {
  name: string
  db: import('../src/js/db.ts').ChordlessDB
  sync: import('../src/js/drive-sync.ts').DriveSyncManager
}

/** Where the files are kept, and what can happen to them there */
export interface World {
  makeDevice(name: string): Promise<HistoryDevice>
  /** The live setlist files, with their content */
  live(): Promise<HistoryFile[]>
  /** The setlist files in Drive's bin */
  trashed(): Promise<HistoryFile[]>
  /** Someone puts a file in Drive's bin, takes it out, or replaces it with a copy under another id */
  trash(ref: string): Promise<void>
  restore(ref: string): Promise<void>
  reid(ref: string): Promise<void>
  /** The feed of changes forgets where it was (not every Drive can be made to) */
  forgetFeedPositions?(): Promise<void>
  /** The kinds of call that can be made to fail, and how: the next calls of that kind fail */
  failures: string[]
  fail(
    kind: string,
    options: { status: number; network: boolean; times: number; skip: number }
  ): void
  clearFailures(): void
}

export interface HistoryOptions {
  devices: number
  steps: number
  /** Check Drive for duplicates after every this many steps (each check reads Drive) */
  checkEvery?: number
  /** After the last step, up to this many rounds of every device syncing, until all agree */
  settleRounds?: number
}

const devicesOf = async (world: World, count: number) => {
  const devs: HistoryDevice[] = []
  for (let i = 0; i < count; i++) devs.push(await world.makeDevice(`device-${i}`))
  return devs
}

const keyOf = (s: Setlist) => [s.date, s.time, s.owner, s.type, s.name].join('|')
const songsOf = (setlist: Pick<Setlist, 'songs'>) => JSON.stringify(setlist.songs)

export async function runHistory(
  world: World,
  seed: number,
  mode: Mode,
  { devices: deviceCount, steps, checkEvery = 1, settleRounds = 3 }: HistoryOptions
) {
  const rng = random(seed)
  const devs = await devicesOf(world, deviceCount)

  /** Each setlist is edited by the device that made it, so edits never conflict */
  const ownerOf = new Map<string, HistoryDevice>()
  const lastEdit = new Map<string, string>()
  const trashedEver = new Set<string>()
  let clock = Date.parse('2026-10-01T00:00:00Z')
  let created = 0
  let failuresQueued = false
  const log: string[] = []

  const stamp = () => {
    clock += 1000
    return new Date(clock).toISOString()
  }
  const someSongs = () =>
    Array.from({ length: 1 + rng.int(4) }, (_, order) =>
      makeEntry({ order, songId: `song-${rng.int(8)}`, songUuid: `uuid-${rng.int(8)}` })
    )

  /** What must hold at every moment, not only once quiet */
  async function checkDriveHasNoDuplicates(label: string) {
    const ids = new Set<string>()
    const keys = new Set<string>()
    for (const file of await world.live()) {
      expect(
        ids.has(file.setlistId),
        `${label}: two live files for setlist ${file.setlistId}`
      ).to.equal(false)
      ids.add(file.setlistId)
      const key = keyOf(JSON.parse(file.content) as Setlist)
      expect(keys.has(key), `${label}: two live files for ${key}`).to.equal(false)
      keys.add(key)
    }
  }

  async function syncDevice(device: HistoryDevice, { quiet = false } = {}) {
    try {
      if (mode === 'incremental') {
        await device.sync.incrementalSync(null, { push: quiet || rng.int(4) > 0 })
      } else await device.sync.sync()
    } catch (error) {
      // Only an injected failure may make a sync fail
      expect(failuresQueued, `${device.name} sync failed: ${(error as Error).message}`).to.equal(
        true
      )
    }
  }

  const operations: Record<string, () => Promise<void>> = {
    async create() {
      const device = rng.pick(devs)
      const day = mode === 'collisions' ? rng.int(3) : created++
      const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10)
      // One device doesn't make the same setlist twice; devices may make the same one
      if ((await device.db.getAllSetlists()).some(s => s.date === date)) return
      const setlist = {
        ...createSetlist({ date, owner: 'Sam', type: 'Church Service' }),
        songs: someSongs(),
        modifiedDate: stamp(),
      }
      await device.db.saveSetlist(setlist)
      ownerOf.set(setlist.id, device)
      lastEdit.set(setlist.id, songsOf(setlist))
      log.push(`${device.name} creates ${date}`)
    },
    async edit() {
      const device = rng.pick(devs)
      const mine = (await device.db.getAllSetlists()).filter(
        s => mode === 'conflicts' || ownerOf.get(s.id) === device
      )
      if (mine.length === 0) return
      const setlist = rng.pick(mine)
      setlist.songs = someSongs()
      setlist.modifiedDate = stamp()
      await device.db.saveSetlist(setlist)
      lastEdit.set(setlist.id, songsOf(setlist))
      log.push(`${device.name} edits ${setlist.date}`)
    },
    async sync() {
      const device = rng.pick(devs)
      log.push(`${device.name} syncs`)
      await syncDevice(device)
    },
    async together() {
      // Two or more devices sync at the same moment
      const count = 2 + rng.int(Math.max(1, devs.length - 1))
      const chosen = [...devs].sort(() => rng.next() - 0.5).slice(0, count)
      log.push(`${chosen.map(d => d.name).join(' and ')} sync together`)
      await Promise.all(chosen.map(device => syncDevice(device)))
    },
    async trash() {
      const files = await world.live()
      if (files.length === 0) return
      const file = rng.pick(files)
      await world.trash(file.ref)
      trashedEver.add(file.setlistId)
      log.push(`Drive trashes ${file.setlistId.slice(0, 8)}`)
    },
    async restore() {
      const trashed = await world.trashed()
      if (trashed.length === 0) return
      const file = rng.pick(trashed)
      // Only if nothing took its place meanwhile: restoring beside a copy is the user's doing
      const content = JSON.parse(file.content) as Setlist
      const taken = (await world.live()).some(f => {
        const other = JSON.parse(f.content) as Setlist
        return f.setlistId === file.setlistId || keyOf(other) === keyOf(content)
      })
      if (taken) return
      await world.restore(file.ref)
      log.push(`Drive restores ${file.setlistId.slice(0, 8)}`)
    },
    async reid() {
      // A duplicate was cleaned up, leaving another file for the setlist: same content, new id
      const files = await world.live()
      if (files.length === 0) return
      const file = rng.pick(files)
      await world.reid(file.ref)
      log.push(`Drive re-ids ${file.setlistId.slice(0, 8)}`)
    },
    async reset() {
      const device = rng.pick(devs)
      try {
        await device.sync.resetLocalFromDrive()
        log.push(`${device.name} resets`)
      } catch (error) {
        // Refused because of changes not in Drive, or by an injected failure
        if ((error as Error).name !== 'UnsyncedChangesError') {
          expect(failuresQueued, `reset failed: ${(error as Error).message}`).to.equal(true)
        }
      }
    },
    async forget() {
      await world.forgetFeedPositions?.()
      log.push('the feed forgets its positions')
    },
    async fail() {
      world.fail(rng.pick(world.failures), {
        status: 500,
        network: rng.int(2) === 0,
        times: 1 + rng.int(2),
        skip: rng.int(4),
      })
      failuresQueued = true
      log.push('requests start failing')
    },
  }
  const weighted = [
    ...Array(4).fill('create'),
    ...Array(4).fill('edit'),
    ...Array(8).fill('sync'),
    ...Array(mode === 'incremental' ? 3 : 1).fill('trash'),
    ...Array(1).fill('restore'),
    ...Array(1).fill('reid'),
    ...Array(1).fill('reset'),
    ...Array(1).fill('fail'),
    ...Array(mode === 'incremental' && world.forgetFeedPositions ? 1 : 0).fill('forget'),
    ...Array(mode === 'concurrent' ? 5 : 0).fill('together'),
  ]

  const label = (step: number) => `seed ${seed}, step ${step}\n  ${log.slice(-12).join('\n  ')}`

  for (let step = 0; step < steps; step++) {
    await operations[rng.pick(weighted)]()
    if ((step + 1) % checkEvery === 0) await checkDriveHasNoDuplicates(label(step))
  }

  // Quiet: no more failures, everyone syncs until nothing changes
  world.clearFailures()
  failuresQueued = false
  for (let round = 0; round < settleRounds; round++) {
    for (const device of devs) await syncDevice(device, { quiet: true })
    await checkDriveHasNoDuplicates(`${label(steps)} (round ${round})`)
  }

  if (mode === 'collisions') return

  // Every device has what Drive has
  const inDrive = new Map(
    (await world.live()).map(f => [f.setlistId, songsOf(JSON.parse(f.content))])
  )
  for (const device of devs) {
    const local = new Map(
      (await device.db.getAllSetlists()).map(s => [s.id, songsOf(s)] as [string, string])
    )
    expect([...local.keys()].sort(), `${label(steps)}: ${device.name} setlists`).to.deep.equal(
      [...inDrive.keys()].sort()
    )
    for (const [id, songs] of local) {
      expect(songs, `${label(steps)}: ${device.name} content of ${id}`).to.equal(inDrive.get(id))
    }
  }

  // No edit is lost, and nothing appears from nowhere
  for (const id of inDrive.keys()) {
    expect(ownerOf.has(id), `${label(steps)}: ${id} was never created`).to.equal(true)
  }
  if (mode === 'conflicts') return
  for (const [id, songs] of lastEdit) {
    if (trashedEver.has(id)) continue
    expect(inDrive.has(id), `${label(steps)}: setlist ${id} was lost`).to.equal(true)
    expect(inDrive.get(id), `${label(steps)}: last edit of ${id} was lost`).to.equal(songs)
  }
}
