/**
 * How the page makes its reports (src/js/telemetry/, docs/OBSERVABILITY.md): few spans, with what
 * happened as attributes, and nothing at all when reports are off. The SDK that sends them is not
 * loaded here: spans go to an in-memory exporter.
 */
import { expect } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-web'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { baselineAttributes } from '../src/js/telemetry/baseline.ts'
import { clearSetlist, getAmbient, setAmbient } from '../src/js/telemetry/context.ts'
import { GatedExporter } from '../src/js/telemetry/gated-exporter.ts'
import { getDeviceId, resetDeviceId } from '../src/js/telemetry/ids.ts'
import {
  countCall,
  reportError,
  resetTelemetryState,
  timedFetch,
  traced,
  traceparent,
} from '../src/js/telemetry/telemetry.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const exporter = new InMemorySpanExporter()

beforeEach(() => {
  localStorage.clear()
  trace.disable()
  exporter.reset()
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  )
  resetTelemetryState()
  setAmbient({ accountId: undefined })
  clearSetlist()
})

afterEach(() => {
  trace.disable()
  localStorage.clear()
})

const finished = () => exporter.getFinishedSpans()
const names = () => finished().map(span => span.name)

describe('the device id', () => {
  it('is made once, a UUID, and kept', () => {
    const id = getDeviceId()
    expect(id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(getDeviceId()).to.equal(id)
  })

  it('is a new one after a reset, which nothing links to the old', () => {
    const first = getDeviceId()
    resetDeviceId()
    expect(localStorage.getItem('telemetry-device-id')).to.equal(null)
    expect(getDeviceId()).to.not.equal(first)
  })

  it('is null where storage cannot hold one, and a reset there does nothing', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    try {
      expect(getDeviceId()).to.equal(null)
      resetDeviceId()
    } finally {
      if (real) Object.defineProperty(window, 'localStorage', real)
    }
  })
})

describe('what every span carries', () => {
  it('has the device, and whether the page is online, live, and installed', () => {
    const attributes = baselineAttributes()
    expect(attributes['device.id']).to.equal(getDeviceId())
    expect(attributes['chordless.online']).to.equal(navigator.onLine)
    expect(attributes['chordless.live']).to.equal(false)
    expect(attributes['chordless.display_mode']).to.be.oneOf(['browser', 'standalone'])
    expect(attributes).to.not.have.property('session.id')
    expect(attributes).to.not.have.property('enduser.pseudo.id')
  })

  it('says when the app is installed and opened on its own', () => {
    const real = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === '(display-mode: standalone)',
    })) as typeof window.matchMedia
    try {
      expect(baselineAttributes()['chordless.display_mode']).to.equal('standalone')
    } finally {
      window.matchMedia = real
    }
  })

  it('has the page the person is on, by its name, not its address', () => {
    document.body.dataset.view = 'setlist'
    try {
      expect(baselineAttributes()['chordless.route']).to.equal('setlist')
    } finally {
      delete document.body.dataset.view
    }
  })

  it('has the setlist and song in view, and loses them when the setlist is left, keeping the ids', () => {
    setAmbient({
      accountId: 'account-1',
      sessionId: 'session-1',
      setlistId: 'setlist-1',
      setlistDate: '2026-11-01',
      songId: 'song-1',
      songCcli: '22025',
      songIndex: 2,
      songKey: 'G',
    })
    const attributes = baselineAttributes()
    expect(attributes).to.include({
      'enduser.pseudo.id': 'account-1',
      'session.id': 'session-1',
      'chordless.setlist.id': 'setlist-1',
      'chordless.setlist.date': '2026-11-01',
      'chordless.song.id': 'song-1',
      'chordless.song.ccli': '22025',
      'chordless.song.index': 2,
      'chordless.song.key': 'G',
    })
    clearSetlist()
    const after = baselineAttributes()
    expect(after['enduser.pseudo.id']).to.equal('account-1')
    for (const key of ['session.id', 'chordless.setlist.id', 'chordless.song.id']) {
      expect(after).to.not.have.property(key)
    }
    expect(getAmbient().sessionId).to.equal(undefined)
  })

  it('has a value only while it is set: undefined removes it', () => {
    setAmbient({ spaceKind: 'team' })
    expect(baselineAttributes()['chordless.space_kind']).to.equal('team')
    setAmbient({ spaceKind: undefined })
    expect(baselineAttributes()).to.not.have.property('chordless.space_kind')
  })
})

