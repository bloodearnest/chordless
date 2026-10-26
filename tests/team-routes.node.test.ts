/**
 * The team space API as the Worker serves it (worker/src/router.ts, team-context.ts): a Google ID
 * token is checked first, then the member's role in the space's Durable Object, then the owner's
 * Drive. The Durable Object is its state over a Map, Drive is the in-memory one, and the ID tokens
 * are signed with a key made here that stands in for Google's.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as jose from 'jose'
import { encryptBlob } from '../worker/src/blob.ts'
import type { Env } from '../worker/src/env.ts'
import { googleProvider, type Identity } from '../worker/src/identity.ts'
import { handleRequest } from '../worker/src/router.ts'
import type { ShareCache } from '../worker/src/share.ts'
import { handleCreateSpace } from '../worker/src/team-admin.ts'
import { createAdminContext, createTeamContext, type TeamDeps } from '../worker/src/team-context.ts'
import { teamDrive } from '../worker/src/team-drive.ts'
import { TeamSpaceState } from '../worker/src/team-state.ts'
import { FakeDrive } from './fake-drive.ts'
import { MapStore } from './map-store.ts'

const ORIGIN = 'https://chordless.test'
const SPACE = 'space-aaaaaaaa'
const TOKEN = 'fake-drive-token'
const env0 = {
  GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  JWE_ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
}
const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true })
const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const keys = jose.createLocalJWKSet({ keys: [jwk] })

const ann: Identity = { provider: 'google', sub: 'g-ann', email: 'ann@example.com' }
const bob: Identity = { provider: 'google', sub: 'g-bob', email: 'bob@example.com' }
const cat: Identity = { provider: 'google', sub: 'g-cat', email: 'cat@example.com' }
const dan: Identity = { provider: 'google', sub: 'g-dan', email: 'dan@example.com' }
const eve: Identity = { provider: 'google', sub: 'g-eve', email: 'eve@example.com' }
const stranger: Identity = { provider: 'google', sub: 'g-fay', email: 'fay@example.com' }

/** A Google ID token for this person */
const idToken = ({ sub, email }: Identity) =>
  new jose.SignJWT({ email, email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com')
    .setAudience(env0.GOOGLE_CLIENT_ID)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)

/** The encrypted sign-in the page holds for this person */
const blobFor = (who: Identity) =>
  encryptBlob(
    {
      owner_email: who.email,
      owner_sub: who.sub,
      scopes: 'drive.file',
      refresh_token: 'refresh',
      created_at: '2026-10-21T00:00:00Z',
      blob_id: `blob-${crypto.randomUUID()}`,
      kid: 'default',
    },
    env0
  )

const input = (name: string) => ({ name, type: 'text/plain', props: {} })

/** The world: a Drive, one made team space with an owner, a writer and a reader, and the Worker */
async function world() {
  const drive = new FakeDrive()
  const viaFake = ((i: RequestInfo | URL, init?: RequestInit) =>
    drive.handle(i, init)) as typeof fetch
  const backend = teamDrive(async () => TOKEN, viaFake)
  const root = (await backend.ensureRoot('Team', SPACE)).ref

  /** The Durable Objects: one state per name, and a note of which names were asked for */
  const states = new Map<string, TeamSpaceState>()
  const asked: string[] = []
  /** The sockets asked of the objects (the Durable Object's own side of a live socket is tested in workerd) */
  const live: { space: string; request: Request }[] = []
  const teamSpaces = {
    idFromName(name: string) {
      asked.push(name)
      return name
    },
    get(id: unknown) {
      const name = String(id)
      const state = states.get(name) ?? new TeamSpaceState(new MapStore())
      states.set(name, state)
      return Object.assign(state, {
        fetch: async (request: Request) => {
          live.push({ space: name, request })
          return new Response('socket', { status: 200 })
        },
      })
    },
  }
  const room = teamSpaces.get(SPACE) as TeamSpaceState
  await room.create({ rootRef: root, name: 'Team', owner: ann })
  await room.setMember(bob, 'writer')
  await room.setMember(cat, 'reader')
  await room.setMember(dan, 'admin')
  await room.setOwnerBlob(await blobFor(ann))
  asked.length = 0

  const env = {
    ...env0,
    ASSETS: { fetch: async () => new Response('assets') },
    TEAM_SPACE: teamSpaces,
  } satisfies Env
  const deps: TeamDeps = {
    providers: [googleProvider(env0, keys)],
    google: {
      refreshAccessToken: (async () => ({ access_token: TOKEN, expires_in: 3600 })) as never,
    },
    fetch: viaFake,
  }
  const cache: ShareCache = { match: async () => undefined, put: async () => {} }
  const call = async (
    path: string,
    who: Identity | null | string,
    init: RequestInit = {},
    withEnv: Env = env,
    withDeps: TeamDeps | null = deps
  ) => {
    const headers = new Headers(init.headers)
    if (who) {
      headers.set('Authorization', `Bearer ${typeof who === 'string' ? who : await idToken(who)}`)
    }
    return handleRequest(
      new Request(path.startsWith('/') ? `${ORIGIN}${path}` : `${ORIGIN}/api/space/${path}`, {
        ...init,
        headers,
      }),
      withEnv,
      { waitUntil() {} },
      cache,
      undefined,
      withDeps ?? undefined
    )
  }
  /** What the owner's own sync makes, straight in Drive */
  const direct = async (name: string, body = `${name} text`) =>
    (await backend.space(root).create('songs', input(name), body)).file.ref
  return { drive, backend, root, room, env, deps, asked, call, direct, teamSpaces, states, live }
}

const json = async (response: Response) => (await response.json()) as Record<string, unknown>
const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const post = (body: unknown) => send('POST', body)

describe('the route', () => {
  test('says team spaces are not available where the Worker has no Durable Object binding', async () => {
    const { call, env } = await world()
    const { TEAM_SPACE: _, ...without } = env
    const answer = await call(`${SPACE}/root`, ann, {}, without)
    assert.equal(answer.status, 503)
  })

  test('does not make an object for an id that is not one', async () => {
    const { call, asked } = await world()
    for (const id of ['x', 'has space', 'a'.repeat(65), '..%2Fetc']) {
      assert.equal((await call(`${id}/root`, ann)).status, 404, id)
    }
    assert.deepEqual(asked, [])
  })

  test('refuses a cross-origin request', async () => {
    const { call } = await world()
    const answer = await call(`${SPACE}/root`, ann, { headers: { Origin: 'https://evil.example' } })
    assert.equal(answer.status, 403)
  })

  test('is kept by nothing on the way', async () => {
    const { call } = await world()
    assert.equal((await call(`${SPACE}/root`, ann)).headers.get('Cache-Control'), 'no-store')
  })
})

describe('who is asking', () => {
  test('is checked first: no token, or one that is not Google’s, is a 401 and touches no object', async () => {
    const { call, asked } = await world()
    assert.equal((await call(`${SPACE}/root`, null)).status, 401)
    assert.equal((await call(`${SPACE}/root`, 'garbage')).status, 401)
    assert.deepEqual(asked, [])
  })

  test('is answered with the real providers when none are given', async () => {
    const { call, env } = await world()
    const answer = await call(`${SPACE}/root`, null, {}, env, null)
    assert.equal(answer.status, 401)
  })

  test('a signed-in stranger and a space that is not there get the same 403', async () => {
    const { call } = await world()
    const stranger403 = await call(`${SPACE}/root`, stranger)
    const unknown403 = await call('space-bbbbbbbb/root', ann)
    assert.equal(stranger403.status, 403)
    assert.equal(unknown403.status, 403)
    assert.deepEqual(await json(stranger403), await json(unknown403))
  })
})

describe('what a role may do', () => {
  test('a reader reads: the root (which says it is not writable), the list and a file', async () => {
    const { call, direct } = await world()
    const ref = await direct('Amazing Grace')

    const root = await json(await call(`${SPACE}/root`, cat))
    assert.equal(root.name, 'Team')
    assert.equal(root.canWrite, false)

    const list = (await (await call(`${SPACE}/files?collection=songs`, cat)).json()) as unknown[]
    assert.equal(list.length, 1)
    assert.equal(await (await call(`${SPACE}/files/${ref}/text`, cat)).text(), 'Amazing Grace text')
  })

  test('a reader cannot write, and nothing is made in Drive', async () => {
    const { call, backend, root } = await world()
    const answer = await call(
      `${SPACE}/files?collection=songs`,
      cat,
      post({ input: input('Nope'), body: 'text' })
    )
    assert.equal(answer.status, 403)
    assert.deepEqual(await backend.space(root).list('songs'), [])
  })

  test('a writer writes, and the owner too: the file is in Drive, and noted as the space’s', async () => {
    const { call, backend, root, room } = await world()
    for (const who of [bob, ann]) {
      const made = await call(
        `${SPACE}/files?collection=songs`,
        who,
        post({ input: input(`By ${who.sub}`), body: 'text' })
      )
      assert.equal(made.status, 200)
      const ref = ((await json(made)).file as { ref: string }).ref
      assert.equal(await room.owns(ref), true)
    }
    assert.equal((await backend.space(root).list('songs')).length, 2)
  })

  test('a writer’s root says it is writable', async () => {
    const { call } = await world()
    assert.equal((await json(await call(`${SPACE}/root`, bob))).canWrite, true)
  })
})

describe('files the owner made straight in Drive', () => {
  test('are not readable by a member until they have listed the space, as a sync does', async () => {
    const { call, direct } = await world()
    const ref = await direct('Made by the owner')
    assert.equal((await call(`${SPACE}/files/${ref}/text`, cat)).status, 404)

    await call(`${SPACE}/files?collection=songs`, cat)
    assert.equal((await call(`${SPACE}/files/${ref}/text`, cat)).status, 200)
  })

  test('a batch read gets the listed ones, and null for one that was not', async () => {
    const { call, direct } = await world()
    const listed = await direct('Listed')
    await call(`${SPACE}/files?collection=songs`, cat)
    const later = await direct('Made after')

    const answer = await json(
      await call(`${SPACE}/read-many`, cat, post({ refs: [listed, later] }))
    )
    assert.deepEqual(answer.texts, ['Listed text', null])
  })
})

describe('the owner’s Drive credential', () => {
  test('a space with no blob says sharing is not set up, as a 409', async () => {
    const { call, room } = await world()
    await room.clearOwnerBlob()
    const answer = await call(`${SPACE}/files?collection=songs`, bob)
    assert.equal(answer.status, 409)
    assert.match(String((await json(answer)).error), /not set up/)
  })

  test('an owner whose sign-in Google no longer honours is told to reconnect, as a 409', async () => {
    const { call, deps, env } = await world()
    const refused: TeamDeps = {
      ...deps,
      google: {
        refreshAccessToken: (async () => {
          throw Object.assign(new Error('bad'), { error: 'invalid_grant' })
        }) as never,
      },
    }
    const answer = await call(`${SPACE}/files?collection=songs`, bob, {}, env, refused)
    assert.equal(answer.status, 409)
    assert.match(String((await json(answer)).error), /reconnect/)
  })

  test('a folder that has gone is a 404 for the root', async () => {
    const { call, drive } = await world()
    drive.files.clear()
    assert.equal((await call(`${SPACE}/root`, bob)).status, 404)
  })
})

describe('the context', () => {
  test('says there is no such space, and no root, for an id with no space', async () => {
    const { env, deps } = await world()
    assert.ok(env.TEAM_SPACE)
    const context = createTeamContext(env, env.TEAM_SPACE, deps)
    assert.equal(await context.space('space-cccccccc'), null)
    assert.equal(await context.root('space-cccccccc'), null)
    assert.equal(await context.owns('space-cccccccc', 'anything'), false)
  })
})

describe('making a space', () => {
  const make = async (w: Awaited<ReturnType<typeof world>>, who: Identity = eve, extra = {}) =>
    w.call(
      '/api/spaces',
      who,
      post({ blob: await blobFor(who), rootRef: w.root, name: 'Eve Church', ...extra })
    )

  test('is done by the folder’s owner with their sign-in; the space is theirs, and works at once', async () => {
    const w = await world()
    const made = await make(w, ann)
    assert.equal(made.status, 200)
    const { spaceId, role } = (await json(made)) as { spaceId: string; role: string }
    assert.equal(role, 'owner')
    assert.match(spaceId, /^[A-Za-z0-9_-]{8,64}$/)
    assert.notEqual(spaceId, SPACE)

    const root = await json(await w.call(`${spaceId}/root`, ann))
    assert.equal(root.name, 'Team')
    assert.equal(root.canWrite, true)
    assert.equal((await w.call(`${spaceId}/root`, bob)).status, 403)
  })

  test('needs a sign-in, and says what is wrong with the body', async () => {
    const w = await world()
    assert.equal((await w.call('/api/spaces', null, post({}))).status, 401)
    assert.equal((await w.call('/api/spaces', ann, post({ blob: 'x' }))).status, 400)
    assert.equal((await make(w, ann, { name: '  ' })).status, 400)
    assert.equal((await make(w, ann, { name: 'x'.repeat(201) })).status, 400)
    assert.equal((await w.call('/api/spaces', ann, send('POST', 'not an object'))).status, 400)
  })

  test('refuses a sign-in that is not ours, or not theirs, and makes nothing', async () => {
    const w = await world()
    const before = w.states.size
    const garbage = await w.call(
      '/api/spaces',
      eve,
      post({ blob: 'garbage', rootRef: w.root, name: 'x' })
    )
    assert.equal(garbage.status, 400)
    const theirs = await w.call(
      '/api/spaces',
      eve,
      post({ blob: await blobFor(ann), rootRef: w.root, name: 'x' })
    )
    assert.equal(theirs.status, 403)
    assert.equal(w.states.size, before)
  })

  test('refuses a folder that is not there, is in the bin, or cannot be written', async () => {
    const w = await world()
    assert.equal((await make(w, eve, { rootRef: 'no-such-folder' })).status, 400)
    w.drive.readOnly = true
    assert.equal((await make(w, eve)).status, 400)
  })

  test('says when the sign-in is no longer honoured by Google (409), or Drive fails (502)', async () => {
    const w = await world()
    const refused: TeamDeps = {
      ...w.deps,
      google: {
        refreshAccessToken: (async () => {
          throw Object.assign(new Error('bad'), { error: 'invalid_grant' })
        }) as never,
      },
    }
    const blob = await blobFor(eve)
    const body = post({ blob, rootRef: w.root, name: 'Eve Church' })
    const reconnect = await w.call('/api/spaces', eve, body, w.env, refused)
    assert.equal(reconnect.status, 409)
    assert.match(String((await json(reconnect)).error), /reconnect/)

    const down: TeamDeps = {
      ...w.deps,
      fetch: (async () => {
        throw new Error('Drive is down')
      }) as never,
    }
    assert.equal((await w.call('/api/spaces', eve, body, w.env, down)).status, 502)
  })

  test('does not make a space over one that exists, if an id were ever to repeat', async () => {
    const w = await world()
    assert.ok(w.env.TEAM_SPACE)
    const admin = createAdminContext(w.env, w.env.TEAM_SPACE, w.deps)
    const request = new Request(`${ORIGIN}/api/spaces`, {
      ...post({ blob: await blobFor(eve), rootRef: w.root, name: 'Eve Church' }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await idToken(eve)}`,
      },
    })
    const answer = await handleCreateSpace(request, { ...admin, newSpaceId: () => SPACE })
    assert.equal(answer.status, 409)
    assert.equal((await w.room.info())?.owner.sub, ann.sub, 'the space is still the first owner’s')
  })

  test('refuses other methods', async () => {
    const w = await world()
    assert.equal((await w.call('/api/spaces', ann)).status, 404)
    assert.equal((await w.call('/api/spaces/join', ann)).status, 404)
  })
})

describe('joining', () => {
  const invite = async (
    w: Awaited<ReturnType<typeof world>>,
    role: string,
    email: string,
    who = ann
  ) =>
    (await json(await w.call(`${SPACE}/invites`, who, post({ role, email })))) as {
      code: string
      expiresAt: string
    }
  const join = (
    w: Awaited<ReturnType<typeof world>>,
    who: Identity | null,
    code: string,
    id = SPACE
  ) => w.call('/api/spaces/join', who, post({ spaceId: id, code }))

  test('is done with an invite’s code, once: the new member has the role it was made with', async () => {
    const w = await world()
    const { code } = await invite(w, 'writer', stranger.email)

    const joined = await join(w, stranger, code)
    assert.deepEqual(await json(joined), { spaceId: SPACE, role: 'writer' })
    const made = await w.call(
      `${SPACE}/files?collection=songs`,
      stranger,
      post({ input: input('By the new member'), body: 'text' })
    )
    assert.equal(made.status, 200)

    assert.equal((await join(w, eve, code)).status, 404, 'a used code is just not good')
  })

  test('says only that an invite is not valid, whatever the reason', async () => {
    const w = await world()
    const { code } = await invite(w, 'reader', eve.email)
    await join(w, eve, code)
    const reasons = [
      await join(w, stranger, code),
      await join(w, stranger, 'made-up'),
      await join(w, stranger, code, 'space-zzzzzzzz'),
      await join(w, stranger, code, 'no'),
      await w.call('/api/spaces/join', stranger, post({ spaceId: 1, code: 2 })),
    ]
    for (const answer of reasons) assert.equal(answer.status, 404)
    const bodies = await Promise.all(reasons.map(json))
    assert.ok(bodies.every(body => body.error === 'This invite is not valid'))
  })

  test('is for the invited email only: another account is told so, and the code stays good', async () => {
    const w = await world()
    const { code } = await invite(w, 'writer', eve.email)

    const turnedAway = await join(w, stranger, code)
    assert.equal(turnedAway.status, 403)
    assert.match(String((await json(turnedAway)).error), /different Google account/)
    assert.equal((await w.call(`${SPACE}/root`, stranger)).status, 403, 'not a member')

    assert.deepEqual(await json(await join(w, eve, code)), { spaceId: SPACE, role: 'writer' })
  })

  test('needs a sign-in', async () => {
    const w = await world()
    const { code } = await invite(w, 'reader', eve.email)
    assert.equal((await join(w, null, code)).status, 401)
  })

  test('is not done twice by someone already in: they keep their role and the code stays good', async () => {
    const w = await world()
    const { code } = await invite(w, 'reader', eve.email)
    assert.deepEqual(await json(await join(w, bob, code)), { spaceId: SPACE, role: 'writer' })
    assert.equal((await join(w, eve, code)).status, 200)
  })
})

describe('invites', () => {
  test('are listed for an admin, without their codes, and revoked by id', async () => {
    const w = await world()
    const made = await json(
      await w.call(`${SPACE}/invites`, ann, post({ role: 'reader', email: 'Eve@Example.com' }))
    )
    const listed = (await (await w.call(`${SPACE}/invites`, dan)).json()) as {
      id: string
      email: string
    }[]
    assert.equal(listed.length, 1)
    assert.equal(listed[0].email, 'eve@example.com', 'who it is for, in lower case')
    assert.ok(!JSON.stringify(listed).includes(String(made.code)))

    const gone = await w.call(`${SPACE}/invites/${listed[0].id}`, dan, send('DELETE'))
    assert.equal(gone.status, 204)
    const again = await w.call(`${SPACE}/invites/${listed[0].id}`, dan, send('DELETE'))
    assert.equal(again.status, 404)
    assert.equal(
      (await w.call('/api/spaces/join', eve, post({ spaceId: SPACE, code: made.code }))).status,
      404
    )
  })

  test('are for admins: a writer or a reader can neither list nor make them', async () => {
    const w = await world()
    for (const who of [bob, cat]) {
      assert.equal((await w.call(`${SPACE}/invites`, who)).status, 403)
      assert.equal(
        (await w.call(`${SPACE}/invites`, who, post({ role: 'reader', email: 'e@example.com' })))
          .status,
        403
      )
      assert.equal((await w.call(`${SPACE}/invites/ab12`, who, send('DELETE'))).status, 403)
    }
  })

  test('are made for a role below the maker’s: an admin cannot make an admin, the owner can', async () => {
    const w = await world()
    const email = 'eve@example.com'
    const status = async (who: Identity, body: unknown) =>
      (await w.call(`${SPACE}/invites`, who, post(body))).status
    assert.equal(await status(dan, { role: 'writer', email }), 200)
    assert.equal(await status(dan, { role: 'admin', email }), 403)
    assert.equal(await status(ann, { role: 'admin', email }), 200)
    assert.equal(await status(ann, { role: 'owner', email }), 400)
    assert.equal(await status(ann, { email }), 400)
  })

  test('are made for an email address, and nothing else', async () => {
    const w = await world()
    const status = async (body: unknown) =>
      (await w.call(`${SPACE}/invites`, ann, post(body))).status
    assert.equal(await status({ role: 'reader' }), 400, 'not an open invite')
    assert.equal(await status({ role: 'reader', email: 'not an email' }), 400)
    assert.equal(await status({ role: 'reader', email: 7 }), 400)
    assert.equal(await status({ role: 'reader', email: `${'a'.repeat(250)}@example.com` }), 400)
  })
})

describe('looking after the people', () => {
  const members = async (w: Awaited<ReturnType<typeof world>>) =>
    (await (await w.call(`${SPACE}/members`, ann)).json()) as { email: string; role: string }[]

  test('the members are the space’s own list, with the owner first', async () => {
    const w = await world()
    assert.deepEqual(await members(w), [
      { email: 'ann@example.com', role: 'owner' },
      { email: 'bob@example.com', role: 'writer' },
      { email: 'cat@example.com', role: 'reader' },
      { email: 'dan@example.com', role: 'admin' },
    ])
  })

  test('an admin changes a writer’s or reader’s role, and the new role is what they can do', async () => {
    const w = await world()
    const write = () =>
      w.call(`${SPACE}/files?collection=songs`, cat, post({ input: input('x'), body: 't' }))
    assert.equal((await write()).status, 403)
    const changed = await w.call(
      `${SPACE}/members/cat%40example.com`,
      dan,
      send('PUT', { role: 'writer' })
    )
    assert.equal(changed.status, 204)
    assert.equal((await write()).status, 200)
  })

  test('an admin removes a reader, who is then a stranger', async () => {
    const w = await world()
    assert.equal(
      (await w.call(`${SPACE}/members/CAT@example.com`, dan, send('DELETE'))).status,
      204
    )
    assert.equal((await w.call(`${SPACE}/root`, cat)).status, 403)
  })

  test('only a higher role acts on a role: not an admin on an admin or the owner, not for a higher role', async () => {
    const w = await world()
    await w.room.setMember(eve, 'admin')
    const attempts: [string, Identity, string, unknown?][] = [
      ['eve%40example.com', dan, 'PUT', { role: 'reader' }],
      ['eve%40example.com', dan, 'DELETE'],
      ['ann%40example.com', dan, 'DELETE'],
      ['bob%40example.com', dan, 'PUT', { role: 'admin' }],
      ['ann%40example.com', ann, 'DELETE'],
    ]
    for (const [email, who, method, body] of attempts) {
      const answer = await w.call(`${SPACE}/members/${email}`, who, send(method, body))
      assert.equal(answer.status, 403, `${who.sub} ${method} ${email}`)
    }
    assert.equal(
      (await w.call(`${SPACE}/members/eve%40example.com`, ann, send('PUT', { role: 'reader' })))
        .status,
      204
    )
  })

  test('a member who is not there, or a role that is not one, is refused', async () => {
    const w = await world()
    assert.equal(
      (await w.call(`${SPACE}/members/nobody%40example.com`, dan, send('DELETE'))).status,
      404
    )
    assert.equal(
      (await w.call(`${SPACE}/members/bob%40example.com`, dan, send('PUT', { role: 'owner' })))
        .status,
      400
    )
  })

  test('a writer or reader cannot look after people', async () => {
    const w = await world()
    for (const who of [bob, cat]) {
      const answer = await w.call(`${SPACE}/members/cat%40example.com`, who, send('DELETE'))
      assert.equal(answer.status, 403)
    }
  })

  test('a member leaves; the owner cannot, they end sharing', async () => {
    const w = await world()
    assert.equal((await w.call(`${SPACE}/leave`, bob, send('POST'))).status, 204)
    assert.equal((await w.call(`${SPACE}/root`, bob)).status, 403)
    const owner = await w.call(`${SPACE}/leave`, ann, send('POST'))
    assert.equal(owner.status, 400)
    assert.equal((await w.call(`${SPACE}/root`, ann)).status, 200)
  })

  test('a stranger can do none of it, and a route that is not one is a 404', async () => {
    const w = await world()
    assert.equal((await w.call(`${SPACE}/invites`, stranger)).status, 403)
    assert.equal((await w.call(`${SPACE}/leave`, stranger, send('POST'))).status, 403)
    assert.equal((await w.call(`${SPACE}/invites`, null)).status, 401)
    assert.equal((await w.call(`${SPACE}/invites/zz`, ann, send('DELETE'))).status, 404)
    assert.equal((await w.call(`${SPACE}/members/bob%40example.com`, ann)).status, 404)
  })
})

describe('the owner’s own routes', () => {
  test('a new sign-in replaces the stored one, if it is theirs and sees the folder', async () => {
    const w = await world()
    const replaced = await w.call(
      `${SPACE}/credential`,
      ann,
      send('PUT', { blob: await blobFor(ann) })
    )
    assert.equal(replaced.status, 204)
    assert.equal((await w.call(`${SPACE}/files?collection=songs`, bob)).status, 200)

    const theirs = await w.call(
      `${SPACE}/credential`,
      ann,
      send('PUT', { blob: await blobFor(eve) })
    )
    assert.equal(theirs.status, 403)
    assert.equal((await w.call(`${SPACE}/credential`, ann, send('PUT', {}))).status, 400)
  })

  test('is for the owner only', async () => {
    const w = await world()
    const blob = await blobFor(dan)
    assert.equal((await w.call(`${SPACE}/credential`, dan, send('PUT', { blob }))).status, 403)
    assert.equal((await w.call(`${SPACE}/`, dan, send('DELETE'))).status, 403)
  })

  test('ending sharing forgets the space: no members, no sign-in, no files for anyone', async () => {
    const w = await world()
    assert.equal((await w.call(`${SPACE}/`, ann, send('DELETE'))).status, 204)
    for (const who of [ann, bob, dan]) {
      assert.equal((await w.call(`${SPACE}/root`, who)).status, 403)
    }
    assert.equal(await w.room.ownerBlob(), null)
  })
})

describe('the live route', () => {
  /** What a page sends: `new WebSocket(url, ['chordless', token])` */
  const upgrade = async (who: Identity, extra: Record<string, string> = {}) => ({
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': `chordless, ${await idToken(who)}`,
      ...extra,
    },
  })

  test('hands a member’s socket to the space’s object, and says who they are', async () => {
    const w = await world()
    const answer = await w.call(`${SPACE}/live`, null, await upgrade(bob))
    assert.equal(answer.status, 200, 'the object’s answer, as it is')
    assert.equal(await answer.text(), 'socket')
    const [{ space, request }] = w.live
    assert.equal(space, SPACE)
    assert.deepEqual(JSON.parse(request.headers.get('X-Live-Identity') ?? ''), bob)
    assert.equal(request.headers.get('Upgrade'), 'websocket')
    assert.equal(request.headers.get('Authorization'), null, 'the token goes no further')
  })

  test('lets a reader listen', async () => {
    const w = await world()
    assert.equal((await w.call(`${SPACE}/live`, null, await upgrade(cat))).status, 200)
  })

  test('does not let a page say who it is: the object has only what the Worker settled', async () => {
    const w = await world()
    await w.call(
      `${SPACE}/live`,
      null,
      await upgrade(cat, { 'X-Live-Identity': JSON.stringify(ann) })
    )
    assert.deepEqual(JSON.parse(w.live[0].request.headers.get('X-Live-Identity') ?? ''), cat)
  })

  test('asks who it is before any object is touched: no token, a bad one, or one in the wrong place', async () => {
    const w = await world()
    const attempts: Record<string, string>[] = [
      { Upgrade: 'websocket' },
      { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'chordless' },
      { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'chordless, not-a-token' },
      { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `other, ${await idToken(bob)}` },
      { Upgrade: 'websocket', Authorization: `Bearer ${await idToken(bob)}` },
    ]
    for (const headers of attempts) {
      const answer = await w.call(`${SPACE}/live`, null, { headers })
      assert.equal(answer.status, 401, JSON.stringify(Object.keys(headers)))
    }
    assert.deepEqual(w.asked, [])
    assert.deepEqual(w.live, [])
  })

  test('refuses a stranger', async () => {
    const w = await world()
    assert.equal((await w.call(`${SPACE}/live`, null, await upgrade(stranger))).status, 403)
    assert.deepEqual(w.live, [])
  })

  test('is not a page: a plain request is told it is a socket', async () => {
    const w = await world()
    assert.equal((await w.call(`${SPACE}/live`, bob)).status, 426)
  })

  test('refuses a page of another origin', async () => {
    const w = await world()
    const answer = await w.call(
      `${SPACE}/live`,
      null,
      await upgrade(bob, { Origin: 'https://evil.example' })
    )
    assert.equal(answer.status, 403)
    assert.deepEqual(w.live, [])
  })

  test('says so where the object cannot take a socket', async () => {
    const w = await world()
    const state = w.states.get(SPACE)
    assert.ok(state)
    delete (state as { fetch?: unknown }).fetch
    w.teamSpaces.get = id => w.states.get(String(id)) as never
    assert.equal((await w.call(`${SPACE}/live`, null, await upgrade(bob))).status, 503)
  })

  test('does not make an object for an id that is not a space’s', async () => {
    const w = await world()
    assert.equal((await w.call('x/live', null, await upgrade(bob))).status, 404)
    assert.deepEqual(w.asked, [])
  })
})
