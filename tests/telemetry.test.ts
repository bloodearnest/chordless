/**
 * How the page makes its reports (src/js/telemetry/, docs/OBSERVABILITY.md): few spans, with what
 * happened as attributes, and nothing at all when reports are off. The SDK that sends them is not
 * loaded here: spans go to an in-memory exporter.
 */
import { expect } from '@open-wc/testing'
import { context, propagation, ROOT_CONTEXT, SpanKind, trace } from '@opentelemetry/api'
import type { FetchInstrumentation } from '@opentelemetry/browser-instrumentation/experimental/fetch'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import {
  InMemorySpanExporter,
  SamplingDecision,
  SimpleSpanProcessor,
  StackContextManager,
  TracerProvider,
} from '@opentelemetry/sdk-trace'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { baselineAttributes } from '../src/js/telemetry/baseline.ts'
import { getAmbient, setAmbient } from '../src/js/telemetry/context.ts'
import { instrumentFetch } from '../src/js/telemetry/fetch.ts'
import { GatedExporter } from '../src/js/telemetry/gated-exporter.ts'
import { getDeviceId, resetDeviceId } from '../src/js/telemetry/ids.ts'
import { sampler } from '../src/js/telemetry/sampler.ts'
import { stampSpans } from '../src/js/telemetry/span-processor.ts'
import {
  countCall,
  phase,
  reportError,
  resetTelemetryState,
  TICK_SAMPLE,
  timedFetch as timedFetchNow,
  traced as tracedNow,
} from '../src/js/telemetry/telemetry.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const exporter = new InMemorySpanExporter()

/**
 * A fetch's span ends once the instrumentation has read its copy of the body, a moment after the call
 * is answered: so these two wait for that, and a test reads what ended
 */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const timedFetch = (...args: Parameters<typeof timedFetchNow>) => {
  const call = timedFetchNow(...args)
  return (async (input, init) => {
    try {
      return await call(input, init)
    } finally {
      await settle()
    }
  }) as typeof fetch
}
const traced: typeof tracedNow = async (...args) => {
  try {
    return await tracedNow(...args)
  } finally {
    await settle()
  }
}

const realFetch = globalThis.fetch
/** What the page's `fetch` answers, in a test (the instrumentation wraps the one below) */
let respond: typeof fetch
let fetchSpans: FetchInstrumentation

beforeEach(() => {
  localStorage.clear()
  trace.disable()
  context.disable()
  exporter.reset()
  trace.setGlobalTracerProvider(
    new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
  )
  // (what is active for a call as it is made, as the page has it)
  context.setGlobalContextManager(new StackContextManager().enable())
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  resetTelemetryState()
  respond = async () => new Response('{}')
  globalThis.fetch = ((input, init) => respond(input, init)) as typeof fetch
  fetchSpans = instrumentFetch()
  setAmbient({ accountId: undefined, sessionId: undefined, teamPseudoId: undefined })
})

afterEach(() => {
  fetchSpans.disable()
  globalThis.fetch = realFetch
  trace.disable()
  context.disable()
  propagation.disable()
  localStorage.clear()
})

const expectEventually = async (check: () => boolean, ms = 2000) => {
  const until = Date.now() + ms
  while (!check() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10))
  expect(check()).to.equal(true)
}

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

/** A provider like the page's: its sampler and its stamping, with an id generator that says whether the trace is among the sampled one in ten */
function pageProvider(traceId: string) {
  trace.disable()
  trace.setGlobalTracerProvider(
    new TracerProvider({
      sampler: sampler(),
      idGenerator: { generateTraceId: () => traceId, generateSpanId: () => '1'.repeat(16) },
      spanProcessors: [stampSpans, new SimpleSpanProcessor({ exporter })],
    })
  )
  // (the instrumentation's tracer is the global provider's as it was when it was made)
  fetchSpans.disable()
  fetchSpans = instrumentFetch()
}
const DRIVE = 'https://www.googleapis.com/drive/v3/files/'
const SAMPLED_ID = `${'0'.repeat(31)}1`
// (a trace id's four words are XORed, and it is kept if the result is under a tenth of the range)
const DROPPED_ID = `ffffffff${'0'.repeat(24)}`

