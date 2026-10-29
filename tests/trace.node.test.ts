/**
 * The Worker's own span for a call that carries the page's `traceparent` (worker/src/trace.ts): that
 * it is a child of the page's span, what it records, and when it is not made.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handleRequest } from '../worker/src/router.ts'
import type { ShareCache } from '../worker/src/share.ts'
import type { TelemetryDeps } from '../worker/src/telemetry.ts'
import { routeOf, tracedFetch, tracedStub, withWorkerSpan } from '../worker/src/trace.ts'

const ORIGIN = 'https://chordless.test'
const TRACE = 'a'.repeat(32)
const PARENT = 'b'.repeat(16)
const TRACEPARENT = `00-${TRACE}-${PARENT}-01`

function setup(env: Partial<Env> = {}, assets: () => Response = () => new Response('page')) {
  const sent: Record<string, any>[] = []
  const pending: Promise<unknown>[] = []
  const deps: TelemetryDeps = {
    async fetch(_url, init) {
      sent.push(JSON.parse(String(init.body)))
      return new Response('{}')
    },
  }
  const full = {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    JWE_ENCRYPTION_KEY: btoa('k'.repeat(32)),
    ASSETS: { fetch: async () => assets() },
    OTLP_ENDPOINT: 'https://api.eu1.honeycomb.test/v1/traces',
    OTLP_HEADERS: 'x-honeycomb-team=hcaik_test',
    CF_VERSION_METADATA: { id: 'version-1' },
    ...env,
  } satisfies Env
  const cache: ShareCache = { match: async () => undefined, put: async () => {} }
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) }
  const send = async (path: string, headers: Record<string, string> = {}, cf?: object) => {
    const request = new Request(`${ORIGIN}${path}`, { headers })
    if (cf) Object.defineProperty(request, 'cf', { value: cf })
    const response = await handleRequest(request, full, ctx, cache, undefined, undefined, deps)
    await Promise.all(pending)
    return response
  }
  return { send, sent }
}

const theSpan = (batch: Record<string, any>) => batch.resourceSpans[0].scopeSpans[0].spans[0]
const attributes = (span: Record<string, any>) =>
  Object.fromEntries(
    span.attributes.map((a: any) => [
      a.key,
      a.value.stringValue ?? a.value.intValue ?? a.value.boolValue,
    ])
  )

test('a call with the page’s trace context gets a span that is a child of the page’s span', async () => {
  const { send, sent } = setup()
  await send('/api/config', { traceparent: TRACEPARENT })
  assert.equal(sent.length, 1)
  const span = theSpan(sent[0])
  assert.equal(span.traceId, TRACE)
  assert.equal(span.parentSpanId, PARENT)
  assert.match(span.spanId, /^[0-9a-f]{16}$/)
  assert.notEqual(span.spanId, PARENT)
  assert.equal(span.name, 'chordless.worker.handle')
  assert.equal(span.kind, 2)
  assert.deepEqual(span.status, { code: 0 })
  assert.ok(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano))
  const resource = sent[0].resourceSpans[0].resource.attributes
  assert.deepEqual(resource[0], { key: 'service.name', value: { stringValue: 'chordless-worker' } })
  assert.deepEqual(resource[1], { key: 'service.version', value: { stringValue: 'version-1' } })
})

test('it records the route, the status, the ray and what the runtime knows of where it came from', async () => {
  const { send, sent } = setup(
    {},
    () => new Response('page', { headers: { 'Content-Length': '4' } })
  )
  await send(
    '/files/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    {
      traceparent: TRACEPARENT,
      'cf-ray': 'a51c89e75a0635ca-LHR',
      'user-agent': 'Browser/1',
      'Content-Length': '12',
    },
    {
      colo: 'LHR',
      asn: 20712,
      country: 'GB',
      continent: 'EU',
      regionCode: 'ENG',
      city: 'Bracknell',
      timezone: 'Europe/London',
      httpProtocol: 'HTTP/2',
    }
  )
  assert.deepEqual(attributes(theSpan(sent[0])), {
    'http.request.method': 'GET',
    'http.route': '/files/:id',
    'url.path': '/files/3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    'url.scheme': 'https',
    'http.request.body.size': 12,
    'http.response.status_code': 200,
    'http.response.body.size': 4,
    'server.address': 'chordless.test',
    'server.port': 443,
    'network.protocol.name': 'http',
    'network.protocol.version': '2',
    'user_agent.original': 'Browser/1',
    'cloudflare.ray_id': 'a51c89e75a0635ca',
    'cloudflare.colo': 'LHR',
    'cloudflare.asn': 20712,
    'geo.country.iso_code': 'GB',
    'geo.continent.code': 'EU',
    'geo.region.iso_code': 'ENG',
    'geo.locality.name': 'Bracknell',
    'chordless.geo.timezone': 'Europe/London',
    'cloudflare.script_version.id': 'version-1',
    'chordless.outcome': 'ok',
  })
})

test('a request that fails is an error on the span, and still fails the same way', async () => {
  const { send, sent } = setup({}, () => {
    throw new Error('boom')
  })
  // (it is thrown on to the runtime, as it was)
  await assert.rejects(send('/somewhere', { traceparent: TRACEPARENT }), /boom/)
  const span = theSpan(sent[0])
  assert.deepEqual(span.status, { code: 2 })
  assert.equal(attributes(span)['chordless.outcome'], 'error')
})

test('no span without trace context, with an unsampled or broken one, or with nowhere to send it', async () => {
  const { send, sent } = setup()
  await send('/api/config')
  await send('/api/config', { traceparent: `00-${TRACE}-${PARENT}-00` })
  await send('/api/config', { traceparent: 'garbage' })
  await send('/api/config', { traceparent: `ff-${TRACE}-${PARENT}-01` })
  await send('/api/config', { traceparent: `00-${'0'.repeat(32)}-${PARENT}-01` })
  assert.equal(sent.length, 0)

  const dropped = setup({ OTLP_HEADERS: undefined })
  const response = await dropped.send('/api/config', { traceparent: TRACEPARENT })
  assert.equal(response.status, 200)
  assert.equal(dropped.sent.length, 0)
})

test('a sender over the limit gets its answer and no span', async () => {
  const { send, sent } = setup({ TELEMETRY: { limit: async () => ({ success: false }) } })
  const response = await send('/api/config', { traceparent: TRACEPARENT })
  assert.equal(response.status, 200)
  assert.equal(sent.length, 0)
})

test('the route is the path with its ids replaced', () => {
  assert.equal(routeOf('/session/refresh'), '/session/refresh')
  assert.equal(
    routeOf('/api/spaces/3f2504e0-4f89-41d3-9a0c-0305e82c3301/files'),
    '/api/spaces/:id/files'
  )
  assert.equal(routeOf('/s/1aeCBhjc6e_wrRmSmlBhPaKDzMvYdZFXA'), '/s/:id')
})

/** Run `run` as a traced request, and what was sent for it: the spans of the one batch, by name */
async function traceCalls(run: () => Promise<unknown>, env: Partial<Env> = {}) {
  const { sent, ...rest } = setup(env)
  const full = {
    OTLP_ENDPOINT: 'https://api.eu1.honeycomb.test/v1/traces',
    OTLP_HEADERS: 'x-honeycomb-team=hcaik_test',
    ...env,
  } as Env
  const pending: Promise<unknown>[] = []
  const deps: TelemetryDeps = {
    async fetch(_url, init) {
      sent.push(JSON.parse(String(init.body)))
      return new Response('{}')
    },
  }
  const request = new Request(`${ORIGIN}/api/config`, { headers: { traceparent: TRACEPARENT } })
  let thrown: unknown
  try {
    await withWorkerSpan(
      request,
      full,
      { waitUntil: p => void pending.push(p) },
      deps,
      async () => {
        await run()
        return new Response('ok')
      }
    )
  } catch (error) {
    thrown = error
  }
  await Promise.all(pending)
  const spans: Record<string, any>[] = sent.flatMap(
    batch => batch.resourceSpans[0].scopeSpans[0].spans
  )
  void rest
  return { spans, batches: sent.length, thrown }
}

