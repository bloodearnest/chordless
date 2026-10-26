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
import type { Identity } from '../worker/src/identity.ts'
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

  // The live channel (worker/src/live-relay.ts): a device going live is a socket on the space's object
  describe('the live channel', () => {
    const cat = { provider: 'google', sub: 'g-3', email: 'cat@example.com' }
    const changed = '{"type":"changed"}'

    /** A space with ann as owner, cat as writer and bob as reader */
    const space = async (name: string) => {
      await inSpace(name, async team => {
        await team.create({ rootRef: `root-${name}`, name, owner: ann })
        await team.setMember(cat, 'writer')
        await team.setMember(bob, 'reader')
      })
      return name
    }

    /** A device going live in a space, as the Worker passes it on after settling who it is (team-live.ts) */
    const goLive = async (name: string, who: Identity) => {
      const env = await worker.getWorker<Env>().getEnv()
      assert.ok(env.TEAM_SPACE)
      const stub = env.TEAM_SPACE.get(env.TEAM_SPACE.idFromName(name))
      assert.ok(stub.fetch)
      const answer = (await stub.fetch(
        new Request('https://chordless.test/api/space/x/live', {
          headers: {
            Upgrade: 'websocket',
            'Sec-WebSocket-Protocol': 'chordless',
            'X-Live-Identity': JSON.stringify(who),
          },
        })
      )) as Response & { webSocket: (WebSocket & { accept(): void }) | null }
      assert.equal(answer.status, 101)
      assert.equal(answer.headers.get('Sec-WebSocket-Protocol'), 'chordless')
      const socket = answer.webSocket
      assert.ok(socket)
      socket.accept()
      const heard: string[] = []
      const closed: number[] = []
      socket.addEventListener('message', event => heard.push(String(event.data)))
      socket.addEventListener('close', event => closed.push(event.code))
      return { socket, heard, closed }
    }

    /** Let the messages in flight arrive */
    const settle = () => new Promise(resolve => setTimeout(resolve, 200))

    test('relays a writer’s "changed" to the other live devices, and not back', async () => {
      const name = await space('live-a')
      const writer = await goLive(name, cat)
      const reader = await goLive(name, bob)
      const owner = await goLive(name, ann)

      writer.socket.send(changed)
      await settle()

      assert.deepEqual(reader.heard, [changed])
      assert.deepEqual(owner.heard, [changed])
      assert.deepEqual(writer.heard, [])
    })

    test('answers a ping, from a reader too, and relays nothing of it', async () => {
      const name = await space('live-ping')
      const reader = await goLive(name, bob)
      const other = await goLive(name, cat)

      reader.socket.send('ping')
      await settle()

      assert.deepEqual(reader.heard, ['pong'])
      assert.deepEqual(reader.closed, [])
      assert.deepEqual(other.heard, [])
    })

    test('keeps spaces apart', async () => {
      const here = await goLive(await space('live-b'), cat)
      const there = await goLive(await space('live-c'), ann)

      here.socket.send(changed)
      await settle()

      assert.deepEqual(there.heard, [])
    })

    test('closes a reader that sends, and a message that is not the frame', async () => {
      const name = await space('live-d')
      const reader = await goLive(name, bob)
      const writer = await goLive(name, cat)
      const listener = await goLive(name, ann)

      reader.socket.send(changed)
      writer.socket.send('{"type":"changed","setlist":{"songs":[]}}')
      await settle()

      assert.deepEqual(reader.closed, [1008])
      assert.deepEqual(writer.closed, [1003])
      assert.deepEqual(listener.heard, [], 'nothing of either reached the others')
    })

    // (Two things stop them: their sockets are closed when their membership changes, and a frame is
    // checked against the role they have at that moment. This cannot tell which did: the test
    // harness does not tell the client of a close made outside a message, so it cannot be seen.)
    test('relays nothing from a member who was removed or demoted since they connected', async () => {
      const name = await space('live-e')
      const dan = { provider: 'google', sub: 'g-4', email: 'dan@example.com' }
      await inSpace(name, team => team.setMember(dan, 'writer'))
      const removed = await goLive(name, cat)
      const demoted = await goLive(name, dan)
      const listener = await goLive(name, ann)

      await inSpace(name, async team => {
        await team.removeMember(cat)
        await team.setMember(dan, 'reader')
      })
      removed.socket.send(changed)
      demoted.socket.send(changed)
      await settle()

      assert.deepEqual(listener.heard, [])
    })

    test('relays nothing once the space is destroyed', async () => {
      const name = await space('live-f')
      const writer = await goLive(name, cat)
      const listener = await goLive(name, ann)
      await inSpace(name, team => team.destroy())

      writer.socket.send(changed)
      await settle()

      assert.deepEqual(listener.heard, [])
    })
  })

  // A share's live room (worker/src/share-room.ts): no accounts, so who may send is a secret's hash
  describe('a share’s live room', () => {
    const changed = '{"type":"changed"}'

    /** A device joining a share's room, as the Worker passes it on (share-live.ts); `publisher` is the hash of the sharer's secret */
    const join = async (fileId: string, publisher?: string) => {
      const env = await worker.getWorker<Env>().getEnv()
      assert.ok(env.SHARE_ROOM)
      const answer = (await env.SHARE_ROOM.get(env.SHARE_ROOM.idFromName(fileId)).fetch(
        new Request(`https://chordless.test/api/share/${fileId}/live`, {
          headers: {
            Upgrade: 'websocket',
            'Sec-WebSocket-Protocol': 'chordless',
            ...(publisher ? { 'X-Share-Publisher': publisher } : {}),
          },
        })
      )) as Response & { webSocket: (WebSocket & { accept(): void }) | null }
      if (answer.status !== 101) return answer.status
      const socket = answer.webSocket
      assert.ok(socket)
      socket.accept()
      const heard: string[] = []
      const closed: number[] = []
      socket.addEventListener('message', event => heard.push(String(event.data)))
      socket.addEventListener('close', event => closed.push(event.code))
      return { socket, heard, closed }
    }
    /** Let the messages in flight arrive */
    const settle = () => new Promise(resolve => setTimeout(resolve, 200))
    const open = async (fileId: string, publisher?: string) => {
      const joined = await join(fileId, publisher)
      if (typeof joined === 'number') throw new Error(`refused ${joined}`)
      return joined
    }

    test('relays the sharer’s "changed" to those listening, and not back', async () => {
      const sharer = await open('share-aaaaaaaaaa', 'hash-1')
      const one = await open('share-aaaaaaaaaa')
      const two = await open('share-aaaaaaaaaa')

      sharer.socket.send(changed)
      await settle()

      assert.deepEqual(one.heard, [changed])
      assert.deepEqual(two.heard, [changed])
      assert.deepEqual(sharer.heard, [])
    })

    test('closes a listener that sends, and a sharer’s message that is not the frame', async () => {
      const sharer = await open('share-bbbbbbbbbb', 'hash-1')
      const listener = await open('share-bbbbbbbbbb')
      const other = await open('share-bbbbbbbbbb')

      listener.socket.send(changed)
      sharer.socket.send('{"type":"changed","setlist":{}}')
      await settle()

      assert.deepEqual(listener.closed, [1008])
      assert.deepEqual(sharer.closed, [1003])
      assert.deepEqual(other.heard, [])
    })

    test('takes the first secret as the sharer’s, and refuses another’s', async () => {
      await open('share-cccccccccc', 'hash-1')
      const squatter = await join('share-cccccccccc', 'hash-2')
      assert.equal(squatter, 403)

      // (the sharer’s other device, with the same secret, is let in)
      const again = await open('share-cccccccccc', 'hash-1')
      const listener = await open('share-cccccccccc')
      again.socket.send(changed)
      await settle()
      assert.deepEqual(listener.heard, [changed])
    })

    test('keeps rooms apart, one for each share', async () => {
      const here = await open('share-dddddddddd', 'hash-1')
      const there = await open('share-eeeeeeeeee')
      here.socket.send(changed)
      await settle()
      assert.deepEqual(there.heard, [])
      // (and a secret claimed in one room is nothing in another)
      assert.notEqual(typeof (await join('share-eeeeeeeeee', 'hash-9')), 'number')
    })

    test('answers a ping, from a listener too', async () => {
      const listener = await open('share-ffffffffff')
      listener.socket.send('ping')
      await settle()
      assert.deepEqual(listener.heard, ['pong'])
      assert.deepEqual(listener.closed, [])
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
