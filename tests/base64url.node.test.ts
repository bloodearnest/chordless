/**
 * Reading a JWT's claims without checking it (src/js/base64url.ts): only for showing who a token
 * is for, so anything it cannot read is no one rather than an error.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { jwtClaims, toBase64Url } from '../src/js/base64url.ts'

const part = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)))
const token = (claims: unknown) => `${part({ alg: 'RS256' })}.${part(claims)}.sig`

test('reads the claims, whatever the text in them', () => {
  assert.deepEqual(jwtClaims(token({ email: 'zoë@example.com', exp: 5 })), {
    email: 'zoë@example.com',
    exp: 5,
  })
})

test('is null for what is not a token, or claims that are not an object', () => {
  for (const bad of ['', 'one-part', 'a.!!!.c', `x.${part('just text')}.y`, `x.${part(null)}.y`]) {
    assert.equal(jwtClaims(bad), null, bad)
  }
})