test('a call made while a request is traced is a span below ours, with no query and no body read', async () => {
  let bodyRead = false
  const body = new ReadableStream(
    {
      pull(controller) {
        bodyRead = true
        controller.close()
      },
    },
    { highWaterMark: 0 }
  )
  const { spans, batches } = await traceCalls(async () => {
    const fetcher = tracedFetch(async () => new Response(body, { status: 200 }))
    await fetcher('https://www.googleapis.com/drive/v3/files/abc?access_token=secret', {
      method: 'get',
    })
  })
  assert.equal(batches, 1)
  const [call, handle] = [
    spans.find(s => s.name === 'chordless.worker.fetch'),
    spans.find(s => s.name === 'chordless.worker.handle'),
  ]
  assert.equal(call?.parentSpanId, handle?.spanId)
  assert.equal(call?.traceId, TRACE)
  assert.equal(call?.kind, 3)
  assert.deepEqual(attributes(call as Record<string, any>), {
    'http.request.method': 'GET',
    'url.scheme': 'https',
    'server.address': 'www.googleapis.com',
    'server.port': 443,
    'url.path': '/drive/v3/files/abc',
    'http.response.status_code': 200,
  })
  assert.equal(bodyRead, false)
})

test('a call is an error when it is refused or does not answer, and a 404 is not', async () => {
  const { spans } = await traceCalls(async () => {
    await tracedFetch(async () => new Response('', { status: 404 }))(new URL('https://x.test/a'))
    await tracedFetch(async () => new Response('', { status: 503 }))(
      new Request('https://x.test/b', { method: 'post' })
    )
    await assert.rejects(
      tracedFetch(async () => {
        throw new Error('no route')
      })('https://x.test/c'),
      /no route/
    )
    // (what is thrown need not be an Error)
    await assert.rejects(
      tracedFetch(async () => {
        throw 'refused'
      })('https://x.test/d')
    )
  })
  const calls = spans.filter(s => s.name === 'chordless.worker.fetch')
  assert.deepEqual(
    calls.map(s => s.status.code),
    [0, 2, 2, 2]
  )
  assert.equal(attributes(calls[1])['http.request.method'], 'POST')
  assert.deepEqual(
    calls.map(s => attributes(s)['error.type']),
    [undefined, '503', 'Error', '_OTHER']
  )
  assert.equal(calls[2].events[0].name, 'exception')
})

