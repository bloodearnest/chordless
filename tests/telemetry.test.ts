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
import { getAmbient, setAmbient } from '../src/js/telemetry/context.ts'
import { GatedExporter } from '../src/js/telemetry/gated-exporter.ts'
import { getDeviceId, resetDeviceId } from '../src/js/telemetry/ids.ts'
import {
  countCall,
  phase,
  reportError,
  resetTelemetryState,
  timedFetch,
  traced,
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
  setAmbient({ accountId: undefined, sessionId: undefined, teamPseudoId: undefined })
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

  it('has the session and the ids, and never the setlist or the song: those are on the spans about them', () => {
    setAmbient({ accountId: 'account-1', sessionId: 'session-1', teamPseudoId: 'team-1' })
    const attributes = baselineAttributes()
    expect(attributes).to.include({
      'enduser.pseudo.id': 'account-1',
      'session.id': 'session-1',
      'chordless.team.pseudo_id': 'team-1',
    })
    for (const key of Object.keys(attributes)) {
      expect(key, 'a background span would seem to be about it').to.not.match(
        /^chordless\.(setlist|song)\./
      )
    }
    setAmbient({ sessionId: undefined })
    expect(baselineAttributes()).to.not.have.property('session.id')
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
  })

  it('count as errors when they got no answer or were refused, and not for a 404', async () => {
    await traced(
      'chordless.sync.run',
      {},
      () => {
        countCall('drive', 50, 500)
        countCall('drive', 50, 0)
        countCall('drive', 50, 403)
        countCall('drive', 50, 404)
        countCall('worker', 50, 429)
        countCall('worker', 50, 304)
      },
      { trackCalls: true }
    )
    expect(finished()[0].attributes['chordless.sync.errors']).to.equal(4)
  })

  it('are not counted when no sync is running, or on a span that does not ask', async () => {
    countCall('drive', 10, 200)
    await traced('chordless.other', {}, () => countCall('drive', 10, 200))
    expect(finished()[0].attributes).to.not.have.property('chordless.sync.drive_calls')
  })

  it('end with the sync: the next one starts from nothing', async () => {
    await traced('chordless.sync.run', {}, () => countCall('drive', 10, 200), { trackCalls: true })
    await traced('chordless.sync.run', {}, () => {}, { trackCalls: true })
    expect(finished()[1].attributes['chordless.sync.drive_calls']).to.equal(0)
  })
})

describe('traced, sampled', () => {
  const realRandom = Math.random
  afterEach(() => {
    Math.random = realRandom
  })

  it('keeps one in N, counted N times, with its calls', async () => {
    Math.random = () => 0
    await traced(
      'chordless.sync.run',
      {},
      async () => {
        await timedFetch('drive', async () => new Response('{}'))('https://x.test/')
      },
      { trackCalls: true, sample: 10 }
    )
    expect(finished()).to.have.length(2)
    for (const span of finished()) expect(span.attributes.SampleRate).to.equal(10)
  })

  it('drops the rest, and the calls they make, but still runs them', async () => {
    Math.random = () => 0.5
    let ran = false
    let calls = 0
    const result = await traced(
      'chordless.sync.run',
      {},
      async () => {
        ran = true
        await timedFetch('drive', async () => {
          calls++
          return new Response('{}')
        })('https://x.test/')
        return 'done'
      },
      { trackCalls: true, sample: 10 }
    )
    expect(result).to.equal('done')
    expect([ran, calls]).to.deep.equal([true, 1])
    expect(finished()).to.have.length(0)
    // (and what follows is not left thinking there is a sync running)
    await timedFetch('drive', async () => new Response('{}'))('https://x.test/')
    expect(finished()).to.have.length(1)
    expect(finished()[0].attributes).to.not.have.property('SampleRate')
  })

  it('keeps every one when there is no sampling', async () => {
    Math.random = () => 0.99
    await traced('chordless.sync.run', {}, () => {}, { sample: 1 })
    expect(finished()).to.have.length(1)
    expect(finished()[0].attributes).to.not.have.property('SampleRate')
  })
})

