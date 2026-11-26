import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handleLibraryPads } from '../worker/src/library-pads.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const T = '2026-11-25T10:00:00.000Z'

test('a library keeps its pad sets: members add, an admin replaces, nobody else reads them', async () => {
  const { db, sql } = d1Db()
  for (const account of ['admin', 'reader', 'outsider'])
    sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(account, T)
  for (const church of ['church-a', 'church-b']) {
    sql
      .prepare(
        `INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at) VALUES (?, 'Church', 'GB', 'York', '{}', ?, ?)`
      )
      .run(church, T, T)
    sql
      .prepare('INSERT INTO libraries (library_id, church_id, created_at) VALUES (?, ?, ?)')
      .run(`lib-${church}`, church, T)
  }
  sql
    .prepare('INSERT INTO libraries (library_id, account_id, created_at) VALUES (?, ?, ?)')
    .run('lib-mine', 'outsider', T)
  for (const [account, role] of [
    ['admin', 'admin'],
    ['reader', 'reader'],
  ] as const)
    sql
      .prepare(
        'INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)'
      )
      .run('church-a', account, role, T)

  const objects = new Map<string, ArrayBuffer>()
  const env = {
    DB: db,
    SONG_BUCKET: {
      async list({ prefix }: { prefix: string }) {
        return {
          objects: [...objects.entries()]
            .filter(([k]) => k.startsWith(prefix))
            .sort()
            .map(([k, v]) => ({ key: k, size: v.byteLength })),
        }
      },
      async get(objectKey: string) {
        const value = objects.get(objectKey)
        return value === undefined
          ? null
          : {
              text: async () => '',
              arrayBuffer: async () => value,
              body: new Blob([value]).stream(),
            }
      },
      async put(objectKey: string, value: string | ArrayBuffer | Blob) {
        objects.set(objectKey, await new Blob([value]).arrayBuffer())
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
    type = 'application/json'
  ) =>
    handleLibraryPads(
      new Request(`https://example.test${path}`, {
        method,
        headers: {
          ...(who === null
            ? {}
            : {
                Authorization: `Bearer ${await signAccessToken({ accountId: who, sessionId: 's', email: `${who}@example.com` }, env)}`,
              }),
          'Content-Type': type,
        },
        ...(body === undefined
          ? {}
          : {
              body:
                body instanceof Uint8Array ? new Blob([body as BlobPart]) : JSON.stringify(body),
            }),
      }),
      env
    )
  const church = '/api/libraries/lib-church-a/pads'
  const mp3 = new Uint8Array([0xff, 0xfb, 1, 2, 3])
  const make = async (who: string, name: string, path = church) =>
    ((await (await send(who, 'POST', path, { name })).json()) as { ref: string }).ref

  // Who may reach it, and what is said to anything in between
  assert.equal((await send(null, 'GET', church)).status, 401)
  assert.equal((await send('outsider', 'GET', church)).status, 404, 'not a member')
  assert.equal((await send('admin', 'GET', '/api/libraries/nope/pads')).status, 404)
  const listed = await send('reader', 'GET', church)
  assert.equal(listed.status, 200)
  assert.deepEqual(await listed.json(), [])
  assert.equal(listed.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(listed.headers.get('Vary'), 'Authorization')
  assert.equal((await send('admin', 'GET', `${church}/other/nothing/here`)).status, 404)

  // A member makes a set, and gets the same one by its name; its id is a ULID that is the same everywhere
  const set = await make('reader', 'Warm')
  assert.match(set, /^[0-9A-Z]{26}$/)
  assert.equal(await make('admin', 'Warm'), set)
  assert.equal((await send('reader', 'POST', church, { name: '' })).status, 400)
  const sets = (await (await send('admin', 'GET', church)).json()) as {
    ref: string
    name: string
    modified: string
  }[]
  assert.deepEqual(
    sets.map(each => [each.ref, each.name]),
    [[set, 'Warm']]
  )

  // Another set, listed by name; and a library keeps only so many
  await make('admin', 'Bright')
  assert.deepEqual(
    ((await (await send('admin', 'GET', church)).json()) as { name: string }[]).map(
      each => each.name
    ),
    ['Bright', 'Warm']
  )
  sql
    .prepare('UPDATE libraries SET pad_sets = ? WHERE library_id = ?')
    .run(
      JSON.stringify(
        Array.from({ length: 200 }, (_, n) => ({ id: `x${n}`, name: `Set ${n}`, modifiedAt: T }))
      ),
      'lib-church-b'
    )
  assert.equal(
    (await send('admin', 'POST', '/api/libraries/lib-church-b/pads', { name: 'One more' })).status,
    404,
    'not a member of that church'
  )
  sql
    .prepare(
      'INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)'
    )
    .run('church-b', 'admin', 'admin', T)
  assert.equal(
    (await send('admin', 'POST', '/api/libraries/lib-church-b/pads', { name: 'One more' })).status,
    400,
    'as many as it may'
  )
  assert.equal(
    (await send('admin', 'POST', '/api/libraries/lib-church-b/pads', { name: 'Set 7' })).status,
    200,
    'one it has is not another'
  )

  // Any member adds a key, once: a reader cannot replace it, an admin can
  const file = `${church}/${set}/files/C`
  assert.equal((await send('reader', 'PUT', file, mp3, 'audio/mpeg')).status, 204)
  assert.equal((await send('reader', 'PUT', file, mp3, 'audio/mpeg')).status, 409)
  assert.equal((await send('admin', 'PUT', file, mp3, 'audio/mpeg')).status, 204)
  assert.equal(
    (await send('admin', 'PUT', `${church}/${set}/files/C%23`, mp3, 'audio/mpeg')).status,
    204
  )
  assert.equal(
    (await send('admin', 'PUT', `${church}/${set}/files/H`, mp3, 'audio/mpeg')).status,
    400,
    'not a key'
  )
  assert.equal(
    (await send('admin', 'PUT', `${church}/${set}/files/D`, mp3, 'text/plain')).status,
    415
  )
  assert.equal(
    (await send('admin', 'PUT', `${church}/NOPE/files/D`, mp3, 'audio/mpeg')).status,
    404,
    'not a set of the library'
  )
  assert.deepEqual([...objects.keys()].sort(), [
    `library/lib-church-a/pads/${set}/C#.mp3`,
    `library/lib-church-a/pads/${set}/C.mp3`,
  ])

  // The files are listed with their keys, and each is streamed, and only from this library
  const files = (await (await send('reader', 'GET', `${church}/${set}/files`)).json()) as {
    ref: string
    padKey: string
    size: number
  }[]
  assert.deepEqual(
    files.map(each => [each.padKey, each.size]),
    [
      ['C#', 5],
      ['C', 5],
    ]
  )
  const audio = await send(
    'reader',
    'GET',
    `${church}/files/${encodeURIComponent((files.find(each => each.padKey === 'C') as { ref: string }).ref)}`
  )
  assert.deepEqual(new Uint8Array(await audio.arrayBuffer()), mp3)
  assert.equal(audio.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(
    (await send('reader', 'GET', `${church}/files/${encodeURIComponent(`${set}:D`)}`)).status,
    404,
    'no such key'
  )
  assert.equal(
    (await send('reader', 'GET', `${church}/files/${encodeURIComponent('NOPE:C')}`)).status,
    404
  )
  assert.equal(
    (await send('reader', 'GET', `${church}/files/${encodeURIComponent('a.b:C')}`)).status,
    404,
    'not a set id'
  )
  assert.equal(
    (await send('reader', 'GET', `${church}/files/${encodeURIComponent(':C')}`)).status,
    404,
    'no set'
  )
  assert.equal(
    (await send('reader', 'GET', `${church}/files/${encodeURIComponent(`${set}:H`)}`)).status,
    404,
    'not a pad key'
  )
  assert.equal(
    (await send('reader', 'GET', `${church}/files/${encodeURIComponent('bad')}`)).status,
    404
  )
  assert.equal(
    (
      await send(
        'admin',
        'GET',
        `/api/libraries/lib-church-b/pads/files/${encodeURIComponent((files.find(each => each.padKey === 'C') as { ref: string }).ref)}`
      )
    ).status,
    404,
    'another library'
  )
  assert.deepEqual(await (await send('reader', 'GET', `${church}/NOPE/files`)).json(), {
    error: 'No such pad set',
  })

  // Only an admin empties a set; the set stays to be filled again
  assert.equal((await send('reader', 'POST', `${church}/${set}/trash`)).status, 403)
  assert.equal((await send('admin', 'POST', `${church}/${set}/trash`)).status, 204)
  assert.equal(objects.size, 0)
  assert.deepEqual(await (await send('admin', 'GET', `${church}/${set}/files`)).json(), [])
  assert.equal(((await (await send('admin', 'GET', church)).json()) as unknown[]).length, 2)

  // A person's own library is theirs, and they are its admin; the name is the library's, so another has its own set
  const mine = '/api/libraries/lib-mine/pads'
  const own = await make('outsider', 'Warm', mine)
  assert.notEqual(own, set)
  assert.equal(
    (await send('outsider', 'PUT', `${mine}/${own}/files/A`, mp3, 'audio/mpeg')).status,
    204
  )
  assert.equal(
    (await send('outsider', 'PUT', `${mine}/${own}/files/A`, mp3, 'audio/mpeg')).status,
    204,
    'their own to replace'
  )
  assert.equal((await send('admin', 'GET', mine)).status, 404, 'nobody else reaches it')
  // (and a church's, by a team of it)
  assert.equal((await send('admin', 'GET', '/api/teams/nope/pads')).status, 404)
})
