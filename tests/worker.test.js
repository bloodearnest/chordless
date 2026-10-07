/**
 * Functional tests for the Cloudflare Worker.
 * Validates wrangler.toml config, static asset serving, SPA fallback,
 * and that API routes are wired up.
 *
 * Uses wrangler's unstable_dev to start a real worker process.
 */
import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { unstable_dev } from 'wrangler'

let worker

before(async () => {
  worker = await unstable_dev('worker/src/index.js', {
    config: 'wrangler.toml',
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true },
  })
})

after(async () => {
  await worker?.stop()
})

test('serves root as HTML', async () => {
  const resp = await worker.fetch('/')
  assert.equal(resp.status, 200)
  assert.ok(resp.headers.get('content-type')?.includes('text/html'), 'content-type should be text/html')
})

test('serves static CSS', async () => {
  const resp = await worker.fetch('/css/style.css')
  assert.equal(resp.status, 200)
  assert.ok(resp.headers.get('content-type')?.includes('text/css'))
})

test('serves static JS', async () => {
  const resp = await worker.fetch('/js/parser.js')
  assert.equal(resp.status, 200)
  assert.ok(resp.headers.get('content-type')?.includes('javascript'))
})

test('SPA fallback: unknown path returns HTML, not 404', async () => {
  // Validates not_found_handling = "single-page-application" in wrangler.toml
  const resp = await worker.fetch('/setlist/some-uuid')
  assert.equal(resp.status, 200)
  assert.ok(resp.headers.get('content-type')?.includes('text/html'))
})

test('worker API: /oauth/callback route exists', async () => {
  // Empty payload → 400 (missing fields), not 404 (unrouted)
  const resp = await worker.fetch('/oauth/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.notEqual(resp.status, 404, '/oauth/callback should be handled by the worker, not fall through to assets')
  assert.equal(resp.status, 400, `expected 400 for missing fields, got ${resp.status}`)
})

test('worker API: /session/refresh route exists', async () => {
  const resp = await worker.fetch('/session/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.notEqual(resp.status, 404)
  assert.equal(resp.status, 400, `expected 400 for missing fields, got ${resp.status}`)
})

test('worker source is not served as JavaScript', async () => {
  // If .assetsignore is working: ASSETS excludes the file, SPA fallback returns index.html (text/html)
  // If .assetsignore is broken: source code is served as application/javascript — leaks server logic
  const resp = await worker.fetch('/worker/src/index.js')
  const ct = resp.headers.get('content-type') ?? ''
  assert.ok(
    ct.includes('text/html'),
    `worker source should not be served — got content-type: ${ct} (check .assetsignore)`,
  )
})

test('CORS preflight returns correct headers', async () => {
  const resp = await worker.fetch('/oauth/callback', { method: 'OPTIONS' })
  assert.equal(resp.status, 200)
  assert.ok(resp.headers.get('access-control-allow-origin'), 'missing Access-Control-Allow-Origin')
  assert.ok(
    resp.headers.get('access-control-allow-methods')?.includes('POST'),
    'POST should be in allowed methods',
  )
})

test('sets/ personal data not served as raw files', async () => {
  // If .assetsignore is working: ASSETS excludes the dir, SPA fallback returns index.html
  // If .assetsignore is broken: setlist JSON files are publicly readable
  const resp = await worker.fetch('/sets/test.json')
  const ct = resp.headers.get('content-type') ?? ''
  assert.ok(
    ct.includes('text/html'),
    `sets/ should not be served as assets — got content-type: ${ct} (check .assetsignore)`,
  )
})

test('notes/ personal data not served as raw files', async () => {
  const resp = await worker.fetch('/notes/test.txt')
  const ct = resp.headers.get('content-type') ?? ''
  assert.ok(
    ct.includes('text/html'),
    `notes/ should not be served as assets — got content-type: ${ct} (check .assetsignore)`,
  )
})
