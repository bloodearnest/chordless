/**
 * The worker's side of Google sign-in (worker/src/google-auth.ts): the ID token check, and the
 * calls to the token endpoint. Tokens are signed with a key made here, which stands in for Google's
 * signing keys, and the token endpoint is a fetch that answers as Google does.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as jose from 'jose'
import {
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  verifyIdToken,
} from '../worker/src/google-auth.ts'

const env = {
  GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'unused',
}
const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true })
const other = await jose.generateKeyPair('RS256')
const publicJwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const keys = jose.createLocalJWKSet({ keys: [publicJwk] })

const sign = ({
  key = privateKey,
  alg = 'RS256',
  claims = {},
  exp = '1h',
  kid = 'k1',
  iss = 'https://accounts.google.com',
  aud = env.GOOGLE_CLIENT_ID,
}: {
  key?: jose.CryptoKey | Uint8Array
  alg?: string
  claims?: object
  exp?: string | number | null
  kid?: string
  iss?: string
  aud?: string
} = {}) => {
  const jwt = new jose.SignJWT({ email: 'a@example.com', ...claims })
    .setProtectedHeader({ alg, kid })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject('sub-1')
    .setIssuedAt()
  if (exp) jwt.setExpirationTime(exp)
  return jwt.sign(key)
}

// A jose error (JWSInvalid, JWTExpired, JWTClaimValidationFailed...), not some other failure
const rejects = (token, why) =>
  assert.rejects(
    () => verifyIdToken(token, env, keys),
    err => (err as { code?: string })?.code?.startsWith('ERR_J'),
    `should reject ${why}`
  )

test('a valid token gives its claims', async () => {
  const claims = await verifyIdToken(await sign(), env, keys)
  assert.equal(claims.sub, 'sub-1')
  assert.equal(claims.email, 'a@example.com')
})

test('the issuer without the scheme is accepted', async () => {
  const token = await sign({ iss: 'accounts.google.com' })
  assert.equal((await verifyIdToken(token, env, keys)).sub, 'sub-1')
})

test('alg none is rejected', async () => {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: env.GOOGLE_CLIENT_ID,
    sub: 'sub-1',
    iat: now,
    exp: now + 3600,
  })}.`
  await rejects(token, 'alg none')
})

test('HS256 signed with the public key is rejected (algorithm confusion)', async () => {
  const secret = new TextEncoder().encode(JSON.stringify(publicJwk))
  await rejects(await sign({ key: secret, alg: 'HS256' }), 'HS256 confusion')
})

test('a token signed by another key is rejected', async () => {
  await rejects(await sign({ key: other.privateKey }), 'wrong key')
})

test('a token for another app (audience) is rejected', async () => {
  const token = await sign({ aud: 'someone-else' })
  await rejects(token, 'wrong audience')
})

test('a token from another issuer is rejected', async () => {
  const token = await sign({ iss: 'https://evil.example' })
  await rejects(token, 'wrong issuer')
})

test('an expired token is rejected', async () => {
  await rejects(await sign({ exp: Math.floor(Date.now() / 1000) - 60 }), 'expired')
})

test('a token with no expiry is rejected', async () => {
  await rejects(await sign({ exp: null }), 'no exp')
})

test('garbage is rejected', async () => {
  await rejects('not.a.jwt', 'garbage')
  await rejects('', 'empty')
})

// ---- Talking to Google's token endpoint (a fake one here) ----

const secretEnv = { ...env, GOOGLE_CLIENT_SECRET: 'the-secret' }

/** A fetch that records the requests to Google and answers each with `respond` */
function fakeGoogle(respond: (request: Request) => Response | Promise<Response>) {
  const requests: { url: string; method: string; form: URLSearchParams }[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push({
      url: request.url,
      method: request.method,
      form: new URLSearchParams(await request.clone().text()),
    })
    return respond(request)
  }
  return { fetch: fetch as typeof globalThis.fetch, requests }
}

const tokenResponse = (body: object, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

test('exchanging a code asks the token endpoint for tokens, and checks the ID token that comes back', async () => {
  const idToken = await sign({ claims: { email: 'ann@example.com' } })
  const google = fakeGoogle(() =>
    tokenResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      expires_in: 3599,
      scope: 'openid email',
      id_token: idToken,
    })
  )

  const tokens = await exchangeCode('code-1', 'https://chordless.app', secretEnv, {
    fetch: google.fetch,
    keys,
  })

  assert.equal(google.requests.length, 1)
  const [request] = google.requests
  assert.equal(request.url, 'https://oauth2.googleapis.com/token')
  assert.equal(request.method, 'POST')
  assert.equal(request.form.get('grant_type'), 'authorization_code')
  assert.equal(request.form.get('code'), 'code-1')
  assert.equal(request.form.get('redirect_uri'), 'https://chordless.app')
  assert.equal(request.form.get('client_id'), env.GOOGLE_CLIENT_ID)
  assert.equal(request.form.get('client_secret'), 'the-secret')

  assert.equal(tokens.access_token, 'access-1')
  assert.equal(tokens.refresh_token, 'refresh-1')
  assert.equal(tokens.expires_in, 3599)
  assert.equal(tokens.claims?.email, 'ann@example.com')
  assert.equal(tokens.claims?.sub, 'sub-1')
})

