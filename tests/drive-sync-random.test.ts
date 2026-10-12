import { expect } from '@esm-bundle/chai'
import type { Setlist } from '../src/js/data-types.ts'
import { ChordlessDB, createSetlist } from '../src/js/db.ts'
import { DriveSyncManager, type FolderLink } from '../src/js/drive-sync.ts'
import { makeEntry } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

/**
 * Random histories: several devices share one fake Drive and do random things (create and edit
 * setlists, sync, go quiet, have files trashed, restored or re-id'd in Drive, reset, hit failing
 * requests), then everything is synced until it is quiet. What must hold, whatever the history:
 *
 * - Drive never holds two live files for one setlist, or for one date/leader/type/name
 * - once quiet, every device has exactly the setlists Drive has, with the same contents
 * - an edit is never lost: the last edit of a setlist (made by its one owner) is what everyone
 *   ends up with, unless someone trashed the setlist in Drive at some point
 *
 * Two harder modes loosen what can be promised: with `conflicts` any device edits any setlist
 * (Drive wins a conflict, so only the first two hold), and with `collisions` devices make
 * setlists for the same date, leader, type and name (a device keeps its own record of one Drive
 * already holds, so devices can't match Drive exactly: only the first holds).
 *
 * A failure names its seed: `SEEDS` below (or a single number) reproduces the same history.
 * For a long hunt raise SEEDS, STEPS and DEVICES (360 histories of 4 devices and 70 steps take
 * about a minute; the test runner gives up after two).
 */

const ORG_NAME = 'Test Church'
const ORG_ID = 'org-test-church'
const DEVICES = 3
const STEPS = 45
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

/** A small seeded random number generator, so a failing history can be replayed */
function random(seed: number) {
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

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })

type Device = { name: string; db: ChordlessDB; sync: DriveSyncManager }

