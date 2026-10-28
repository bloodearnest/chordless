/**
 * The page's traces on their way to Honeycomb (worker/src/telemetry.ts), with upstream and the rate
 * limit replaced: who is let in, that the body is rebuilt from what we allow (never a title or a
 * lyric), what is forwarded and with which key, and that upstream trouble stays out of the answer.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handleRequest } from '../worker/src/router.ts'
import type { ShareCache } from '../worker/src/share.ts'
import {
  parseHeaders,
  redact,
  TELEMETRY_PATH,
  type TelemetryDeps,
  withoutEmails,
} from '../worker/src/telemetry.ts'

const ORIGIN = 'https://chordless.test'
const ENDPOINT = 'https://api.eu1.honeycomb.test/v1/traces'

const str = (key: string, value: string) => ({ key, value: { stringValue: value } })

const span = (overrides: Record<string, unknown> = {}) => ({
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  name: 'chordless.sync.run',
  kind: 1,
  startTimeUnixNano: '1793142294832999936',
  endTimeUnixNano: '1793142294912999936',
  attributes: [str('chordless.sync.operation', 'sync')],
  status: { code: 1 },
  ...overrides,
})

const batch = (
  spans: unknown[],
  resourceAttributes: unknown[] = [str('service.name', 'chordless-web')]
) => ({
  resourceSpans: [
    {
      resource: { attributes: resourceAttributes },
      scopeSpans: [{ scope: { name: 'chordless', version: '1' }, spans }],
    },
  ],
})

interface Forwarded {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

function setup(
  env: Partial<Env> = {},
  upstream: () => Promise<Response> = async () => new Response('{}')
) {
  const forwarded: Forwarded[] = []
  const pending: Promise<unknown>[] = []
  const deps: TelemetryDeps = {
    async fetch(url, init) {
      forwarded.push({
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)),
      })
      return upstream()
    },
  }
  const full = {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    JWE_ENCRYPTION_KEY: btoa('k'.repeat(32)),
    ASSETS: { fetch: async () => new Response('page') },
    OTLP_ENDPOINT: ENDPOINT,
    OTLP_HEADERS: 'x-honeycomb-team=hcaik_test',
    ...env,
  } satisfies Env
  const cache: ShareCache = { match: async () => undefined, put: async () => {} }
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) }
  const send = async ({ json, headers, ...rest }: RequestInit & { json?: unknown } = {}) => {
    const request = new Request(`${ORIGIN}${TELEMETRY_PATH}`, {
      method: 'POST',
      body: json === undefined ? undefined : JSON.stringify(json),
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(headers as Record<string, string>) },
    })
    const response = await handleRequest(request, full, ctx, cache, undefined, undefined, deps)
    await Promise.all(pending)
    return response
  }
  return { send, forwarded }
}

test('a batch from the page is answered 204 and passed on, with the key the page cannot hold', async () => {
  const { send, forwarded } = setup()
  const response = await send({ json: batch([span()]) })
  assert.equal(response.status, 204)
  assert.equal(forwarded.length, 1)
  assert.equal(forwarded[0].url, ENDPOINT)
  assert.equal(forwarded[0].headers.get('x-honeycomb-team'), 'hcaik_test')
  assert.equal(forwarded[0].headers.get('Content-Type'), 'application/json')
  const spans = (forwarded[0].body.resourceSpans as any)[0].scopeSpans[0].spans
  assert.equal(spans[0].name, 'chordless.sync.run')
  assert.deepEqual(spans[0].attributes, [str('chordless.sync.operation', 'sync')])
  assert.deepEqual(spans[0].status, { code: 1 })
})

test('lyrics and URLs go on to Honeycomb, which keeps them a while: an email address never does', () => {
  const clean = redact(
    batch(
      [
        span({
          name: 'chordless.share.open for ann@example.org',
          attributes: [
            str('chordless.song.lyrics', 'Amazing grace, how sweet the sound'),
            str('url.full', 'https://chordless.app/api/share/FILEID?from=bob%40example.com'),
            str('chordless.song.contact', 'write to leader.name+band@church.example.co.uk today'),
            str('chordless.song.ccli', '22025'),
          ],
          events: [{ name: 'sent to cat@example.com', timeUnixNano: '1793142294832999936' }],
        }),
      ],
      [str('service.name', 'chordless-web'), str('host.name', 'dan@laptop.example')]
    )
  ) as any
  const rebuilt = clean.resourceSpans[0].scopeSpans[0].spans[0]
  const values = Object.fromEntries(
    rebuilt.attributes.map((a: any) => [a.key, a.value.stringValue])
  )
  assert.equal(values['chordless.song.lyrics'], 'Amazing grace, how sweet the sound')
  assert.equal(values['url.full'], 'https://chordless.app/api/share/FILEID?from=[email]')
  assert.equal(values['chordless.song.contact'], 'write to [email] today')
  assert.equal(values['chordless.song.ccli'], '22025')
  assert.equal(rebuilt.name, 'chordless.share.open for [email]')
  assert.equal(rebuilt.events[0].name, 'sent to [email]')
  const resource = clean.resourceSpans[0].resource.attributes
  assert.deepEqual(
    resource.map((a: any) => a.value.stringValue),
    ['chordless-web', '[email]']
  )
  assert.doesNotMatch(JSON.stringify(clean), /@|%40|example\.(org|com)/)
})

test('values are plain and bounded: a list, a map or a long text does not pass whole', () => {
  const clean = redact(
    batch([
      span({
        attributes: [
          {
            key: 'chordless.setlist.ccli',
            value: { arrayValue: { values: [{ stringValue: 'x' }] } },
          },
          { key: 'chordless.route', value: { kvlistValue: { values: [] } } },
          str('chordless.setlist.source', 'z'.repeat(5000)),
          { key: 'chordless.sync.pulled', value: { intValue: '12' } },
          { key: 'chordless.live', value: { boolValue: true } },
          { key: 'chordless.sync.pull_ms', value: { doubleValue: 1.5 } },
          { key: 'chordless.sync.push_ms', value: { intValue: 'not a number' } },
        ],
      }),
    ])
  ) as any
  const attributes = clean.resourceSpans[0].scopeSpans[0].spans[0].attributes
  assert.deepEqual(
    attributes.map((a: any) => a.key),
    [
      'chordless.setlist.source',
      'chordless.sync.pulled',
      'chordless.live',
      'chordless.sync.pull_ms',
    ]
  )
  assert.equal(attributes[0].value.stringValue.length, 2048)
})

test('an attribute name has to look like one: words and dots, not a sentence, an id or a flood', () => {
  const names = [
    'chordless.sync.pull_ms',
    'http.response.status_code',
    'SampleRate',
    'Not A Name',
    'Chordless.Upper',
    'chordless.',
    '.chordless',
    '',
    `chordless.${'a'.repeat(120)}`,
    'chordless.song-title',
    '9lives',
    'a b',
  ]
  const clean = redact(batch([span({ attributes: names.map(name => str(name, 'v')) })])) as any
  const kept = clean.resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a: any) => a.key)
  assert.deepEqual(kept, ['chordless.sync.pull_ms', 'http.response.status_code', 'SampleRate'])
})

test('email addresses are found in the forms they come in, and ordinary text is left alone', () => {
  assert.equal(withoutEmails('a@b.co'), '[email]')
  assert.equal(withoutEmails('x first.last+tag@sub.example.com y'), 'x [email] y')
  assert.equal(withoutEmails('?to=a%40b.com&n=1'), '?to=[email]&n=1')
  assert.equal(withoutEmails('two a@b.com and c@d.org'), 'two [email] and [email]')
  assert.equal(
    withoutEmails('Amazing grace @ 4pm, 100% sure, see example.com'),
    'Amazing grace @ 4pm, 100% sure, see example.com'
  )
  assert.equal(withoutEmails('https://chordless.app/s/abc#key'), 'https://chordless.app/s/abc#key')
})

test('an error keeps its type, message and status text, with emails blanked and a bound on the length', () => {
  const clean = redact(
    batch([
      span({
        status: { code: 2, message: 'Failed to load for ann@example.org' },
        events: [
          {
            name: 'exception',
            timeUnixNano: '1793142294832999936',
            attributes: [
              str('exception.type', 'TypeError'),
              str('exception.message', `m${'x'.repeat(3000)}`),
              str('exception.stacktrace', 'at song.ts:1 (bob@example.com)'),
            ],
          },
        ],
      }),
    ])
  ) as any
  const rebuilt = clean.resourceSpans[0].scopeSpans[0].spans[0]
  assert.deepEqual(rebuilt.status, { code: 2, message: 'Failed to load for [email]' })
  const [event] = rebuilt.events
  assert.deepEqual(
    event.attributes.map((a: any) => a.key),
    ['exception.type', 'exception.message', 'exception.stacktrace']
  )
  assert.equal(event.attributes[1].value.stringValue.length, 2048)
  assert.equal(event.attributes[2].value.stringValue, 'at song.ts:1 ([email])')
})

test('fields we do not know are not passed on, nor is a scope’s own data', () => {
  const clean = redact({
    extra: 'secret',
    resourceSpans: [
      {
        extra: 'secret',
        resource: { attributes: [], droppedAttributesCount: 3, extra: 'secret' },
        scopeSpans: [
          {
            scope: {
              name: 'n',
              version: 'v',
              attributes: [str('service.name', 'x')],
              extra: 'secret',
            },
            schemaUrl: 'secret',
            spans: [span({ extra: 'secret', traceState: 'secret' })],
          },
        ],
      },
    ],
  })
  assert.doesNotMatch(JSON.stringify(clean), /secret/)
  assert.deepEqual((clean as any).resourceSpans[0].scopeSpans[0].scope, { name: 'n', version: 'v' })
})

test('a span that is not one is dropped, and a batch with none is refused', async () => {
  const bad = [
    span({ traceId: 'short' }),
    span({ spanId: 'Z'.repeat(16) }),
    span({ startTimeUnixNano: 'soon' }),
    span({ name: 5 }),
    'a string',
    null,
  ]
  assert.equal(redact(batch(bad)), null)
  assert.equal(redact({ resourceSpans: 'no' }), null)
  assert.equal(redact('no'), null)
  const mixed = redact(batch([...bad, span()])) as any
  assert.equal(mixed.resourceSpans[0].scopeSpans[0].spans.length, 1)

  const { send, forwarded } = setup()
  const response = await send({ json: batch(bad) })
  assert.equal(response.status, 400)
  assert.equal(forwarded.length, 0)
})

test('there is a limit on the spans of one batch', () => {
  const clean = redact(batch(Array.from({ length: 600 }, () => span()))) as any
  assert.equal(clean.resourceSpans[0].scopeSpans[0].spans.length, 500)
})

test('without the headers (development, or not set up yet) a batch is taken and dropped', async () => {
  for (const env of [
    { OTLP_HEADERS: undefined },
    { OTLP_ENDPOINT: undefined },
    { OTLP_ENDPOINT: 'http://insecure.test' },
  ]) {
    const { send, forwarded } = setup(env)
    const response = await send({ json: batch([span()]) })
    assert.equal(response.status, 204)
    assert.equal(forwarded.length, 0)
  }
})

test('trouble upstream is not the page’s: a failure and an error answer are both 204', async () => {
  const error = console.error
  const logged: string[] = []
  console.error = (...args: unknown[]) => logged.push(args.join(' '))
  try {
    for (const upstream of [
      async () => {
        throw new Error('network down: Amazing Grace')
      },
      async () => new Response('no', { status: 401 }),
    ]) {
      const { send } = setup({}, upstream)
      assert.equal((await send({ json: batch([span()]) })).status, 204)
    }
    assert.equal(logged.length, 2)
    // (what was sent, and the text of an error, are never logged)
    assert.doesNotMatch(logged.join('\n'), /Amazing|sync|hcaik/)
  } finally {
    console.error = error
  }
})

test('only POST, only JSON, and not too much of it', async () => {
  const { send, forwarded } = setup()
  assert.equal((await send({ method: 'GET' })).status, 405)
  assert.equal(
    (await send({ headers: { 'Content-Type': 'text/plain' }, json: batch([span()]) })).status,
    415
  )
  assert.equal((await send({ method: 'POST', body: '{nope' })).status, 400)
  const huge = JSON.stringify(batch([span({ name: 'n'.repeat(300 * 1024) })]))
  assert.equal((await send({ body: huge })).status, 413)
  assert.equal(forwarded.length, 0)
})

test('the size limit holds when the sender says nothing of the size', async () => {
  const { send } = setup()
  const chunk = new TextEncoder().encode('x'.repeat(64 * 1024))
  let sent = 0
  const body = new ReadableStream({
    pull(controller) {
      if (sent++ < 8) controller.enqueue(chunk)
      else controller.close()
    },
  })
  const response = await send({ body, duplex: 'half' } as RequestInit)
  assert.equal(response.status, 413)
})

test('a page from another origin is refused before it is read', async () => {
  const { send, forwarded } = setup()
  const crossOrigin: Record<string, string>[] = [
    { Origin: 'https://evil.example' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]
  for (const headers of crossOrigin) {
    const response = await send({ headers, json: batch([span()]) })
    assert.equal(response.status, 403)
  }
  assert.equal(forwarded.length, 0)
})

test('a sender over its limit is told so, and one the limit cannot be asked about is let through', async () => {
  const keys: string[] = []
  const limited = setup({
    TELEMETRY: {
      async limit({ key }) {
        keys.push(key)
        return { success: false }
      },
    },
  })
  const response = await limited.send({
    headers: { 'CF-Connecting-IP': '203.0.113.9' },
    json: batch([span()]),
  })
  assert.equal(response.status, 429)
  assert.deepEqual(keys, ['203.0.113.9'])
  assert.equal(limited.forwarded.length, 0)

  const broken = setup({
    TELEMETRY: {
      async limit() {
        throw new Error('binding unavailable')
      },
    },
  })
  assert.equal((await broken.send({ json: batch([span()]) })).status, 204)
  assert.equal(broken.forwarded.length, 1)
})

test('the headers are read as OTEL_EXPORTER_OTLP_HEADERS has them', () => {
  const headers = parseHeaders('x-honeycomb-team=abc==, x-other = 1,,novalue,=nokey,bad name=1')
  assert.equal(headers.get('x-honeycomb-team'), 'abc==')
  assert.equal(headers.get('x-other'), '1')
  assert.equal([...headers.keys()].length, 2)
})

test('links and events are rebuilt too: ids checked, attributes by name, and a limit on how many of each are looked at', () => {
  const clean = redact(
    batch([
      span({
        parentSpanId: 'c'.repeat(16),
        kind: 99,
        links: [
          {
            traceId: 'd'.repeat(32),
            spanId: 'e'.repeat(16),
            attributes: [str('chordless.song.id', 's'), str('Not A Name', 'dropped')],
          },
          { traceId: 'short', spanId: 'e'.repeat(16) },
          null,
          ...Array.from({ length: 20 }, () => ({
            traceId: 'd'.repeat(32),
            spanId: 'e'.repeat(16),
          })),
        ],
        events: [
          null,
          { name: 5, timeUnixNano: '1' },
          { name: 'no time' },
          ...Array.from({ length: 30 }, () => ({
            name: 'tick',
            timeUnixNano: '1793142294832999936',
          })),
        ],
      }),
    ])
  ) as any
  const rebuilt = clean.resourceSpans[0].scopeSpans[0].spans[0]
  assert.equal(rebuilt.parentSpanId, 'c'.repeat(16))
  assert.equal('kind' in rebuilt, false)
  // (the limit is on the items looked at: 8 of them, two of which are not links)
  assert.equal(rebuilt.links.length, 6)
  assert.deepEqual(
    rebuilt.links[0].attributes.map((a: any) => a.key),
    ['chordless.song.id']
  )
  // (16 looked at, three of which are not events)
  assert.equal(rebuilt.events.length, 13)
  assert.doesNotMatch(JSON.stringify(clean), /dropped/)
})

test('a batch of the wrong shape inside is cleaned down to what is a span', () => {
  const clean = redact({
    resourceSpans: [
      'no',
      { scopeSpans: 'no' },
      { resource: 'no', scopeSpans: ['no', { spans: 'no' }, { scope: 'no', spans: [span()] }] },
      {
        scopeSpans: [
          { spans: [span({ attributes: 'no', events: 'no', links: 'no', status: 'no' })] },
        ],
      },
    ],
  }) as any
  assert.equal(clean.resourceSpans.length, 2)
  assert.deepEqual(clean.resourceSpans[0].resource, { attributes: [] })
  assert.deepEqual(clean.resourceSpans[0].scopeSpans[0].scope, {})
  const plain = clean.resourceSpans[1].scopeSpans[0].spans[0]
  assert.deepEqual([plain.attributes, plain.events, plain.links], [[], [], []])
  assert.equal('status' in plain, false)
})

test('an attribute that is not a pair, and more than the limit of them', () => {
  const many = Array.from({ length: 80 }, () => str('chordless.route', '/setlist'))
  const clean = redact(
    batch([
      span({
        attributes: [
          'no',
          { key: 'chordless.route' },
          { key: 'chordless.route', value: 'no' },
          ...many,
        ],
      }),
    ])
  ) as any
  assert.equal(clean.resourceSpans[0].scopeSpans[0].spans[0].attributes.length, 64)
})

test('the size is refused by what the sender says of it, and an empty body is not a batch', async () => {
  const { send, forwarded } = setup()
  const declared = await send({
    headers: { 'Content-Length': String(300 * 1024) },
    body: JSON.stringify(batch([span()])),
  })
  assert.equal(declared.status, 413)
  assert.equal((await send()).status, 400)
  assert.equal(forwarded.length, 0)
})

test('upstream is the network unless the test says otherwise, and anything thrown is logged by kind only', async () => {
  const real = globalThis.fetch
  const error = console.error
  const logged: string[] = []
  console.error = (...args: unknown[]) => logged.push(args.join(' '))
  const urls: string[] = []
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url))
    throw 'a plain string, not an Error'
  }) as typeof fetch
  try {
    const pending: Promise<unknown>[] = []
    const response = await handleRequest(
      new Request(`${ORIGIN}${TELEMETRY_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch([span()])),
      }),
      {
        GOOGLE_CLIENT_ID: 'c',
        GOOGLE_CLIENT_SECRET: 's',
        JWE_ENCRYPTION_KEY: btoa('k'.repeat(32)),
        ASSETS: { fetch: async () => new Response('page') },
        OTLP_ENDPOINT: ENDPOINT,
        OTLP_HEADERS: 'x-honeycomb-team=hcaik_test',
      },
      { waitUntil: promise => void pending.push(promise) },
      { match: async () => undefined, put: async () => {} }
    )
    await Promise.all(pending)
    assert.equal(response.status, 204)
    assert.deepEqual(urls, [ENDPOINT])
    assert.deepEqual(logged, ['[telemetry] upstream failed: error'])
  } finally {
    globalThis.fetch = real
    console.error = error
  }
})
