/**
 * Joining a share's live room (worker/src/share-live.ts): who is told what, and that the secret a
 * sharer gives is passed on only as a hash. The room itself (share-room.ts) is tested in workerd.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { shareSecretFromProtocol } from '../worker/src/live-relay.ts'
import { handleRequest } from '../worker/src/router.ts'
import { handleShareLive, shareLiveId } from '../worker/src/share-live.ts'

const ID = '1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y'
const SECRET = 'aB3_dE5-gH7jK9mN1pQ3rS5tU7vW9xY1zA3bC5dE7fG'
const ORIGIN = 'https://chordless.test'

/** The rooms: a note of which were asked for and what was sent to them */
function rooms() {
  const asked: string[] = []
  const sent: Request[] = []
  const SHARE_ROOM: NonNullable<Env['SHARE_ROOM']> = {
    idFromName(name) {
      asked.push(name)
      return name
    },
    get: () => ({
      fetch: request => {
        sent.push(request)
        return new Response('socket')
      },
    }),
  }
  return { SHARE_ROOM, asked, sent }
}

const join = (protocol: string | null, extra: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/share/${ID}/live`, {
    headers: {
      Upgrade: 'websocket',
      ...(protocol === null ? {} : { 'Sec-WebSocket-Protocol': protocol }),
      ...extra,
    },
  })

const hashOfSecret = async () =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SECRET))).toString(
    'hex'
  )

describe('shareLiveId', () => {
  test('reads the id from the path, and nothing else', () => {
    assert.equal(shareLiveId(`/api/share/${ID}/live`), ID)
    assert.equal(shareLiveId(`/api/share/${ID}`), null)
    assert.equal(shareLiveId(`/api/share/${ID}/live/more`), null)
    assert.equal(shareLiveId('/api/share//live'), null)
  })
})

describe('shareSecretFromProtocol', () => {
  test('is ours alone for a listener, and ours then the secret for the sharer', () => {
    assert.deepEqual(shareSecretFromProtocol('chordless'), { secret: null })
    assert.deepEqual(shareSecretFromProtocol('chordless, abc'), { secret: 'abc' })
  })

  test('is none for anything else', () => {
    for (const header of [null, '', 'other', 'other, abc', 'chordless, abc, more']) {
      assert.equal(shareSecretFromProtocol(header), null, String(header))
    }
  })
})

describe('handleShareLive', () => {
  test('lets anyone with the link listen, with nothing to say who they are', async () => {
    const { SHARE_ROOM, asked, sent } = rooms()
    const answer = await handleShareLive(join('chordless'), ID, { SHARE_ROOM } as Env)
    assert.equal(await answer.text(), 'socket')
    assert.deepEqual(asked, [ID])
    assert.equal(sent[0].headers.get('X-Share-Publisher'), null)
    assert.equal(sent[0].headers.get('Upgrade'), 'websocket')
  })

  test('gives the room only the hash of the sharer’s secret', async () => {
    const { SHARE_ROOM, sent } = rooms()
    await handleShareLive(join(`chordless, ${SECRET}`), ID, { SHARE_ROOM } as Env)
    assert.equal(sent[0].headers.get('X-Share-Publisher'), await hashOfSecret())
    assert.equal(sent[0].headers.get('Sec-WebSocket-Protocol'), null, 'the secret goes no further')
    assert.ok(![...sent[0].headers.values()].some(value => value.includes(SECRET)))
  })

  test('does not let a page say it is the sharer by a header of its own', async () => {
    const { SHARE_ROOM, sent } = rooms()
    await handleShareLive(join('chordless', { 'X-Share-Publisher': 'whatever' }), ID, {
      SHARE_ROOM,
    } as Env)
    assert.equal(sent[0].headers.get('X-Share-Publisher'), null)
  })

  test('refuses what is not a request to join, before any room is made', async () => {
    const { SHARE_ROOM, asked } = rooms()
    const env = { SHARE_ROOM } as Env
    assert.equal((await handleShareLive(join('chordless'), 'bad', env)).status, 404)
    assert.equal((await handleShareLive(join(null), ID, env)).status, 400)
    assert.equal((await handleShareLive(join('other'), ID, env)).status, 400)
    assert.equal((await handleShareLive(join('chordless, short'), ID, env)).status, 400)
    assert.equal(
      (await handleShareLive(join('chordless, a b c d e f g h i j k l m'), ID, env)).status,
      400
    )
    const plain = new Request(`${ORIGIN}/api/share/${ID}/live`)
    assert.equal((await handleShareLive(plain, ID, env)).status, 426)
    assert.deepEqual(asked, [])
  })

  test('says so where there are no rooms', async () => {
    assert.equal((await handleShareLive(join('chordless'), ID, {} as Env)).status, 503)
  })
})

describe('through the router', () => {
  const env = (SHARE_ROOM: Env['SHARE_ROOM']) =>
    ({ ASSETS: { fetch: async () => new Response('assets') }, SHARE_ROOM }) as unknown as Env
  const cache = { match: async () => undefined, put: async () => {} }
  const call = (request: Request, withEnv: Env) =>
    handleRequest(request, withEnv, { waitUntil() {} }, cache)

  test('is the Worker’s, not the app shell’s', async () => {
    const { SHARE_ROOM } = rooms()
    const answer = await call(join('chordless'), env(SHARE_ROOM))
    assert.equal(await answer.text(), 'socket')
  })

  test('refuses a page of another origin', async () => {
    const { SHARE_ROOM, asked } = rooms()
    const answer = await call(
      join('chordless', { Origin: 'https://evil.example' }),
      env(SHARE_ROOM)
    )
    assert.equal(answer.status, 403)
    assert.deepEqual(asked, [])
  })
})