describe('traced', () => {
  it('makes a span with its attributes, and says it went well', async () => {
    const result = await traced('chordless.test', { 'chordless.sync.operation': 'sync' }, () => 7)
    expect(result).to.equal(7)
    const [span] = finished()
    expect(span.name).to.equal('chordless.test')
    expect(span.attributes['chordless.sync.operation']).to.equal('sync')
    expect(span.attributes['chordless.outcome']).to.equal('ok')
    expect(span.parentSpanContext).to.equal(undefined)
  })

  it('records an error as an exception on the span, and throws it again', async () => {
    let thrown: unknown
    try {
      await traced('chordless.test', {}, async () => {
        throw new Error('no network')
      })
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error).message).to.equal('no network')
    const [span] = finished()
    expect(span.attributes['chordless.outcome']).to.equal('error')
    expect(span.attributes['chordless.error']).to.equal(true)
    expect(span.status.code).to.equal(2)
    expect(span.events[0].name).to.equal('exception')
    expect(span.events[0].attributes?.['exception.message']).to.equal('no network')
  })

  it('records something thrown that is not an Error too', async () => {
    try {
      await traced('chordless.test', {}, () => Promise.reject('plain text'))
    } catch {
      // (thrown again)
    }
    expect(finished()[0].events[0].attributes?.['exception.message']).to.equal('plain text')
  })

  it('does nothing but run the function when reports are off', async () => {
    setTelemetryPreference(false)
    let seen = ''
    const result = await traced('chordless.test', {}, span => {
      span.setAttribute('chordless.outcome', 'ok')
      seen = span.spanContext().traceId
      return 'done'
    })
    expect(result).to.equal('done')
    expect(finished()).to.have.length(0)
    expect(seen).to.equal('00000000000000000000000000000000')
  })
})