describe('Drive sync: random histories', () => {
  let drive: ReturnType<typeof installFakeDrive>
  let devices: Device[]

  async function makeDevice(name: string): Promise<Device> {
    const db = new ChordlessDB(`test-random-${name}-${crypto.randomUUID()}`)
    await db.init()
    const folderLink: FolderLink & { value: string | null } = {
      value: null,
      async get() {
        return this.value
      },
      async set(value: string) {
        this.value = value
      },
    }
    const memberCache = {
      async set() {},
    }
    const sync = new DriveSyncManager(ORG_NAME, ORG_ID, { db, folderLink, memberCache })
    await sync.init()
    const device = { name, db, sync }
    devices.push(device)
    return device
  }

  beforeEach(() => {
    drive = installFakeDrive()
    devices = []
  })

  afterEach(async () => {
    drive.uninstall()
    for (const device of devices) {
      device.db.db?.close()
      await deleteDatabase(device.db.dbName)
    }
  })

  const liveSetlistFiles = () =>
    drive.listFiles(f => f.appProperties?.setlistId && !f.trashed) as {
      id: string
      appProperties: { setlistId: string }
      content: string
    }[]

  const keyOf = (s: Setlist) => [s.date, s.time, s.owner, s.type, s.name].join('|')

  const songsOf = (setlist: Pick<Setlist, 'songs'>) => JSON.stringify(setlist.songs)

  /** What must hold at every moment, not only once quiet */
  function checkDriveHasNoDuplicates(label: string) {
    const ids = new Set<string>()
    const keys = new Set<string>()
    for (const file of liveSetlistFiles()) {
      const content = JSON.parse(file.content) as Setlist
      const id = file.appProperties.setlistId
      expect(ids.has(id), `${label}: two live files for setlist ${id}`).to.equal(false)
      ids.add(id)
      const key = keyOf(content)
      expect(keys.has(key), `${label}: two live files for ${key}`).to.equal(false)
      keys.add(key)
    }
  }

  type Mode = 'owner' | 'conflicts' | 'collisions'

  async function runHistory(seed: number, mode: Mode) {
    const rng = random(seed)
    const devs: Device[] = []
    for (let i = 0; i < DEVICES; i++) devs.push(await makeDevice(`device-${i}`))

    /** Each setlist is edited by the device that made it, so edits never conflict */
    const ownerOf = new Map<string, Device>()
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

    async function syncDevice(device: Device) {
      try {
        await device.sync.sync()
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
      async trash() {
        const files = liveSetlistFiles()
        if (files.length === 0) return
        const file = rng.pick(files)
        drive.files.get(file.id).trashed = true
        trashedEver.add(file.appProperties.setlistId)
        log.push(`Drive trashes ${file.appProperties.setlistId.slice(0, 8)}`)
      },
      async restore() {
        const trashed = drive.listFiles(f => f.appProperties?.setlistId && f.trashed)
        if (trashed.length === 0) return
        const file = rng.pick(trashed)
        // Only if nothing took its place meanwhile: restoring beside a copy is the user's doing
        const content = JSON.parse(file.content) as Setlist
        const taken = liveSetlistFiles().some(f => {
          const other = JSON.parse(f.content) as Setlist
          return (
            f.appProperties.setlistId === file.appProperties.setlistId ||
            keyOf(other) === keyOf(content)
          )
        })
        if (taken) return
        file.trashed = false
        log.push(`Drive restores ${file.appProperties.setlistId.slice(0, 8)}`)
      },
      async reid() {
        // A duplicate was cleaned up, leaving another file for the setlist: same content, new id
        const files = liveSetlistFiles()
        if (files.length === 0) return
        const file = rng.pick(files)
        const record = drive.files.get(file.id)
        drive.files.delete(file.id)
        record.id = `reid-${crypto.randomUUID()}`
        drive.files.set(record.id, record)
        log.push(`Drive re-ids ${file.appProperties.setlistId.slice(0, 8)}`)
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
      async fail() {
        drive.failRequests({
          status: 500,
          network: rng.int(2) === 0,
          times: 1 + rng.int(2),
          skip: rng.int(20),
        })
        failuresQueued = true
        log.push('requests start failing')
      },
    }
    const weighted = [
      ...Array(4).fill('create'),
      ...Array(4).fill('edit'),
      ...Array(8).fill('sync'),
      ...Array(1).fill('trash'),
      ...Array(1).fill('restore'),
      ...Array(1).fill('reid'),
      ...Array(1).fill('reset'),
      ...Array(1).fill('fail'),
    ]

    const label = (step: number) => `seed ${seed}, step ${step}\n  ${log.slice(-12).join('\n  ')}`

    for (let step = 0; step < STEPS; step++) {
      await operations[rng.pick(weighted)]()
      checkDriveHasNoDuplicates(label(step))
    }

    // Quiet: no more failures, everyone syncs until nothing changes
    drive._failures.length = 0
    failuresQueued = false
    for (let round = 0; round < 3; round++) {
      for (const device of devs) await syncDevice(device)
      checkDriveHasNoDuplicates(`${label(STEPS)} (round ${round})`)
    }

    if (mode === 'collisions') return

    // Every device has what Drive has
    const inDrive = new Map(
      liveSetlistFiles().map(f => [f.appProperties.setlistId, songsOf(JSON.parse(f.content))])
    )
    for (const device of devs) {
      const local = new Map(
        (await device.db.getAllSetlists()).map(s => [s.id, songsOf(s)] as [string, string])
      )
      expect([...local.keys()].sort(), `${label(STEPS)}: ${device.name} setlists`).to.deep.equal(
        [...inDrive.keys()].sort()
      )
      for (const [id, songs] of local) {
        expect(songs, `${label(STEPS)}: ${device.name} content of ${id}`).to.equal(inDrive.get(id))
      }
    }

    // No edit is lost, and nothing appears from nowhere
    for (const id of inDrive.keys()) {
      expect(ownerOf.has(id), `${label(STEPS)}: ${id} was never created`).to.equal(true)
    }
    if (mode === 'conflicts') return
    for (const [id, songs] of lastEdit) {
      if (trashedEver.has(id)) continue
      expect(inDrive.has(id), `${label(STEPS)}: setlist ${id} was lost`).to.equal(true)
      expect(inDrive.get(id), `${label(STEPS)}: last edit of ${id} was lost`).to.equal(songs)
    }
  }

  for (const mode of ['owner', 'conflicts', 'collisions'] as Mode[]) {
    for (const seed of SEEDS) {
      it(`keeps devices and Drive consistent (${mode}, seed ${seed})`, async function (this: {
        timeout(ms: number): void
      }) {
        this.timeout(60000)
        await runHistory(seed, mode)
      })
    }
  }
})
