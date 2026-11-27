import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handlePersonalSetlists } from '../worker/src/personal-setlists.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

test('a person has a library and setlists of their own, and nobody else sees them', async () => {
  const { db, sql } = d1Db()
  const env = {
    DB: db,
    SESSION_SIGNING_KEY: key(),
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    JWE_ENCRYPTION_KEY: key(),
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  const now = new Date().toISOString()
  for (const id of ['me', 'you'])
    sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(id, now)

  const send = async (who: string | null, method: string, path: string, body?: unknown) =>
    handlePersonalSetlists(
      new Request(`https://example.test${path}`, {
        method,
        headers: {
          ...(who === null
            ? {}
            : {
                Authorization: `Bearer ${await signAccessToken({ accountId: who, sessionId: 's', email: `${who}@example.com` }, env)}`,
              }),
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env
    )
  const batch = async (who: string, ...ops: unknown[]) => {
    const response = await send(who, 'POST', '/api/account/setlists/batch', { ops })
    assert.equal(response.status, 200)
    return ((await response.json()) as { results: Record<string, unknown>[] }).results
  }
  const list = async (who: string) =>
    (
      (await (await send(who, 'GET', '/api/account/setlists')).json()) as {
        setlists: { setlistId: string }[]
      }
    ).setlists
  const song = {
    songUuid: 'song',
    songId: 'song',
    title: 'Song',
    ccli: null,
    key: 'D',
    tempo: 100,
    notes: '',
    annotations: [],
    extra: {},
  }
  const record = (over: Record<string, unknown> = {}) => ({
    setlistId: 'set',
    date: '2026-11-22',
    time: '',
    type: '',
    name: 'Sunday',
    leaderId: null,
    createdBy: 'me@example.com',
    createdAt: now,
    body: {},
    songs: [],
    ...over,
  })
  const put = (baseVersion: number | null | undefined, data: unknown = record(), id = 'set') => ({
    kind: 'setlist',
    id,
    op: 'put',
    baseVersion,
    record: data,
  })

  // Signed in, and on the server
  assert.equal((await send(null, 'GET', '/api/account/setlists')).status, 401)
  // What the account holds, without making a library: nothing, then (below) what has been put there
  assert.deepEqual(await (await send('me', 'GET', '/api/account/library')).json(), {
    libraryId: null,
    songs: 0,
    setlists: 0,
  })
  assert.equal(sql.prepare('SELECT count(*) AS n FROM libraries').get()?.n, 0, 'asking makes none')
  assert.equal((await send(null, 'GET', '/api/account/library')).status, 401)
  assert.equal((await send('me', 'DELETE', '/api/account/setlists')).status, 404)
  assert.equal((await send('me', 'GET', '/api/other')).status, 404, 'a path that is not its own')
  assert.equal((await send('me', 'GET', '/api/account/setlists/batch')).status, 404)
  assert.equal(
    (
      await handlePersonalSetlists(
        new Request('https://example.test/api/account/setlists'),
        {} as Env
      )
    ).status,
    503
  )

  // The library is made when it is first asked for, once, and is the person's own
  const made = (await (await send('me', 'PUT', '/api/account/library')).json()) as {
    libraryId: string
  }
  assert.match(made.libraryId, /^[0-9A-Z]{26}$/)
  assert.deepEqual(await (await send('me', 'PUT', '/api/account/library')).json(), made)
  const yours = (await (await send('you', 'PUT', '/api/account/library')).json()) as {
    libraryId: string
  }
  assert.notEqual(yours.libraryId, made.libraryId)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM libraries').get()?.n, 2)
  assert.deepEqual(await list('me'), [])

  // What is read is kept by the browser and asked again, and says it depends on who asks
  const first = await send('me', 'GET', '/api/account/setlists')
  assert.equal(first.headers.get('Cache-Control'), 'private, no-cache')
  assert.equal(first.headers.get('Vary'), 'Authorization')
  const etag = first.headers.get('ETag') ?? ''
  assert.match(etag, /^"[0-9a-f]{64}"$/)
  const again = await handlePersonalSetlists(
    new Request('https://example.test/api/account/setlists', {
      headers: {
        Authorization: `Bearer ${await signAccessToken({ accountId: 'me', sessionId: 's', email: 'me@example.com' }, env)}`,
        'If-None-Match': etag,
      },
    }),
    env
  )
  assert.equal(again.status, 304)
  assert.equal(again.headers.get('ETag'), etag)
  assert.equal(again.headers.get('Vary'), 'Authorization')
  // (what is written, and what is refused, is kept by nobody)
  const written = await send('me', 'POST', '/api/account/setlists/batch', { ops: [] })
  assert.equal(written.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(written.headers.get('Vary'), 'Authorization')
  assert.equal(
    (await send(null, 'GET', '/api/account/setlists')).headers.get('Cache-Control'),
    'private, no-store'
  )

  // A setlist is made, changed from the version it was, and refused when it was changed meanwhile
  assert.deepEqual(await batch('me', put(null)), [{ status: 'ok', version: 1 }])
  assert.deepEqual(await (await send('me', 'GET', '/api/account/library')).json(), {
    libraryId: made.libraryId,
    songs: 0,
    setlists: 1,
  })
  assert.deepEqual(
    await (await send('you', 'GET', '/api/account/library')).json(),
    { libraryId: yours.libraryId, songs: 0, setlists: 0 },
    'only what is the account’s own'
  )
  assert.deepEqual(await batch('me', put(1, record({ name: 'Evening' }))), [
    { status: 'ok', version: 2 },
  ])
  const stale = (await batch('me', put(1, record({ name: 'Late' }))))[0]
  assert.equal(stale.status, 'conflict')
  assert.equal((stale.current as { name: string; version: number }).name, 'Evening')
  assert.equal(
    ((await batch('me', put(null)))[0].current as { version: number }).version,
    2,
    'made twice'
  )
  assert.deepEqual(await batch('me', put(3, record({ setlistId: 'none' }), 'none')), [
    { status: 'missing' },
  ])
  assert.deepEqual(
    (await list('me')).map(row => row.setlistId),
    ['set']
  )
  assert.notEqual(
    (await send('me', 'GET', '/api/account/setlists')).headers.get('ETag'),
    etag,
    'it changed'
  )
  assert.equal(
    sql.prepare("SELECT account_id, space_id FROM setlists WHERE setlist_id = 'set'").get()
      ?.space_id,
    null
  )

  // Nobody else sees it, changes it or takes its id
  assert.deepEqual(await list('you'), [])
  assert.deepEqual(await batch('you', put(null)), [{ status: 'conflict', current: null }])
  assert.deepEqual(await batch('you', put(2, record({ name: 'Mine now' }))), [
    { status: 'missing' },
  ])
  assert.deepEqual(await batch('you', { kind: 'setlist', op: 'delete', id: 'set' }), [
    { status: 'ok', version: 0 },
  ])
  assert.equal((await list('me')).length, 1, 'still there')

  // Songs must be in the person's own library
  assert.equal((await batch('me', put(2, record({ songs: [song] }))))[0].status, 'invalid')
  const insertSong = (library: string, uuid: string) =>
    sql
      .prepare(`INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, modified_at)
      VALUES (?, ?, ?, 'S', 1, ?)`)
      .run(library, uuid, uuid, now)
  insertSong(yours.libraryId, 'song')
  assert.equal(
    (await batch('me', put(2, record({ songs: [song] }))))[0].status,
    'invalid',
    "not yours: a song of someone else's library"
  )
  insertSong(made.libraryId, 'song')
  assert.deepEqual(await batch('me', put(2, record({ songs: [song] }))), [
    { status: 'ok', version: 3 },
  ])
  // (and to a team's setlist of the same id)
  sql
    .prepare(
      "INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at) VALUES ('c', 'C', 'GB', 'York', '{}', ?, ?)"
    )
    .run(now, now)
  sql
    .prepare(
      "INSERT INTO teams (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at, church_id) VALUES ('team', 'T', 'you', 'y@example.com', 'google', 's', ?, ?, 'c')"
    )
    .run(now, now)
  sql
    .prepare(
      "INSERT INTO setlists (setlist_id, space_id, date, time, type, name, created_at, modified_at) VALUES ('theirs', 'team', '2026-11-22', '', '', 'Team', ?, ?)"
    )
    .run(now, now)
  assert.deepEqual(await batch('me', put(null, record({ setlistId: 'theirs' }), 'theirs')), [
    { status: 'conflict', current: null },
  ])

  // The leader of one's own setlist is oneself, or nobody
  assert.equal(
    (await batch('me', put(3, record({ leaderId: 'you', songs: [song] }))))[0].status,
    'invalid'
  )
  assert.deepEqual(await batch('me', put(3, record({ leaderId: 'me', songs: [song] }))), [
    { status: 'ok', version: 4 },
  ])

  // ...or a name in words: one or the other, never both; trimmed; null when empty
  assert.equal(
    (await batch('me', put(4, record({ leaderId: 'me', leaderName: 'Sam', songs: [song] }))))[0]
      .status,
    'invalid'
  )
  assert.equal(
    (await batch('me', put(4, record({ leaderName: 'x'.repeat(201), songs: [song] }))))[0].status,
    'invalid'
  )
  assert.deepEqual(await batch('me', put(4, record({ leaderName: '  Sam  ', songs: [song] }))), [
    { status: 'ok', version: 5 },
  ])
  const named = (await list('me'))[0] as unknown as { leaderId: unknown; leaderName: unknown }
  assert.deepEqual([named.leaderId, named.leaderName], [null, 'Sam'])
  assert.deepEqual(await batch('me', put(5, record({ leaderName: '   ', songs: [song] }))), [
    { status: 'ok', version: 6 },
  ])
  assert.equal(((await list('me'))[0] as unknown as { leaderName: unknown }).leaderName, null)
  assert.deepEqual(await batch('me', put(6, record({ leaderId: 'me', songs: [song] }))), [
    { status: 'ok', version: 7 },
  ])

  // What is not a change, or not one that can be made
  const bad = await batch(
    'me',
    { kind: 'song', op: 'put', id: 'x' },
    { kind: 'setlist', op: 'put', id: 'bad id!', baseVersion: null, record: record() },
    put(0.5),
    put(undefined),
    { kind: 'setlist', op: 'merge', id: 'x', baseVersion: null },
    put(null, record({ setlistId: 'dated', date: 'yesterday' }), 'dated'),
    put(null, record({ setlistId: 'other' }), 'mismatch'),
    { kind: 'setlist', op: 'delete', id: 'set', baseVersion: 0 }
  )
  assert.deepEqual(
    bad.map(result => result.status),
    ['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid']
  )
  assert.equal((await send('me', 'POST', '/api/account/setlists/batch', { ops: 'no' })).status, 400)
  assert.equal(
    (
      await send('me', 'POST', '/api/account/setlists/batch', {
        ops: new Array(101).fill(put(null)),
      })
    ).status,
    400
  )

  // Deleting: from a version that is not the current one it is refused; from it, or from none, it goes
  const refused = (
    await batch('me', { kind: 'setlist', op: 'delete', id: 'set', baseVersion: 1 })
  )[0]
  assert.equal(refused.status, 'conflict')
  assert.deepEqual(
    await batch('me', { kind: 'setlist', op: 'delete', id: 'set', baseVersion: 7 }),
    [{ status: 'ok', version: 0 }]
  )
  assert.deepEqual(await batch('me', { kind: 'setlist', op: 'delete', id: 'set' }), [
    { status: 'ok', version: 0 },
  ])
  assert.deepEqual(await list('me'), [])
})