test('a Durable Object’s calls are spans below ours, answered or refused', async () => {
  const stub = {
    label: 'room',
    async info() {
      return 'info'
    },
    sync() {
      return 'now'
    },
    async refuse() {
      throw new Error('closed')
    },
    explode() {
      throw new Error('boom')
    },
  }
  const { spans } = await traceCalls(async () => {
    const room = tracedStub(stub, 'TeamSpace')
    assert.equal(room.label, 'room')
    assert.equal(await room.info(), 'info')
    assert.equal(room.sync(), 'now')
    await assert.rejects(room.refuse(), /closed/)
    assert.throws(() => room.explode(), /boom/)
    // (awaiting the stub itself is not a call)
    assert.equal(await (async () => room)(), room)
  })
  const calls = spans.filter(s => s.name === 'chordless.worker.do')
  assert.deepEqual(
    calls.map(s => attributes(s)['rpc.method']),
    ['info', 'sync', 'refuse', 'explode']
  )
  assert.equal(attributes(calls[0])['chordless.do.class'], 'TeamSpace')
  assert.deepEqual(
    calls.map(s => s.status.code),
    [0, 0, 2, 2]
  )
})

test('no call is a span outside a traced request, and at most fifty are inside one', async () => {
  assert.equal(
    await tracedFetch(async () => new Response('plain'))('https://x.test/').then(r => r.text()),
    'plain'
  )
  assert.equal(tracedStub({ ping: () => 'pong' }, 'Room').ping(), 'pong')

  const { spans } = await traceCalls(async () => {
    const fetcher = tracedFetch(async () => new Response(''))
    for (let i = 0; i < 60; i++) await fetcher('https://x.test/')
  })
  assert.equal(spans.filter(s => s.name === 'chordless.worker.fetch').length, 50)
})