describe('the calls made during a sync', () => {
  it('are counted on its span, with the slowest', async () => {
    await traced(
      'chordless.sync.run',
      {},
      () => {
        countCall('drive', 120, 200)
        countCall('drive', 480, 200)
        countCall('worker', 90, 200)
      },
      { trackCalls: true }
    )
    const attributes = finished()[0].attributes
    expect(attributes['chordless.sync.drive_calls']).to.equal(2)
    expect(attributes['chordless.sync.drive_ms_total']).to.equal(600)
    expect(attributes['chordless.sync.drive_ms_max']).to.equal(480)
    expect(attributes['chordless.sync.worker_calls']).to.equal(1)
    expect(attributes['chordless.sync.errors']).to.equal(0)
    expect(finished()[0].events).to.have.length(0)
  })

  it('make an event when one fails or is slow, a few at most, and an error is counted', async () => {
    await traced(
      'chordless.sync.run',
      {},
      () => {
        countCall('drive', 50, 500)
        countCall('drive', 50, 0)
        countCall('worker', 2500, 200)
        for (let i = 0; i < 30; i++) countCall('drive', 10, 403)
      },
      { trackCalls: true }
    )
    const [span] = finished()
    expect(span.attributes['chordless.sync.errors']).to.equal(32)
    expect(span.events).to.have.length(10)
    expect(span.events[0].name).to.equal('chordless.call')
    expect(span.events[0].attributes).to.include({
      'chordless.call.kind': 'drive',
      'chordless.call.status': 500,
    })
  })

  it('are not counted when no sync is running, or on a span that does not ask', async () => {
    countCall('drive', 10, 200)
    await traced('chordless.other', {}, () => countCall('drive', 10, 200))
    expect(finished()[0].attributes).to.not.have.property('chordless.sync.drive_calls')
  })

  it('give the Worker a traceparent of the sync, and nothing otherwise', async () => {
    expect(traceparent()).to.equal(null)
    let header: string | null = null
    let traceId = ''
    await traced(
      'chordless.sync.run',
      {},
      span => {
        header = traceparent()
        traceId = span.spanContext().traceId
      },
      { trackCalls: true }
    )
    expect(header).to.match(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    expect(String(header).split('-')[1]).to.equal(traceId)
    expect(traceparent()).to.equal(null)

    setTelemetryPreference(false)
    await traced('chordless.sync.run', {}, () => {}, { trackCalls: true })
    expect(traceparent()).to.equal(null)
  })

  it('end with the sync: the next one starts from nothing', async () => {
    await traced('chordless.sync.run', {}, () => countCall('drive', 10, 200), { trackCalls: true })
    await traced('chordless.sync.run', {}, () => {}, { trackCalls: true })
    expect(finished()[1].attributes['chordless.sync.drive_calls']).to.equal(0)
  })
})

describe('timedFetch', () => {
  it('counts a call by its status, and returns the response untouched', async () => {
    const response = new Response('{}', { status: 502 })
    const fetcher = timedFetch('drive', async () => response)
    await traced(
      'chordless.sync.run',
      {},
      async () => {
        expect(await fetcher('https://x.test/')).to.equal(response)
      },
      { trackCalls: true }
    )
    expect(finished()[0].attributes['chordless.sync.drive_calls']).to.equal(1)
    expect(finished()[0].attributes['chordless.sync.errors']).to.equal(1)
  })

  it('counts a call with no answer as a failure, and throws it again', async () => {
    const fetcher = timedFetch('worker', async () => {
      throw new TypeError('Failed to fetch')
    })
    await traced(
      'chordless.sync.run',
      {},
      async () => {
        let thrown: unknown
        try {
          await fetcher('https://x.test/')
        } catch (error) {
          thrown = error
        }
        expect(thrown).to.be.instanceOf(TypeError)
      },
      { trackCalls: true }
    )
    expect(finished()[0].attributes['chordless.sync.worker_calls']).to.equal(1)
    expect(finished()[0].events[0].attributes?.['chordless.call.status']).to.equal(0)
  })

  it('is the real fetch unless it is given another', async () => {
    const real = window.fetch
    let asked = ''
    window.fetch = (async (input: RequestInfo | URL) => {
      asked = String(input)
      return new Response('ok')
    }) as typeof fetch
    try {
      const response = await timedFetch('drive')('https://x.test/real')
      expect(await response.text()).to.equal('ok')
      expect(asked).to.equal('https://x.test/real')
    } finally {
      window.fetch = real
    }
  })
})

describe('reportError', () => {
  it('is a span of its own, with the error on it', () => {
    reportError(new TypeError('x is not a function'), { 'chordless.error.toast': true })
    const [span] = finished()
    expect(span.name).to.equal('chordless.error')
    expect(span.attributes['chordless.error.toast']).to.equal(true)
    expect(span.events[0].attributes?.['exception.type']).to.equal('TypeError')
    expect(span.status.code).to.equal(2)
  })

  it('takes text as well as an error', () => {
    reportError('Could not save the setlist.')
    expect(finished()[0].events[0].attributes?.['exception.message']).to.equal(
      'Could not save the setlist.'
    )
  })

  it('stops after a few in a visit: a loop of errors is one problem', () => {
    for (let i = 0; i < 50; i++) reportError(`error ${i}`)
    expect(finished()).to.have.length(20)
  })

  it('does nothing when reports are off', () => {
    setTelemetryPreference(false)
    reportError(new Error('x'))
    expect(names()).to.deep.equal([])
  })
})

describe('the exporter', () => {
  const spans = [] as never[]

  it('passes a batch on when sending is wanted', () => {
    const sent: unknown[] = []
    const inner = { export: (s: unknown) => sent.push(s), shutdown: async () => {} }
    const results: number[] = []
    new GatedExporter(inner as never, () => true).export(spans, result => results.push(result.code))
    expect(sent).to.have.length(1)
    expect(results).to.deep.equal([])
  })

  it('drops a batch, and says it went well, when sending is not wanted', () => {
    const sent: unknown[] = []
    const inner = { export: (s: unknown) => sent.push(s), shutdown: async () => {} }
    const results: number[] = []
    new GatedExporter(inner as never, () => false).export(spans, result =>
      results.push(result.code)
    )
    expect(sent).to.have.length(0)
    expect(results).to.deep.equal([0])
  })

  it('is by default offline or off: neither is sent', () => {
    const sent: unknown[] = []
    const inner = { export: (s: unknown) => sent.push(s), shutdown: async () => {} }
    const exporter2 = new GatedExporter(inner as never)
    setTelemetryPreference(false)
    exporter2.export(spans, () => {})
    expect(sent).to.have.length(0)
    setTelemetryPreference(true)
    exporter2.export(spans, () => {})
    expect(sent).to.have.length(navigator.onLine ? 1 : 0)
  })

  it('shuts down and flushes the exporter it wraps, if that can flush', async () => {
    let shut = 0
    let flushed = 0
    const inner = {
      export: () => {},
      shutdown: async () => void shut++,
      forceFlush: async () => void flushed++,
    }
    const gated = new GatedExporter(inner as never, () => true)
    await gated.shutdown()
    await gated.forceFlush()
    expect([shut, flushed]).to.deep.equal([1, 1])
    await new GatedExporter({ export: () => {}, shutdown: async () => {} } as never).forceFlush()
  })
})
