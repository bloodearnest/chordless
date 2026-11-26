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
  run(
    `UPDATE setlists SET leader_id = 'leader', songs = ?, created_by = 'l@example.com', body = '{"share":"secret"}', version = version + 1 WHERE setlist_id = 'team-set'`,
    JSON.stringify([
      { songUuid: 'holy', songId: 'title-holy', title: 'Holy', key: 'D', tempo: 80 },
      { songUuid: 'draft', songId: 'title-draft', title: 'Draft', key: 'G' },
    ])
  )
  setlist('mine', null, 'other', '2020-01-01')
  run(
    `UPDATE setlists SET leader_name = 'Me', songs = ?, version = version + 1 WHERE setlist_id = 'mine'`,
    JSON.stringify([{ songUuid: 'mine-song', songId: 'title-mine-song', title: 'Mine', key: 'C' }])
  )
  run(`INSERT INTO libraries (library_id, church_id, created_at) VALUES ('church-lib', 'c', ?)`, T)
  run(
    `INSERT INTO libraries (library_id, account_id, created_at) VALUES ('own-lib', 'other', ?)`,
    T
  )
  const song = (library: string, uuid: string, title: string, bundleRef: string | null) =>
    run(
      `INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, bundle_ref, modified_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
      library,
      uuid,
      `title-${uuid}`,
      title,
      bundleRef,
      T
    )
  song('church-lib', 'holy', 'Holy', 'lib/holy.json')
  song('church-lib', 'draft', 'Draft', null)
  song('own-lib', 'mine-song', 'Mine', 'lib/mine.json')
  const objects = new Map<string, string>([
    ['lib/holy.json', JSON.stringify({ format: 1, chordpro: '{title: Holy}', musicxml: null })],
    [
      'lib/mine.json',
      JSON.stringify({ format: 1, chordpro: '{title: Mine}', musicxml: '<score/>' }),
    ],
  ])
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

test('a leader shares a setlist by a link anyone can open, until it ends', async () => {
  const { sql, send } = rig()

  // Who may make one, and what is said to anything in between
  assert.equal((await send(null, 'POST', '/api/shares', { setlistId: 'team-set' })).status, 401)
  assert.equal(
    (await send('reader', 'POST', '/api/shares', { setlistId: 'team-set' })).status,
    404,
    'a reader cannot write it'
  )
  assert.equal(
    (await send('other', 'POST', '/api/shares', { setlistId: 'team-set' })).status,
    404,
    'not in the church'
  )
  assert.equal((await send('leader', 'POST', '/api/shares', { setlistId: 'nope' })).status, 404)
  assert.equal(
    (await send('leader', 'POST', '/api/shares', { setlistId: 5 })).status,
    404,
    'not an id'
  )
  assert.equal((await send('leader', 'POST', '/api/shares', { setlistId: '../x' })).status, 404)
  assert.equal((await send('leader', 'GET', '/api/shares')).status, 404, 'no setlist named')
  assert.equal((await send('leader', 'GET', '/api/other')).status, 404)
  assert.equal((await send('leader', 'PATCH', '/api/shares')).status, 404)

  // A writer makes one: a long unguessable id, ending two weeks after the setlist's date
  const made = await send('writer', 'POST', '/api/shares', { setlistId: 'team-set' })
  assert.equal(made.status, 201)
  const share = (await made.json()) as { shareId: string; expiresAt: string }
  assert.match(share.shareId, /^sh_[A-Za-z0-9_-]{22}$/)
  assert.equal(share.expiresAt, '2026-12-20T23:59:59.999Z')
  assert.equal(made.headers.get('Cache-Control'), 'private, no-store')

  // One live share a setlist, which the leader is told about
  const again = await send('leader', 'POST', '/api/shares', { setlistId: 'team-set' })
  assert.equal(again.status, 409)
  assert.equal(((await again.json()) as { shareId: string }).shareId, share.shareId)
  const found = await send('leader', 'GET', '/api/shares?setlistId=team-set')
  assert.equal(((await found.json()) as { shareId: string }).shareId, share.shareId)
  assert.equal((await send('reader', 'GET', '/api/shares?setlistId=team-set')).status, 404)
  assert.equal((await send('leader', 'GET', '/api/shares?setlistId=../x')).status, 404)

  // Anyone with the link reads the setlist and its songs as they are, with no sign-in
  const read = await send(null, 'GET', `/api/shares/${share.shareId}`)
  assert.equal(read.status, 200)
  const shown = (await read.json()) as {
    shareId: string
    expiresAt: string
    setlist: Record<string, unknown>
    songs: { songUuid: string; title: string; bundle: unknown }[]
  }
  assert.equal(shown.shareId, share.shareId)
  assert.equal(shown.expiresAt, share.expiresAt)
  assert.deepEqual(Object.keys(shown.setlist).sort(), [
    'date',
    'leader',
    'name',
    'setlistId',
    'songs',
    'time',
    'type',
  ])
  assert.equal(shown.setlist.leader, null, 'an account with no name shows none')
  assert.deepEqual(
    (shown.setlist.songs as { title: string }[]).map(each => each.title),
    ['Holy', 'Draft']
  )
  assert.deepEqual(shown.songs.map(each => [each.songUuid, each.bundle]).sort(), [
    ['draft', null],
    ['holy', { format: 1, chordpro: '{title: Holy}', musicxml: null }],
  ])
  assert.doesNotMatch(
    JSON.stringify(shown),
    /secret|l@example|createdBy|leaderId/,
    'nothing of the church’s own'
  )
  assert.equal(read.headers.get('Cache-Control'), 'no-cache')
  assert.equal(read.headers.get('X-Robots-Tag'), 'noindex, nofollow')
  const etag = read.headers.get('ETag') ?? ''
  assert.match(etag, /^"[0-9a-f]{32}"$/)
  assert.equal(
    (await send(null, 'GET', `/api/shares/${share.shareId}`, undefined, { 'If-None-Match': etag }))
      .status,
    304
  )
  assert.equal(
    (await send(null, 'GET', '/api/shares/sh_aaaaaaaaaaaaaaaaaaaaaa')).status,
    404,
    'a link that never was'
  )
  assert.equal((await send(null, 'GET', '/api/shares/guess')).status, 404, 'not the shape of one')

  // The link is never updated: a change to the setlist or a song is what is read next, and the old copy is out of date
  sql
    .prepare(
      "UPDATE setlists SET name = 'Evening', version = version + 1 WHERE setlist_id = 'team-set'"
    )
    .run()
  const changed = await send(null, 'GET', `/api/shares/${share.shareId}`, undefined, {
    'If-None-Match': etag,
  })
  assert.equal(changed.status, 200)
  assert.equal(((await changed.json()) as { setlist: { name: string } }).setlist.name, 'Evening')
  const etag2 = changed.headers.get('ETag') ?? ''
  assert.notEqual(etag2, etag)
  sql
    .prepare(
      "UPDATE library_songs SET title = 'Holy!', version = version + 1 WHERE song_uuid = 'holy'"
    )
    .run()
  assert.equal(
    (await send(null, 'GET', `/api/shares/${share.shareId}`, undefined, { 'If-None-Match': etag2 }))
      .status,
    200
  )

  // The leader's name, from the account, when it has one
  sql.prepare("UPDATE accounts SET name = 'Pat' WHERE account_id = 'leader'").run()
  assert.equal(
    (
      (await (await send(null, 'GET', `/api/shares/${share.shareId}`)).json()) as {
        setlist: { leader: string }
      }
    ).setlist.leader,
    'Pat'
  )

  // A setlist moved to a later date moves the end with it
  sql
    .prepare(
      "UPDATE setlists SET date = '2026-12-13', version = version + 1 WHERE setlist_id = 'team-set'"
    )
    .run()
  assert.equal(
    (
      (await (await send(null, 'GET', `/api/shares/${share.shareId}`)).json()) as {
        expiresAt: string
      }
    ).expiresAt,
    '2026-12-27T23:59:59.999Z'
  )

  // Stopped: gone at once, whenever the cleanup runs
  assert.equal((await send('reader', 'DELETE', `/api/shares/${share.shareId}`)).status, 404)
  assert.equal((await send('leader', 'DELETE', `/api/shares/${share.shareId}`)).status, 204)
  assert.equal((await send(null, 'GET', `/api/shares/${share.shareId}`)).status, 410)
  assert.equal(
    (await send('leader', 'DELETE', `/api/shares/${share.shareId}`)).status,
    204,
    'again is harmless'
  )
  assert.equal((await send('leader', 'GET', '/api/shares?setlistId=team-set')).status, 404)
  assert.equal(
    (await send('leader', 'POST', `/api/shares/${share.shareId}`, {})).status,
    404,
    'nothing is posted to a share'
  )

  // The setlist can be shared again, by a new link
  const next = (await (
    await send('leader', 'POST', '/api/shares', { setlistId: 'team-set' })
  ).json()) as { shareId: string }
  assert.notEqual(next.shareId, share.shareId)

  // A person's own setlist, whose date long passed: a day from now, not dead on arrival; its leader is a name
  const own = await send('other', 'POST', '/api/shares', { setlistId: 'mine' })
  const ownShare = (await own.json()) as { shareId: string; expiresAt: string }
  const days = (Date.parse(ownShare.expiresAt) - Date.now()) / 86_400_000
  assert.ok(days > 0.99 && days <= 1, `${days}`)
  const mine = (await (await send(null, 'GET', `/api/shares/${ownShare.shareId}`)).json()) as {
    setlist: { leader: string }
    songs: { bundle: { musicxml: string } }[]
  }
  assert.equal(mine.setlist.leader, 'Me')
  assert.equal(mine.songs[0].bundle.musicxml, '<score/>')
  sql
    .prepare('UPDATE shares SET expires_at = ? WHERE share_id = ?')
    .run('2020-01-01T00:00:00.000Z', ownShare.shareId)
  assert.equal(
    (await send(null, 'GET', `/api/shares/${ownShare.shareId}`)).status,
    410,
    'ended by its date'
  )
  assert.equal((await send('other', 'GET', '/api/shares?setlistId=mine')).status, 404)

  // (a personal setlist of someone with no library has no songs to show: there is nothing to read)
  sql
    .prepare(
      "INSERT INTO setlists (setlist_id, account_id, date, time, type, name, created_at, modified_at) VALUES ('bare', 'reader', '2026-12-01', '', '', 'Bare', ?, ?)"
    )
    .run(T, T)
  const bare = (await (
    await send('reader', 'POST', '/api/shares', { setlistId: 'bare' })
  ).json()) as { shareId: string }
  assert.equal((await send(null, 'GET', `/api/shares/${bare.shareId}`)).status, 404)

  // A setlist with no songs, and a share whose setlist is gone
  sql
    .prepare(
      "UPDATE setlists SET songs = '[]', version = version + 1 WHERE setlist_id = 'team-set'"
    )
    .run()
  assert.deepEqual(
    (
      (await (await send(null, 'GET', `/api/shares/${next.shareId}`)).json()) as {
        songs: unknown[]
      }
    ).songs,
    []
  )
  sql.prepare("DELETE FROM setlists WHERE setlist_id = 'team-set'").run()
  assert.equal(
    (await send(null, 'GET', `/api/shares/${next.shareId}`)).status,
    404,
    'a share goes with its setlist'
  )
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

test('the daily cleanup removes the rows of shares that ended a week ago', async () => {
  const { db, sql, send } = rig()
  const live = (await (
    await send('leader', 'POST', '/api/shares', { setlistId: 'team-set' })
  ).json()) as { shareId: string }
  const gone = (await (
    await send('other', 'POST', '/api/shares', { setlistId: 'mine' })
  ).json()) as { shareId: string }
  sql
    .prepare('UPDATE shares SET expires_at = ? WHERE share_id = ?')
    .run('2026-11-24T00:00:00.000Z', gone.shareId)
  assert.equal(
    await removeEndedShares(db, new Date('2026-11-25T12:00:00.000Z')),
    0,
    'the row stays, so the link says it ended'
  )
  assert.equal(await removeEndedShares(db, new Date('2026-12-05T12:00:00.000Z')), 1)
  assert.deepEqual(
    sql
      .prepare('SELECT share_id FROM shares')
      .all()
      .map(row => row.share_id),
    [live.shareId]
  )
  await send('leader', 'DELETE', `/api/shares/${live.shareId}`)
  assert.equal(
    await removeEndedShares(db, new Date('2030-01-01T00:00:00.000Z')),
    1,
    'a stopped one goes too'
  )
})
