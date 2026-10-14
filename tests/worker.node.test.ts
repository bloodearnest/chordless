/**
 * Functional tests for the Cloudflare Worker.
 * Validates wrangler.toml config, static asset serving, SPA fallback,
 * and that API routes are wired up.
 *
 * Uses wrangler's unstable_dev to start a real worker process.
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { unstable_dev } from 'wrangler'

let worker

before(async () => {
  worker = await unstable_dev('worker/src/index.ts', {
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
  assert.ok(
    resp.headers.get('content-type')?.includes('text/html'),
    'content-type should be text/html'
  )
})

test('serves static CSS', async () => {
  const resp = await worker.fetch('/css/style.css')
  assert.equal(resp.status, 200)
  assert.ok(resp.headers.get('content-type')?.includes('text/css'))
})

test('serves source files as files, not the app shell', async () => {
  // (The source is TypeScript, which Vite compiles: wrangler serves the directory as it is)
  const resp = await worker.fetch('/js/db.ts')
  assert.equal(resp.status, 200)
  assert.ok(!resp.headers.get('content-type')?.includes('text/html'))
  assert.ok((await resp.text()).includes('export'))
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
  assert.notEqual(
    resp.status,
    404,
    '/oauth/callback should be handled by the worker, not fall through to assets'
  )
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
  // Only src/ is served; anything outside it falls through to the SPA fallback (text/html)
  const resp = await worker.fetch('/worker/src/index.ts')
  const ct = resp.headers.get('content-type') ?? ''
  assert.ok(
    ct.includes('text/html'),
    `worker source should not be served — got content-type: ${ct} (check [assets] directory)`
  )
})

test('the API sends no CORS headers', async () => {
  const resp = await worker.fetch('/session/refresh', { method: 'POST', body: '{}' })
  assert.equal(resp.headers.get('access-control-allow-origin'), null)
})

test('the API refuses cross-origin requests', async () => {
  for (const headers of [
    { Origin: 'https://evil.example' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' },
  ]) {
    const resp = await worker.fetch('/oauth/callback', { method: 'POST', body: '{}', headers })
    assert.equal(resp.status, 403, JSON.stringify(headers))
  }
})

test('the API accepts same-origin requests', async () => {
  const resp = await worker.fetch('/oauth/callback', {
    method: 'POST',
    body: '{}',
    headers: { 'Sec-Fetch-Site': 'same-origin' },
  })
  assert.equal(resp.status, 400, 'reaches the handler (missing code)')
})

test('repo root files are not served', async () => {
  for (const path of ['/wrangler.toml', '/package.json', '/CLAUDE.md']) {
    const resp = await worker.fetch(path)
    const ct = resp.headers.get('content-type') ?? ''
    assert.ok(ct.includes('text/html'), `${path} should not be served — got content-type: ${ct}`)
  }
})

test('dev pages are not served without DEV_PAGES (production)', async () => {
  for (const path of ['/dev', '/dev/', '/dev/index.html', '/dev/components.html']) {
    const resp = await worker.fetch(path, { redirect: 'manual' })
    assert.equal(resp.status, 404, `${path} should be 404 in production, got ${resp.status}`)
  }
})

test('dev pages are served in the dev environment (npm run dev)', async () => {
  const devWorker = await unstable_dev('worker/src/index.ts', {
    config: 'wrangler.toml',
    env: 'dev',
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true },
  })
  try {
    const resp = await devWorker.fetch('/dev/components.html')
    assert.equal(resp.status, 200)
    assert.match(await resp.text(), /<title>Components Test - Chordless<\/title>/)
  } finally {
    await devWorker.stop()
  }
})

test('worker API: /api/share/ is handled by the worker, not the SPA fallback', async () => {
  // A malformed id is refused before Drive is asked: 404 from the worker, not the app shell
  const resp = await worker.fetch('/api/share/bad')
  assert.equal(resp.status, 404)
  assert.ok(!resp.headers.get('content-type')?.includes('text/html'))
})

test('a share link is the app with a preview, and not for indexing', async () => {
  const resp = await worker.fetch('/s/abcdefghijklmnop1234')
  assert.equal(resp.status, 200)
  assert.ok(resp.headers.get('content-type')?.includes('text/html'))
  assert.equal(resp.headers.get('x-robots-tag'), 'noindex, nofollow')
  const html = await resp.text()
  assert.ok(html.includes('property="og:title" content="A setlist shared with you"'))
  assert.ok(html.includes('id="view-outlet"'), 'it is still the app shell')
})
