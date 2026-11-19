/**
 * An account's Google Drive connection, kept at the Worker (worker/src/account-drive.ts, docs/ACCOUNT.md): a sign-in with Drive
 * keeps the blob for the account, any signed-in device asks for a Drive access token, a device's old blob is adopted once, and
 * disconnecting revokes at Google and forgets, for every device. Run in Node with Google replaced and a SQLite for D1.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { handleAccount } from '../worker/src/account.ts'
import { DRIVE_PATH, handleDrive } from '../worker/src/account-drive.ts'
import { type BlobData, decryptBlob, encryptBlob } from '../worker/src/blob.ts'
import type { Env } from '../worker/src/env.ts'
import type { GoogleApi } from '../worker/src/google-auth.ts'
import { handleOAuthCallback } from '../worker/src/session.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'

const NOW = new Date('2026-11-19T12:00:00.000Z')
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const REFRESH_TOKEN = 'refresh-token-that-must-not-leak'
const randomKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

const setup = () => {
  const { db, sql } = d1Db()
  const env = {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    JWE_ENCRYPTION_KEY: randomKey(),
    SESSION_SIGNING_KEY: randomKey(),
    ASSETS: { fetch: async () => new Response('assets') },
    DB: db,
  } satisfies Env
  return { env, sql }
}

type Calls = { name: string; args: unknown[] }[]
const fakeGoogle = (over: Partial<GoogleApi> = {}) => {
  const calls: Calls = []
  const google = {
    exchangeCode: async () => ({
      refresh_token: REFRESH_TOKEN,
      access_token: 'access-1',
      expires_in: 3600,
      scope: `openid email ${DRIVE_SCOPE}`,
      id_token: 'id-token',
      claims: { email: 'ann@gmail.example', sub: 'g-1', email_verified: true, name: 'Ann' },
    }),
    refreshAccessToken: async (token: string) => {
      calls.push({ name: 'refresh', args: [token] })
      return { access_token: 'drive-access', expires_in: 1800 }
    },
    revokeToken: async (token: string) => {
      calls.push({ name: 'revoke', args: [token] })
    },
    ...over,
  } as unknown as GoogleApi
  return { google, calls }
}

/** An account with a session, as an emailed sign-in makes (no Google) */
const account = async (env: Env, sql: ReturnType<typeof setup>['sql'], id = 'acct-1') => {
  const at = NOW.toISOString()
  sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(id, at)
  sql
    .prepare(
      "INSERT INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at) VALUES ('email', ?, ?, ?, ?, ?)"
    )
    .run('ann@hotmail.example', id, 'ann@hotmail.example', at, at)
  // (the Worker checks a token against the real clock)
  return signAccessToken({ accountId: id, sessionId: 's1', email: 'ann@hotmail.example' }, env)
}

