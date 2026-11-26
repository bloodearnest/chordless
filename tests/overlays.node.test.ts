import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handleOverlays } from '../worker/src/overlays.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const T = '2026-11-25T10:00:00.000Z'

test('what a person keeps is one document of theirs alone, versioned, and reaches only what they still can', async () => {
  const { db, sql } = d1Db()
  const env = {
    DB: db,
    SESSION_SIGNING_KEY: key(),
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    JWE_ENCRYPTION_KEY: key(),
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  const run = (text: string, ...values: (string | null)[]) => sql.prepare(text).run(...values)
  for (const id of ['me', 'you'])
    run('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)', id, T)
  run(
    `INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at) VALUES ('c', 'C', 'GB', 'York', '{}', ?, ?)`,
    T,
    T
  )
  run(
    `INSERT INTO teams (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at, church_id) VALUES ('team', 'T', 'you', 'you@example.com', 'google', 's', ?, ?, 'c')`,
    T,
    T
  )
  run(
    `INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES ('c', 'me', 'reader', ?)`,
    T
  )
  run(`INSERT INTO libraries (library_id, church_id, created_at) VALUES ('church-lib', 'c', ?)`, T)
  run(`INSERT INTO libraries (library_id, account_id, created_at) VALUES ('my-lib', 'me', ?)`, T)
  run(`INSERT INTO libraries (library_id, account_id, created_at) VALUES ('your-lib', 'you', ?)`, T)
  for (const [lib, song] of [
    ['church-lib', 'a'],
    ['my-lib', 'b'],
    ['your-lib', 'c'],
  ])
    run(
      `INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, modified_at) VALUES (?, ?, ?, 'S', 1, ?)`,
      lib,
      song,
      song,
      T
    )
  for (const [id, team, account] of [
    ['team-set', 'team', null],
    ['my-set', null, 'me'],
    ['your-set', null, 'you'],
  ])
    run(
      `INSERT INTO setlists (setlist_id, space_id, account_id, date, time, type, name, created_at, modified_at) VALUES (?, ?, ?, '2026-11-22', '', '', 'Sunday', ?, ?)`,
      id,
      team,
      account,
      T,
      T
    )

  const send = async (
    who: string | null,
    method: string,
    body?: unknown,
    headers: Record<string, string> = {},
    path = '/api/account/overlays'
  ) =>
    handleOverlays(
      new Request(`https://example.test${path}`, {
        method,
        headers: {
          ...(who === null
            ? {}
            : {
                Authorization: `Bearer ${await signAccessToken({ accountId: who, sessionId: 's', email: `${who}@example.com` }, env)}`,
              }),
          'Content-Type': 'application/json',
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env
    )
  const read = async (who: string) =>
    (await (await send(who, 'GET')).json()) as {
      version: number
      body: Record<string, Record<string, unknown>>
    }
  const write = async (who: string, baseVersion: unknown, body: unknown) =>
    send(who, 'PUT', { baseVersion, body })
  const nothing = { settings: {}, setlists: {}, songs: {} }

  // Who asks, and what is said to anything in between
  assert.equal((await send(null, 'GET')).status, 401)
  assert.equal((await send('me', 'GET', undefined, {}, '/api/account/other')).status, 404)
  assert.equal((await send('me', 'DELETE')).status, 404)
  assert.equal(
    (await handleOverlays(new Request('https://example.test/api/account/overlays'), {} as Env))
      .status,
    503
  )
  const first = await send('me', 'GET')
  assert.equal(first.headers.get('Cache-Control'), 'private, no-cache')
  assert.equal(first.headers.get('Vary'), 'Authorization')
  assert.deepEqual(await first.json(), { version: 0, body: nothing })
  const etag = first.headers.get('ETag') ?? ''
  assert.equal((await send('me', 'GET', undefined, { 'If-None-Match': etag })).status, 304)
  const refused = await send('me', 'PUT', { baseVersion: 'x', body: nothing })
  assert.equal(refused.status, 400)
  assert.equal(refused.headers.get('Cache-Control'), 'private, no-store')

  // Made, from nothing: what the person can reach is kept, and what they cannot is not
  const mine = {
    settings: { musician_type: 'guitarist' },
    setlists: {
      'my-set': { capo: 2 },
      'team-set': { capo: 1 },
      'your-set': { capo: 9 },
      nope: { capo: 9 },
    },
    songs: { b: { capo: 1 }, a: { capo: 3 }, c: { capo: 9 }, nope: { capo: 9 } },
  }
  const made = await write('me', 0, mine)
  assert.deepEqual(await made.json(), { version: 1 })
  const kept = await read('me')
  assert.equal(kept.version, 1)
  assert.deepEqual(kept.body, {
    settings: { musician_type: 'guitarist' },
    setlists: { 'my-set': { capo: 2 }, 'team-set': { capo: 1 } },
    songs: { b: { capo: 1 }, a: { capo: 3 } },
  })
  assert.deepEqual(
    await read('you'),
    { version: 0, body: nothing },
    'nobody reads another person’s'
  )

  // Changed from the version it was; refused, with what is kept, when another device wrote first or it was made twice
  assert.deepEqual(
    await (await write('me', 1, { ...kept.body, settings: { tuning: '-1' } })).json(),
    { version: 2 }
  )
  const stale = await write('me', 1, nothing)
  assert.equal(stale.status, 409)
  assert.deepEqual(((await stale.json()) as { current: unknown }).current, {
    version: 2,
    body: { ...kept.body, settings: { tuning: '-1' } },
  })
  assert.equal((await write('me', 0, nothing)).status, 409, 'made twice')
  assert.equal((await write('you', 3, nothing)).status, 409, 'nothing to write from')

  // What is asked of it is checked
  const bad = [
    { baseVersion: -1, body: nothing },
    { baseVersion: 2 },
    { baseVersion: 2, body: [] },
    { baseVersion: 2, body: { ...nothing, extra: {} } },
    { baseVersion: 2, body: { settings: [], setlists: {}, songs: {} } },
    { baseVersion: 2, body: { ...nothing, settings: { not_a_setting: 'x' } } },
    { baseVersion: 2, body: { ...nothing, settings: { tuning: 4 } } },
    { baseVersion: 2, body: { ...nothing, setlists: { '../x': {} } } },
    { baseVersion: 2, body: { ...nothing, setlists: { 'my-set': [] } } },
    { baseVersion: 2, body: { ...nothing, songs: { '': {} } } },
    { baseVersion: 2, body: { ...nothing, songs: { b: 'x' } } },
    { baseVersion: 2, body: { ...nothing, songs: { b: { text: 'x'.repeat(1024 * 1024) } } } },
  ]
  for (const each of bad)
    assert.equal((await send('me', 'PUT', each)).status, 400, JSON.stringify(each).slice(0, 60))
  assert.deepEqual(
    await (await write('me', 2, { settings: {}, songs: { b: { capo: 4 } } })).json(),
    { version: 3 },
    'a part left out is none'
  )

  // Leaving the church ends reaching its setlist and library: it is no longer shown, and is not kept by the next write
  sql.prepare('DELETE FROM church_members WHERE account_id = ?').run('me')
  const left = await read('me')
  assert.deepEqual(left.body, { settings: {}, setlists: {}, songs: { b: { capo: 4 } } })
  await write('me', 3, { ...nothing, setlists: { 'team-set': { capo: 5 }, 'my-set': { capo: 6 } } })
  assert.deepEqual((await read('me')).body.setlists, { 'my-set': { capo: 6 } })
  assert.equal(
    sql.prepare('SELECT body FROM account_overlays WHERE account_id = ?').get('me')?.body,
    '{"settings":{},"setlists":{"my-set":{"capo":6}},"songs":{}}'
  )

  // The account takes its overlays with it
  run(`INSERT INTO accounts (account_id, created_at) VALUES ('gone', ?)`, T)
  sql
    .prepare(
      "INSERT INTO account_overlays (account_id, body, modified_at) VALUES ('gone', '{}', ?)"
    )
    .run(T)
  sql.prepare('DELETE FROM accounts WHERE account_id = ?').run('gone')
  assert.equal(
    sql.prepare('SELECT count(*) AS n FROM account_overlays WHERE account_id = ?').get('gone')?.n,
    0
  )
})
