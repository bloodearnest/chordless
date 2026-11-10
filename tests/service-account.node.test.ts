/**
 * Chordless's service account for team storage (worker/src/service-account.ts): the request for a
 * token it signs with its key, what it makes of Google's answer, and the check of a team's folder
 * before a space is switched to it, against the fake Drive.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import * as jose from 'jose'
import { createDriveApi } from '../src/js/drive-client.ts'
import {
  checkTeamStorage,
  forgetServiceAccountTokens,
  serviceAccountAddress,
  serviceAccountToken,
} from '../worker/src/service-account.ts'
import { CredentialError } from '../worker/src/team-drive.ts'
import { FakeDrive } from './fake-drive.ts'
import { must } from './must.ts'

const ADDRESS = 'team-storage@chordless-app.iam.gserviceaccount.com'
const TOKEN_URI = 'https://oauth2.googleapis.com/token'
const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true })
const KEY = JSON.stringify({
  type: 'service_account',
  client_email: ADDRESS,
  private_key: await jose.exportPKCS8(privateKey),
  token_uri: TOKEN_URI,
})

/** Google's token endpoint: it checks the signed request with the account's public key */
function tokenEndpoint(answer: { status?: number; body?: unknown } = {}) {
  const asked: URLSearchParams[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), TOKEN_URI)
    const form = new URLSearchParams(String(init?.body))
    asked.push(form)
    return Response.json(
      answer.body ?? { access_token: `token-${asked.length}`, expires_in: 3600 },
      {
        status: answer.status ?? 200,
      }
    )
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

describe('the service account’s token', () => {
  beforeEach(() => forgetServiceAccountTokens())

  test('is asked for with a request signed by its key, for Drive, and kept for its hour', async () => {
    const google = tokenEndpoint()
    let clock = Date.parse('2026-11-10T12:00:00Z')
    const token = serviceAccountToken({
      env: { TEAM_STORAGE_KEY: KEY },
      fetch: google.fetch,
      now: () => clock,
    })

    assert.equal(await token(), 'token-1')
    const form = must(google.asked[0])
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
    const { payload, protectedHeader } = await jose.jwtVerify(
      must(form.get('assertion')),
      publicKey,
      {
        issuer: ADDRESS,
        audience: TOKEN_URI,
        currentDate: new Date(clock),
      }
    )
    assert.equal(protectedHeader.alg, 'RS256')
    assert.equal(payload.scope, 'https://www.googleapis.com/auth/drive')
    assert.equal(Number(payload.exp) - Number(payload.iat), 3600)

    // (two callers at once, and later in the hour, are given the same one)
    assert.deepEqual(await Promise.all([token(), token()]), ['token-1', 'token-1'])
    clock += 50 * 60 * 1000
    assert.equal(await token(), 'token-1')
    // (near its end, a new one is made)
    clock += 6 * 60 * 1000
    assert.equal(await token(), 'token-2')
  })

  test('is refused, saying why, when Google will not give one, and asked for again next time', async () => {
    const refused = tokenEndpoint({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' },
    })
    const token = serviceAccountToken({
      env: { TEAM_STORAGE_KEY: KEY },
      fetch: refused.fetch,
      now: Date.now,
    })
    await assert.rejects(token(), (error: unknown) => {
      assert.ok(error instanceof CredentialError)
      assert.equal(error.status, 502)
      assert.match(error.message, /Invalid JWT Signature/)
      return true
    })
    await assert.rejects(token())
    assert.equal(refused.asked.length, 2)

    const odd = { fetch: (async () => new Response('not json', { status: 500 })) as typeof fetch }
    const again = serviceAccountToken({
      env: { TEAM_STORAGE_KEY: KEY },
      fetch: odd.fetch,
      now: Date.now,
    })
    await assert.rejects(again(), /HTTP 500/)
  })

  test('is taken to last no time when Google does not say how long', async () => {
    const google = tokenEndpoint({ body: { access_token: 'brief' } })
    const token = serviceAccountToken({
      env: { TEAM_STORAGE_KEY: KEY },
      fetch: google.fetch,
      now: Date.now,
    })
    assert.equal(await token(), 'brief')
    assert.equal(await token(), 'brief')
    assert.equal(google.asked.length, 2)
  })

  test('is not there where no key is set, and a key that is not one is said to be wrong', async () => {
    const none = serviceAccountToken({ env: {}, fetch: tokenEndpoint().fetch, now: Date.now })
    await assert.rejects(
      none(),
      (error: unknown) => error instanceof CredentialError && error.status === 409
    )
    assert.equal(serviceAccountAddress({}), null)
    assert.equal(serviceAccountAddress({ TEAM_STORAGE_KEY: KEY }), ADDRESS)
    assert.throws(() => serviceAccountAddress({ TEAM_STORAGE_KEY: 'not json' }), /not the JSON/)
    assert.throws(() => serviceAccountAddress({ TEAM_STORAGE_KEY: '{}' }), /no client_email/)
    assert.throws(() => serviceAccountAddress({ TEAM_STORAGE_KEY: 'null' }), /no client_email/)
  })

  test('is asked for at Google’s own endpoint when the key does not name one', async () => {
    const { token_uri: _, ...rest } = JSON.parse(KEY)
    const google = tokenEndpoint()
    const token = serviceAccountToken({
      env: { TEAM_STORAGE_KEY: JSON.stringify(rest) },
      fetch: google.fetch,
      now: Date.now,
    })
    assert.equal(await token(), 'token-1')
  })
})