describe('the sampler', () => {
  const ask = (trigger: string | undefined, traceId: string) =>
    sampler().shouldSample(
      ROOT_CONTEXT,
      traceId,
      'chordless.sync.run',
      SpanKind.INTERNAL,
      trigger ? { 'chordless.sync.trigger': trigger } : {},
      []
    )

  it('keeps every trace but the timer’s, and one in ten of those, counted ten times', () => {
    expect(ask('manual', DROPPED_ID).decision).to.equal(SamplingDecision.RECORD_AND_SAMPLED)
    expect(ask(undefined, DROPPED_ID).attributes).to.equal(undefined)
    expect(ask('tick', SAMPLED_ID)).to.deep.equal({
      decision: SamplingDecision.RECORD_AND_SAMPLED,
      attributes: { SampleRate: TICK_SAMPLE },
    })
    expect(ask('tick', DROPPED_ID)).to.deep.equal({ decision: SamplingDecision.NOT_RECORD })
    expect(sampler().toString()).to.contain('1 in 10')
  })

  it('reports a kept trace’s spans, each counted ten times, calls below it too', async () => {
    pageProvider(SAMPLED_ID)
    await traced(
      'chordless.sync.run',
      { 'chordless.sync.trigger': 'tick' },
      () => phase('chordless.sync.feed', {}, () => timedFetch('drive')(DRIVE)),
      { trackCalls: true }
    )
    expect(names()).to.have.members(['GET', 'chordless.sync.feed', 'chordless.sync.run'])
    for (const span of finished()) expect(span.attributes.SampleRate, span.name).to.equal(10)
  })

  it('reports nothing of a trace that is not kept, and the call is still made, with the sampled flag off', async () => {
    pageProvider(DROPPED_ID)
    let sent: Headers | undefined
    respond = async (_input, init) => {
      sent = new Headers(init?.headers)
      return new Response('{}')
    }
    const result = await traced(
      'chordless.sync.run',
      { 'chordless.sync.trigger': 'tick' },
      async () => {
        await phase('chordless.sync.feed', {}, () => timedFetch('worker')('/api/x'))
        return 'done'
      },
      { trackCalls: true }
    )
    expect(result).to.equal('done')
    expect(finished()).to.have.length(0)
    expect(sent?.get('traceparent')).to.match(/^00-ffffffff0{24}-[0-9a-f]{16}-00$/)
  })

  it('does not leave the calls made after it, by others, unreported', async () => {
    pageProvider(DROPPED_ID)
    await traced('chordless.sync.run', { 'chordless.sync.trigger': 'tick' }, () => {}, {
      trackCalls: true,
    })
    // (this is not the sync's: a call of its own is a trace of its own, kept)
    pageProvider(SAMPLED_ID)
    await timedFetch('drive')(`${DRIVE}other`)
    expect(names()).to.deep.equal(['GET'])
  })
})

describe('what every span gets as it starts', () => {
  it('is the page’s baseline, and from the span above it the sync it is part of and its sample rate, and has nothing to flush or end', async () => {
    pageProvider(SAMPLED_ID)
    await traced(
      'chordless.sync.run',
      { 'chordless.sync.trigger': 'tick', 'chordless.sync.operation': 'Incremental sync' },
      () => phase('chordless.sync.feed', {}, () => timedFetch('drive')(DRIVE)),
      { trackCalls: true }
    )
    // (the step is below the sync, and the call below the step: it is passed down)
    for (const name of ['chordless.sync.feed', 'GET']) {
      const span = finished().find(found => found.name === name)
      expect(span?.attributes, name).to.include({
        SampleRate: TICK_SAMPLE,
        'chordless.sync.trigger': 'tick',
        'chordless.sync.operation': 'Incremental sync',
        'chordless.online': navigator.onLine,
      })
    }
    // (a span of its own, outside a sync, has none of it)
    exporter.reset()
    await timedFetch('drive')(DRIVE)
    expect(finished()[0].attributes).to.not.have.property('chordless.sync.trigger')
    // (the processor is the provider's: these are what it does when asked)
    await stampSpans.forceFlush()
    await stampSpans.shutdown()
  })
})