describe('phase', () => {
  const ok = async () => new Response('{}')

  it('is a child of the sync and the parent of the calls it makes', async () => {
    let syncId = ''
    await traced(
      'chordless.sync.run',
      {},
      async span => {
        syncId = span.spanContext().spanId
        await phase('chordless.sync.feed', {}, () => timedFetch('drive', ok)('https://x.test/a'))
        await timedFetch('drive', ok)('https://x.test/b')
      },
      { trackCalls: true }
    )
    const step = finished().find(span => span.name === 'chordless.sync.feed')
    const [inside, after] = finished().filter(span => span.name === 'chordless.drive.request')
    expect(step?.parentSpanContext?.spanId).to.equal(syncId)
    expect(step?.attributes['chordless.outcome']).to.equal('ok')
    expect(inside.parentSpanContext?.spanId).to.equal(step?.spanContext().spanId)
    // (and it hands the sync back when it ends)
    expect(after.parentSpanContext?.spanId).to.equal(syncId)
  })

  it('nests, records an error and throws it again', async () => {
    let thrown: unknown
    await traced(
      'chordless.sync.run',
      {},
      async () => {
        try {
          await phase('chordless.sync.outer', {}, () =>
            phase('chordless.sync.inner', {}, () => {
              throw new Error('nope')
            })
          )
        } catch (error) {
          thrown = error
        }
      },
      { trackCalls: true }
    )
    const outer = finished().find(span => span.name === 'chordless.sync.outer')
    const inner = finished().find(span => span.name === 'chordless.sync.inner')
    expect((thrown as Error).message).to.equal('nope')
    expect(inner?.parentSpanContext?.spanId).to.equal(outer?.spanContext().spanId)
    expect(inner?.attributes['chordless.outcome']).to.equal('error')
  })

  it('is no span outside a sync, or in one that is not reported, but still runs', async () => {
    expect(await phase('chordless.sync.feed', {}, () => 'ran')).to.equal('ran')
    const random = Math.random
    Math.random = () => 0.5
    try {
      await traced('chordless.sync.run', {}, () => phase('chordless.sync.feed', {}, () => {}), {
        trackCalls: true,
        sample: 10,
      })
    } finally {
      Math.random = random
    }
    expect(finished()).to.have.length(0)
  })

  it('does nothing but run the function when reports are off', async () => {
    setTelemetryPreference(false)
    await traced('chordless.sync.run', {}, () => phase('chordless.sync.feed', {}, () => {}), {
      trackCalls: true,
    })
    expect(finished()).to.have.length(0)
  })
})

