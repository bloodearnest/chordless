/**
 * Functional tests for the Cloudflare Worker.
 * Validates wrangler.toml config, static asset serving, SPA fallback,
 * and that API routes are wired up.
 *
 * Uses wrangler's unstable_dev to start a real worker process.
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import * as jose from 'jose'
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
  // Only public/ is served; anything outside it falls through to the SPA fallback (text/html)
  const resp = await worker.fetch('/worker/src/index.js')
  const ct = resp.headers.get('content-type') ?? ''
  assert.ok(
    ct.includes('text/html'),
    `worker source should not be served — got content-type: ${ct} (check [assets] directory)`
  )
})

test('CORS preflight returns correct headers', async () => {
  const resp = await worker.fetch('/oauth/callback', { method: 'OPTIONS' })
  assert.equal(resp.status, 200)
  assert.ok(resp.headers.get('access-control-allow-origin'), 'missing Access-Control-Allow-Origin')
  assert.ok(
    resp.headers.get('access-control-allow-methods')?.includes('POST'),
    'POST should be in allowed methods'
  )
})

test('sets/ personal data not served as raw files', async () => {
  const resp = await worker.fetch('/sets/test.json')
  const ct = resp.headers.get('content-type') ?? ''
  assert.ok(
    ct.includes('text/html'),
    `sets/ should not be served as assets — got content-type: ${ct} (check [assets] directory)`
  )
})

test('JWE blob round-trips: encrypt then decrypt returns original data', async () => {
  // Mirrors encryptBlob/decryptBlob in worker/src/index.js exactly.
  // Catches jose API breakage (e.g. CompactEncrypt constructor, header shape, decrypt return type).
  const keyData = globalThis.crypto.getRandomValues(new Uint8Array(32))
  const secret = await globalThis.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  const data = { userId: 'test@example.com', refreshToken: 'rt_abc123', kid: 'default' }

  const jwe = await new jose.CompactEncrypt(new TextEncoder().encode(JSON.stringify(data)))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', kid: data.kid })
    .encrypt(secret)

  const { plaintext } = await jose.compactDecrypt(jwe, secret)
  const decrypted = JSON.parse(new TextDecoder().decode(plaintext))

  assert.deepEqual(decrypted, data)
})

test('notes/ personal data not served as raw files', async () => {
  const resp = await worker.fetch('/notes/test.txt')
  const ct = resp.headers.get('content-type') ?? ''
  assert.ok(
    ct.includes('text/html'),
    `notes/ should not be served as assets — got content-type: ${ct} (check [assets] directory)`
  )
})

test('repo root files are not served', async () => {
  for (const path of ['/wrangler.toml', '/package.json', '/CLAUDE.md']) {
    const resp = await worker.fetch(path)
    const ct = resp.headers.get('content-type') ?? ''
    assert.ok(ct.includes('text/html'), `${path} should not be served — got content-type: ${ct}`)
  }
})

test('worker-only packages are not vendored into public/', async () => {
  for (const path of ['/vendor/jose/package.json', '/vendor/google-auth-library/package.json']) {
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
  const devWorker = await unstable_dev('worker/src/index.js', {
    config: 'wrangler.toml',
    env: 'dev',
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true },
  })
  try {
    const resp = await devWorker.fetch('/dev/components')
    assert.equal(resp.status, 200)
    assert.match(await resp.text(), /<title>Components Test - Chordless<\/title>/)
  } finally {
    await devWorker.stop()
  }
})
