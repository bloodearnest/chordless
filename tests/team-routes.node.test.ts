/**
 * The team space API as the Worker serves it (worker/src/router.ts, team-context.ts): a Google ID
 * token is checked first, then the member's role in the space's state, then the owner's
 * Drive. The state is over a SQLite with the migrations applied (d1-db.ts), Drive is the in-memory one, and the ID tokens
 * are signed with a key made here that stands in for Google's.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as jose from 'jose'
import { encryptBlob } from '../worker/src/blob.ts'
import type { Env } from '../worker/src/env.ts'
import { googleProvider, type Identity } from '../worker/src/identity.ts'
import { handleRequest } from '../worker/src/router.ts'
import { forgetServiceAccountTokens } from '../worker/src/service-account.ts'
import type { ShareCache } from '../worker/src/share.ts'
import { handleCreateSpace } from '../worker/src/team-admin.ts'
import { createAdminContext, createTeamContext, type TeamDeps } from '../worker/src/team-context.ts'
import { teamDrive } from '../worker/src/team-drive.ts'
import { TeamSpaceState } from '../worker/src/team-state.ts'
import { d1Db } from './d1-db.ts'
import { FakeDrive } from './fake-drive.ts'
import { must } from './must.ts'

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

  /** The database the spaces are in, and the live rooms (Durable Objects) asked for: a note of which names */
  const { db, sql, fail } = d1Db()
  const asked: string[] = []
  /** The sockets asked of the rooms (the room's own side of a live socket is tested in workerd) */
  const live: { space: string; request: Request }[] = []
  /** The accounts whose sockets the rooms were told to close: undefined for all of them */
  const dropped: { space: string; identity?: string }[] = []
  const teamRooms = {
    idFromName(name: string) {
      asked.push(name)
      return name
    },
    get(id: unknown) {
      const name = String(id)
      return {
        fetch: async (request: Request) => {
          live.push({ space: name, request })
          return new Response('socket', { status: 200 })
        },
        dropSockets: async (identity?: string) => void dropped.push({ space: name, identity }),
      }
    },
  }
  const room = new TeamSpaceState(db, SPACE)
  await room.create({ rootRef: root, name: 'Team', owner: ann })
  await room.setMember(bob, 'writer')
  await room.setMember(cat, 'reader')
  await room.setMember(dan, 'admin')
  await room.setOwnerBlob(await blobFor(ann))
  asked.length = 0

  const env = {
    ...env0,
    ASSETS: { fetch: async () => new Response('assets') },
    DB: db,
    TEAM_ROOM: teamRooms,
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
  /** Rows of the database, as plain objects */
  const all = (query: string) =>
    sql
      .prepare(query)
      .all()
      .map(row => ({ ...row }))
  return {
    drive,
    backend,
    root,
    room,
    env,
    deps,
    asked,
    call,
    direct,
    teamRooms,
    live,
    dropped,
    db,
    all,
    fail,
  }
}

const json = async (response: Response) => (await response.json()) as Record<string, unknown>
const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const post = (body: unknown) => send('POST', body)

