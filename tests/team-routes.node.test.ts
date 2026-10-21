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
import { createTeamContext, type TeamDeps } from '../worker/src/team-context.ts'
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
const stranger: Identity = { provider: 'google', sub: 'g-dan', email: 'dan@example.com' }

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
  const teamSpaces = {
    idFromName(name: string) {
      asked.push(name)
      return name
    },
    get(id: unknown) {
      const name = String(id)
      const state = states.get(name) ?? new TeamSpaceState(new MapStore())
      states.set(name, state)
      return state
    },
  }
  const room = teamSpaces.get(SPACE) as TeamSpaceState
  await room.create({ rootRef: root, name: 'Team', owner: ann })
  await room.setMember(bob, 'writer')
  await room.setMember(cat, 'reader')
  await room.setOwnerBlob(
    await encryptBlob(
      {
        owner_email: ann.email,
        owner_sub: ann.sub,
        scopes: 'drive.file',
        refresh_token: 'refresh',
        created_at: '2026-10-21T00:00:00Z',
        blob_id: `blob-${crypto.randomUUID()}`,
        kid: 'default',
      },
      env0
    )
  )
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
      new Request(`${ORIGIN}/api/space/${path}`, { ...init, headers }),
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
  return { drive, backend, root, room, env, deps, asked, call, direct, teamSpaces }
}

const json = async (response: Response) => (await response.json()) as Record<string, unknown>
const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

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
