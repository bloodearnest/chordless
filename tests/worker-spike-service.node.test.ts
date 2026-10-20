/**
 * The service account spike (worker/src/spike-service-account.ts, throwaway): the Worker signs a
 * JWT with the account's key, trades it for a token, and tries each operation in a folder.
 * Google and Drive are replaced.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handleSpikeService, signServiceAccountJwt } from '../worker/src/spike-service-account.ts'

const pair = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify']
)
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
  'base64'
)
const key = {
  client_email: 'chordless-broker@proj.iam.gserviceaccount.com',
  private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`,
}
const env = (over: Partial<Env> = {}) =>
  ({ SPIKE_SERVICE_ACCOUNT_KEY: JSON.stringify(key), ...over }) as Env

const call = (body: unknown, e: Env, fetcher?: typeof fetch) =>
  handleSpikeService(
    new Request('https://chordless.test/dev/spike/service', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    e,
    fetcher
  )

/** A Drive that does what is asked, apart from the things named in `refuse` */
function drive(refuse: string[] = [], tokenStatus = 200) {
  const seen: string[] = []
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    seen.push(`${method} ${url}`)
    if (url.includes('oauth2')) {
      return tokenStatus === 200
        ? Response.json({ access_token: 'sa-token' })
        : new Response('invalid_grant', { status: tokenStatus })
    }
    if (url.includes('upload/drive/v3/files?') && method === 'POST')
      return refuse.includes('create')
        ? new Response('no', { status: 403 })
        : Response.json({ id: 'new' })
    if (url.includes('alt=media')) return new Response('made by the service account')
    if (method === 'PATCH' && url.includes('upload')) return new Response('{}')
    if (method === 'PATCH') return new Response('{}')
    if (method === 'DELETE') return new Response('{"error":"forbidden"}', { status: 403 })
    if (url.includes('q=')) return Response.json({ files: [] })
    return refuse.includes('folder')
      ? new Response('nf', { status: 404 })
      : Response.json({ id: 'f' })
  }) as typeof fetch
  return { fetcher, seen }
}

describe('the service account spike', () => {
  test('signs a JWT that its public key verifies, naming the account and the scope', async () => {
    const jwt = await signServiceAccountJwt(key, 1_000_000)
    const [head, claims, signature] = jwt.split('.') as [string, string, string]
    const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString())
    assert.deepEqual(decode(head), { alg: 'RS256', typ: 'JWT' })
    assert.equal(decode(claims).iss, key.client_email)
    assert.equal(decode(claims).scope, 'https://www.googleapis.com/auth/drive')
    assert.equal(decode(claims).exp - decode(claims).iat, 3600)
    assert.ok(
      await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        pair.publicKey,
        Buffer.from(signature, 'base64url'),
        new TextEncoder().encode(`${head}.${claims}`)
      )
    )
  })

  test('tries every operation in the folder and reports each', async () => {
    const { fetcher, seen } = drive()
    const answer = (await (await call({ folderId: 'team' }, env(), fetcher)).json()) as {
      account: string
      steps: { step: string; ok: boolean }[]
    }
    assert.equal(answer.account, key.client_email)
    assert.equal(answer.steps.length, 8)
    assert.ok(answer.steps.every(step => step.ok))
    assert.ok(seen.some(line => line.startsWith('DELETE')))
  })

  test('stops at the first thing refused', async () => {
    const noFolder = (await (
      await call({ folderId: 't' }, env(), drive(['folder']).fetcher)
    ).json()) as {
      steps: unknown[]
    }
    assert.equal(noFolder.steps.length, 2)
    const noCreate = (await (
      await call({ folderId: 't' }, env(), drive(['create']).fetcher)
    ).json()) as {
      steps: unknown[]
    }
    assert.equal(noCreate.steps.length, 4)
  })

  test('says so when Google will not give a token, or the fetch fails', async () => {
    const refused = (await (
      await call({ folderId: 't' }, env(), drive([], 400).fetcher)
    ).json()) as {
      steps: { ok: boolean }[]
    }
    assert.deepEqual(
      refused.steps.map(s => s.ok),
      [false]
    )
    const broken = (await (
      await call({ folderId: 't' }, env(), (async () => {
        throw new Error('offline')
      }) as typeof fetch)
    ).json()) as { steps: { detail: string }[] }
    assert.equal(broken.steps[0]?.detail, 'offline')
  })

  test('asks for a folder, and for a key that is there and is JSON', async () => {
    assert.equal((await call({}, env())).status, 400)
    assert.equal(
      (await call({ folderId: 't' }, env({ SPIKE_SERVICE_ACCOUNT_KEY: undefined }))).status,
      500
    )
    assert.equal(
      (await call({ folderId: 't' }, env({ SPIKE_SERVICE_ACCOUNT_KEY: '{nope' }))).status,
      500
    )
  })

  test('is reached at /dev/spike/service only in dev', async () => {
    const { handleRequest } = await import('../worker/src/router.ts')
    const request = () =>
      new Request('https://chordless.test/dev/spike/service', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    const cache = { match: async () => undefined, put: async () => {} } as never
    const ctx = { waitUntil() {} }
    assert.equal((await handleRequest(request(), env(), ctx, cache)).status, 404)
    assert.equal((await handleRequest(request(), env({ DEV_PAGES: '1' }), ctx, cache)).status, 400)
  })
})