describe('phase', () => {
  it('is a child of the sync and the parent of the calls it makes', async () => {
    let syncId = ''
    await traced(
      'chordless.sync.run',
      {},
      async span => {
        syncId = span.spanContext().spanId
        await phase('chordless.sync.feed', {}, () =>
          timedFetch('drive')('https://www.googleapis.com/drive/v3/files/a')
        )
        await timedFetch('drive')('https://www.googleapis.com/drive/v3/files/b')
      },
      { trackCalls: true }
    )
    const step = finished().find(span => span.name === 'chordless.sync.feed')
    const [inside, after] = finished().filter(span => span.kind === SpanKind.CLIENT)
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

  it('is no span outside a sync, but still runs', async () => {
    expect(await phase('chordless.sync.feed', {}, () => 'ran')).to.equal('ran')
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
  it('makes a span of a call, a child of the sync, with what the call was', async () => {
    let syncId = ''
    await traced(
      'chordless.sync.run',
      {},
      async span => {
        syncId = span.spanContext().spanId
        await timedFetch('drive')('https://www.googleapis.com/drive/v3/files/f1?alt=media', {
          method: 'get',
        })
      },
      { trackCalls: true }
    )
    const call = finished().find(span => span.kind === SpanKind.CLIENT)
    expect(call?.kind).to.equal(2)
    expect(call?.parentSpanContext?.spanId).to.equal(syncId)
    expect(call?.attributes).to.include({
      'http.request.method': 'GET',
      'url.full': 'https://www.googleapis.com/drive/v3/files/f1?alt=media',
      'url.path': '/drive/v3/files/f1',
      'server.address': 'www.googleapis.com',
      'server.port': 443,
      'http.response.status_code': 200,
    })
    expect(finished().find(span => span.name === 'chordless.sync.run')?.attributes).to.include({
      'chordless.sync.drive_calls': 1,
    })
  })

  it('is a trace of its own where no sync is running, and a child of the span it is given where it has none (a token refresh)', async () => {
    await timedFetch('drive')('https://www.googleapis.com/drive/v3/files/a')
    expect(finished()[0].parentSpanContext).to.equal(undefined)
    exporter.reset()
    await traced('chordless.auth.refresh', {}, async span => {
      await timedFetch('worker', undefined, () => span)('/session/refresh', { method: 'POST' })
    })
    const call = finished().find(span => span.kind === SpanKind.CLIENT)
    const refresh = finished().find(span => span.name === 'chordless.auth.refresh')
    expect(call?.parentSpanContext?.spanId).to.equal(refresh?.spanContext().spanId)
    expect(call?.spanContext().traceId).to.equal(refresh?.spanContext().traceId)
  })

  it('sends a call to our Worker with the span’s own traceparent, and never one to Google', async () => {
    const sent: Headers[] = []
    respond = async (_input, init) => {
      sent.push(new Headers(init?.headers))
      return new Response('{}')
    }
    await timedFetch('worker')('/api/spaces', { headers: { Authorization: 'Bearer t' } })
    await timedFetch('drive')('https://www.googleapis.com/drive/v3/files')
    const [worker, drive] = finished()
    const { traceId, spanId } = worker.spanContext()
    expect(worker.attributes['server.address']).to.equal(location.hostname)
    expect(sent[0].get('traceparent')).to.equal(`00-${traceId}-${spanId}-01`)
    expect(sent[0].get('authorization')).to.equal('Bearer t')
    expect(drive.attributes['server.address']).to.equal('www.googleapis.com')
    expect(sent[1].get('traceparent')).to.equal(null)
  })

  it('keeps the Cloudflare ray id of an answer, the way to find the Worker’s span', async () => {
    respond = async () => new Response('{}', { headers: { 'cf-ray': 'a51c89e75a0635ca-LHR' } })
    await timedFetch('worker')('/api/spaces')
    expect(finished()[0].attributes['cloudflare.ray_id']).to.equal('a51c89e75a0635ca')
  })

  it('keeps the size of a body sent, and of an answer by its Content-Length', async () => {
    respond = async () => new Response('abc', { headers: { 'Content-Length': '3' } })
    await timedFetch('drive')('https://www.googleapis.com/drive/v3/files/a', {
      method: 'POST',
      body: 'héllo',
    })
    await expectEventually(() => finished()[0]?.attributes['http.request.body.size'] !== undefined)
    expect(finished()[0].attributes).to.include({
      'http.request.body.size': 6,
      'http.response.body.size': 3,
    })
  })

  it('takes the size of an answer from the browser’s record of it, which a header may not say', async () => {
    // (our own server, as a page’s call to its Worker is: a script of the test page)
    fetchSpans.disable()
    globalThis.fetch = realFetch
    fetchSpans = instrumentFetch()
    const response = await timedFetch('worker')('/tests/shims/node-builtins.js')
    await response.text()
    await expectEventually(() => finished().length === 1)
    const [call] = finished()
    expect(call.attributes['http.response.body.size'], 'wire').to.be.greaterThan(0)
    expect(
      call.attributes['chordless.http.response.decoded_body_size'],
      'decoded'
    ).to.be.greaterThan(0)
    expect(call.attributes['http.response.size'], 'with headers').to.be.greaterThan(0)
  })

  it('has no size from the browser for a call it has no record of, and does not break', async () => {
    await timedFetch('worker')('/api/nothing-fetched-for-real')
    await expectEventually(() => finished().length === 1)
    expect(finished()[0].attributes).to.not.have.property(
      'chordless.http.response.decoded_body_size'
    )
  })

  it('marks a refusal or a server error as one, counts what the sync counts as errors, and a 404 is no error to it', async () => {
    let status = 503
    respond = async () => new Response('', { status })
    await traced(
      'chordless.sync.run',
      {},
      async () => {
        await timedFetch('drive')('https://www.googleapis.com/drive/v3/files/a')
        status = 404
        await timedFetch('drive')('https://www.googleapis.com/drive/v3/files/b')
      },
      { trackCalls: true }
    )
    const [refused] = finished().filter(span => span.kind === SpanKind.CLIENT)
    expect(refused.attributes).to.include({ 'http.response.status_code': 503, 'error.type': '503' })
    expect(refused.status.code).to.equal(2)
    expect(
      finished().find(span => span.name === 'chordless.sync.run')?.attributes[
        'chordless.sync.errors'
      ]
    ).to.equal(1)
  })

  it('records a call with no answer as an error, counts it, and throws it again', async () => {
    respond = async () => {
      throw new TypeError('Failed to fetch')
    }
    let thrown: unknown
    await traced(
      'chordless.sync.run',
      {},
      async () => {
        await timedFetch('worker')('/api/spaces').catch(error => {
          thrown = error
        })
      },
      { trackCalls: true }
    )
    expect((thrown as Error).message).to.equal('Failed to fetch')
    const call = finished().find(span => span.kind === SpanKind.CLIENT)
    expect(call?.attributes['error.type']).to.equal('TypeError')
    expect(call?.status.code).to.equal(2)
    expect(
      finished().find(span => span.name === 'chordless.sync.run')?.attributes[
        'chordless.sync.errors'
      ]
    ).to.equal(1)
  })

  it('makes spans for only the first calls of a sync, and counts them all', async () => {
    const fetcher = timedFetch('drive')
    await traced(
      'chordless.sync.run',
      {},
      async () => {
        for (let i = 0; i < 250; i++) await fetcher(DRIVE)
      },
      { trackCalls: true }
    )
    expect(finished().filter(span => span.kind === SpanKind.CLIENT)).to.have.length(200)
    expect(
      finished().find(span => span.name === 'chordless.sync.run')?.attributes[
        'chordless.sync.drive_calls'
      ]
    ).to.equal(250)
  })

  it('does not make a span of a report on its way: it would be traced sending itself', async () => {
    await window.fetch('/api/otlp/v1/traces', { method: 'POST', body: '{}' })
    expect(finished()).to.have.length(0)
  })

  it('makes the call, with no span, while reports are off and nothing is traced', async () => {
    fetchSpans.disable()
    setTelemetryPreference(false)
    const response = await timedFetch('worker')('/api/spaces')
    expect(response.status).to.equal(200)
    expect(finished()).to.have.length(0)
  })

  it('is the real fetch unless it is given another', async () => {
    let asked = ''
    respond = async input => {
      asked = String(input)
      return new Response('ok')
    }
    const response = await timedFetch('drive')('https://x.test/real')
    expect(await response.text()).to.equal('ok')
    expect(asked).to.equal('https://x.test/real')
    const given = await timedFetch(
      'drive',
      async () => new Response('given')
    )('https://x.test/given')
    expect(await given.text()).to.equal('given')
    expect(asked).to.equal('https://x.test/real')
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