test('exchanging a code with no ID token in the answer gives no claims', async () => {
  const google = fakeGoogle(() =>
    tokenResponse({ access_token: 'access-1', token_type: 'Bearer', expires_in: 3599 })
  )

  const tokens = await exchangeCode('code-1', 'https://chordless.app', secretEnv, {
    fetch: google.fetch,
    keys,
  })

  assert.equal(tokens.access_token, 'access-1')
  assert.equal(tokens.claims, null)
})

test('exchanging a code is refused when Google refuses the code', async () => {
  const google = fakeGoogle(() =>
    tokenResponse({ error: 'invalid_grant', error_description: 'Bad Request' }, 400)
  )

  await assert.rejects(
    () =>
      exchangeCode('used-code', 'https://chordless.app', secretEnv, { fetch: google.fetch, keys }),
    (error: Error & { error?: string }) => error.error === 'invalid_grant'
  )
})

test("exchanging a code is refused when the ID token that comes back is not Google's", async () => {
  const forged = await sign({ key: other.privateKey })
  const google = fakeGoogle(() =>
    tokenResponse({
      access_token: 'access-1',
      token_type: 'Bearer',
      expires_in: 3599,
      id_token: forged,
    })
  )

  await assert.rejects(
    () => exchangeCode('code-1', 'https://chordless.app', secretEnv, { fetch: google.fetch, keys }),
    (error: Error & { code?: string }) => error.code?.startsWith('ERR_J') === true
  )
})

test('exchanging a code is refused when the ID token is for another app', async () => {
  const google = fakeGoogle(async () =>
    tokenResponse({
      access_token: 'access-1',
      token_type: 'Bearer',
      expires_in: 3599,
      id_token: await sign({ aud: 'someone-elses-client' }),
    })
  )

  await assert.rejects(() =>
    exchangeCode('code-1', 'https://chordless.app', secretEnv, { fetch: google.fetch, keys })
  )
})

test('exchanging a code is refused when Google cannot be reached', async () => {
  const google = fakeGoogle(() => {
    throw new TypeError('network down')
  })

  await assert.rejects(
    () => exchangeCode('code-1', 'https://chordless.app', secretEnv, { fetch: google.fetch, keys }),
    /network down/
  )
})

test('refreshing asks the token endpoint with the refresh token, and gives the new access token', async () => {
  const google = fakeGoogle(() =>
    tokenResponse({ access_token: 'access-2', token_type: 'Bearer', expires_in: 3599 })
  )

  const tokens = await refreshAccessToken('refresh-1', secretEnv, { fetch: google.fetch })

  const [request] = google.requests
  assert.equal(request.url, 'https://oauth2.googleapis.com/token')
  assert.equal(request.form.get('grant_type'), 'refresh_token')
  assert.equal(request.form.get('refresh_token'), 'refresh-1')
  assert.equal(request.form.get('client_id'), env.GOOGLE_CLIENT_ID)
  assert.equal(request.form.get('client_secret'), 'the-secret')
  assert.equal(tokens.access_token, 'access-2')
  assert.equal(tokens.expires_in, 3599)
})

test('refreshing is refused when Google has revoked the refresh token', async () => {
  const google = fakeGoogle(() =>
    tokenResponse({ error: 'invalid_grant', error_description: 'Token has been revoked.' }, 400)
  )

  await assert.rejects(
    () => refreshAccessToken('revoked', secretEnv, { fetch: google.fetch }),
    (error: Error & { error?: string }) => error.error === 'invalid_grant'
  )
})

test('revoking a token asks the revocation endpoint, with the token and no secret', async () => {
  const google = fakeGoogle(() => new Response('', { status: 200 }))

  await revokeToken('refresh-1', secretEnv, { fetch: google.fetch })

  const [request] = google.requests
  assert.equal(request.url, 'https://oauth2.googleapis.com/revoke')
  assert.equal(request.method, 'POST')
  assert.equal(request.form.get('token'), 'refresh-1')
  assert.equal(request.form.get('client_secret'), null)
})

test('revoking is refused, as invalid_token, when the token is already revoked', async () => {
  const google = fakeGoogle(() => tokenResponse({ error: 'invalid_token' }, 400))

  await assert.rejects(
    () => revokeToken('revoked', secretEnv, { fetch: google.fetch }),
    (error: Error & { error?: string }) => error.error === 'invalid_token'
  )
})
