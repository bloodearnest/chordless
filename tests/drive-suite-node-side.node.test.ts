/** The real-Drive suite's Node side: minting and reusing access tokens, and reading what was asked for */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  accessTokens,
  consentUrl,
  credentialsFromEnv,
  mintAccessToken,
  parseSeeds,
  readDevVars,
  settingsFromEnv,
  withEnvVariable,
} from './drive/node-side.ts'

const credentials = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh-1' }

/** A Google that gives out numbered tokens, and records what it was asked */
function fakeGoogle(reply: { status?: number; body?: object } = {}) {
  const asked: URLSearchParams[] = []
  const fetchFn = (async (_url: string, init: RequestInit) => {
    asked.push(new URLSearchParams(init.body as URLSearchParams))
    const body = reply.body ?? { access_token: `token-${asked.length}`, expires_in: 3600 }
    return new Response(JSON.stringify(body), { status: reply.status ?? 200 })
  }) as unknown as typeof fetch
  return { asked, fetch: fetchFn }
}

test('the credentials come from the environment, and a missing one is named', () => {
  assert.deepEqual(
    credentialsFromEnv({
      DRIVE_TEST_CLIENT_ID: 'a',
      DRIVE_TEST_CLIENT_SECRET: 'b',
      DRIVE_TEST_REFRESH_TOKEN: 'c',
    }),
    { credentials: { clientId: 'a', clientSecret: 'b', refreshToken: 'c' } }
  )
  assert.deepEqual(credentialsFromEnv({ DRIVE_TEST_CLIENT_ID: 'a' }), {
    missing: ['DRIVE_TEST_CLIENT_SECRET', 'DRIVE_TEST_REFRESH_TOKEN'],
  })
})

test('a token is asked for with the refresh token, and lasts as long as Google says', async () => {
  const google = fakeGoogle({ body: { access_token: 'abc', expires_in: 100 } })
  const minted = await mintAccessToken(credentials, { fetch: google.fetch, now: () => 1000 })
  assert.deepEqual(minted, { accessToken: 'abc', expiresAt: 101000 })
  assert.equal(google.asked[0].get('grant_type'), 'refresh_token')
  assert.equal(google.asked[0].get('refresh_token'), 'refresh-1')
})

test('when Google refuses, the error says why and does not hold the credentials', async () => {
  const google = fakeGoogle({
    status: 400,
    body: { error: 'invalid_grant', error_description: 'Token has been revoked' },
  })
  await assert.rejects(
    () => mintAccessToken(credentials, { fetch: google.fetch }),
    error => {
      assert.match((error as Error).message, /invalid_grant.*revoked/)
      assert.doesNotMatch((error as Error).message, /refresh-1|secret/)
      return true
    }
  )
})

test('a token is reused while it has time left, and minted again when it is nearly out', async () => {
  const google = fakeGoogle()
  let now = 0
  const token = accessTokens(credentials, { fetch: google.fetch, now: () => now })
  assert.equal(await token(), 'token-1')
  now = 30 * 60 * 1000
  assert.equal(await token(), 'token-1')
  now = 56 * 60 * 1000
  assert.equal(await token(), 'token-2')
  assert.equal(google.asked.length, 2)
})

test('tests asking at the same moment cost one request', async () => {
  const google = fakeGoogle()
  const token = accessTokens(credentials, { fetch: google.fetch })
  assert.deepEqual(await Promise.all([token(), token(), token()]), [
    'token-1',
    'token-1',
    'token-1',
  ])
  assert.equal(google.asked.length, 1)
})