describe('timedFetch', () => {
  const ok = async () => new Response('{}', { status: 200 })

  it('makes a span for a call, a child of the sync, with what the call was', async () => {
    const fetcher = timedFetch('drive', ok)
    let syncId = ''
    await traced(
      'chordless.sync.run',
      {},
      async span => {
        syncId = span.spanContext().spanId
        await fetcher('https://www.googleapis.com/drive/v3/files/f1?alt=media', { method: 'get' })
      },
      { trackCalls: true }
    )
    const call = finished().find(span => span.name === 'chordless.drive.request')
    expect(call?.kind).to.equal(2)
    expect(call?.parentSpanContext?.spanId).to.equal(syncId)
    expect(call?.attributes).to.include({
      'http.request.method': 'GET',
      'server.address': 'www.googleapis.com',
      'url.path': '/drive/v3/files/f1',
      'url.query': '?alt=media',
      'http.response.status_code': 200,
    })
    expect(call?.attributes).to.not.have.property('chordless.error')
    expect(finished().find(span => span.name === 'chordless.sync.run')?.attributes).to.include({
      'chordless.sync.drive_calls': 1,
    })
  })

  it('has a trace of its own when no sync is running, and takes the method from a Request', async () => {
    await timedFetch('drive', ok)(new Request('https://x.test/a', { method: 'POST' }))
    const [call] = finished()
    expect(call.parentSpanContext).to.equal(undefined)
    expect(call.attributes['http.request.method']).to.equal('POST')
  })

  it('is a child of the span it is given where there is no sync (a token refresh)', async () => {
    let parentId = ''
    await traced('chordless.auth.refresh', {}, async span => {
      parentId = span.spanContext().spanId
      await timedFetch('worker', ok, () => span)('/session/refresh', { method: 'POST' })
    })
    const call = finished().find(span => span.name === 'chordless.worker.request')
    expect(call?.parentSpanContext?.spanId).to.equal(parentId)
    expect(call?.attributes['url.path']).to.equal('/session/refresh')
  })

  it('sends a call to our Worker with its own traceparent, so the Worker’s span is its child', async () => {
    const sent: Headers[] = []
    const fetcher = timedFetch('worker', async (_input, init) => {
      sent.push(new Headers(init?.headers))
      return new Response('{}')
    })
    await fetcher('/api/spaces', { headers: { Authorization: 'Bearer t' } })
    const [call] = finished()
    const { traceId, spanId } = call.spanContext()
    expect(sent[0].get('traceparent')).to.equal(`00-${traceId}-${spanId}-01`)
    expect(sent[0].get('authorization')).to.equal('Bearer t')
    // (headers given as a list, or a Headers object, are kept too)
    await fetcher('/api/spaces', { headers: [['X-One', '1']] })
    await fetcher('/api/spaces', { headers: new Headers({ 'X-Two': '2' }) })
    expect(sent[1].get('x-one')).to.equal('1')
    expect(sent[2].get('x-two')).to.equal('2')
    expect(sent[2].get('traceparent')).to.match(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('never sends a traceparent to Google', async () => {
    const sent: Headers[] = []
    await timedFetch('drive', async (_input, init) => {
      sent.push(new Headers(init?.headers))
      return new Response('{}')
    })('https://www.googleapis.com/drive/v3/files')
    expect(sent[0].get('traceparent')).to.equal(null)
  })

  it('marks a refusal or a server error as one, and a 404 as no error', async () => {
    for (const status of [404, 500, 403, 429]) {
      await timedFetch('drive', async () => new Response('', { status }))('https://x.test/')
    }
    const byStatus = Object.fromEntries(
      finished().map(span => [span.attributes['http.response.status_code'], span])
    )
    expect(byStatus[404].status.code).to.equal(0)
    expect(byStatus[404].attributes).to.not.have.property('chordless.error')
    for (const status of [500, 403, 429]) {
      expect(byStatus[status].status.code, String(status)).to.equal(2)
      expect(byStatus[status].attributes['chordless.error']).to.equal(true)
    }
  })

  it('records a call with no answer as an exception, and throws it again', async () => {
    const fetcher = timedFetch('worker', async () => {
      throw new TypeError('Failed to fetch')
    })
    let thrown: unknown
    await traced(
      'chordless.sync.run',
      {},
      async () => {
        try {
          await fetcher('/api/spaces')
        } catch (error) {
          thrown = error
        }
      },
      { trackCalls: true }
    )
    expect(thrown).to.be.instanceOf(TypeError)
    const call = finished().find(span => span.name === 'chordless.worker.request')
    expect(call?.status.code).to.equal(2)
    expect(call?.events[0].attributes?.['exception.message']).to.equal('Failed to fetch')
    expect(finished().find(span => span.name === 'chordless.sync.run')?.attributes).to.include({
      'chordless.sync.worker_calls': 1,
      'chordless.sync.errors': 1,
    })
  })

  it('makes spans for only the first calls of a sync, and counts them all', async () => {
    const fetcher = timedFetch('drive', ok)
    await traced(
      'chordless.sync.run',
      {},
      async () => {
        for (let i = 0; i < 250; i++) await fetcher('https://x.test/')
      },
      { trackCalls: true }
    )
    expect(finished().filter(span => span.name === 'chordless.drive.request')).to.have.length(200)
    expect(
      finished().find(span => span.name === 'chordless.sync.run')?.attributes[
        'chordless.sync.drive_calls'
      ]
    ).to.equal(250)
  })

  it('makes no span while reports are off, and still makes the call', async () => {
    setTelemetryPreference(false)
    const sent: Headers[] = []
    const response = await timedFetch('worker', async (_input, init) => {
      sent.push(new Headers(init?.headers))
      return new Response('{}')
    })('/api/spaces')
    expect(response.status).to.equal(200)
    expect(finished()).to.have.length(0)
    expect(sent[0].get('traceparent')).to.equal(null)
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
