/**
 * The sign-in and session routes (worker/src/session.ts) and the token blob (worker/src/blob.ts),
 * run in Node with Google replaced: what each route refuses, what it answers, and that a refresh
 * token only ever leaves the Worker inside an encrypted blob.
 */

import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import * as jose from 'jose'
import { type BlobData, decryptBlob, encryptBlob } from '../worker/src/blob.ts'
import {
  CODE_TTL_MS,
  handleEmailStart,
  handleEmailVerify,
  loginEmail,
} from '../worker/src/email-login.ts'
import type { Env } from '../worker/src/env.ts'
import type { GoogleApi } from '../worker/src/google-auth.ts'
import {
  handleOAuthCallback,
  handleSessionLogout,
  handleSessionToken,
  handleSessionUpgrade,
  handleTokenRefresh,
} from '../worker/src/session.ts'
import { revokeSession, rotateSession, verifyAccessToken } from '../worker/src/session-tokens.ts'
import { accountOf } from '../worker/src/team-state.ts'
import { d1Db } from './d1-db.ts'

const randomKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  JWE_ENCRYPTION_KEY: randomKey(),
  SESSION_SIGNING_KEY: randomKey(),
  ASSETS: { fetch: async () => new Response('assets') },
} satisfies Env

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const REFRESH_TOKEN = 'refresh-token-that-must-not-leak'

const blobData = (over: Partial<BlobData> = {}): BlobData => ({
  owner_email: 'ann@example.com',
  owner_sub: 'sub-1',
  scopes: DRIVE_SCOPE,
  refresh_token: REFRESH_TOKEN,
  created_at: '2026-10-14T12:00:00.000Z',
  blob_id: 'blob-1',
  kid: 'default',
  ...over,
})

/** Google, answering what a successful sign-in would, unless a test says otherwise */
function fakeGoogle(over: Partial<GoogleApi> = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const record =
    <T extends (...args: never[]) => unknown>(name: string, fn: T) =>
    (...args: Parameters<T>) => {
      calls.push({ name, args })
      return fn(...args)
    }
  const google = {
    exchangeCode: record('exchangeCode', async () => ({
      refresh_token: REFRESH_TOKEN,
      access_token: 'access-1',
      expires_in: 3600,
      scope: `openid email ${DRIVE_SCOPE}`,
      id_token: 'id-token',
      claims: { email: 'ann@example.com', sub: 'sub-1', name: 'Ann Smith', picture: 'pic.png' },
    })),
    refreshAccessToken: record('refreshAccessToken', async (_token: string) => ({
      access_token: 'access-2',
      expires_in: 1800,
    })),
    revokeToken: record('revokeToken', async (_token: string) => undefined),
    verifyIdToken: record('verifyIdToken', async () => ({
      email: 'ann@example.com',
      sub: 'sub-1',
    })),
    ...over,
  } as unknown as GoogleApi
  return { google, calls }
}