describe('the route', () => {
  test('says team spaces are not available where the Worker has no database', async () => {
    const { call, env } = await world()
    const { DB: _, ...without } = env
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

describe('a team space’s pads, over the owner’s Drive', () => {
  test('are kept in the space’s own folder, apart from the owner’s, and streamed to a member', async () => {
    const { call, backend, root, drive } = await world()
    // (the owner has pads of their own too: those are not the team's)
    await backend.pads.ensureSet('Ann’s own')

    const made = await call(`${SPACE}/pads`, cat, post({ name: 'Team pads' }))
    assert.equal(made.status, 200)
    const { ref } = (await json(made)) as { ref: string }
    const padsFolder = must(drive.files.get(must(drive.files.get(ref)).parents[0]))
    assert.equal(padsFolder.name, 'pads')
    assert.deepEqual(padsFolder.parents, [root])

    const audio = new Uint8Array([0, 1, 2, 254, 255])
    const put = await call(`${SPACE}/pads/${ref}/files/${encodeURIComponent('C#')}`, cat, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: new Blob([audio], { type: 'audio/mpeg' }),
    })
    assert.equal(put.status, 204)

    const sets = (await json(await call(`${SPACE}/pads`, bob))) as unknown as { name: string }[]
    assert.deepEqual(
      sets.map(set => set.name),
      ['Team pads']
    )
    const files = (await (await call(`${SPACE}/pads/${ref}/files`, bob)).json()) as {
      ref: string
      padKey: string
    }[]
    assert.deepEqual(
      files.map(file => file.padKey),
      ['C#']
    )
    const read = await call(`${SPACE}/pads/files/${files[0]?.ref}`, bob)
    assert.equal(read.status, 200)
    assert.deepEqual([...new Uint8Array(await read.arrayBuffer())], [...audio])
  })
})

describe('team-managed storage (the service account)', () => {
  const ADDRESS = 'team-storage@chordless-app.iam.gserviceaccount.com'
  const key = async () => {
    const { privateKey: signing } = await jose.generateKeyPair('RS256', { extractable: true })
    return JSON.stringify({ client_email: ADDRESS, private_key: await jose.exportPKCS8(signing) })
  }

  /** The world, with the service account's key, Google's token endpoint, and the owner's refreshes counted */
  async function managed({ withKey = true } = {}) {
    forgetServiceAccountTokens()
    const w = await world()
    const counts = { grants: 0, refreshes: 0 }
    const env = { ...w.env, ...(withKey ? { TEAM_STORAGE_KEY: await key() } : {}) }
    const deps: TeamDeps = {
      ...w.deps,
      google: {
        refreshAccessToken: (async () => {
          counts.refreshes++
          return { access_token: TOKEN, expires_in: 3600 }
        }) as never,
      },
      tokenFetch: (async () => {
        counts.grants++
        return Response.json({ access_token: TOKEN, expires_in: 3600 })
      }) as typeof fetch,
    }
    // (the team's folder is in a shared drive)
    must(w.drive.files.get(w.root)).driveId = 'shared-drive-1'
    const call = (path: string, who: Identity, init: RequestInit = {}) =>
      w.call(path, who, init, env, deps)
    return { ...w, env, deps, counts, call, raw: w.call }
  }

  test('is shown to an admin, with the address to add, and the space starts on the owner’s sign-in', async () => {
    const { call } = await managed()
    const shown = await json(await call(`${SPACE}/credential`, dan))
    assert.deepEqual(shown, { kind: 'owner', serviceAccount: ADDRESS })
    assert.equal((await call(`${SPACE}/credential`, bob)).status, 403)
  })

  test('is switched to by the owner only, once the folder passes the check: then their sign-in is gone', async () => {
    const { call, room, counts } = await managed()
    assert.equal((await call(`${SPACE}/credential/service-account`, dan, post({}))).status, 403)

    const switched = await call(`${SPACE}/credential/service-account`, ann, post({}))
    assert.equal(switched.status, 200)
    assert.deepEqual(await json(switched), { kind: 'service-account', serviceAccount: ADDRESS })
    assert.equal(await room.credential(), 'service-account')
    assert.equal(await room.ownerBlob(), null)

    // A member's call now goes with the service account's token, not the owner's
    const before = { ...counts }
    assert.equal((await call(`${SPACE}/files?collection=songs`, bob)).status, 200)
    assert.equal(counts.refreshes, before.refreshes)
    assert.ok(counts.grants > 0)
  })

  test('is not switched to when the folder fails the check, and the owner’s sign-in stays', async () => {
    const { call, room, drive, root } = await managed()
    delete must(drive.files.get(root)).driveId
    const refused = await call(`${SPACE}/credential/service-account`, ann, post({}))
    assert.equal(refused.status, 409)
    assert.match(String((await json(refused)).error), /shared drive/)
    assert.equal(await room.credential(), 'owner')
    assert.notEqual(await room.ownerBlob(), null)
  })

  test('is not offered where the server has no key', async () => {
    const { call } = await managed({ withKey: false })
    assert.deepEqual(await json(await call(`${SPACE}/credential`, ann)), {
      kind: 'owner',
      serviceAccount: null,
    })
    assert.equal((await call(`${SPACE}/credential/service-account`, ann, post({}))).status, 503)
  })

  test('is left by the owner giving their sign-in again', async () => {
    const { call, room } = await managed()
    await call(`${SPACE}/credential/service-account`, ann, post({}))
    const back = await call(`${SPACE}/credential`, ann, send('PUT', { blob: await blobFor(ann) }))
    assert.equal(back.status, 204)
    assert.equal(await room.credential(), 'owner')
    assert.notEqual(await room.ownerBlob(), null)
  })

  test('says so to a member when the server has lost its key', async () => {
    const w = await managed()
    await w.call(`${SPACE}/credential/service-account`, ann, post({}))
    const { TEAM_STORAGE_KEY: _, ...without } = w.env
    const answer = await w.raw(`${SPACE}/files?collection=songs`, bob, {}, without, w.deps)
    assert.equal(answer.status, 409)
    assert.match(String((await json(answer)).error), /not set up/)
  })
})

describe('the context', () => {
  test('says there is no such space, and no root, for an id with no space', async () => {
    const { env, deps } = await world()
    const context = createTeamContext(env, deps)
    assert.equal(await context.space('space-cccccccc'), null)
    assert.equal(await context.root('space-cccccccc'), null)
    assert.equal(await context.pads('space-cccccccc'), null)
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
    const before = w.all('SELECT * FROM teams').length
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
    assert.equal(w.all('SELECT * FROM teams').length, before)
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
    const admin = createAdminContext(w.env, w.deps)
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

describe('the CCLI licence number', () => {
  const put = (number: unknown) => send('PUT', { ccliLicence: number })

  test('is set by a writer where there is none, tidied, and any member can read it', async () => {
    const { call, room } = await world()
    assert.deepEqual(await json(await call(`${SPACE}/licence`, cat)), { ccliLicence: null })
    const set = await call(`${SPACE}/licence`, bob, put(' CCLI Licence # 471 102 '))
    assert.equal(set.status, 200)
    assert.deepEqual(await json(set), { ccliLicence: '471102' })
    assert.equal((await room.licence()).ccliLicence, '471102')
    assert.deepEqual(await json(await call(`${SPACE}/licence`, cat)), { ccliLicence: '471102' })
  })

  test('is changed or cleared by an admin only; a writer who sets the same number changes nothing', async () => {
    const { call, room } = await world()
    await call(`${SPACE}/licence`, bob, put('471102'))
    assert.equal((await call(`${SPACE}/licence`, bob, put('999'))).status, 403)
    assert.equal((await call(`${SPACE}/licence`, bob, put(''))).status, 403)
    assert.equal((await call(`${SPACE}/licence`, bob, put('471102'))).status, 200)
    assert.equal((await call(`${SPACE}/licence`, cat, put('1'))).status, 403)
    assert.equal((await call(`${SPACE}/licence`, dan, put('999'))).status, 200)
    assert.equal((await call(`${SPACE}/licence`, ann, put(''))).status, 200)
    assert.equal((await room.licence()).ccliLicence, null)
  })

  test('shows its log to an admin and to no one below', async () => {
    const { call } = await world()
    await call(`${SPACE}/licence`, bob, put('471102'))
    await call(`${SPACE}/licence`, dan, put('471103'))
    const admin = (await json(await call(`${SPACE}/licence`, dan))) as {
      history: { by: string; from: string | null; to: string | null }[]
    }
    assert.deepEqual(
      admin.history.map(({ by, from, to }) => ({ by, from, to })),
      [
        { by: 'bob@example.com', from: null, to: '471102' },
        { by: 'dan@example.com', from: '471102', to: '471103' },
      ]
    )
    assert.equal('history' in (await json(await call(`${SPACE}/licence`, bob))), false)
  })

  test('needs a sign-in and a membership, and refuses what is not a number in text', async () => {
    const { call } = await world()
    assert.equal((await call(`${SPACE}/licence`, null)).status, 401)
    assert.equal((await call(`${SPACE}/licence`, stranger)).status, 403)
    assert.equal((await call(`${SPACE}/licence`, ann, put(471102))).status, 400)
    assert.equal((await call(`${SPACE}/licence`, ann, put('1'.repeat(33)))).status, 400)
  })

  test('can be given when the space is made, and is then logged to its owner', async () => {
    const w = await world()
    const made = await w.call(
      '/api/spaces',
      eve,
      post({
        blob: await blobFor(eve),
        rootRef: w.root,
        name: 'Eve Church',
        ccliLicence: '#2345678',
      })
    )
    const { spaceId } = (await json(made)) as { spaceId: string }
    assert.deepEqual(await json(await w.call(`${spaceId}/licence`, eve)), {
      ccliLicence: '2345678',
      history: [
        {
          at: (await new TeamSpaceState(w.db, spaceId).licence()).history[0]?.at,
          by: 'eve@example.com',
          from: null,
          to: '2345678',
        },
      ],
    })
    const bad = await w.call(
      '/api/spaces',
      eve,
      post({ blob: await blobFor(eve), rootRef: w.root, name: 'Eve Church', ccliLicence: 5 })
    )
    assert.equal(bad.status, 400)
  })
})

describe('the register of teams', () => {
  const put = (number: unknown) => send('PUT', { ccliLicence: number })
  const eventsOf = (w: Awaited<ReturnType<typeof world>>, spaceId: string) =>
    w.all(
      `SELECT kind, by_email, detail FROM team_events WHERE space_id = '${spaceId}' ORDER BY id`
    )

  test('has a space when it is made, with its owner, its licence number and its history', async () => {
    const w = await world()
    const made = await w.call(
      '/api/spaces',
      eve,
      post({
        blob: await blobFor(eve),
        rootRef: w.root,
        name: 'Eve Church',
        ccliLicence: '2345678',
      })
    )
    const { spaceId } = (await json(made)) as { spaceId: string }
    assert.deepEqual(
      w.all(
        `SELECT space_id, name, owner_email, ccli_licence, ended_at FROM teams WHERE space_id = '${spaceId}'`
      ),
      [
        {
          space_id: spaceId,
          name: 'Eve Church',
          owner_email: 'eve@example.com',
          ccli_licence: '2345678',
          ended_at: null,
        },
      ]
    )
    assert.deepEqual(
      eventsOf(w, spaceId).map(({ kind, by_email }) => ({ kind, by_email })),
      [
        { kind: 'created', by_email: 'eve@example.com' },
        { kind: 'licence', by_email: 'eve@example.com' },
      ]
    )
  })

  test('notes each change of the licence number with who made it, and nothing where it changed nothing', async () => {
    const w = await world()
    await w.call(`${SPACE}/licence`, bob, put('471102'))
    await w.call(`${SPACE}/licence`, bob, put('471102'))
    await w.call(`${SPACE}/licence`, dan, put('471103'))
    assert.deepEqual(
      eventsOf(w, SPACE)
        .filter(each => each.kind === 'licence')
        .map(({ by_email, detail }) => [by_email, JSON.parse(String(detail))]),
      [
        ['bob@example.com', { from: null, to: '471102' }],
        ['dan@example.com', { from: '471102', to: '471103' }],
      ]
    )
    assert.equal(
      w.all(`SELECT ccli_licence FROM teams WHERE space_id = '${SPACE}'`)[0].ccli_licence,
      '471103'
    )
  })

  test('notes a space made with no licence number with none, and a cleared one as cleared', async () => {
    const w = await world()
    const made = await w.call(
      '/api/spaces',
      eve,
      post({ blob: await blobFor(eve), rootRef: w.root, name: 'Eve Church' })
    )
    const { spaceId } = (await json(made)) as { spaceId: string }
    const licence = () =>
      w.all(`SELECT ccli_licence FROM teams WHERE space_id = '${spaceId}'`)[0].ccli_licence
    assert.equal(licence(), null)
    assert.deepEqual(
      eventsOf(w, spaceId).map(each => each.kind),
      ['created']
    )
    await w.call(`${spaceId}/licence`, eve, put('471102'))
    await w.call(`${spaceId}/licence`, eve, put(''))
    assert.equal(licence(), null)
    const last = eventsOf(w, spaceId).at(-1)
    assert.deepEqual(JSON.parse(String(last?.detail)), { from: '471102', to: null })
  })

  test('has the people as they join, leave and are removed, and closes the sockets of those who go', async () => {
    const w = await world()
    const count = () =>
      Number(w.all(`SELECT COUNT(*) AS n FROM team_members WHERE space_id = '${SPACE}'`)[0].n)
    const invite = await json(
      await w.call(`${SPACE}/invites`, ann, post({ role: 'writer', email: stranger.email }))
    )
    const joined = await w.call(
      '/api/spaces/join',
      stranger,
      post({ spaceId: SPACE, code: invite.code })
    )
    assert.equal(joined.status, 200)
    assert.equal(count(), 4)
    assert.equal((await w.call(`${SPACE}/leave`, stranger, post({}))).status, 204)
    assert.equal(count(), 3)
    assert.equal(
      (await w.call(`${SPACE}/members/bob%40example.com`, ann, send('DELETE'))).status,
      204
    )
    assert.equal(count(), 2)
    assert.deepEqual(w.dropped.at(-1), { space: SPACE, identity: 'google:g-bob' })
  })

  test('keeps a space that ended, marked, with its number and what happened to it, and forgets its people', async () => {
    const w = await world()
    await w.call(`${SPACE}/licence`, bob, put('471102'))
    assert.equal((await w.call(SPACE, ann, send('DELETE'))).status, 204)
    const [team] = w.all(
      `SELECT name, ccli_licence, ended_at FROM teams WHERE space_id = '${SPACE}'`
    )
    assert.equal(team.name, 'Team')
    assert.equal(team.ccli_licence, '471102')
    assert.match(String(team.ended_at), /^20\d\d-/)
    assert.deepEqual(
      eventsOf(w, SPACE).map(each => each.kind),
      ['created', 'licence', 'ended']
    )
    assert.deepEqual(w.all(`SELECT * FROM team_members WHERE space_id = '${SPACE}'`), [])
    assert.deepEqual(w.all(`SELECT * FROM team_credentials WHERE space_id = '${SPACE}'`), [])
    assert.equal((await w.call(`${SPACE}/licence`, ann)).status, 403)
    assert.deepEqual(w.dropped.at(-1), { space: SPACE, identity: undefined })
  })

  test('is the space itself: with the database down a team call fails, rather than carrying on without it', async () => {
    const w = await world()
    w.fail(true)
    const quiet = console.error
    console.error = () => {}
    try {
      assert.ok((await w.call(`${SPACE}/licence`, bob, put('471102'))).status >= 500)
    } finally {
      console.error = quiet
    }
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

  test('hands a member’s socket to the space’s live room, and says which account and space', async () => {
    const w = await world()
    const answer = await w.call(`${SPACE}/live`, null, await upgrade(bob))
    assert.equal(answer.status, 200, 'the object’s answer, as it is')
    assert.equal(await answer.text(), 'socket')
    const [{ space, request }] = w.live
    assert.equal(space, SPACE)
    assert.deepEqual(JSON.parse(request.headers.get('X-Live-Identity') ?? ''), {
      provider: bob.provider,
      sub: bob.sub,
      spaceId: SPACE,
    })
    assert.equal(request.headers.get('Upgrade'), 'websocket')
    assert.equal(request.headers.get('Authorization'), null, 'the token goes no further')
  })

  test('lets a reader listen', async () => {
    const w = await world()
    assert.equal((await w.call(`${SPACE}/live`, null, await upgrade(cat))).status, 200)
  })

  test('does not let a page say who it is: the room has only what the Worker settled', async () => {
    const w = await world()
    await w.call(
      `${SPACE}/live`,
      null,
      await upgrade(cat, { 'X-Live-Identity': JSON.stringify(ann) })
    )
    assert.deepEqual(JSON.parse(w.live[0].request.headers.get('X-Live-Identity') ?? ''), {
      provider: cat.provider,
      sub: cat.sub,
      spaceId: SPACE,
    })
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
    const { TEAM_ROOM: _, ...without } = w.env
    const answer = await w.call(`${SPACE}/live`, null, await upgrade(bob), without)
    assert.equal(answer.status, 503)
  })

  test('does not make an object for an id that is not a space’s', async () => {
    const w = await world()
    assert.equal((await w.call('x/live', null, await upgrade(bob))).status, 404)
    assert.deepEqual(w.asked, [])
  })
})
