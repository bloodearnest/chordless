/**
 * The worker's ID token check (worker/src/google-auth.ts). Tokens are signed with a key
 * made here, which stands in for Google's signing keys.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as jose from 'jose'
import { verifyIdToken } from '../worker/src/google-auth.ts'

const env = { GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com' }
const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true })
const other = await jose.generateKeyPair('RS256')
const publicJwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const keys = jose.createLocalJWKSet({ keys: [publicJwk] })

const sign = ({ key = privateKey, alg = 'RS256', claims = {}, exp = '1h', kid = 'k1' } = {}) => {
  const jwt = new jose.SignJWT({ email: 'a@example.com', ...claims })
    .setProtectedHeader({ alg, kid })
    .setIssuer('https://accounts.google.com')
    .setAudience(env.GOOGLE_CLIENT_ID)
    .setSubject('sub-1')
    .setIssuedAt()
  if (exp) jwt.setExpirationTime(exp)
  return jwt.sign(key)
}

// A jose error (JWSInvalid, JWTExpired, JWTClaimValidationFailed...), not some other failure
const rejects = (token, why) =>
  assert.rejects(
    () => verifyIdToken(token, env, keys),
    err => err?.code?.startsWith('ERR_J'),
    `should reject ${why}`
  )

test('a valid token gives its claims', async () => {
  const claims = await verifyIdToken(await sign(), env, keys)
  assert.equal(claims.sub, 'sub-1')
  assert.equal(claims.email, 'a@example.com')
})

test('the issuer without the scheme is accepted', async () => {
  const token = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('accounts.google.com')
    .setAudience(env.GOOGLE_CLIENT_ID)
    .setSubject('s')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
  assert.equal((await verifyIdToken(token, env, keys)).sub, 's')
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
  const token = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com')
    .setAudience('someone-else')
    .setSubject('s')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
  await rejects(token, 'wrong audience')
})

test('a token from another issuer is rejected', async () => {
  const token = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://evil.example')
    .setAudience(env.GOOGLE_CLIENT_ID)
    .setSubject('s')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
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
