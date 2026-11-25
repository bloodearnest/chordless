import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { handleShares, removeEndedShares } from '../worker/src/shares.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const T = '2026-11-25T10:00:00.000Z'

function rig() {
  const { db, sql } = d1Db()
  const run = (text: string, ...values: (string | null)[]) => sql.prepare(text).run(...values)
  for (const id of ['leader', 'reader', 'writer', 'other'])
    run('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)', id, T)
  run(
    `INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at) VALUES ('c', 'C', 'GB', 'York', '{}', ?, ?)`,
    T,
    T
  )
  run(
    `INSERT INTO teams (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at, church_id) VALUES ('team', 'T', 'leader', 'l@example.com', 'google', 's', ?, ?, 'c')`,
    T,
    T
  )
  for (const [account, role] of [
    ['leader', 'admin'],
    ['writer', 'writer'],
    ['reader', 'reader'],
  ])
    run(
      'INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)',
      'c',
      account,
      role,
      T
    )
  const setlist = (id: string, team: string | null, account: string | null, date: string) =>
    run(
      `INSERT INTO setlists (setlist_id, space_id, account_id, date, time, type, name, created_at, modified_at) VALUES (?, ?, ?, ?, '', '', 'Sunday', ?, ?)`,
      id,
      team,
      account,
      date,
      T,
      T
    )
  setlist('team-set', 'team', null, '2026-12-06')
  setlist('mine', null, 'other', '2020-01-01')
  const objects = new Map<string, string>()
  const env = {
    DB: db,
    SONG_BUCKET: {
      async list({ prefix }: { prefix: string }) {
        return {
          objects: [...objects.keys()]
            .filter(k => k.startsWith(prefix))
            .map(k => ({ key: k, size: 1 })),
        }
      },
      async get(objectKey: string) {
        const value = objects.get(objectKey)
        return value === undefined
          ? null
          : {
              text: async () => value,
              arrayBuffer: async () => new ArrayBuffer(0),
              body: new Blob([value]).stream(),
            }
      },
      async put(objectKey: string, value: string | ArrayBuffer | Blob) {
        objects.set(objectKey, String(value))
      },
      async delete(keys: string[]) {
        for (const each of keys) objects.delete(each)
      },
    },
    SESSION_SIGNING_KEY: key(),
    JWE_ENCRYPTION_KEY: key(),
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  const send = async (
    who: string | null,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) =>
    handleShares(
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
  return { db, sql, env, objects, send }
}

const bundle = { format: 1, setlist: { name: 'Sunday' }, songs: [{ title: 'Holy' }] }

test('a leader shares a setlist by a link anyone can open, until it ends', async () => {
  const { sql, objects, send } = rig()

  // Who may make one, and what is said to anything in between
  assert.equal(
    (await send(null, 'POST', '/api/shares', { setlistId: 'team-set', bundle })).status,
    401
  )
  assert.equal(
    (await send('reader', 'POST', '/api/shares', { setlistId: 'team-set', bundle })).status,
    404,
    'a reader cannot write it'
  )
  assert.equal(
    (await send('other', 'POST', '/api/shares', { setlistId: 'team-set', bundle })).status,
    404,
    'not in the church'
  )
  assert.equal(
    (await send('leader', 'POST', '/api/shares', { setlistId: 'nope', bundle })).status,
    404
  )
  assert.equal(
    (await send('leader', 'POST', '/api/shares', { setlistId: 'team-set' })).status,
    400,
    'no bundle'
  )
  assert.equal(
    (
      await send('leader', 'POST', '/api/shares', {
        setlistId: 'team-set',
        bundle: { text: 'x'.repeat(3 * 1024 * 1024) },
      })
    ).status,
    413
  )
  assert.equal((await send('leader', 'GET', '/api/other')).status, 404)
  assert.equal(
    (await send('leader', 'POST', '/api/shares', { setlistId: 5, bundle })).status,
    404,
    'not an id'
  )
  assert.equal(
    (await send('leader', 'POST', '/api/shares', { setlistId: '../x', bundle })).status,
    404
  )
  assert.equal((await send('leader', 'GET', '/api/shares')).status, 404, 'no setlist named')
  assert.equal((await send('leader', 'PATCH', '/api/shares')).status, 404)

  // A writer makes one: a long unguessable id, ending two weeks after the setlist's date
  const made = await send('writer', 'POST', '/api/shares', { setlistId: 'team-set', bundle })
  assert.equal(made.status, 201)
  const share = (await made.json()) as { shareId: string; expiresAt: string; version: number }
  assert.match(share.shareId, /^sh_[A-Za-z0-9_-]{22}$/)
  assert.equal(share.expiresAt, '2026-12-20T23:59:59.999Z')
  assert.equal(share.version, 1)
  assert.deepEqual([...objects.keys()], [`shares/${share.shareId}/bundle.json`])
  assert.equal(made.headers.get('Cache-Control'), 'private, no-store')

  // One live share a setlist, which the leader is told about
  const again = await send('leader', 'POST', '/api/shares', { setlistId: 'team-set', bundle })
  assert.equal(again.status, 409)
  assert.equal(((await again.json()) as { shareId: string }).shareId, share.shareId)
  const found = await send('leader', 'GET', '/api/shares?setlistId=team-set')
  assert.equal(((await found.json()) as { shareId: string }).shareId, share.shareId)
  assert.equal((await send('reader', 'GET', '/api/shares?setlistId=team-set')).status, 404)
  assert.equal(
    (await send('leader', 'GET', '/api/shares?setlistId=mine')).status,
    404,
    'a setlist that is not shared'
  )
  assert.equal((await send('leader', 'GET', '/api/shares?setlistId=../x')).status, 404)

  // Anyone with the link reads it, with no sign-in; nothing may keep it, and a version they hold is a 304
  const read = await send(null, 'GET', `/api/shares/${share.shareId}`)
  assert.equal(read.status, 200)
  assert.deepEqual(await read.json(), { ...share, bundle })
  assert.equal(read.headers.get('Cache-Control'), 'no-cache')
  assert.equal(read.headers.get('X-Robots-Tag'), 'noindex, nofollow')
  assert.equal(read.headers.get('ETag'), '"1"')
  assert.equal(
    (await send(null, 'GET', `/api/shares/${share.shareId}`, undefined, { 'If-None-Match': '"1"' }))
      .status,
    304
  )
  assert.equal(
    (await send(null, 'GET', '/api/shares/sh_aaaaaaaaaaaaaaaaaaaaaa')).status,
    404,
    'a link that never was'
  )
  assert.equal((await send(null, 'GET', '/api/shares/guess')).status, 404, 'not the shape of one')

  // The leader updates it in place: the same link, a new version, and what readers had is out of date
  const updated = { ...bundle, songs: [{ title: 'Holy' }, { title: 'Amazing' }] }
  assert.equal(
    (await send('reader', 'PUT', `/api/shares/${share.shareId}`, { bundle: updated })).status,
    404
  )
  assert.equal((await send('leader', 'PUT', `/api/shares/${share.shareId}`, {})).status, 400)
  const put = await send('leader', 'PUT', `/api/shares/${share.shareId}`, { bundle: updated })
  assert.deepEqual(await put.json(), {
    shareId: share.shareId,
    expiresAt: share.expiresAt,
    version: 2,
  })
  assert.equal(
    (await send(null, 'GET', `/api/shares/${share.shareId}`, undefined, { 'If-None-Match': '"1"' }))
      .status,
    200
  )
  assert.deepEqual(
    (
      (await (await send(null, 'GET', `/api/shares/${share.shareId}`)).json()) as {
        bundle: unknown
      }
    ).bundle,
    updated
  )

  // A change of the setlist's date moves the end; a setlist with none keeps what it had
  sql
    .prepare(
      "UPDATE setlists SET date = '2026-12-13', version = version + 1 WHERE setlist_id = 'team-set'"
    )
    .run()
  assert.equal(
    (
      (await (await send('leader', 'PUT', `/api/shares/${share.shareId}`, { bundle })).json()) as {
        expiresAt: string
      }
    ).expiresAt,
    '2026-12-27T23:59:59.999Z'
  )

  // Stopped: gone at once, whenever the cleanup runs, and nothing more is written to it
  assert.equal((await send('reader', 'DELETE', `/api/shares/${share.shareId}`)).status, 404)
  assert.equal((await send('leader', 'DELETE', `/api/shares/${share.shareId}`)).status, 204)
  assert.equal((await send(null, 'GET', `/api/shares/${share.shareId}`)).status, 410)
  assert.equal(
    (await send('leader', 'PUT', `/api/shares/${share.shareId}`, { bundle })).status,
    410
  )
  assert.equal(objects.size, 0)
  assert.equal(
    (await send('leader', 'DELETE', `/api/shares/${share.shareId}`)).status,
    204,
    'again is harmless'
  )
  assert.equal((await send('leader', 'GET', '/api/shares?setlistId=team-set')).status, 404)

  // The setlist can be shared again, by a new link
  const next = (await (
    await send('leader', 'POST', '/api/shares', { setlistId: 'team-set', bundle })
  ).json()) as { shareId: string }
  assert.notEqual(next.shareId, share.shareId)

  // (an object lost from storage is a share that is not there, not an error)
  objects.clear()
  assert.equal((await send(null, 'GET', `/api/shares/${next.shareId}`)).status, 404)
  assert.equal(
    (await send('leader', 'POST', `/api/shares/${next.shareId}`, { bundle })).status,
    404,
    'nothing is posted to a share'
  )

  // A person's own setlist, whose date long passed: a day from now, not dead on arrival
  const own = await send('other', 'POST', '/api/shares', { setlistId: 'mine', bundle })
  const ownShare = (await own.json()) as { shareId: string; expiresAt: string }
  const days = (Date.parse(ownShare.expiresAt) - Date.now()) / 86_400_000
  assert.ok(days > 0.99 && days <= 1, `${days}`)
  sql
    .prepare('UPDATE shares SET expires_at = ?, version = version + 1 WHERE share_id = ?')
    .run('2020-01-01T00:00:00.000Z', ownShare.shareId)
  assert.equal(
    (await send(null, 'GET', `/api/shares/${ownShare.shareId}`)).status,
    410,
    'ended by its date'
  )
  assert.equal(
    (await send('other', 'PUT', `/api/shares/${ownShare.shareId}`, { bundle })).status,
    410,
    'an ended share is not brought back by an update'
  )
  assert.equal((await send('other', 'GET', '/api/shares?setlistId=mine')).status, 404)
  assert.equal(
    (
      await handleShares(
        new Request('https://example.test/api/shares/sh_aaaaaaaaaaaaaaaaaaaaaa'),
        {} as Env
      )
    ).status,
    503
  )
})

test('the daily cleanup removes the objects of shares that ended, and their rows a week on', async () => {
  const { db, sql, env, objects, send } = rig()
  const live = (await (
    await send('leader', 'POST', '/api/shares', { setlistId: 'team-set', bundle })
  ).json()) as { shareId: string }
  const gone = (await (
    await send('other', 'POST', '/api/shares', { setlistId: 'mine', bundle })
  ).json()) as { shareId: string }
  sql
    .prepare('UPDATE shares SET expires_at = ?, version = version + 1 WHERE share_id = ?')
    .run('2026-11-24T00:00:00.000Z', gone.shareId)
  assert.equal(objects.size, 2)
  const bucket = env.SONG_BUCKET
  assert.deepEqual(await removeEndedShares(db, bucket, new Date('2026-11-25T12:00:00.000Z')), {
    objects: 1,
    rows: 0,
  })
  assert.deepEqual([...objects.keys()], [`shares/${live.shareId}/bundle.json`])
  assert.equal(
    sql.prepare('SELECT count(*) AS n FROM shares').get()?.n,
    2,
    'the row stays, so the link says it ended'
  )
  assert.deepEqual(await removeEndedShares(db, bucket, new Date('2026-12-05T12:00:00.000Z')), {
    objects: 0,
    rows: 1,
  })
  assert.deepEqual(
    sql
      .prepare('SELECT share_id FROM shares')
      .all()
      .map(row => row.share_id),
    [live.shareId]
  )
})
