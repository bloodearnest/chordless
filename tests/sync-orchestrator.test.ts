import { expect } from '@open-wc/testing'
import type { DriveSyncManager, ProgressCallback } from '../src/js/drive-sync.ts'
import {
  listenForSyncProgress,
  type SyncBroadcast,
  SyncOrchestrator,
} from '../src/js/sync-orchestrator.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

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

  type Operation = 'sync' | 'pushToDrive' | 'pullFromDrive' | 'resetLocalFromDrive'

  /** A manager whose one operation reports `reports`, then fails with `failure` if given */
  function orchestratorWith(operation: Operation, reports: object[] = [], failure?: Error) {
    const manager = {
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

describe('listenForSyncProgress', () => {
  let added: EventListenerOrEventListenerObject[]
  let removed: EventListenerOrEventListenerObject[]
  let realAdd: typeof navigator.serviceWorker.addEventListener
  let realRemove: typeof navigator.serviceWorker.removeEventListener

  beforeEach(() => {
    added = []
    removed = []
    realAdd = navigator.serviceWorker.addEventListener
    realRemove = navigator.serviceWorker.removeEventListener
    // Record the listener instead of attaching it, so nothing else hears the test's messages
    navigator.serviceWorker.addEventListener = ((_type: string, listener) => {
      added.push(listener)
    }) as typeof realAdd
    navigator.serviceWorker.removeEventListener = ((_type: string, listener) => {
      removed.push(listener)
    }) as typeof realRemove
  })

  afterEach(() => {
    navigator.serviceWorker.addEventListener = realAdd
    navigator.serviceWorker.removeEventListener = realRemove
  })

  const deliver = (listener: EventListenerOrEventListenerObject, data: unknown) =>
    (listener as (event: MessageEvent) => void)({ data } as MessageEvent)

  it('passes on the progress in SYNC_PROGRESS messages from the service worker', () => {
    const received: SyncBroadcast[] = []
    listenForSyncProgress(progress => received.push(progress))

    const progress = { stage: 'pushing', message: 'Pushing', timestamp: 't' }
    deliver(added[0], { type: 'SYNC_PROGRESS', data: progress })

    expect(received).to.deep.equal([progress])
  })

  it('ignores other messages', () => {
    const received: SyncBroadcast[] = []
    listenForSyncProgress(progress => received.push(progress))

    deliver(added[0], { type: 'SOMETHING_ELSE', data: {} })
    deliver(added[0], null)
    deliver(added[0], undefined)

    expect(received).to.deep.equal([])
  })

  it('returns a function that stops listening', () => {
    const stop = listenForSyncProgress(() => {})
    expect(removed).to.deep.equal([])
    stop()
    expect(removed).to.deep.equal([added[0]])
  })
})
