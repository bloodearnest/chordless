import { expect } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import type { ProgressCallback, SyncManager } from '../src/js/sync-manager.ts'
import {
  createSyncOrchestrator,
  type SyncBroadcast,
  SyncOrchestrator,
} from '../src/js/sync-orchestrator.ts'
import { resetTelemetryState } from '../src/js/telemetry/telemetry.ts'
import { installFakeDrive } from './fake-drive.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

/**
 * The orchestrator wraps a SyncManager (tested against a fake Drive in the drive-sync files)
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

  /** What a manager's operation resolves to: nothing found that a person must be told of */
  const report = () => ({
    heldBack: 0,
    readOnly: null,
    downloadsFailed: false,
  })

  /** A manager whose one operation reports `reports`, then fails with `failure` if given */
  function orchestratorWith(operation: Operation, reports: object[] = [], failure?: Error) {
    const manager = {
      [operation]: async (progress: ProgressCallback) => {
        for (const each of reports) progress(each as Parameters<ProgressCallback>[0])
        if (failure) throw failure
        return report()
      },
    }
    const orchestrator = new SyncOrchestrator('Test Church', null)
    orchestrator.syncManager = manager as unknown as SyncManager
    return orchestrator
  }

  const stages = (messages: SyncBroadcast[]) => messages.map(m => m.stage)

  it('syncs church team metadata without invoking Drive operations', async () => {
    const space = await createSpace(`Church team ${crypto.randomUUID()}`)
    await updateSpace(space.id, { team: { id: 'team', churchId: 'church', role: 'writer' } })
    try {
      const orchestrator = new SyncOrchestrator(space.name, space.id)
      let calls = 0
      orchestrator.syncData = async () => {
        calls++
      }
      await orchestrator.init()
      await orchestrator.sync()
      await orchestrator.incrementalSync()
      expect(calls).to.equal(2)
      let failure: unknown
      try {
        await orchestrator.push()
      } catch (error) {
        failure = error
      }
      expect((failure as Error).message).to.equal('This team does not use Google Drive')
    } finally {
      await deleteSpace(space.id)
    }
  })

  /** Run `call` with a callback that collects what is reported */
  async function reported(call: (callback: (progress: SyncBroadcast) => void) => Promise<unknown>) {
    const messages: SyncBroadcast[] = []
    await call(progress => messages.push(progress))
    return messages
  }

  it('attempts content sync even when the metadata backend fails, then reports that failure', async () => {
    const orchestrator = orchestratorWith('sync')
    const failure = new Error('Metadata is unavailable')
    let contentRan = false
    orchestrator.syncData = async () => {
      throw failure
    }
    orchestrator.syncManager = {
      sync: async () => {
        contentRan = true
        return report()
      },
    } as unknown as SyncManager
    const messages: SyncBroadcast[] = []
    let caught: unknown
    try {
      await orchestrator.sync(progress => messages.push(progress))
    } catch (error) {
      caught = error
    }
    expect(contentRan).to.equal(true)
    expect(caught).to.equal(failure)
    expect(messages.at(-1)?.stage).to.equal('error')
  })

  it('attempts metadata sync when content storage cannot even be initialized', async () => {
    const orchestrator = new SyncOrchestrator('Test', null)
    const failure = new Error('Drive is unavailable')
    let metadataRan = false
    orchestrator.init = async () => {
      throw failure
    }
    orchestrator.syncData = async trigger => {
      expect(trigger).to.equal('manual')
      metadataRan = true
    }
    let caught: unknown
    try {
      await orchestrator.sync(null, 'manual')
    } catch (error) {
      caught = error
    }
    expect(metadataRan).to.equal(true)
    expect(caught).to.equal(failure)
  })

  describe('an incremental sync, the one the app makes by itself', () => {
    it('runs the manager’s, tells it whether to push, and says it ran', async () => {
      const calls: unknown[] = []
      const orchestrator = new SyncOrchestrator('Test Church', null)
      orchestrator.syncManager = {
        incrementalSync: async (_progress: unknown, options: unknown) => {
          calls.push(options)
          return report()
        },
      } as unknown as SyncManager

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
      const manager = running.syncManager as unknown as { sync: () => Promise<unknown> }
      manager.sync = async () => {
        await held
        return report()
      }
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
      } as unknown as SyncManager
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

describe('what a sync reports of itself', () => {
  suppressConsoleLogs()
  const exporter = new InMemorySpanExporter()

  beforeEach(() => {
    trace.disable()
    exporter.reset()
    trace.setGlobalTracerProvider(
      new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
    )
    resetTelemetryState()
  })
  afterEach(() => {
    trace.disable()
  })

  const report = { heldBack: 0, readOnly: null, downloadsFailed: false }
  const orchestrator = () => {
    const made = new SyncOrchestrator('Test Church', null)
    made.syncManager = {
      sync: async () => report,
      incrementalSync: async () => report,
    } as unknown as SyncManager
    return made
  }
  const spans = () => exporter.getFinishedSpans().filter(span => span.name === 'chordless.sync.run')

  it('says what started it: the button, or what the caller says, or nothing in particular', async () => {
    const made = orchestrator()
    await made.sync(null, 'manual')
    await made.sync()
    await made.incrementalSync(null, { trigger: 'edit' })
    await made.incrementalSync()
    expect(spans().map(span => span.attributes['chordless.sync.trigger'])).to.deep.equal([
      'manual',
      'other',
      'edit',
      'other',
    ])
    expect(spans().map(span => span.attributes['chordless.sync.operation'])).to.deep.equal([
      'Sync',
      'Sync',
      'Incremental sync',
      'Incremental sync',
    ])
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
