/**
 * The Worker's routing (worker/src/router.ts), with the static assets and the cache replaced:
 * which paths belong to the API, the share links and the dev pages, which are refused, and that
 * a route that throws becomes a JSON 500 rather than a crash.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handleRequest } from '../worker/src/router.ts'
import type { ShareCache } from '../worker/src/share.ts'

const ORIGIN = 'https://chordless.test'

const HTML = '<!doctype html><html><head><title>Chordless</title></head><body></body></html>'

/** The Worker's bindings, with static assets that answer HTML */
function setupEnv(env: Partial<Env> = {}, assetRequests: string[] = []) {
  return {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    JWE_ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname
        assetRequests.push(`${request.method} ${path}`)
        return path.endsWith('.js')
          ? new Response('console.log(1)', { headers: { 'Content-Type': 'text/javascript' } })
          : new Response(HTML, {
              headers: { 'Content-Type': 'text/html', 'Content-Length': String(HTML.length) },
            })
      },
    },
    ...env,
  } satisfies Env
}

/** The static assets: records what was asked of them, and answers HTML (or a script, for .js) */
function setup(env: Partial<Env> = {}) {
  const assetRequests: string[] = []
  const full = setupEnv(env, assetRequests)
  const cache: ShareCache = { match: async () => undefined, put: async () => {} }
  const ctx = { waitUntil() {} }
  const send = (path: string, init: RequestInit = {}) =>
    handleRequest(new Request(`${ORIGIN}${path}`, init), full, ctx, cache)
  return { send, assetRequests }
}

const postJson = (body: string) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
})

const crossOrigin: Record<string, string>[] = [
  { Origin: 'https://evil.example' },
  { 'Sec-Fetch-Site': 'cross-site' },
  { 'Sec-Fetch-Site': 'same-site' },
]

test('the API is refused to a page from another origin, before it is routed', async () => {
  const { send, assetRequests } = setup()
  for (const path of [
    '/oauth/callback',
    '/session/refresh',
    '/session/logout',
    '/session/invite',
    '/api/share/abc',
    '/api/config',
  ]) {
    for (const headers of crossOrigin) {
      const response = await send(path, { ...postJson('{}'), headers })
      assert.equal(response.status, 403, `${path} ${JSON.stringify(headers)}`)
    }
  }
  assert.deepEqual(assetRequests, [])
})

test('the API answers the app itself, and tools that send neither header', async () => {
  const { send } = setup()
  const sameOrigin: Record<string, string>[] = [
    {},
    { Origin: ORIGIN },
    { 'Sec-Fetch-Site': 'same-origin' },
    { 'Sec-Fetch-Site': 'none' },
  ]
  for (const headers of sameOrigin) {
    const response = await send('/oauth/callback', { ...postJson('{}'), headers })
    assert.equal(response.status, 400, JSON.stringify(headers))
  }
})

test('the API sends no CORS headers', async () => {
  const response = await setup().send('/session/refresh', postJson('{}'))
  assert.equal(response.headers.get('access-control-allow-origin'), null)
})

test("each session route is the Worker's: an empty request is refused by its own handler", async () => {
  const { send, assetRequests } = setup()
  for (const path of [
    '/session/refresh',
    '/session/logout',
    '/session/invite',
    '/session/revoke',
  ]) {
    assert.equal((await send(path, postJson('{}'))).status, 400, path)
  }
  assert.deepEqual(assetRequests, [])
})

test('only POST reaches the auth routes: other methods fall through to the assets', async () => {
  const { send, assetRequests } = setup()
  await send('/oauth/callback')
  await send('/session/refresh', { method: 'PUT' })
  assert.deepEqual(assetRequests, ['GET /oauth/callback', 'PUT /session/refresh'])
})

test('a route that throws is a JSON 500 with the reason, not a crash', async () => {
  const error = console.error
  console.error = () => {}
  try {
    const response = await setup().send('/session/refresh', postJson('this is not json'))
    assert.equal(response.status, 500)
    assert.equal(response.headers.get('Content-Type'), 'application/json')
    const body = (await response.json()) as { error: string; message: string }
    assert.equal(body.error, 'Internal server error')
    assert.ok(body.message.length > 0)
  } finally {
    console.error = error
  }
})

