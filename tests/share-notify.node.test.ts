import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handlePersonalSetlists } from '../worker/src/personal-setlists.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import {
  changedSetlists,
  notifySetlistShares,
  notifySongShares,
} from '../worker/src/share-notify.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const T = '2026-11-27T10:00:00.000Z'

function rig() {
  const { db, sql } = d1Db()
  const run = (text: string, ...values: (string | null)[]) => sql.prepare(text).run(...values)
  run('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)', 'me', T)
  run(`INSERT INTO libraries (library_id, account_id, created_at) VALUES ('lib', 'me', ?)`, T)
  run(
    `INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, modified_at) VALUES ('lib', 'holy', 'title-holy', 'Holy', 1, ?)`,
    T
  )
  const songs = JSON.stringify([
    {
      songUuid: 'holy',
      songId: 'title-holy',
      title: 'Holy',
      key: 'D',
      tempo: null,
      notes: '',
      annotations: [],
      extra: {},
    },
  ])
  for (const id of ['live', 'stopped', 'unshared', 'other'])
    run(
      `INSERT INTO setlists (setlist_id, account_id, date, time, type, name, created_at, modified_at, songs) VALUES (?, 'me', '2026-12-06', '', '', ?, ?, ?, ?)`,
      id,
      id,
      T,
      T,
      id === 'other' ? '[]' : songs
    )
  run(
    `INSERT INTO shares (share_id, setlist_id, created_by, created_at, expires_at) VALUES ('sh_live', 'live', 'me', ?, '2099-01-01T00:00:00.000Z')`,
    T
  )
  run(
    `INSERT INTO shares (share_id, setlist_id, created_by, created_at, expires_at, stopped_at) VALUES ('sh_stopped', 'stopped', 'me', ?, '2099-01-01T00:00:00.000Z', ?)`,
    T,
    T
  )
  const rung: string[] = []
  let failing = false
  const env = {
    DB: db,
    SHARE_ROOM: {
      idFromName: (name: string) => name,
      get: (id: unknown) => ({
        fetch: async (request: Request) => {
          if (failing) throw new Error('room down')
          assert.equal(request.method, 'POST')
          rung.push(String(id))
          return new Response(null, { status: 204 })
        },
      }),
    },
    SESSION_SIGNING_KEY: key(),
    JWE_ENCRYPTION_KEY: key(),
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  return { db, sql, env, rung, fail: (on: boolean) => (failing = on) }
}

test('the room of each live share of a setlist is told it changed, and no other', async () => {
  const { env, rung } = rig()
  await notifySetlistShares(env, ['live', 'stopped', 'unshared'])
  assert.deepEqual(rung, ['sh_live'])
  rung.length = 0
  await notifySetlistShares(env, [])
  await notifySetlistShares(env, ['unshared'])
  assert.deepEqual(rung, [])
})

test('the room of each live share of a setlist with the song in it is told the song changed', async () => {
  const { env, rung } = rig()
  await notifySongShares(env, 'holy')
  assert.deepEqual(
    rung,
    ['sh_live'],
    'the stopped share and the setlist with no songs are left alone'
  )
  rung.length = 0
  await notifySongShares(env, 'nobody')
  assert.deepEqual(rung, [])
})

test('it is best effort: a room that is down, or no room or database, refuses nothing', async () => {
  const { env, fail } = rig()
  fail(true)
  await notifySetlistShares(env, ['live'])
  await notifySongShares(env, 'holy')
  await notifySetlistShares({ ...env, SHARE_ROOM: undefined }, ['live'])
  await notifySongShares({ ...env, DB: undefined }, 'holy')
  // (and a database that fails to answer)
  await notifySetlistShares(
    {
      ...env,
      DB: {
        prepare: () => {
          throw new Error('D1 down')
        },
      } as never,
    },
    ['live']
  )
  await notifySongShares(
    {
      ...env,
      DB: {
        prepare: () => {
          throw new Error('D1 down')
        },
      } as never,
    },
    'holy'
  )
})

test('only the writes of a batch that were made count', () => {
  assert.deepEqual(
    changedSetlists(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, 'junk', { id: 4 }],
      [
        { status: 'ok', version: 2 },
        { status: 'conflict', current: null },
        { status: 'ok', version: 1 },
        { status: 'ok', version: 1 },
        { status: 'ok', version: 1 },
      ]
    ),
    ['a', 'c']
  )
})

test('a setlist written through the Worker rings the room of its live share', async () => {
  const { env, rung, sql } = rig()
  const token = await signAccessToken(
    { accountId: 'me', sessionId: 's', email: 'me@example.com' },
    env
  )
  const version = (
    sql.prepare("SELECT version FROM setlists WHERE setlist_id = 'live'").get() as {
      version: number
    }
  ).version
  const record = {
    setlistId: 'live',
    date: '2026-12-06',
    time: '',
    type: '',
    name: 'Evening',
    leaderId: null,
    createdBy: null,
    createdAt: T,
    body: {},
    songs: [
      {
        songUuid: 'holy',
        songId: 'title-holy',
        title: 'Holy',
        ccli: null,
        key: 'D',
        tempo: null,
        notes: '',
        annotations: [],
        extra: {},
      },
    ],
  }
  const send = (ops: unknown[]) =>
    handlePersonalSetlists(
      new Request('https://example.test/api/account/setlists/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops }),
      }),
      env
    )
  const put = (id: string, base: number, name: string) => ({
    kind: 'setlist',
    op: 'put',
    id,
    baseVersion: base,
    record: { ...record, setlistId: id, name },
  })
  // a write that is refused (a stale version) rings nothing
  const stale = (await (await send([put('live', version + 5, 'Stale')])).json()) as {
    results: { status: string }[]
  }
  assert.equal(stale.results[0].status, 'conflict')
  assert.deepEqual(rung, [])
  const made = (await (
    await send([put('live', version, 'Evening'), put('unshared', 1, 'No share')])
  ).json()) as { results: { status: string }[] }
  assert.deepEqual(
    made.results.map(each => each.status),
    ['ok', 'ok']
  )
  assert.deepEqual(rung, ['sh_live'])
})
