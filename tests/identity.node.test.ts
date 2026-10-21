/**
 * Who is asking the team space API (worker/src/identity.ts): the Bearer token is the provider's ID
 * token, matched to its provider by issuer, and anything that is not a valid one names no one.
 * Tokens are signed with a key made here, which stands in for Google's signing keys.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as jose from 'jose'
import {
  authenticate,
  googleProvider,
  type Identity,
  type IdentityProvider,
  identityKey,
} from '../worker/src/identity.ts'

const env = {
  GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'unused',
}
const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true })
const other = await jose.generateKeyPair('RS256')
const publicJwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const keys = jose.createLocalJWKSet({ keys: [publicJwk] })
const providers = [googleProvider(env, keys)]

const sign = ({
  key = privateKey,
  claims = {},
  exp = '1h',
  iss = 'https://accounts.google.com',
  aud = env.GOOGLE_CLIENT_ID,
  sub = 'sub-1',
}: {
  key?: jose.CryptoKey
  claims?: object
  exp?: string
  iss?: string
  aud?: string
  sub?: string
} = {}) =>
  new jose.SignJWT({ email: 'Ann@Example.com', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key)

const asking = (token?: string, scheme = 'Bearer') =>
  new Request('https://chordless.test/api/space/s1/root', {
    headers: token === undefined ? {} : { Authorization: `${scheme} ${token}` },
  })

describe('a Google ID token', () => {
  test('names the account: provider, sub and the verified email, in lower case', async () => {
    assert.deepEqual(await authenticate(asking(await sign()), providers), {
      provider: 'google',
      sub: 'sub-1',
      email: 'ann@example.com',
    })
  })

  test('is accepted with the issuer written without the scheme', async () => {
    const token = await sign({ iss: 'accounts.google.com' })
    assert.equal((await authenticate(asking(token), providers))?.sub, 'sub-1')
  })

  test('names no one when the email is not verified, or there is none', async () => {
    for (const claims of [{ email_verified: false }, { email_verified: undefined }, { email: 1 }]) {
      assert.equal(await authenticate(asking(await sign({ claims })), providers), null)
    }
    const noEmail = await new jose.SignJWT({ email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://accounts.google.com')
      .setAudience(env.GOOGLE_CLIENT_ID)
      .setSubject('sub-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)
    assert.equal(await authenticate(asking(noEmail), providers), null)
  })

  test('names no one when the sub is empty', async () => {
    assert.equal(await authenticate(asking(await sign({ sub: '' })), providers), null)
  })

  test('names no one when it is expired, for another app, or signed with another key', async () => {
    const tokens = [
      await sign({ exp: '-1m' }),
      await sign({ aud: 'someone-elses.apps.googleusercontent.com' }),
      await sign({ key: other.privateKey }),
    ]
    for (const token of tokens) assert.equal(await authenticate(asking(token), providers), null)
  })

  test('names no one with alg none', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      iss: 'https://accounts.google.com',
      aud: env.GOOGLE_CLIENT_ID,
      sub: 'sub-1',
      email: 'ann@example.com',
      email_verified: true,
      iat: now,
      exp: now + 3600,
    })}.`
    assert.equal(await authenticate(asking(token), providers), null)
  })
})

describe('a request', () => {
  test('names no one without a Bearer token, or with one that is not a token', async () => {
    assert.equal(await authenticate(asking(), providers), null)
    assert.equal(await authenticate(asking(await sign(), 'Basic'), providers), null)
    assert.equal(await authenticate(asking('garbage'), providers), null)
  })

  test('is matched to its provider by issuer, and a token of no known issuer is not tried', async () => {
    const asked: string[] = []
    const elsewhere: IdentityProvider = {
      id: 'elsewhere',
      issuers: ['https://login.elsewhere.example'],
      async verify(token) {
        asked.push(token)
        return { provider: 'elsewhere', sub: 'e-1', email: 'ann@example.com' }
      },
    }
    const both = [...providers, elsewhere]

    const theirs = await sign({ iss: 'https://login.elsewhere.example' })
    assert.equal((await authenticate(asking(theirs), both))?.provider, 'elsewhere')
    assert.equal((await authenticate(asking(await sign()), both))?.provider, 'google')

    asked.length = 0
    const unknown = await sign({ iss: 'https://unknown.example' })
    assert.equal(await authenticate(asking(unknown), both), null)
    assert.deepEqual(asked, [])
  })
})

test('a member is keyed by provider and sub, so the same sub from two providers is two people', () => {
  const google: Identity = { provider: 'google', sub: '42', email: 'a@example.com' }
  const elsewhere: Identity = { provider: 'elsewhere', sub: '42', email: 'a@example.com' }
  assert.equal(identityKey(google), 'google:42')
  assert.notEqual(identityKey(google), identityKey(elsewhere))
})
