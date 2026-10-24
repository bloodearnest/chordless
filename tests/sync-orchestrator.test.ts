import { expect, waitUntil } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import type { DriveSyncManager, ProgressCallback } from '../src/js/drive-sync.ts'
import { createSpace, deleteSpace, getCurrentSpace, setCurrentSpace } from '../src/js/space.ts'
import type { ResetSetlist } from '../src/js/sync/session.ts'
import {
  createSyncOrchestrator,
  type SyncBroadcast,
  SyncOrchestrator,
} from '../src/js/sync-orchestrator.ts'
import { setlistTitle } from '../src/js/utils/date-utils.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

/**
 * The orchestrator wraps a DriveSyncManager (tested against a fake Drive in the drive-sync files)
 * in progress messages and error reporting, so it is run here with a manager that only reports
 * progress or fails.
 */
describe('SyncOrchestrator', () => {
  suppressConsoleLogs()

  // The orchestrator logs each failure with console.error; these tests cause them on purpose
  let realError: typeof console.error
  beforeEach(() => {
    realError = console.error
    console.error = () => {}
  })
  afterEach(() => {
    console.error = realError
  })

  type Operation =
    | 'sync'
    | 'incrementalSync'
    | 'pushToDrive'
    | 'pullFromDrive'
    | 'resetLocalFromDrive'

  /** A manager whose one operation reports `reports`, then fails with `failure` if given */
  function orchestratorWith(
    operation: Operation,
    reports: object[] = [],
    failure?: Error,
    resetSetlists: ResetSetlist[] = [],
    db?: ChordlessDB
  ) {
    const manager = {
      db,
      resetSetlists,
      [operation]: async (progress: ProgressCallback) => {
        for (const report of reports) progress(report as Parameters<ProgressCallback>[0])
        if (failure) throw failure
      },
    }
    const orchestrator = new SyncOrchestrator('Test Church', null)
    orchestrator.syncManager = manager as unknown as DriveSyncManager
    return orchestrator
  }

  const stages = (messages: SyncBroadcast[]) => messages.map(m => m.stage)

  /** Run `call` with a callback that collects what is reported */
  async function reported(call: (callback: (progress: SyncBroadcast) => void) => Promise<unknown>) {
    const messages: SyncBroadcast[] = []
    await call(progress => messages.push(progress))
    return messages
  }

  describe('an incremental sync, the one the app makes by itself', () => {
    it('runs the manager’s, tells it whether to push, and says it ran', async () => {
      const calls: unknown[] = []
      const orchestrator = new SyncOrchestrator('Test Church', null)
      orchestrator.syncManager = {
        resetSetlists: [],
        incrementalSync: async (_progress: unknown, options: unknown) => {
          calls.push(options)
        },
      } as unknown as DriveSyncManager

      expect(await orchestrator.incrementalSync()).to.equal(true)
      expect(await orchestrator.incrementalSync(null, { push: false })).to.equal(true)
      expect(calls).to.deep.equal([{ push: true }, { push: false }])
    })

    it('is skipped when asked to, if a sync is already running, and its failure is thrown', async () => {
      let release = () => {}
      const held = new Promise<void>(resolve => {
        release = resolve
      })
      const running = orchestratorWith('sync')
      const manager = running.syncManager as unknown as { sync: () => Promise<void> }
      manager.sync = () => held
      const first = running.sync()
      await new Promise(resolve => setTimeout(resolve, 20))

      const other = orchestratorWith('incrementalSync')
      expect(await other.incrementalSync(null, { skipIfBusy: true })).to.equal(false)
      release()
      await first

      const failing = orchestratorWith('incrementalSync', [], new Error('offline'))
      let thrown: Error | null = null
      try {
        await failing.incrementalSync()
      } catch (error) {
        thrown = error as Error
      }
      expect(thrown?.message).to.equal('offline')
    })
  })

  describe('a successful run', () => {
    const progress = { stage: 'pulling', message: 'Pulling songs', current: 1, total: 2 }

    it('sync reports starting, what the manager reports, then complete', async () => {
      const orchestrator = orchestratorWith('sync', [progress])
      const messages = await reported(callback => orchestrator.sync(callback))

      expect(stages(messages)).to.deep.equal(['starting', 'pulling', 'complete'])
      expect(messages[0].message).to.equal('Starting sync...')
      expect(messages[1]).to.include(progress)
      expect(messages[2].message).to.equal('Sync complete!')
    })

    it('push reports starting, progress, then complete', async () => {
      const orchestrator = orchestratorWith('pushToDrive', [progress])
      const messages = await reported(callback => orchestrator.push(callback))

      expect(stages(messages)).to.deep.equal(['starting', 'pulling', 'complete'])
      expect(messages[0].message).to.equal('Pushing to Drive...')
      expect(messages[2].message).to.equal('Push complete!')
    })

    it('pull reports starting, progress, then complete', async () => {
      const orchestrator = orchestratorWith('pullFromDrive', [progress])
      const messages = await reported(callback => orchestrator.pull(callback))

      expect(stages(messages)).to.deep.equal(['starting', 'pulling', 'complete'])
      expect(messages[0].message).to.equal('Pulling from Drive...')
      expect(messages[2].message).to.equal('Pull complete!')
    })

    it('reset reports only what the manager reports, and finishes without a message of its own', async () => {
      const orchestrator = orchestratorWith('resetLocalFromDrive', [progress])
      const messages = await reported(callback => orchestrator.resetLocalFromDrive(callback))

      expect(stages(messages)).to.deep.equal(['pulling'])
    })

    it('tells a reader, once, what the leader’s version changed in their setlists, and can undo it', async () => {
      const db = new ChordlessDB(`reset-${crypto.randomUUID()}`)
      await db.init()
      try {
        await db.saveSong(makeSong({ uuid: 'u-a', id: 'title-alpha', title: 'Alpha' }))
        await db.saveSong(makeSong({ uuid: 'u-b', id: 'title-beta', title: 'Beta' }))
        const entry = (songId: string, songUuid: string, key: string) =>
          makeEntry({ songId, songUuid, key })
        const mine = makeSetlist({
          id: 's-1',
          date: '2026-10-18',
          songs: [entry('title-alpha', 'u-a', 'G')],
        })
        const theirs = {
          ...mine,
          songs: [entry('title-alpha', 'u-a', 'A'), entry('title-beta', 'u-b', 'D')],
        }
        const toasts = () => [...document.querySelectorAll('app-toast')]
        const text = () =>
          toasts()
            .map(el => el.shadowRoot?.textContent ?? '')
            .join(' ')

        const one = orchestratorWith('sync', [], undefined, [{ before: mine, after: theirs }], db)
        await one.sync()
        expect(text()).to.contain(`Your changes to ${setlistTitle(mine)} were replaced`)
        expect(text()).to.contain('+ Beta')
        expect(text()).to.contain('Alpha: key G → A')
        // said once: the list is emptied
        expect(
          (one.syncManager as unknown as { resetSetlists: unknown[] }).resetSetlists
        ).to.deep.equal([])

        // Undo puts back what this device had
        await db.saveSetlist(theirs)
        toasts().at(-1)?.shadowRoot?.querySelector<HTMLButtonElement>('button.btn')?.click()
        await waitUntil(async () => (await db.getSetlist('s-1'))?.songs.length === 1, 'it is back')

        const many = orchestratorWith(
          'pullFromDrive',
          [],
          undefined,
          [
            { before: mine, after: theirs },
            { before: { ...mine, id: 's-2' }, after: { ...theirs, id: 's-2' } },
          ],
          db
        )
        await many.pull()
        expect(text()).to.contain('Your changes to 2 setlists were replaced')

        // Nothing to name (only a field the diff does not describe): just that it was replaced
        await orchestratorWith(
          'sync',
          [],
          undefined,
          [{ before: mine, after: { ...mine, modifiedDate: 'later' } }],
          db
        ).sync()
        expect(text()).to.match(/were replaced by the leader's version\./)

        // A changed song with a long list of changes is cut short; a failed Undo says so
        const long = {
          ...theirs,
          date: '2026-10-19',
          songs: [
            entry('title-beta', 'u-b', 'C'),
            entry('title-gamma', 'u-g', 'E'),
            entry('title-delta', 'u-d', 'F'),
          ],
        }
        db.saveSetlist = () => Promise.reject(new Error('disk full'))
        await orchestratorWith('sync', [], undefined, [{ before: mine, after: long }], db).sync()
        expect(text()).to.contain('…')
        toasts().at(-1)?.shadowRoot?.querySelector<HTMLButtonElement>('button.btn')?.click()
        await waitUntil(() => text().includes("Couldn't put your changes back"), 'it says so')
      } finally {
        db.db?.close()
        await deleteDatabase(db.dbName)
      }
    })

    it('each operation resolves to success', async () => {
      for (const [operation, run] of [
        ['sync', (o: SyncOrchestrator) => o.sync()],
        ['pushToDrive', (o: SyncOrchestrator) => o.push()],
        ['pullFromDrive', (o: SyncOrchestrator) => o.pull()],
        ['resetLocalFromDrive', (o: SyncOrchestrator) => o.resetLocalFromDrive()],
      ] as const) {
        expect(await run(orchestratorWith(operation)), operation).to.deep.equal({ success: true })
      }
    })

    it('stamps every message with the time', async () => {
      const messages = await reported(callback =>
        orchestratorWith('sync', [progress]).sync(callback)
      )
      for (const message of messages) {
        expect(new Date(message.timestamp).toISOString()).to.equal(message.timestamp)
      }
    })
  })

  describe('a failed run', () => {
    const failure = new Error('Drive said no')

    for (const [name, operation, run] of [
      ['sync', 'sync', (o: SyncOrchestrator, cb: () => void) => o.sync(cb)],
      ['push', 'pushToDrive', (o: SyncOrchestrator, cb: () => void) => o.push(cb)],
      ['pull', 'pullFromDrive', (o: SyncOrchestrator, cb: () => void) => o.pull(cb)],
      [
        'reset',
        'resetLocalFromDrive',
        (o: SyncOrchestrator, cb: () => void) => o.resetLocalFromDrive(cb),
      ],
    ] as const) {
      it(`${name} reports the error, then throws it again`, async () => {
        const orchestrator = orchestratorWith(operation, [], failure)
        const messages: SyncBroadcast[] = []

        let thrown: unknown
        try {
          await run(orchestrator, ((progress: SyncBroadcast) => messages.push(progress)) as never)
        } catch (error) {
          thrown = error
        }

        expect(thrown).to.equal(failure)
        const last = messages.at(-1)
        expect(last?.stage).to.equal('error')
        expect(last?.message).to.equal('Drive said no')
        expect(last?.error).to.equal('Drive said no')
        expect(stages(messages)).not.to.include('complete')
      })
    }

    it('reports the text of an error that is not an Error', async () => {
      const orchestrator = new SyncOrchestrator('Test Church', null)
      orchestrator.syncManager = {
        sync: async () => {
          throw 'plain string'
        },
      } as unknown as DriveSyncManager
      const messages: SyncBroadcast[] = []

      let thrown: unknown
      try {
        await orchestrator.sync(progress => messages.push(progress))
      } catch (error) {
        thrown = error
      }

      expect(thrown).to.equal('plain string')
      expect(messages.at(-1)?.error).to.equal('plain string')
    })

    it('works with no callback', async () => {
      const orchestrator = orchestratorWith('sync', [], failure)
      let thrown: unknown
      try {
        await orchestrator.sync()
      } catch (error) {
        thrown = error
      }
      expect(thrown).to.equal(failure)
    })
  })
})

describe('SyncOrchestrator against a Drive', () => {
  let drive: ReturnType<typeof installFakeDrive>
  let before: { id: string | null; name: string }
  let space: { id: string; name: string }

  beforeEach(async () => {
    drive = installFakeDrive()
    before = getCurrentSpace()
    space = await createSpace(`Orchestrated ${crypto.randomUUID().slice(0, 8)}`)
    await setCurrentSpace(space.id, space.name)
  })

  afterEach(async () => {
    drive.uninstall()
    await deleteSpace(space.id)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  it('is made ready by createSyncOrchestrator, and syncs', async () => {
    const orchestrator = await createSyncOrchestrator(space.name, space.id)
    expect(orchestrator.syncManager).to.not.equal(null)
    const stages: string[] = []
    expect(await orchestrator.sync(progress => stages.push(progress.stage))).to.deep.equal({
      success: true,
    })
    expect(stages[0]).to.equal('starting')
    expect(stages.at(-1)).to.equal('complete')
  })

  it('makes its manager when it is first asked to do something', async () => {
    const orchestrator = new SyncOrchestrator(space.name, space.id)
    expect(orchestrator.syncManager).to.equal(null)
    expect(await orchestrator.push()).to.deep.equal({ success: true })
    expect(orchestrator.syncManager).to.not.equal(null)
    expect(await orchestrator.pull()).to.deep.equal({ success: true })
  })
})