const call = (
  env: Env,
  google: GoogleApi,
  method: string,
  path: string,
  token?: string,
  body?: unknown
) =>
  handleDrive(
    new Request(`https://chordless.test${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
    google,
    NOW
  )

const connect = async (env: Env, google: GoogleApi, token: string) =>
  handleOAuthCallback(
    new Request('https://chordless.test/oauth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: 'c', redirect_uri: 'https://chordless.test' }),
    }),
    env,
    google,
    NOW
  )

const blobOf = (over: Partial<BlobData> = {}): BlobData => ({
  owner_email: 'ann@gmail.example',
  owner_sub: 'g-1',
  scopes: DRIVE_SCOPE,
  refresh_token: REFRESH_TOKEN,
  created_at: '2026-10-14T12:00:00.000Z',
  blob_id: 'blob-1',
  kid: 'default',
  ...over,
})

const json = async (response: Response) => (await response.json()) as Record<string, unknown>

describe('a sign-in with Drive', () => {
  test('keeps the encrypted blob for the account it joins, and says whose Drive it is', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    const { google } = fakeGoogle()
    assert.equal((await connect(env, google, token)).status, 200)
    const row = sql.prepare('SELECT * FROM account_drive').get() as Record<string, string>
    assert.equal(row.account_id, 'acct-1')
    assert.equal(row.google_email, 'ann@gmail.example')
    assert.ok(
      !row.blob.includes(REFRESH_TOKEN),
      'the refresh token is not readable in what is kept'
    )
    assert.equal((await decryptBlob(row.blob, env)).refresh_token, REFRESH_TOKEN)

    const info = await handleAccount(
      new Request('https://chordless.test/api/account', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env
    )
    assert.deepEqual((await json(info)).drive, { email: 'ann@gmail.example' })
  })

  test('keeps nothing when Drive was not granted (its box left unticked)', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    const { google } = fakeGoogle({
      exchangeCode: async () => ({
        refresh_token: REFRESH_TOKEN,
        access_token: 'a',
        expires_in: 3600,
        scope: 'openid email profile',
        id_token: 'id-token',
        claims: { email: 'ann@gmail.example', sub: 'g-1', email_verified: true },
      }),
    } as never)
    await connect(env, google, token)
    assert.equal(sql.prepare('SELECT count(*) AS n FROM account_drive').get()?.n, 0)
  })

  test('a second one replaces the first: one connection for an account', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    await connect(env, fakeGoogle().google, token)
    await connect(env, fakeGoogle().google, token)
    assert.equal(sql.prepare('SELECT count(*) AS n FROM account_drive').get()?.n, 1)
  })
})

describe('POST /api/account/drive/token', () => {
  test('gives a Drive access token to any device signed in as the account, and nothing else of the credential', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    await connect(env, fakeGoogle().google, token)
    const { google, calls } = fakeGoogle()
    const response = await call(env, google, 'POST', `${DRIVE_PATH}/token`, token)
    assert.equal(response.status, 200)
    const body = await json(response)
    assert.deepEqual(body, { access_token: 'drive-access', expires_in: 1800 })
    assert.deepEqual(calls, [{ name: 'refresh', args: [REFRESH_TOKEN] }])
  })

  test('is 404 not_connected for an account with no Drive', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    const response = await call(env, fakeGoogle().google, 'POST', `${DRIVE_PATH}/token`, token)
    assert.equal(response.status, 404)
    assert.equal((await json(response)).error, 'not_connected')
  })

  test('says invalid_grant (401) when Google no longer honours it, and keeps the row to reconnect over', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    await connect(env, fakeGoogle().google, token)
    const { google } = fakeGoogle({
      refreshAccessToken: async () => {
        throw { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }
      },
    } as never)
    const response = await call(env, google, 'POST', `${DRIVE_PATH}/token`, token)
    assert.equal(response.status, 401)
    assert.equal((await json(response)).error, 'invalid_grant')
    assert.equal(sql.prepare('SELECT count(*) AS n FROM account_drive').get()?.n, 1)
  })

  test('says invalid_blob (401) for a blob this Worker can no longer read', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    sql
      .prepare(
        "INSERT INTO account_drive (account_id, blob, google_email, scope, created_at, updated_at) VALUES ('acct-1', 'not-a-blob', 'a@b.example', 'x', 'now', 'now')"
      )
      .run()
    const response = await call(env, fakeGoogle().google, 'POST', `${DRIVE_PATH}/token`, token)
    assert.equal(response.status, 401)
    assert.equal((await json(response)).error, 'invalid_blob')
  })

  test('needs a session', async () => {
    const { env } = setup()
    const response = await call(env, fakeGoogle().google, 'POST', `${DRIVE_PATH}/token`)
    assert.equal(response.status, 401)
  })

  test('is not set up on a Worker with no database', async () => {
    const { env } = setup()
    const { DB: _db, ...bare } = env
    const response = await call(bare, fakeGoogle().google, 'POST', `${DRIVE_PATH}/token`, 'x')
    assert.equal(response.status, 503)
  })
})

describe('POST /api/account/drive/adopt', () => {
  /** The account of a Google login that signed in on this device before the blob moved: the login is on the account */
  const withGoogleLogin = (sql: ReturnType<typeof setup>['sql'], id = 'acct-1') =>
    sql
      .prepare(
        "INSERT INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at) VALUES ('google', 'g-1', ?, 'ann@gmail.example', 'now', 'now')"
      )
      .run(id)

  test("keeps a device's blob for the account whose Google login it is", async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    withGoogleLogin(sql)
    const blob = await encryptBlob(blobOf(), env)
    const response = await call(env, fakeGoogle().google, 'POST', `${DRIVE_PATH}/adopt`, token, {
      blob,
    })
    assert.deepEqual(await json(response), { adopted: true })
    const row = sql.prepare('SELECT blob, google_email FROM account_drive').get()
    assert.equal(row?.blob, blob)
    assert.equal(row?.google_email, 'ann@gmail.example')
  })

  test('keeps what another device connected since: the connection already there is newer', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    withGoogleLogin(sql)
    await connect(env, fakeGoogle().google, token)
    const before = sql.prepare('SELECT blob FROM account_drive').get()?.blob
    const response = await call(env, fakeGoogle().google, 'POST', `${DRIVE_PATH}/adopt`, token, {
      blob: await encryptBlob(blobOf({ blob_id: 'old' }), env),
    })
    assert.deepEqual(await json(response), { adopted: false })
    assert.equal(sql.prepare('SELECT blob FROM account_drive').get()?.blob, before)
  })

  test('is refused (409) for a blob whose Google login is on another account: a blob is not a way to take one', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    withGoogleLogin(sql, 'someone-else')
    const response = await call(env, fakeGoogle().google, 'POST', `${DRIVE_PATH}/adopt`, token, {
      blob: await encryptBlob(blobOf(), env),
    })
    assert.equal(response.status, 409)
    assert.equal(sql.prepare('SELECT count(*) AS n FROM account_drive').get()?.n, 0)
  })

  test('keeps nothing from a blob without Drive in it', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    withGoogleLogin(sql)
    const response = await call(env, fakeGoogle().google, 'POST', `${DRIVE_PATH}/adopt`, token, {
      blob: await encryptBlob(blobOf({ scopes: 'openid email' }), env),
    })
    assert.deepEqual(await json(response), { adopted: false })
    assert.equal(sql.prepare('SELECT count(*) AS n FROM account_drive').get()?.n, 0)
  })

  test('refuses a blob it cannot read (401 invalid_blob) and a request with none (400)', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    const unreadable = await call(env, fakeGoogle().google, 'POST', `${DRIVE_PATH}/adopt`, token, {
      blob: 'not-a-blob',
    })
    assert.equal(unreadable.status, 401)
    assert.equal((await json(unreadable)).error, 'invalid_blob')
    const missing = await call(env, fakeGoogle().google, 'POST', `${DRIVE_PATH}/adopt`, token, {})
    assert.equal(missing.status, 400)
  })
})

describe('DELETE /api/account/drive', () => {
  test('revokes at Google and forgets, for every device', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    await connect(env, fakeGoogle().google, token)
    const { google, calls } = fakeGoogle()
    const response = await call(env, google, 'DELETE', DRIVE_PATH, token)
    assert.deepEqual(await json(response), { success: true, revoked: true })
    assert.deepEqual(calls, [{ name: 'revoke', args: [REFRESH_TOKEN] }])
    assert.equal(sql.prepare('SELECT count(*) AS n FROM account_drive').get()?.n, 0)
    const after = await call(env, google, 'POST', `${DRIVE_PATH}/token`, token)
    assert.equal(after.status, 404)
  })

  test('forgets the connection but leaves the grant when the account owns a team kept in its Drive', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    await connect(env, fakeGoogle().google, token)
    sql
      .prepare(
        "INSERT INTO teams (space_id, name, owner_email, owner_account_id, created_at, updated_at) VALUES ('t1', 'T', 'a@b.example', 'acct-1', 'now', 'now')"
      )
      .run()
    const { google, calls } = fakeGoogle()
    const response = await call(env, google, 'DELETE', DRIVE_PATH, token)
    assert.deepEqual(await json(response), { success: true, revoked: false })
    assert.deepEqual(calls, [], 'the team still uses the grant')
    assert.equal(sql.prepare('SELECT count(*) AS n FROM account_drive').get()?.n, 0)
  })

  test('forgets a grant Google already revoked, and one that cannot be read', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    await connect(env, fakeGoogle().google, token)
    const revoked = fakeGoogle({
      revokeToken: async () => {
        throw { error: 'invalid_token' }
      },
    } as never).google
    assert.equal((await call(env, revoked, 'DELETE', DRIVE_PATH, token)).status, 200)
    sql
      .prepare(
        "INSERT INTO account_drive (account_id, blob, google_email, scope, created_at, updated_at) VALUES ('acct-1', 'not-a-blob', 'a@b.example', 'x', 'now', 'now')"
      )
      .run()
    assert.equal((await call(env, fakeGoogle().google, 'DELETE', DRIVE_PATH, token)).status, 200)
    assert.equal(sql.prepare('SELECT count(*) AS n FROM account_drive').get()?.n, 0)
  })

  test('keeps the connection if Google could not be asked: not forgotten while still granted (502)', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    await connect(env, fakeGoogle().google, token)
    const down = fakeGoogle({
      revokeToken: async () => {
        throw new Error('network')
      },
    } as never).google
    assert.equal((await call(env, down, 'DELETE', DRIVE_PATH, token)).status, 502)
    assert.equal(sql.prepare('SELECT count(*) AS n FROM account_drive').get()?.n, 1)
  })

  test('has nothing to do for an account with no Drive, and 404s other methods and paths', async () => {
    const { env, sql } = setup()
    const token = await account(env, sql)
    const { google } = fakeGoogle()
    assert.equal((await call(env, google, 'DELETE', DRIVE_PATH, token)).status, 200)
    assert.equal((await call(env, google, 'GET', DRIVE_PATH, token)).status, 404)
    assert.equal((await call(env, google, 'POST', `${DRIVE_PATH}/other`, token)).status, 404)
  })
})