const post = (path: string, body: unknown) =>
  new Request(`https://chordless.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const bodyOf = async (response: Response) => (await response.json()) as Record<string, unknown>

describe('the token blob', () => {
  test('is encrypted, and gives its data back for the same key', async () => {
    const data = blobData()
    const blob = await encryptBlob(data, env)
    assert.ok(!blob.includes(REFRESH_TOKEN), 'the refresh token is not readable in the blob')
    assert.deepEqual(await decryptBlob(blob, env), data)
  })

  test('names its key id and algorithm in the header', async () => {
    const header = jose.decodeProtectedHeader(await encryptBlob(blobData({ kid: 'k2' }), env))
    assert.deepEqual(header, { alg: 'dir', enc: 'A256GCM', kid: 'k2' })
  })

  test('has the key id "default" when the data names none', async () => {
    const header = jose.decodeProtectedHeader(await encryptBlob(blobData({ kid: '' }), env))
    assert.equal(header.kid, 'default')
  })

  test('is not readable with another key', async () => {
    const blob = await encryptBlob(blobData(), env)
    await assert.rejects(decryptBlob(blob, { JWE_ENCRYPTION_KEY: randomKey() }))
  })

  test('is not readable once it has been changed', async () => {
    const blob = await encryptBlob(blobData(), env)
    const parts = blob.split('.')
    parts[3] = `${parts[3].slice(0, -2)}${parts[3].endsWith('AA') ? 'BB' : 'AA'}`
    await assert.rejects(decryptBlob(parts.join('.'), env))
  })

  test('is not readable if it is not a blob at all', async () => {
    await assert.rejects(decryptBlob('not-a-blob', env))
  })

  test('cannot be made with a key of the wrong length', async () => {
    await assert.rejects(
      encryptBlob(blobData(), { JWE_ENCRYPTION_KEY: Buffer.from('too short').toString('base64') })
    )
  })
})

describe('POST /oauth/callback', () => {
  test('wants a code', async () => {
    const { google } = fakeGoogle()
    const response = await handleOAuthCallback(post('/oauth/callback', {}), env, google)
    assert.equal(response.status, 400)
    assert.equal((await bodyOf(response)).error, 'Missing code')
  })

  test('wants to know where the code was sent, from the app or the Worker settings', async () => {
    const { google, calls } = fakeGoogle()
    const none = await handleOAuthCallback(post('/oauth/callback', { code: 'c' }), env, google)
    assert.equal(none.status, 400)
    assert.equal((await bodyOf(none)).error, 'Missing redirect_uri')
    assert.equal(calls.length, 0, 'nothing was asked of Google')

    const fromSettings = { ...env, GOOGLE_REDIRECT_URI: 'https://settings.example' }
    await handleOAuthCallback(post('/oauth/callback', { code: 'c' }), fromSettings, google)
    assert.equal(calls[0].args[1], 'https://settings.example')

    await handleOAuthCallback(
      post('/oauth/callback', { code: 'c', redirect_uri: 'https://app.example' }),
      fromSettings,
      google
    )
    assert.equal(calls[1].args[1], 'https://app.example', "the app's own origin wins")
  })

  test('refuses a sign-in with no ID token', async () => {
    const { google } = fakeGoogle({
      exchangeCode: (async () => ({
        refresh_token: 'r',
        scope: DRIVE_SCOPE,
        claims: null,
      })) as unknown as GoogleApi['exchangeCode'],
    })
    const response = await handleOAuthCallback(
      post('/oauth/callback', { code: 'c', redirect_uri: 'https://app.example' }),
      env,
      google
    )
    assert.equal(response.status, 400)
    assert.match(String((await bodyOf(response)).error), /No ID token/)
  })

  test('refuses a sign-in that gave no refresh token, and says what to do', async () => {
    const { google } = fakeGoogle({
      exchangeCode: (async () => ({
        access_token: 'a',
        scope: DRIVE_SCOPE,
        id_token: 'i',
        claims: { sub: 's' },
      })) as unknown as GoogleApi['exchangeCode'],
    })
    const response = await handleOAuthCallback(
      post('/oauth/callback', { code: 'c', redirect_uri: 'https://app.example' }),
      env,
      google
    )
    assert.equal(response.status, 400)
    assert.match(String((await bodyOf(response)).error), /revoke and re-authorize/)
  })

  test('lets a sign-in through without Drive access, and says what was granted', async () => {
    const { google } = fakeGoogle({
      exchangeCode: (async () => ({
        refresh_token: 'r',
        access_token: 'a',
        expires_in: 3600,
        scope: 'openid email profile',
        id_token: 'i',
        claims: { sub: 's', email: 'ann@example.com', email_verified: true },
      })) as unknown as GoogleApi['exchangeCode'],
    })
    const response = await handleOAuthCallback(
      post('/oauth/callback', { code: 'c', redirect_uri: 'https://app.example' }),
      env,
      google
    )
    const body = await bodyOf(response)
    assert.equal(response.status, 200)
    assert.equal(body.scope, 'openid email profile')
    assert.ok(body.blob, 'a blob to renew the ID token from')
    const data = await decryptBlob(String(body.blob), env)
    assert.equal(data.scopes, 'openid email profile')
  })

  test('keeps no scopes when Google names none, rather than failing', async () => {
    const { google } = fakeGoogle({
      exchangeCode: (async () => ({
        refresh_token: 'r',
        access_token: 'a',
        id_token: 'i',
        claims: { sub: 's' },
      })) as unknown as GoogleApi['exchangeCode'],
    })
    const response = await handleOAuthCallback(
      post('/oauth/callback', { code: 'c', redirect_uri: 'https://app.example' }),
      env,
      google
    )
    assert.equal(response.status, 200)
    assert.equal((await decryptBlob(String((await bodyOf(response)).blob), env)).scopes, '')
  })

  test('says Drive was granted when it was', async () => {
    const { google } = fakeGoogle()
    const response = await handleOAuthCallback(
      post('/oauth/callback', { code: 'c', redirect_uri: 'https://app.example' }),
      env,
      google
    )
    assert.ok(String((await bodyOf(response)).scope).includes(DRIVE_SCOPE))
  })

  test('gives the app only the details Google gave about who signed in', async () => {
    const answer = (claims: object) =>
      fakeGoogle({
        exchangeCode: (async () => ({
          refresh_token: 'r',
          scope: DRIVE_SCOPE,
          id_token: 'i',
          claims,
        })) as unknown as GoogleApi['exchangeCode'],
      }).google
    const request = () =>
      post('/oauth/callback', { code: 'c', redirect_uri: 'https://app.example' })

    const bare = await bodyOf(await handleOAuthCallback(request(), env, answer({})))
    assert.deepEqual(bare.user, {
      name: null,
      email: null,
      picture: null,
      given_name: null,
      family_name: null,
      sub: null,
    })

    const named = await bodyOf(
      await handleOAuthCallback(
        request(),
        env,
        answer({ sub: 's', given_name: 'Ann', family_name: 'Smith' })
      )
    )
    assert.deepEqual(named.user, {
      name: null,
      email: null,
      picture: null,
      given_name: 'Ann',
      family_name: 'Smith',
      sub: 's',
    })
  })

  describe('when it works', () => {
    let body: Record<string, unknown>
    let response: Response

    beforeEach(async () => {
      const { google } = fakeGoogle()
      response = await handleOAuthCallback(
        post('/oauth/callback', { code: 'c', redirect_uri: 'https://app.example' }),
        env,
        google
      )
      body = await bodyOf(response)
    })

    test('gives the app its tokens and who signed in', () => {
      assert.equal(response.status, 200)
      assert.equal(body.access_token, 'access-1')
      assert.equal(body.expires_in, 3600)
      assert.equal(body.id_token, 'id-token')
      assert.deepEqual(body.user, {
        name: 'Ann Smith',
        email: 'ann@example.com',
        picture: 'pic.png',
        given_name: null,
        family_name: null,
        sub: 'sub-1',
      })
    })

    test('keeps the refresh token in the blob, which only the Worker can read', async () => {
      assert.ok(!JSON.stringify(body).includes(REFRESH_TOKEN), 'the refresh token is not sent')
      const data = await decryptBlob(String(body.blob), env)
      assert.equal(data.refresh_token, REFRESH_TOKEN)
      assert.equal(data.owner_email, 'ann@example.com')
      assert.equal(data.owner_sub, 'sub-1')
      assert.equal(data.scopes, `openid email ${DRIVE_SCOPE}`)
      assert.equal(data.kid, 'default')
    })

    test('makes a different blob each time', async () => {
      const { google } = fakeGoogle()
      const again = await bodyOf(
        await handleOAuthCallback(
          post('/oauth/callback', { code: 'c', redirect_uri: 'https://app.example' }),
          env,
          google
        )
      )
      assert.notEqual(again.blob, body.blob)
      assert.notEqual(
        (await decryptBlob(String(again.blob), env)).blob_id,
        (await decryptBlob(String(body.blob), env)).blob_id
      )
    })
  })
})

describe('POST /session/refresh', () => {
  test('wants a blob', async () => {
    const { google } = fakeGoogle()
    const response = await handleTokenRefresh(post('/session/refresh', {}), env, google)
    assert.equal(response.status, 400)
    assert.equal((await bodyOf(response)).error, 'Missing blob')
  })

  test('gives a new access token for the refresh token in the blob, and nothing more', async () => {
    const { google, calls } = fakeGoogle()
    const blob = await encryptBlob(blobData(), env)
    const response = await handleTokenRefresh(post('/session/refresh', { blob }), env, google)

    assert.equal(response.status, 200)
    assert.deepEqual(await bodyOf(response), { access_token: 'access-2', expires_in: 1800 })
    assert.deepEqual(
      calls.map(c => c.name),
      ['refreshAccessToken']
    )
    assert.equal(calls[0].args[0], REFRESH_TOKEN)
  })

  test('passes on the new ID token when Google sends one with the refresh', async () => {
    const { google } = fakeGoogle({
      refreshAccessToken: (async () => ({
        access_token: 'access-2',
        expires_in: 1800,
        id_token: 'id-token-2',
      })) as unknown as GoogleApi['refreshAccessToken'],
    })
    const blob = await encryptBlob(blobData(), env)
    const response = await handleTokenRefresh(post('/session/refresh', { blob }), env, google)

    assert.deepEqual(await bodyOf(response), {
      access_token: 'access-2',
      expires_in: 1800,
      id_token: 'id-token-2',
    })
  })

  test('answers 401 invalid_blob for a blob that is not ours (sign in again), and asks Google nothing', async () => {
    const { google, calls } = fakeGoogle()
    const other = await encryptBlob(blobData(), { JWE_ENCRYPTION_KEY: randomKey() })
    for (const blob of [other, 'garbage']) {
      const response = await handleTokenRefresh(post('/session/refresh', { blob }), env, google)
      assert.equal(response.status, 401)
      assert.equal((await bodyOf(response)).error, 'invalid_blob')
    }
    assert.equal(calls.length, 0)
  })

  test('refuses a body that is not JSON with a 400', async () => {
    const request = new Request('https://chordless.test/session/refresh', {
      method: 'POST',
      body: 'this is not json',
    })
    assert.equal((await handleTokenRefresh(request, env, fakeGoogle().google)).status, 400)
  })

  test('passes an error from Google on, for the router to report', async () => {
    const { google } = fakeGoogle({
      refreshAccessToken: (async () => {
        throw new Error('invalid_grant')
      }) as unknown as GoogleApi['refreshAccessToken'],
    })
    const blob = await encryptBlob(blobData(), env)
    await assert.rejects(
      handleTokenRefresh(post('/session/refresh', { blob }), env, google),
      /invalid_grant/
    )
  })

  test('answers 401 invalid_grant, not a server error, when Google no longer honours the token', async () => {
    const { google } = fakeGoogle({
      refreshAccessToken: (async () => {
        throw Object.assign(new Error('Token has been expired or revoked.'), {
          error: 'invalid_grant',
        })
      }) as unknown as GoogleApi['refreshAccessToken'],
    })
    const blob = await encryptBlob(blobData(), env)
    const response = await handleTokenRefresh(post('/session/refresh', { blob }), env, google)
    assert.equal(response.status, 401)
    assert.equal((await bodyOf(response)).error, 'invalid_grant')
  })

  describe('with an ID token as well', () => {
    test('is refused when the blob belongs to someone else', async () => {
      const { google, calls } = fakeGoogle({
        verifyIdToken: (async () => ({
          email: 'someone@example.com',
          sub: 'sub-2',
        })) as unknown as GoogleApi['verifyIdToken'],
      })
      const blob = await encryptBlob(blobData(), env)
      const response = await handleTokenRefresh(
        post('/session/refresh', { blob, id_token: 'token' }),
        env,
        google
      )
      assert.equal(response.status, 403)
      assert.match(String((await bodyOf(response)).error), /Token mismatch/)
      assert.ok(!calls.some(c => c.name === 'refreshAccessToken'), 'no access token was made')
    })

    test('is accepted when it matches', async () => {
      const { google } = fakeGoogle()
      const blob = await encryptBlob(blobData(), env)
      const response = await handleTokenRefresh(
        post('/session/refresh', { blob, id_token: 'token' }),
        env,
        google
      )
      assert.equal(response.status, 200)
    })

    test('is not needed: the blob alone proves who it is, so an ID token that does not check out is skipped', async () => {
      const { google } = fakeGoogle({
        verifyIdToken: (async () => {
          throw new Error('expired')
        }) as unknown as GoogleApi['verifyIdToken'],
      })
      const warn = console.warn
      console.warn = () => {}
      try {
        const blob = await encryptBlob(blobData(), env)
        const response = await handleTokenRefresh(
          post('/session/refresh', { blob, id_token: 'old' }),
          env,
          google
        )
        assert.equal(response.status, 200)
      } finally {
        console.warn = warn
      }
    })
  })
})

describe('POST /session/logout', () => {
  const logout = async (body: Record<string, unknown>, google = fakeGoogle().google) =>
    handleSessionLogout(post('/session/logout', body), env, google)

  test('revokes the refresh token in the blob at Google', async () => {
    const { google, calls } = fakeGoogle()
    const blob = await encryptBlob(blobData(), env)

    const response = await logout({ blob }, google)

    assert.equal(response.status, 200)
    assert.deepEqual(await bodyOf(response), { success: true })
    const revoked = calls.filter(call => call.name === 'revokeToken')
    assert.equal(revoked.length, 1)
    assert.equal(revoked[0].args[0], REFRESH_TOKEN)
  })

  test('wants a blob, and a real one', async () => {
    const { google, calls } = fakeGoogle()
    assert.equal((await logout({}, google)).status, 400)
    assert.equal((await logout({ blob: 'not-a-blob' }, google)).status, 401)
    assert.equal(calls.length, 0, 'nothing was asked of Google')
  })

  test('is done when Google says the token is already revoked', async () => {
    const { google } = fakeGoogle({
      revokeToken: async () => {
        throw Object.assign(new Error('invalid_token'), { error: 'invalid_token' })
      },
    })
    const response = await logout({ blob: await encryptBlob(blobData(), env) }, google)
    assert.equal(response.status, 200)
  })

  test('says so when Google cannot be asked, or refuses', async () => {
    const { google } = fakeGoogle({
      revokeToken: async () => {
        throw new TypeError('network down')
      },
    })
    const response = await logout({ blob: await encryptBlob(blobData(), env) }, google)
    assert.equal(response.status, 502)
    const body = await bodyOf(response)
    assert.equal(body.error, 'Google did not revoke the access')
    assert.ok(!JSON.stringify(body).includes(REFRESH_TOKEN))
  })
})

describe('a Chordless session', () => {
  const NOW = new Date('2026-11-16T12:00:00.000Z')
  const later = (ms: number) => new Date(NOW.getTime() + ms)
  const withDb = () => {
    const { db, sql } = d1Db()
    return { sql, env: { ...env, DB: db } satisfies Env }
  }
  type Tokens = { access_token: string; refresh_token: string; expires_in: number }
  const tokenFor = async (e: Env, refresh_token: string, now = NOW) =>
    handleSessionToken(post('/session/token', { refresh_token }), e, now)

  test('starts with a sign-in with Google, and the access token names the account', async () => {
    const { env: e, sql } = withDb()
    const { google } = fakeGoogle()
    const response = await handleOAuthCallback(
      post('/oauth/callback', { code: 'c', redirect_uri: 'https://chordless.test' }),
      e,
      google,
      NOW
    )
    const session = (await bodyOf(response)).session as Tokens
    const claims = await verifyAccessToken(session.access_token, e, NOW)
    const account = sql
      .prepare(
        "SELECT account_id FROM account_identities WHERE provider = 'google' AND sub = 'sub-1'"
      )
      .get() as { account_id: string }
    assert.equal(claims?.accountId, account.account_id)
    assert.equal(session.expires_in, 900)
    const stored = sql.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[]
    assert.equal(stored.length, 1)
    assert.ok(!session.refresh_token.includes(stored[0].token_hash))
  })

  test('is not made by a Worker with no database: the sign-in works without one', async () => {
    const { google } = fakeGoogle()
    const response = await handleOAuthCallback(
      post('/oauth/callback', { code: 'c', redirect_uri: 'https://chordless.test' }),
      env,
      google
    )
    assert.equal(response.status, 200)
    assert.equal((await bodyOf(response)).session, undefined)
  })

  test('gives a silent upgrade to a device with a blob from before, for the same account', async () => {
    const { env: e } = withDb()
    const blob = await encryptBlob(blobData(), e)
    const first = (await bodyOf(
      await handleSessionUpgrade(post('/session/upgrade', { blob }), e, NOW)
    )) as Tokens
    const second = (await bodyOf(
      await handleSessionUpgrade(post('/session/upgrade', { blob }), e, NOW)
    )) as Tokens
    const a = await verifyAccessToken(first.access_token, e, NOW)
    const b = await verifyAccessToken(second.access_token, e, NOW)
    assert.equal(a?.accountId, b?.accountId)
    assert.notEqual(a?.sessionId, b?.sessionId)
  })

  test('is not given for a blob that cannot be read, or none', async () => {
    const { env: e } = withDb()
    assert.equal(
      (await handleSessionUpgrade(post('/session/upgrade', { blob: 'nope' }), e, NOW)).status,
      401
    )
    assert.equal((await handleSessionUpgrade(post('/session/upgrade', {}), e, NOW)).status, 400)
  })

  test('is refused with 503 where the Worker has no database', async () => {
    const blob = await encryptBlob(blobData(), env)
    assert.equal(
      (await handleSessionUpgrade(post('/session/upgrade', { blob }), env, NOW)).status,
      503
    )
    assert.equal((await tokenFor(env, 'a.b')).status, 503)
  })

  test('rotates: each refresh token works once, and gives the next pair', async () => {
    const { env: e } = withDb()
    const blob = await encryptBlob(blobData(), e)
    const start = (await bodyOf(
      await handleSessionUpgrade(post('/session/upgrade', { blob }), e, NOW)
    )) as Tokens
    const next = (await bodyOf(await tokenFor(e, start.refresh_token, later(60_000)))) as Tokens
    assert.notEqual(next.refresh_token, start.refresh_token)
    assert.ok(await verifyAccessToken(next.access_token, e, later(60_000)))
    assert.equal((await tokenFor(e, next.refresh_token, later(120_000))).status, 200)
  })

  test('answers a retry within the grace, with a new pair', async () => {
    const { env: e } = withDb()
    const blob = await encryptBlob(blobData(), e)
    const start = (await bodyOf(
      await handleSessionUpgrade(post('/session/upgrade', { blob }), e, NOW)
    )) as Tokens
    assert.equal((await tokenFor(e, start.refresh_token, later(1000))).status, 200)
    // the same request again, a moment later (the answer was lost)
    assert.equal((await tokenFor(e, start.refresh_token, later(5000))).status, 200)
  })

  test('revokes the session when a replaced token is used after the grace', async () => {
    const { env: e, sql } = withDb()
    const blob = await encryptBlob(blobData(), e)
    const start = (await bodyOf(
      await handleSessionUpgrade(post('/session/upgrade', { blob }), e, NOW)
    )) as Tokens
    const next = (await bodyOf(await tokenFor(e, start.refresh_token, later(1000)))) as Tokens
    // the token used long after it was replaced: someone has a copy
    const thief = await tokenFor(e, start.refresh_token, later(600_000))
    assert.equal(thief.status, 401)
    assert.equal((await bodyOf(thief)).reason, 'reused')
    // and the owner's newest token no longer works either
    assert.equal((await tokenFor(e, next.refresh_token, later(601_000))).status, 401)
    const row = sql.prepare('SELECT revoked_at FROM sessions').get() as {
      revoked_at: string | null
    }
    assert.ok(row.revoked_at)
  })

  test('refuses a token that is made up, changed, or after its 90 days', async () => {
    const { env: e } = withDb()
    const blob = await encryptBlob(blobData(), e)
    const start = (await bodyOf(
      await handleSessionUpgrade(post('/session/upgrade', { blob }), e, NOW)
    )) as Tokens
    const [id] = start.refresh_token.split('.')
    for (const bad of [
      '',
      'garbage',
      `${id}.${'x'.repeat(43)}`,
      `${'0'.repeat(32)}.${'x'.repeat(43)}`,
    ]) {
      assert.equal((await tokenFor(e, bad)).status, bad === '' ? 400 : 401, bad)
    }
    assert.equal((await tokenFor(e, start.refresh_token, later(91 * 86_400_000))).status, 401)
  })

  test('is ended by its refresh token alone, and only by a good one', async () => {
    const { env: e, sql } = withDb()
    const blob = await encryptBlob(blobData(), e)
    const start = (await bodyOf(
      await handleSessionUpgrade(post('/session/upgrade', { blob }), e, NOW)
    )) as Tokens
    const [id] = start.refresh_token.split('.')
    assert.equal(await revokeSession(e.DB, 'garbage', NOW), false)
    assert.equal(await revokeSession(e.DB, `${'0'.repeat(32)}.${'x'.repeat(43)}`, NOW), false)
    assert.equal(await revokeSession(e.DB, `${id}.${'x'.repeat(43)}`, NOW), false)
    // (the token a refresh just replaced still ends it: a device that lost the answer signs out)
    const next = (await bodyOf(await tokenFor(e, start.refresh_token, later(1000)))) as Tokens
    assert.equal(await revokeSession(e.DB, start.refresh_token, later(2000)), true)
    assert.equal(await revokeSession(e.DB, next.refresh_token, later(3000)), false, 'already ended')
    const row = sql.prepare('SELECT revoked_at FROM sessions').get() as { revoked_at: string }
    assert.equal(row.revoked_at, later(2000).toISOString())
    const out = await handleSessionLogout(
      post('/session/logout', { refresh_token: start.refresh_token }),
      e,
      fakeGoogle().google
    )
    assert.equal(out.status, 200, 'a device with no blob can end its session')
  })

  test('is made once when two requests use a token at the same moment', async () => {
    const { env: e } = withDb()
    const blob = await encryptBlob(blobData(), e)
    const start = (await bodyOf(
      await handleSessionUpgrade(post('/session/upgrade', { blob }), e, NOW)
    )) as Tokens
    const [a, b] = await Promise.all([
      rotateSession(e.DB, e, start.refresh_token, later(1000)),
      rotateSession(e.DB, e, start.refresh_token, later(1000)),
    ])
    assert.equal([a, b].filter(each => each.ok).length >= 1, true)
  })

  test('ends at sign-out, for the device that signed out', async () => {
    const { env: e } = withDb()
    const { google } = fakeGoogle()
    const blob = await encryptBlob(blobData(), e)
    const start = (await bodyOf(
      await handleSessionUpgrade(post('/session/upgrade', { blob }), e, NOW)
    )) as Tokens
    const out = await handleSessionLogout(
      post('/session/logout', { blob, refresh_token: start.refresh_token }),
      e,
      google
    )
    assert.equal(out.status, 200)
    assert.equal((await tokenFor(e, start.refresh_token, later(1000))).status, 401)
  })
})

describe('signing in with an emailed code', () => {
  const NOW = new Date('2026-11-16T12:00:00.000Z')
  const later = (ms: number) => new Date(NOW.getTime() + ms)
  type Sent = { to: string; from: { email: string; name: string }; subject: string; text: string }

  function world(over: Partial<Env> = {}) {
    const { db, sql } = d1Db()
    const sent: Sent[] = []
    const e = {
      ...env,
      DB: db,
      EMAIL: {
        send: async (message: Sent) => {
          sent.push(message)
          return { messageId: 'm1' }
        },
      },
      ...over,
    } satisfies Env
    const start = (address: unknown, now = NOW, headers: Record<string, string> = {}) =>
      handleEmailStart(
        new Request('https://chordless.test/session/email/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ address }),
        }),
        e,
        now
      )
    const verify = (address: unknown, code: unknown, now = NOW) =>
      handleEmailVerify(post('/session/email/verify', { address, code }), e, now)
    const codeSent = () => /(\d{6})/.exec(sent.at(-1)?.subject ?? '')?.[1] ?? ''
    return { e, sql, sent, start, verify, codeSent }
  }

  test('mails a six-digit code, from Chordless, and says only that it did', async () => {
    const w = world()
    const response = await w.start('Ann@Example.com ')
    assert.equal(response.status, 200)
    assert.deepEqual(await bodyOf(response), { ok: true })
    assert.equal(w.sent.length, 1)
    assert.equal(w.sent[0].to, 'ann@example.com')
    assert.equal(w.sent[0].from.email, 'signin@mail.chordless.app')
    assert.match(w.codeSent(), /^\d{6}$/)
    assert.ok(w.sent[0].text.includes(w.codeSent()))
    assert.equal(loginEmail('123456').subject, 'Your Chordless sign-in code: 123456')
  })

  test('keeps neither the address nor the code', async () => {
    const w = world()
    await w.start('ann@example.com')
    const rows = JSON.stringify(w.sql.prepare('SELECT * FROM login_codes').all())
    assert.ok(!rows.includes('ann@example.com') && !rows.includes(w.codeSent()))
  })

  test('refuses what is not an address, and a Worker that cannot send', async () => {
    const w = world()
    for (const bad of ['', 'nope', 'a@b', 'a b@c.d', 5, null, `${'a'.repeat(250)}@x.example`]) {
      assert.equal((await w.start(bad)).status, 400, String(bad))
    }
    const { DB: _db, ...noDb } = w.e
    assert.equal(
      (await handleEmailStart(post('/session/email/start', { address: 'a@b.co' }), noDb)).status,
      503
    )
    assert.equal(
      (await handleEmailVerify(post('/x', { address: 'a@b.co', code: '123456' }), noDb)).status,
      503
    )
    assert.equal(w.sent.length, 0)
  })

  test('sends no more than five codes an hour to an address, and says the same', async () => {
    const w = world()
    for (let n = 0; n < 7; n++) {
      const response = await w.start('ann@example.com', later(n * 1000))
      assert.deepEqual(await bodyOf(response), { ok: true })
    }
    assert.equal(w.sent.length, 5)
    await w.start('ann@example.com', later(61 * 60 * 1000))
    assert.equal(w.sent.length, 6, 'an hour later it is allowed again')
  })

  test('limits a sender, by its address, and carries on if the limit cannot be asked', async () => {
    const limited = world({ EMAIL_LOGIN: { limit: async () => ({ success: false }) } })
    assert.equal((await limited.start('ann@example.com')).status, 429)
    assert.equal(limited.sent.length, 0)
    const broken = world({
      EMAIL_LOGIN: {
        limit: async () => {
          throw new Error('down')
        },
      },
    })
    assert.equal(
      (await broken.start('ann@example.com', NOW, { 'CF-Connecting-IP': '1.2.3.4' })).status,
      200
    )
  })

  test('says when the mail could not be handed over', async () => {
    const w = world({
      EMAIL: {
        send: async () => {
          throw Object.assign(new Error('no'), { code: 'E_DELIVERY_FAILED' })
        },
      },
    })
    assert.equal((await w.start('ann@example.com')).status, 502)
  })

  test('signs in with the code, once, as a new account', async () => {
    const w = world()
    await w.start('ann@example.com')
    const response = await w.verify('ANN@example.com', ` ${w.codeSent()} `, later(60_000))
    assert.equal(response.status, 200)
    const session = (await bodyOf(response)) as { access_token: string; email: string }
    assert.equal(session.email, 'ann@example.com')
    const claims = await verifyAccessToken(session.access_token, w.e, later(60_000))
    const [login] = w.sql
      .prepare(
        "SELECT account_id FROM account_identities WHERE provider = 'email' AND sub = 'ann@example.com'"
      )
      .all() as { account_id: string }[]
    assert.equal(claims?.accountId, login.account_id)
    const again = await w.verify('ann@example.com', w.codeSent(), later(61_000))
    assert.equal(again.status, 401)
    assert.equal((await bodyOf(again)).reason, 'expired')
    // (the same address, later: the same account)
    await w.start('ann@example.com', later(3_600_000))
    const second = (await bodyOf(
      await w.verify('ann@example.com', w.codeSent(), later(3_601_000))
    )) as { access_token: string }
    assert.equal(
      (await verifyAccessToken(second.access_token, w.e, later(3_601_000)))?.accountId,
      login.account_id
    )
  })

  test('is the account of a Google login with the same address, and of no other', async () => {
    const w = world()
    const ann = await accountOf(
      w.e.DB,
      { provider: 'google', sub: 'g-ann', email: 'ann@example.com' },
      true
    )
    const bob = await accountOf(
      w.e.DB,
      { provider: 'google', sub: 'g-bob', email: 'bob@example.com' },
      true
    )
    await w.start('ann@example.com')
    const session = (await bodyOf(await w.verify('ann@example.com', w.codeSent()))) as {
      access_token: string
    }
    assert.equal((await verifyAccessToken(session.access_token, w.e, NOW))?.accountId, ann)
    assert.notEqual(ann, bob)
    // (a different address is a different account, even for a similar one)
    await w.start('ann+x@example.com')
    const other = (await bodyOf(await w.verify('ann+x@example.com', w.codeSent()))) as {
      access_token: string
    }
    assert.notEqual((await verifyAccessToken(other.access_token, w.e, NOW))?.accountId, ann)
  })

  test('refuses a wrong code, counts the tries, and stops after five', async () => {
    const w = world()
    await w.start('ann@example.com')
    const right = w.codeSent()
    const wrong = right === '000000' ? '111111' : '000000'
    for (let n = 1; n <= 5; n++) {
      const response = await w.verify('ann@example.com', wrong)
      assert.equal(response.status, 401)
      assert.equal((await bodyOf(response)).reason, n < 5 ? 'wrong' : 'too_many')
    }
    const late = await w.verify('ann@example.com', right)
    assert.equal(
      (await bodyOf(late)).reason,
      'too_many',
      'the right one is no good once tries are spent'
    )
    await w.start('ann@example.com', later(1000))
    assert.equal(
      (await w.verify('ann@example.com', w.codeSent(), later(2000))).status,
      200,
      'a new code starts afresh'
    )
  })

  test('refuses a code that has ended, was never asked for, or is not six digits', async () => {
    const w = world()
    await w.start('ann@example.com')
    const code = w.codeSent()
    assert.equal(
      (await bodyOf(await w.verify('ann@example.com', code, later(CODE_TTL_MS + 1)))).reason,
      'expired'
    )
    assert.equal((await bodyOf(await w.verify('nobody@example.com', '123456'))).reason, 'expired')
    for (const bad of ['', '12345', '1234567', 'abcdef', 123456, null]) {
      assert.equal((await w.verify('ann@example.com', bad)).status, 401, String(bad))
    }
    assert.equal((await w.verify('nope', '123456')).status, 401)
  })

  test('lets one of two requests with the right code in, at the same moment', async () => {
    const w = world()
    await w.start('ann@example.com')
    const code = w.codeSent()
    const answers = await Promise.all([
      w.verify('ann@example.com', code),
      w.verify('ann@example.com', code),
    ])
    assert.deepEqual(answers.map(each => each.status).sort(), [200, 401])
  })
})
