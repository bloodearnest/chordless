/**
 * The sign-in and session routes (worker/src/session.ts) and the token blob (worker/src/blob.ts),
 * run in Node with Google replaced: what each route refuses, what it answers, and that a refresh
 * token only ever leaves the Worker inside an encrypted blob.
 */

import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import * as jose from 'jose'
import { type BlobData, decryptBlob, encryptBlob } from '../worker/src/blob.ts'
import type { Env } from '../worker/src/env.ts'
import {
  type GoogleApi,
  handleOAuthCallback,
  handleSessionLogout,
  handleTokenRefresh,
} from '../worker/src/session.ts'

const randomKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  JWE_ENCRYPTION_KEY: randomKey(),
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

  test('fails for a blob that is not ours, and asks Google nothing', async () => {
    const { google, calls } = fakeGoogle()
    const other = await encryptBlob(blobData(), { JWE_ENCRYPTION_KEY: randomKey() })
    await assert.rejects(handleTokenRefresh(post('/session/refresh', { blob: other }), env, google))
    await assert.rejects(
      handleTokenRefresh(post('/session/refresh', { blob: 'garbage' }), env, google)
    )
    assert.equal(calls.length, 0)
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
    assert.equal((await logout({ blob: 'not-a-blob' }, google)).status, 400)
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
