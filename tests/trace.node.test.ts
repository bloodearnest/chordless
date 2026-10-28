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
import { routeOf } from '../worker/src/trace.ts'

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
  const { send, sent } = setup()
  await send(
    '/api/config',
    { traceparent: TRACEPARENT, 'cf-ray': 'a51c89e75a0635ca-LHR', 'user-agent': 'Browser/1' },
    {
      colo: 'LHR',
      asn: 20712,
      country: 'GB',
      continent: 'EU',
      region: 'England',
      city: 'Bracknell',
      timezone: 'Europe/London',
    }
  )
  assert.deepEqual(attributes(theSpan(sent[0])), {
    'http.request.method': 'GET',
    'http.route': '/api/config',
    'http.response.status_code': 200,
    'server.address': 'chordless.test',
    'user_agent.original': 'Browser/1',
    'cloudflare.ray_id': 'a51c89e75a0635ca',
    'cloudflare.colo': 'LHR',
    'cloudflare.asn': 20712,
    'geo.country.code': 'GB',
    'geo.continent.code': 'EU',
    'geo.locality.region': 'England',
    'geo.locality.name': 'Bracknell',
    'geo.timezone': 'Europe/London',
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