describe('the check of a team’s folder', () => {
  async function folder({ shared = true } = {}) {
    const drive = new FakeDrive()
    const api = createDriveApi({
      getAccessToken: async () => 'fake-drive-token',
      fetch: ((input, init) => drive.handle(input, init)) as typeof fetch,
    })
    const root = await api.createTeamFolder('root', 'Team Chordless')
    if (shared) drive.files.get(root).driveId = 'shared-drive-1'
    return { drive, api, root }
  }

  test('passes a folder in a shared drive it can change, and leaves its file in the bin', async () => {
    const { drive, api, root } = await folder()
    assert.equal(await checkTeamStorage(api, root, ADDRESS), null)
    const made = [...drive.files.values()].filter(file => file.parents?.includes(root))
    assert.equal(made.length, 1)
    assert.equal(made[0].trashed, true)
  })

  test('says to add the address when it cannot see the folder', async () => {
    const { api } = await folder()
    assert.match(
      must(await checkTeamStorage(api, 'not-shared-with-it', ADDRESS)),
      new RegExp(`add ${ADDRESS}`)
    )
  })

  test('says the folder must be in a shared drive when it is in a My Drive', async () => {
    const { api, root } = await folder({ shared: false })
    assert.match(must(await checkTeamStorage(api, root, ADDRESS)), /shared drive/)
  })

  test('says it must be a Content manager when it can only read', async () => {
    const { drive, api, root } = await folder()
    drive.readOnly = true
    assert.match(must(await checkTeamStorage(api, root, ADDRESS)), /Content manager/)
  })

  test('says what went wrong when the file cannot be made, read or binned', async () => {
    const { drive, api, root } = await folder()
    drive.failRequests({ method: 'POST', status: 500, times: 1 })
    assert.match(must(await checkTeamStorage(api, root, ADDRESS)), /could not make, read and bin/)

    // (one that is made but cannot be binned is binned on the way out, if it can be)
    drive.failRequests({ method: 'PATCH', status: 500, times: 1 })
    assert.match(must(await checkTeamStorage(api, root, ADDRESS)), /could not make, read and bin/)
    const left = [...drive.files.values()].filter(
      file => file.parents?.includes(root) && !file.trashed
    )
    assert.deepEqual(left, [])

    // (and one that cannot be binned at all is left: the check still says why)
    drive.failRequests({ method: 'PATCH', status: 500, times: 2 })
    assert.match(must(await checkTeamStorage(api, root, ADDRESS)), /could not make, read and bin/)
  })

  test('passes on a refusal to show the folder as not seeing it, and anything else as it is', async () => {
    const { drive, api, root } = await folder()
    drive.failRequests({ method: 'GET', status: 403, times: 1 })
    assert.match(must(await checkTeamStorage(api, root, ADDRESS)), /cannot see/)
    drive.failRequests({ method: 'GET', status: 500, times: 1 })
    await assert.rejects(checkTeamStorage(api, root, ADDRESS))
  })
})