test('the next run reuses the last token, unless the credentials changed; the file is private', async () => {
  const cachePath = join(mkdtempSync(join(tmpdir(), 'drive-token-')), 'nested', 'token.json')
  const google = fakeGoogle()
  await accessTokens(credentials, { cachePath, fetch: google.fetch })()
  assert.equal(statSync(cachePath).mode & 0o077, 0)
  assert.equal(JSON.parse(readFileSync(cachePath, 'utf8')).accessToken, 'token-1')

  const next = fakeGoogle()
  assert.equal(await accessTokens(credentials, { cachePath, fetch: next.fetch })(), 'token-1')
  assert.equal(next.asked.length, 0)

  const other = { ...credentials, refreshToken: 'refresh-2' }
  assert.equal(await accessTokens(other, { cachePath, fetch: next.fetch })(), 'token-1')
  assert.equal(next.asked.length, 1)
})

test('an unreadable cache is no reason to fail', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drive-token-'))
  const cachePath = join(dir, 'token.json')
  await import('node:fs').then(fs => fs.writeFileSync(cachePath, '{not json'))
  const google = fakeGoogle()
  assert.equal(await accessTokens(credentials, { cachePath, fetch: google.fetch })(), 'token-1')
})

test('the seeds are read from numbers, ranges and lists, and a mistake is said', () => {
  assert.deepEqual(parseSeeds('7', [1]), [7])
  assert.deepEqual(parseSeeds('1-3,9', [1]), [1, 2, 3, 9])
  assert.deepEqual(parseSeeds(' ', [4]), [4])
  assert.deepEqual(parseSeeds(undefined, [4]), [4])
  assert.throws(() => parseSeeds('one', [1]), /DRIVE_SEEDS: cannot read "one"/)
})

test('what the run was asked for has defaults, and a mistake is said', () => {
  assert.deepEqual(settingsFromEnv({}), {
    seeds: [1, 2, 3],
    steps: 30,
    devices: 3,
    modes: ['owner', 'concurrent'],
  })
  assert.deepEqual(
    settingsFromEnv({
      DRIVE_SEEDS: '5',
      DRIVE_STEPS: '12',
      DRIVE_DEVICES: '4',
      DRIVE_MODES: 'owner, conflicts',
    }),
    { seeds: [5], steps: 12, devices: 4, modes: ['owner', 'conflicts'] }
  )
  assert.throws(
    () => settingsFromEnv({ DRIVE_STEPS: 'many' }),
    /DRIVE_STEPS: "many" is not a number/
  )
})

test('the consent address asks for offline access to the files the suite makes, and carries the state', () => {
  const url = new URL(
    consentUrl({
      clientId: 'id',
      redirectUri: 'http://127.0.0.1:5',
      state: 's1',
      codeChallenge: 'c',
      loginHint: 'test@example.com',
    })
  )
  assert.equal(url.origin, 'https://accounts.google.com')
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('prompt'), 'consent')
  assert.equal(url.searchParams.get('state'), 's1')
  assert.equal(url.searchParams.get('login_hint'), 'test@example.com')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
})

test('a variable is added to an env file, or replaces the one in it', () => {
  assert.equal(
    withEnvVariable('', 'DRIVE_TEST_REFRESH_TOKEN', 'abc'),
    'DRIVE_TEST_REFRESH_TOKEN=abc\n'
  )
  assert.equal(
    withEnvVariable('A=1', 'DRIVE_TEST_REFRESH_TOKEN', 'abc'),
    'A=1\nDRIVE_TEST_REFRESH_TOKEN=abc\n'
  )
  assert.equal(
    withEnvVariable(
      'A=1\nDRIVE_TEST_REFRESH_TOKEN=old\nB=2\n',
      'DRIVE_TEST_REFRESH_TOKEN',
      'new$&'
    ),
    'A=1\nDRIVE_TEST_REFRESH_TOKEN=new$&\nB=2\n'
  )
})

test('a .dev.vars file is read as KEY=value lines, with quotes and comments set aside', () => {
  assert.deepEqual(
    readDevVars(
      '# the app\nGOOGLE_CLIENT_ID=abc\n  GOOGLE_CLIENT_SECRET = "s e"\nnot a line\nX=\n'
    ),
    { GOOGLE_CLIENT_ID: 'abc', GOOGLE_CLIENT_SECRET: 's e', X: '' }
  )
})
