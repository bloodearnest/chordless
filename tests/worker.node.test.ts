/**
 * The whole Cloudflare Worker, running in workerd as it is deployed (wrangler.toml), through
 * Wrangler's test harness: static files, the SPA fallback, that the routes are wired up and the
 * dev pages are hidden, and the email handler. The logic of the routes is tested in Node on its own
 * (worker-router.node.test.ts, worker-session.node.test.ts), so this checks the wiring.
 *
 * The secrets are made up here (shaped as real ones are), so no .dev.vars is needed.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createTestHarness } from 'wrangler'
import type { Env } from '../worker/src/env.ts'
import type { TeamSpaceApi } from '../worker/src/team-state.ts'
import { email } from './make-email.ts'

const secrets = {
  // (shaped as the real ones are: the Worker checks them as it starts, worker/src/config.ts)
  GOOGLE_CLIENT_ID: '123456789-testclient.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-test-client-secret',
  GOOGLE_API_KEY: `AIza${'x'.repeat(35)}`,
  JWE_ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
}

const worker = createTestHarness({ workers: [{ configPath: 'wrangler.toml', secrets }] })

before(async () => {
  await worker.listen()
})

after(async () => {
  await worker.close()
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

test('worker API: /api/space/<id> is the Worker’s, and asks who is asking first', async () => {
  // 401 for a request with no token: not the SPA fallback's HTML, and no Durable Object touched
  const resp = await worker.fetch('/api/space/space-aaaaaaaa/root')
  assert.equal(resp.status, 401)
  assert.ok(resp.headers.get('content-type')?.includes('application/json'))
  assert.equal(resp.headers.get('cache-control'), 'no-store')
})

test('worker API: /api/spaces and /api/spaces/join are the Worker’s, and want a sign-in', async () => {
  for (const path of ['/api/spaces', '/api/spaces/join']) {
    const resp = await worker.fetch(path, { method: 'POST', body: '{}' })
    assert.equal(resp.status, 401, path)
    assert.ok(resp.headers.get('content-type')?.includes('application/json'), path)
  }
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
  const dev = createTestHarness({ workers: [{ configPath: 'wrangler.toml', env: 'dev', secrets }] })
  try {
    await dev.listen()
    const resp = await dev.fetch('/dev/components.html')
    assert.equal(resp.status, 200)
    assert.match(await resp.text(), /<title>Components Test - Chordless<\/title>/)
  } finally {
    await dev.close()
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

/** An email to the import address, with the Message-ID the runtime wants, as a real mail server gives */
const emailTo = (subject: string, list: string[]) =>
  worker.getWorker().email({
    from: 'sender@example.com',
    to: 'import@chordless.test',
    raw: new Response(
      Buffer.concat([Buffer.from('Message-ID: <test-1@example.com>\r\n'), email(subject, list)])
    ).body as ReadableStream<Uint8Array>,
  })

/** The readable (text/plain) part of a reply message */
function plainTextOf(raw: string) {
  const encoded = raw.match(
    /Content-Type: text\/plain[^\r\n]*\r\nContent-Transfer-Encoding: base64\r\n\r\n([^-]*)/
  )?.[1]
  assert.ok(encoded, raw)
  return Buffer.from(encoded.replace(/\s+/g, ''), 'base64').toString('utf8')
}

test('an email to the import address is answered in the real runtime, with a link, to the sender', async () => {
  const result = await emailTo('Sunday 25th October', ['1. Alpha Song in G'])

  assert.equal(result.outcome, 'ok')
  assert.equal(result.replies.length, 1)
  const reply = result.replies[0]
  assert.equal(reply.sender, 'import@chordless.test')
  assert.match(reply.raw, /^To: sender@example\.com\r?$/m)
  assert.match(reply.raw, /^Subject: Re: Sunday 25th October\r?$/m)
  assert.match(reply.raw, /^In-Reply-To: <test-1@example\.com>\r?$/m)

  // The readable version holds the setlist and the link to review it
  const text = plainTextOf(reply.raw)
  assert.match(text, /Alpha Song \(G\)/)
  assert.match(text, /https:\/\/chordless\.app\/import-setlist#\S+/)
})

test('an email with no songs in it is answered with why, and no link', async () => {
  const result = await emailTo('Hello', [])
  assert.equal(result.outcome, 'ok')
  assert.equal(result.replies.length, 1)
  assert.match(result.replies[0].raw, /^Subject: Re: Hello\r?$/m)
  assert.ok(!plainTextOf(result.replies[0].raw).includes('import-setlist#'))
})

// A team space's Durable Object (worker/src/team-space.ts), through its binding in the real runtime
describe('a team space Durable Object', () => {
  const ann = { provider: 'google', sub: 'g-1', email: 'ann@example.com' }
  const bob = { provider: 'google', sub: 'g-2', email: 'bob@example.com' }

  /** A space's object, through the binding */
  const inSpace = async <T>(name: string, use: (team: TeamSpaceApi) => Promise<T>) => {
    const env = await worker.getWorker<Env>().getEnv()
    assert.ok(env.TEAM_SPACE, 'wrangler.toml binds TEAM_SPACE')
    return use(env.TEAM_SPACE.get(env.TEAM_SPACE.idFromName(name)))
  }

  test('keeps a space, its members and its files, and serves them over the binding', async () => {
    await inSpace('team-a', async team => {
      assert.equal(await team.create({ rootRef: 'root-a', name: 'Pat Church', owner: ann }), true)
      await team.setMember(bob, 'writer')
      await team.addRefs(['file-1'])

      assert.equal(await team.roleOf(ann), 'owner')
      assert.equal(await team.roleOf(bob), 'writer')
      assert.equal(await team.owns('file-1'), true)
      assert.deepEqual(await team.members(), [
        { email: 'ann@example.com', role: 'owner' },
        { email: 'bob@example.com', role: 'writer' },
      ])
    })
  })

  test('is one object per space: another id has nothing of the first', async () => {
    await inSpace('team-b', async team => {
      assert.equal(await team.info(), null)
      assert.equal(await team.roleOf(ann), null)
      assert.equal(await team.owns('file-1'), false)
    })
  })

  test('makes an invite that is used once, with the code never stored', async () => {
    await inSpace('team-a', async team => {
      const { code } = await team.createInvite('reader', 'new@example.com', ann)
      assert.match(code, /^[A-Za-z0-9_-]{22}$/)
      assert.equal((await team.invites()).length, 1)

      assert.equal(
        await team.redeemInvite(code, { ...bob, sub: 'g-9', email: 'new@example.com' }),
        'reader'
      )
      assert.equal(await team.redeemInvite(code, { ...bob, sub: 'g-10' }), null)
      assert.equal((await team.invites()).length, 0)
    })
  })

  test('persists a space that was made', async () => {
    const handle = worker.getWorker<Env>()
    const env = await handle.getEnv()
    assert.ok(env.TEAM_SPACE)
    const persisted = await handle.listDurableObjectIds('TEAM_SPACE')
    assert.ok(persisted.includes(String(env.TEAM_SPACE.idFromName('team-a'))))
  })
})