test('the calls of two requests at once are each below their own', async () => {
  const { spans } = await traceCalls(async () => {
    const fetcher = tracedFetch(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return new Response('')
    })
    await Promise.all([fetcher('https://x.test/1'), fetcher('https://x.test/2')])
  })
  const handle = spans.find(s => s.name === 'chordless.worker.handle')
  const calls = spans.filter(s => s.name === 'chordless.worker.fetch')
  assert.equal(calls.length, 2)
  for (const call of calls) assert.equal(call.parentSpanId, handle?.spanId)
})

test('the sizes of what is sent and what comes back are kept when they are known', async () => {
  const { spans } = await traceCalls(async () => {
    const answer = () => new Response('x'.repeat(7), { headers: { 'Content-Length': '7' } })
    const fetcher = tracedFetch(async () => answer())
    await fetcher('http://x.test:8080/a', { method: 'POST', body: 'héllo' })
    await fetcher('https://x.test/b', { method: 'PUT', body: new Uint8Array(3) })
    await fetcher('https://x.test/c', { method: 'PUT', body: new ArrayBuffer(5) })
    await fetcher('https://x.test/d', { method: 'PUT', body: new Blob(['abcd']) })
    await fetcher('https://x.test/e', { headers: { 'Content-Length': '9' } })
    await fetcher(new Request('https://x.test/f', { headers: { 'Content-Length': '11' } }))
    // (a stream, or a header that is no number, has no size: nothing is read to find out)
    await fetcher('https://x.test/g', { method: 'POST', body: new URLSearchParams({ a: '1' }) })
    await tracedFetch(async () => new Response('', { headers: { 'Content-Length': 'many' } }))(
      'https://x.test/h'
    )
  })
  const calls = spans.filter(s => s.name === 'chordless.worker.fetch')
  assert.deepEqual(
    calls.map(s => attributes(s)['http.request.body.size']),
    [6, 3, 5, 4, 9, 11, undefined, undefined]
  )
  assert.deepEqual(
    calls.map(s => attributes(s)['http.response.body.size']),
    [7, 7, 7, 7, 7, 7, 7, undefined]
  )
  assert.equal(attributes(calls[0])['server.port'], 8080)
  assert.equal(attributes(calls[0])['url.scheme'], 'http')
})

test('a request that fails, or ends in a server error, says what kind', async () => {
  const failing = setup({}, () => new Response('', { status: 502 }))
  await failing.send('/somewhere', { traceparent: TRACEPARENT })
  assert.equal(attributes(theSpan(failing.sent[0]))['error.type'], '502')

  const thrown = setup({}, () => {
    throw new TypeError('boom')
  })
  await assert.rejects(thrown.send('/somewhere', { traceparent: TRACEPARENT }))
  assert.equal(attributes(theSpan(thrown.sent[0]))['error.type'], 'TypeError')
})

test('the port is the scheme’s when the address names none', async () => {
  const { spans } = await traceCalls(async () => {
    await tracedFetch(async () => new Response(''))('http://x.test/plain')
  })
  const call = spans.find(s => s.name === 'chordless.worker.fetch')
  assert.equal(attributes(call as Record<string, any>)['server.port'], 80)
})
