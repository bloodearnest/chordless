import { useSyncRig } from './drive-harness.ts'
import type { StorageOp } from './memory-storage.ts'
import { type HistoryFile, type Mode, runHistory, type World } from './sync-history.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

/**
 * Random histories (the engine and what must hold: sync-history.ts): several devices share one fake
 * Drive and do random things (create and edit setlists, sync, go quiet, have files trashed,
 * restored or re-id'd in Drive, reset, hit failing requests), then everything is synced until it
 * is quiet. What must hold, whatever the history:
 *
 * - Drive never holds two live files for one setlist, or for one date/leader/type/name
 * - once quiet, every device has exactly the setlists Drive has, with the same contents
 * - an edit is never lost: the last edit of a setlist (made by its one owner) is what everyone
 *   ends up with, unless someone trashed the setlist in Drive at some point
 *
 * With `incremental` devices sync from the feed of changes (sometimes only pulling), and the
 * feed sometimes forgets its positions; the promises are those of `owner`.
 *
 * With `concurrent` devices sometimes sync at the same moment; the promises are those of `owner`.
 *
 * Two harder modes loosen what can be promised: with `conflicts` any device edits any setlist
 * (Drive wins a conflict, so only the first two hold), and with `collisions` devices make
 * setlists for the same date, leader, type and name (a device keeps its own record of one Drive
 * already holds, so devices can't match Drive exactly: only the first holds).
 *
 * Each mode is a test file of its own (drive-sync-random.test.ts is `owner`; the others are
 * drive-sync-random-<mode>.test.ts), so the modes run side by side.
 *
 * A failure names its seed: `SEEDS` below (or a single number) reproduces the same history.
 * For a long hunt raise SEEDS, STEPS and DEVICES (360 histories of 4 devices and 70 steps take
 * about a minute; the test runner gives up after two).
 */

const DEVICES = 3
const STEPS = 45
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

/** The calls a history may make fail */
const FAILING_CALLS: StorageOp[] = [
  'inspectRoot',
  'members',
  'list',
  'inventory',
  'status',
  'readText',
  'readMany',
  'create',
  'createMany',
  'update',
  'updateMany',
]

/** The random histories of one mode, as a test file's suite */
export function describeRandomHistories(mode: Mode) {
  suppressConsoleLogs()

  describe('Drive sync: random histories', () => {
    const rig = useSyncRig()

    const files = (found: ReturnType<typeof rig.storage.list>): HistoryFile[] =>
      found.map(f => ({ ref: f.ref, setlistId: f.props.setlistId, content: f.content }))

    /** The in-memory Drive, as the engine sees it */
    const world = (): World => ({
      makeDevice: name => rig.makeDevice(name),
      live: async () => files(rig.storage.list(f => Boolean(f.props.setlistId))),
      trashed: async () =>
        files(rig.storage.everything(f => Boolean(f.props.setlistId) && f.trashed)),
      trash: async ref => rig.storage.trash(ref),
      restore: async ref => rig.storage.restore(ref),
      reid: async ref => rig.storage.rekey(ref, `reid-${crypto.randomUUID()}`),
      forgetFeedPositions: async () => rig.storage.forgetFeedPositions(),
      failures: FAILING_CALLS,
      fail: (kind, options) => rig.storage.fail(kind as StorageOp, options),
      clearFailures: () => rig.storage.clearFailures(),
    })

    for (const seed of SEEDS) {
      it(`keeps devices and Drive consistent (${mode}, seed ${seed})`, async function (this: {
        timeout(ms: number): void
      }) {
        this.timeout(60000)
        await runHistory(world(), seed, mode, { devices: DEVICES, steps: STEPS })
      })
    }
  })
}
