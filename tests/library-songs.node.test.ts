import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sha256Hex } from '../src/js/utils/bytes.ts'
import type { Env } from '../worker/src/env.ts'
import { handleLibrarySongs } from '../worker/src/library-songs.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

test('library song bundles are private, versioned and stored under their library key', async () => {
  const { db, sql } = d1Db()
  const now = new Date().toISOString()
  for (const account of ['admin', 'writer', 'reader', 'outsider'])
    sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(account, now)
  for (const church of ['church-a', 'church-b']) {
    sql
      .prepare(`INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at)
      VALUES (?, 'Church', 'GB', 'York', '{}', ?, ?)`)
      .run(church, now, now)
    sql
      .prepare('INSERT INTO libraries (library_id, church_id, created_at) VALUES (?, ?, ?)')
      .run(`library-${church}`, church, now)
  }
  for (const [account, role] of [
    ['admin', 'admin'],
    ['writer', 'writer'],
    ['reader', 'reader'],
  ] as const)
    sql
      .prepare(
        'INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)'
      )
      .run('church-a', account, role, now)
  sql
    .prepare(`INSERT INTO teams
    (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at, church_id)
    VALUES ('team-a', 'Team', 'admin', 'admin@example.com', 'google', 'admin', ?, ?, 'church-a')`)
    .run(now, now)
  sql
    .prepare('INSERT INTO libraries (library_id, account_id, created_at) VALUES (?, ?, ?)')
    .run('personal-admin', 'admin', now)

  const objects = new Map<string, string>()
  let writes = 0
  let revokeDuringPut = false
  const env = {
    DB: db,
    SONG_BUCKET: {
      async list() {
        return { objects: [] }
      },
      async get(objectKey: string) {
        const value = objects.get(objectKey)
        return value === undefined
          ? null
          : {
              text: async () => value,
              arrayBuffer: async () => new TextEncoder().encode(value).buffer,
            }
      },
      async put(objectKey: string, value: string) {
        writes++
        objects.set(objectKey, value)
        if (revokeDuringPut) {
          sql
            .prepare(
              "DELETE FROM church_members WHERE church_id = 'church-a' AND account_id = 'writer'"
            )
            .run()
          revokeDuringPut = false
        }
      },
    },
    SESSION_SIGNING_KEY: key(),
    JWE_ENCRYPTION_KEY: key(),
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  let missingObjects = false
  env.SONG_BUCKET.get = async objectKey => {
    if (missingObjects) return null
    const value = objects.get(objectKey)
    return value === undefined
      ? null
      : { text: async () => value, arrayBuffer: async () => new TextEncoder().encode(value).buffer }
  }
  const request = async (account: string, method: string, path: string, body?: unknown) =>
    new Request(`https://example.test${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await signAccessToken({ accountId: account, sessionId: 's', email: `${account}@example.com` }, env)}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const path = '/api/libraries/library-church-a/songs/song-1'
  const meta = {
    songId: 'ccli-1',
    title: 'A song',
    ccli: '1',
    key: 'G',
    licence: null,
    isDefault: true,
    variantOf: null,
    variantLabel: '',
  }
  const bundle = { format: 1, chordpro: '{title: A song}\nText', musicxml: '<score-partwise/>' }
  const stringMeta = {
    ...meta,
    ccli: '12345',
    key: 'G',
    licence: 'CCLI',
    variantOf: 'source-song',
  }
  const put = async (baseVersion: number | null) =>
    handleLibrarySongs(
      await request('writer', 'PUT', path, { baseVersion, song: meta, bundle }),
      env
    )

  assert.equal(
    (
      await handleLibrarySongs(
        await request('outsider', 'GET', '/api/libraries/library-church-a/songs'),
        env
      )
    ).status,
    404
  )
  assert.equal(
    (
      await handleLibrarySongs(
        await request('admin', 'GET', '/api/teams/no-such-team/library/songs'),
        env
      )
    ).status,
    404
  )
  assert.equal(
    (
      await handleLibrarySongs(
        new Request('https://example.test/api/libraries/library-church-a/songs'),
        env
      )
    ).status,
    401
  )
  assert.equal(
    (
      await handleLibrarySongs(
        await request('reader', 'GET', '/api/libraries/library-church-a/songs/song-1/unknown'),
        env
      )
    ).status,
    404
  )
  assert.equal(
    (
      await handleLibrarySongs(
        await request('reader', 'PUT', path, { baseVersion: null, song: meta, bundle }),
        env
      )
    ).status,
    403
  )
  const created = await put(null)
  assert.equal(created.status, 201)
  const first = (
    (await created.json()) as { song: { version: number; contentHash: string; fileRef: unknown } }
  ).song
  assert.equal(first.version, 1)
  assert.equal(first.fileRef, null)
  assert.match(first.contentHash, /^[a-f0-9]{64}$/)
  assert.equal(objects.size, 1)
  assert.match([...objects.keys()][0] ?? '', /^library\/library-church-a\/songs\/song-1\//)

  const index = await handleLibrarySongs(
    await request('reader', 'GET', '/api/teams/team-a/library/songs'),
    env
  )
  assert.equal(index.status, 200)
  assert.equal(index.headers.get('cache-control'), 'private, no-store')
  assert.equal(
    ((await index.json()) as { songs: { songUuid: string }[] }).songs[0]?.songUuid,
    'song-1'
  )
  const read = await handleLibrarySongs(await request('reader', 'GET', `${path}/bundle`), env)
  assert.deepEqual(await read.json(), { song: first, bundle })
  assert.equal(read.headers.get('cache-control'), 'private, no-store')
  missingObjects = true
  assert.equal(
    (await handleLibrarySongs(await request('reader', 'GET', `${path}/bundle`), env)).status,
    503
  )
  missingObjects = false
  const absent = await handleLibrarySongs(
    await request('reader', 'GET', '/api/libraries/library-church-a/songs/missing/bundle'),
    env
  )
  assert.equal(absent.status, 404)
  const objectKey = [...objects.keys()][0]
  assert.ok(objectKey)
  objects.set(objectKey, 'corrupt content')
  const corrupted = await handleLibrarySongs(await request('reader', 'GET', `${path}/bundle`), env)
  assert.equal(corrupted.status, 503)
  objects.set(objectKey, JSON.stringify(bundle))

  const invalidJson = '{'
  objects.set(objectKey, invalidJson)
  sql
    .prepare(
      'UPDATE library_songs SET content_hash = ?, version = version + 1 WHERE library_id = ? AND song_uuid = ?'
    )
    .run(await sha256Hex(invalidJson), 'library-church-a', 'song-1')
  const unparsable = await handleLibrarySongs(await request('reader', 'GET', `${path}/bundle`), env)
  assert.equal(unparsable.status, 503, 'valid object hash does not make malformed JSON usable')
  objects.set(objectKey, JSON.stringify(bundle))
  sql
    .prepare(
      'UPDATE library_songs SET content_hash = ?, version = version + 1 WHERE library_id = ? AND song_uuid = ?'
    )
    .run(first.contentHash, 'library-church-a', 'song-1')

  const second = await put(null)
  assert.equal(second.status, 409)
  const update = await handleLibrarySongs(
    await request('writer', 'PUT', path, { baseVersion: 3, song: { ...meta, key: 'A' }, bundle }),
    env
  )
  assert.equal(update.status, 200)
  assert.equal(((await update.json()) as { song: { version: number } }).song.version, 4)
  assert.equal(objects.size, 1, 'the same immutable bundle is reused within this song and library')
  const unchanged = await handleLibrarySongs(
    await request('writer', 'PUT', path, { baseVersion: 4, song: { ...meta, key: 'A' }, bundle }),
    env
  )
  assert.equal(((await unchanged.json()) as { song: { version: number } }).song.version, 4)
  assert.equal(writes, 1, 'an identical reupload is a no-op')
  const variantUpdate = await handleLibrarySongs(
    await request('writer', 'PUT', path, {
      baseVersion: 4,
      song: { ...meta, key: 'A', variantOf: 'parent-song' },
      bundle,
    }),
    env
  )
  assert.equal(variantUpdate.status, 200)
  const defaultUpdate = await handleLibrarySongs(
    await request('writer', 'PUT', path, {
      baseVersion: 5,
      song: { ...meta, key: 'A', variantOf: 'parent-song', isDefault: false },
      bundle,
    }),
    env
  )
  assert.equal(defaultUpdate.status, 200)
  const changedBundle = await handleLibrarySongs(
    await request('writer', 'PUT', path, {
      baseVersion: 6,
      song: { ...meta, key: 'A', variantOf: 'parent-song', isDefault: false },
      bundle: { ...bundle, chordpro: '{title: A song}\nNew chart' },
    }),
    env
  )
  assert.equal(changedBundle.status, 200)
  assert.equal(objects.size, 2, 'a changed chart gets a new immutable R2 object')

  revokeDuringPut = true
  const raced = await handleLibrarySongs(
    await request('writer', 'PUT', path, {
      baseVersion: 7,
      song: { ...meta, key: 'B' },
      bundle: { ...bundle, chordpro: '{title: A song}\nUpdated' },
    }),
    env
  )
  assert.equal(raced.status, 409, 'a permission change during the R2 write is rechecked')
  sql
    .prepare(
      "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES ('church-a', 'writer', 'writer', ?)"
    )
    .run(now)
  revokeDuringPut = true
  const revokedInsert = await handleLibrarySongs(
    await request('writer', 'PUT', '/api/libraries/library-church-a/songs/song-2', {
      baseVersion: null,
      song: meta,
      bundle,
    }),
    env
  )
  assert.equal(revokedInsert.status, 403, 'a new row is refused if membership is revoked mid-write')
  sql
    .prepare(
      "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES ('church-a', 'writer', 'writer', ?)"
    )
    .run(now)
  const wrongResource = await handleLibrarySongs(
    await request('reader', 'PUT', '/api/libraries/library-church-a/songs/song-1/bundle', {
      baseVersion: 4,
      song: meta,
      bundle,
    }),
    env
  )
  assert.equal(wrongResource.status, 404)

  const otherLibrary = await handleLibrarySongs(
    await request('admin', 'GET', '/api/libraries/library-church-b/songs/song-1/bundle'),
    env
  )
  assert.equal(otherLibrary.status, 404)
  assert.equal(
    (
      await handleLibrarySongs(
        await request('admin', 'GET', '/api/libraries/personal-admin/songs'),
        env
      )
    ).status,
    200
  )
  assert.equal(
    (
      await handleLibrarySongs(
        await request('writer', 'GET', '/api/libraries/personal-admin/songs'),
        env
      )
    ).status,
    404
  )

  const personalUpload = await handleLibrarySongs(
    await request('admin', 'PUT', '/api/libraries/personal-admin/songs/personal-song', {
      baseVersion: null,
      song: meta,
      bundle,
    }),
    env
  )
  assert.equal(personalUpload.status, 201, 'personal library owner can upload')
  const malformed = await handleLibrarySongs(
    await request('writer', 'PUT', '/api/libraries/library-church-a/songs/song-2', {
      baseVersion: null,
      song: meta,
      bundle: { format: 2, chordpro: 'x', musicxml: null },
    }),
    env
  )
  assert.equal(malformed.status, 400)
  const invalidMetadata = await handleLibrarySongs(
    await request('writer', 'PUT', '/api/libraries/library-church-a/songs/song-2', {
      baseVersion: null,
      song: { ...meta, title: 5 },
      bundle,
    }),
    env
  )
  assert.equal(invalidMetadata.status, 400)
  const invalidBase = await handleLibrarySongs(
    await request('writer', 'PUT', '/api/libraries/library-church-a/songs/song-2', {
      baseVersion: 0,
      song: meta,
      bundle,
    }),
    env
  )
  assert.equal(invalidBase.status, 400)
  const vanished = await handleLibrarySongs(
    await request('writer', 'PUT', '/api/libraries/library-church-a/songs/song-2', {
      baseVersion: 1,
      song: meta,
      bundle,
    }),
    env
  )
  assert.equal(vanished.status, 409)
  const withStringMetadata = await handleLibrarySongs(
    await request('admin', 'PUT', '/api/libraries/personal-admin/songs/personal-song-strings', {
      baseVersion: null,
      song: { ...stringMeta, isDefault: false },
      bundle,
    }),
    env
  )
  assert.equal(withStringMetadata.status, 201, 'nullable metadata also accepts populated strings')
  const tooLarge = await handleLibrarySongs(
    await request('admin', 'PUT', '/api/libraries/personal-admin/songs/large-song', {
      baseVersion: null,
      song: meta,
      bundle: { format: 1, chordpro: 'x'.repeat(8 * 1024 * 1024), musicxml: null },
    }),
    env
  )
  assert.equal(tooLarge.status, 413)
})
