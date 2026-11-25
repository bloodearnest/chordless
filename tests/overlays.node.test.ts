import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handleOverlays } from '../worker/src/overlays.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const T = '2026-11-25T10:00:00.000Z'

test('what a person keeps is theirs alone, versioned, and reaches only what they still can', async () => {
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
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
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
  const batch = async (who: string, ...ops: unknown[]) => {
    const response = await send(who, 'POST', '/api/account/overlays/batch', { ops })
    assert.equal(response.status, 200)
    return ((await response.json()) as { results: Record<string, unknown>[] }).results
  }
  const all = async (who: string) =>
    (await (await send(who, 'GET', '/api/account/overlays')).json()) as Record<string, any>
  const setlist = (setlistId: string, baseVersion: number | null, body: unknown = { capo: 2 }) => ({
    kind: 'setlist',
    op: 'put',
    setlistId,
    baseVersion,
    body,
  })
  const song = (
    libraryId: string,
    songUuid: string,
    baseVersion: number | null,
    body: unknown = { capo: 1 }
  ) => ({ kind: 'song', op: 'put', libraryId, songUuid, baseVersion, body })
  const prefs = (baseVersion: number | null, body: unknown = { musician_type: 'guitarist' }) => ({
    kind: 'preferences',
    op: 'put',
    baseVersion,
    body,
  })

  // Who asks, and what is said to anything in between
  assert.equal((await send(null, 'GET', '/api/account/overlays')).status, 401)
  assert.equal((await send('me', 'GET', '/api/account/other')).status, 404)
  assert.equal((await send('me', 'PUT', '/api/account/overlays')).status, 404)
  assert.equal(
    (await handleOverlays(new Request('https://example.test/api/account/overlays'), {} as Env))
      .status,
    503
  )
  assert.equal((await send('me', 'POST', '/api/account/overlays/batch', { ops: 'no' })).status, 400)
  const first = await send('me', 'GET', '/api/account/overlays')
  assert.equal(first.headers.get('Cache-Control'), 'private, no-cache')
  assert.equal(first.headers.get('Vary'), 'Authorization')
  assert.deepEqual(await first.json(), { preferences: null, setlists: [], songs: [] })
  const etag = first.headers.get('ETag') ?? ''
  assert.equal(
    (await send('me', 'GET', '/api/account/overlays', undefined, { 'If-None-Match': etag })).status,
    304
  )
  const written = await send('me', 'POST', '/api/account/overlays/batch', { ops: [] })
  assert.equal(written.headers.get('Cache-Control'), 'private, no-store')

  // Made, for what the person can reach: their own setlist and a team's, their own library and their church's
  assert.deepEqual(
    await batch(
      'me',
      setlist('my-set', null),
      setlist('team-set', null),
      song('my-lib', 'b', null),
      song('church-lib', 'a', null),
      prefs(null)
    ),
    [
      { status: 'ok', version: 1 },
      { status: 'ok', version: 1 },
      { status: 'ok', version: 1 },
      { status: 'ok', version: 1 },
      { status: 'ok', version: 1 },
    ]
  )
  const mine = await all('me')
  assert.deepEqual(mine.preferences, { body: { musician_type: 'guitarist' }, version: 1 })
  assert.deepEqual(
    mine.setlists.map((each: { setlistId: string }) => each.setlistId),
    ['my-set', 'team-set']
  )
  assert.equal(mine.songs.length, 2)

  // Not someone else's setlist or library, and nothing that is not there
  assert.deepEqual(
    await batch(
      'me',
      setlist('your-set', null),
      song('your-lib', 'c', null),
      setlist('nope', null),
      song('my-lib', 'nope', null)
    ),
    [
      { status: 'forbidden' },
      { status: 'forbidden' },
      { status: 'forbidden' },
      { status: 'forbidden' },
    ]
  )
  assert.deepEqual(
    await all('you'),
    { preferences: null, setlists: [], songs: [] },
    "nobody reads another person's"
  )

  // Changed from the version it was; refused, with the current, when changed meanwhile or made twice
  assert.deepEqual(await batch('me', setlist('my-set', 1, { capo: 3 })), [
    { status: 'ok', version: 2 },
  ])
  assert.deepEqual(await batch('me', setlist('my-set', 1, { capo: 4 })), [
    { status: 'conflict', current: { body: { capo: 3 }, version: 2 } },
  ])
  assert.deepEqual(await batch('me', setlist('my-set', null)), [
    { status: 'conflict', current: { body: { capo: 3 }, version: 2 } },
  ])
  assert.deepEqual(await batch('me', prefs(1, { tuning: '-1' })), [{ status: 'ok', version: 2 }])
  assert.deepEqual(await batch('me', setlist('team-set', 5)), [
    { status: 'conflict', current: { body: { capo: 2 }, version: 1 } },
  ])
  assert.deepEqual(await batch('me', setlist('gone', 1)), [{ status: 'missing' }])

  // What is asked of it is checked
  const bad = await batch(
    'me',
    { kind: 'other' },
    'text',
    { ...setlist('my-set', 2), setlistId: '../x' },
    { ...song('my-lib', 'b', 1), songUuid: '' },
    { ...song('my-lib', 'b', 1), libraryId: 4 },
    { ...setlist('my-set', 2), baseVersion: 0 },
    { ...setlist('my-set', 2), body: [] },
    { ...setlist('my-set', 2), body: { text: 'x'.repeat(300 * 1024) } },
    prefs(2, { not_a_setting: 'x' }),
    prefs(2, { tuning: 4 }),
    { ...setlist('my-set', 2), op: 'merge' }
  )
  assert.deepEqual(
    bad.map(each => each.status),
    Array(11).fill('invalid')
  )

  // Leaving the church ends reaching its setlists and library, though the rows are kept until they are removed
  sql.prepare('DELETE FROM church_members WHERE account_id = ?').run('me')
  const left = await all('me')
  assert.deepEqual(
    left.setlists.map((each: { setlistId: string }) => each.setlistId),
    ['my-set']
  )
  assert.deepEqual(
    left.songs.map((each: { libraryId: string }) => each.libraryId),
    ['my-lib']
  )
  assert.deepEqual(await batch('me', setlist('team-set', 1)), [{ status: 'forbidden' }])

  // Deleted, from the version it was or without one; a setlist taking its overlay with it
  assert.deepEqual(
    await batch('me', { kind: 'setlist', op: 'delete', setlistId: 'my-set', baseVersion: 1 }),
    [{ status: 'conflict', current: { body: { capo: 3 }, version: 2 } }]
  )
  assert.deepEqual(
    await batch(
      'me',
      { kind: 'setlist', op: 'delete', setlistId: 'my-set', baseVersion: 2 },
      { kind: 'song', op: 'delete', libraryId: 'my-lib', songUuid: 'b', baseVersion: null },
      { kind: 'preferences', op: 'delete', baseVersion: null },
      { kind: 'preferences', op: 'delete', baseVersion: null }
    ),
    [
      { status: 'ok', version: 0 },
      { status: 'ok', version: 0 },
      { status: 'ok', version: 0 },
      { status: 'ok', version: 0 },
    ]
  )
  assert.deepEqual((await all('me')).setlists, [])
  await batch('me', setlist('my-set', null))
  sql.prepare('DELETE FROM setlists WHERE setlist_id = ?').run('my-set')
  assert.equal(
    sql.prepare('SELECT count(*) AS n FROM setlist_overlays WHERE setlist_id = ?').get('my-set')?.n,
    0
  )
})