test('the page is given the Picker key the server has, or null where there is none', async () => {
  const withKey = setup({ PICKER_API_KEY: 'picker-key' })
  const response = await withKey.send('/api/config')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { pickerApiKey: 'picker-key' })
  assert.deepEqual(withKey.assetRequests, [])

  assert.deepEqual(await (await setup().send('/api/config')).json(), { pickerApiKey: null })
})

test("a share download is the Worker's, not the assets", async () => {
  // (the key is not set in this environment, so the Worker says sharing is off: it was routed)
  const { send, assetRequests } = setup()
  const response = await send('/api/share/1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y')
  assert.equal(response.status, 503)
  assert.deepEqual(assetRequests, [])
})

test('a share link opened as a page is the app with a preview, kept out of search', async () => {
  const { send, assetRequests } = setup()
  const response = await send('/s/1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y')
  assert.equal(response.status, 200)
  assert.deepEqual(assetRequests, ['GET /s/1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y'])
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow')
  assert.equal(response.headers.get('Content-Length'), null, 'it is longer than the page was')
  const page = await response.text()
  assert.ok(page.includes('og:title'), 'preview tags were added')
  assert.ok(page.includes('<title>'), 'and it is still the page')
})

test('a file under a share link path is passed through as it is', async () => {
  const response = await setup().send('/s/app.js')
  assert.equal(response.headers.get('X-Robots-Tag'), null)
  assert.equal(await response.text(), 'console.log(1)')
})

test('a share link is only the app for GET', async () => {
  const { send, assetRequests } = setup()
  await send('/s/abc', { method: 'POST', body: 'x' })
  assert.deepEqual(assetRequests, ['POST /s/abc'])
})

test('the dev pages are there only when the environment turns them on', async () => {
  const off = setup()
  for (const path of ['/dev', '/dev/', '/dev/components.html']) {
    const response = await off.send(path)
    assert.equal(response.status, 404, path)
  }
  assert.deepEqual(off.assetRequests, [])

  const on = setup({ DEV_PAGES: '1' })
  assert.equal((await on.send('/dev/components.html')).status, 200)
  assert.deepEqual(on.assetRequests, ['GET /dev/components.html'])
})

test('the bare /dev is the index of the dev pages, when they are on', async () => {
  for (const path of ['/dev', '/dev/']) {
    const on = setup({ DEV_PAGES: '1' })
    assert.equal((await on.send(path)).status, 200)
    assert.deepEqual(on.assetRequests, ['GET /dev/index.html'])
  }
})

test('a path that only starts like /dev is an ordinary one', async () => {
  const { send, assetRequests } = setup()
  assert.equal((await send('/devices')).status, 200)
  assert.deepEqual(assetRequests, ['GET /devices'])
})

test('everything else is the static assets, whose answer is passed on as it is', async () => {
  const { send, assetRequests } = setup()
  const response = await send('/setlist/some-id')
  assert.equal(response.status, 200)
  assert.equal(await response.text(), HTML)
  assert.deepEqual(assetRequests, ['GET /setlist/some-id'])
})

test('a share download is cached in the background: the runtime is asked to wait for it', async () => {
  const waiting: Promise<unknown>[] = []
  const cached: string[] = []
  const cache: ShareCache = {
    match: async () => undefined,
    put: async request => void cached.push(new URL(request.url).pathname),
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch
  try {
    const env = { ...setupEnv(), GOOGLE_API_KEY: 'key' }
    const response = await handleRequest(
      new Request(`${ORIGIN}/api/share/1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y`),
      env,
      { waitUntil: promise => waiting.push(promise) },
      cache
    )
    assert.equal(response.status, 200)
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(waiting.length, 1)
  await Promise.all(waiting)
  assert.deepEqual(cached, ['/api/share/1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y'])
})
