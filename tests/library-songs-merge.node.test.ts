/**
 * A chart that is in a church's library already, under another id, is not added again (docs/CENTRAL_STORAGE.md, step 8: two
 * Drive teams that kept the same songs become one church): the song that is there is told back, with `mergedInto`, and the
 * sender takes it in place of its own. A person's own library keeps what it is given.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Env } from '../worker/src/env.ts'
import { handleLibrarySongs } from '../worker/src/library-songs.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const T = '2026-11-27T10:00:00.000Z'

test('a chart already in the church library is told back, not added twice; a different chart is; a personal library keeps both', async () => {
  const { db, sql } = d1Db()
  for (const id of ['writer', 'solo'])
    sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(id, T)
  sql
    .prepare(
      `INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at) VALUES ('c', 'C', 'GB', 'York', '{}', ?, ?)`
    )
    .run(T, T)
  sql
    .prepare(
      "INSERT INTO libraries (library_id, church_id, created_at) VALUES ('church-lib', 'c', ?)"
    )
    .run(T)
  sql
    .prepare(
      "INSERT INTO libraries (library_id, account_id, created_at) VALUES ('own-lib', 'solo', ?)"
    )
    .run(T)
  sql
    .prepare(
      "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES ('c', 'writer', 'writer', ?)"
    )
    .run(T)
  const objects = new Map<string, string>()
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
              arrayBuffer: async () => new ArrayBuffer(0),
              body: new Blob([value]).stream(),
            }
      },
      async put(objectKey: string, value: string | ArrayBuffer | Blob) {
        objects.set(objectKey, String(value))
      },
      async delete() {},
    },
    SESSION_SIGNING_KEY: key(),
    JWE_ENCRYPTION_KEY: key(),
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  const send = async (
    who: string,
    library: string,
    id: string,
    chordpro: string,
    base: number | null = null
  ) =>
    handleLibrarySongs(
      new Request(`https://example.test/api/libraries/${library}/songs/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${await signAccessToken({ accountId: who, sessionId: 's', email: `${who}@example.com` }, env)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          baseVersion: base,
          song: {
            songId: 'title-holy',
            title: 'Holy',
            ccli: null,
            key: 'G',
            licence: null,
            isDefault: true,
            variantOf: null,
            variantLabel: '',
          },
          bundle: { format: 1, chordpro, musicxml: null },
        }),
      }),
      env
    )
  const rows = (library: string) =>
    (
      sql
        .prepare('SELECT song_uuid FROM library_songs WHERE library_id = ? ORDER BY song_uuid')
        .all(library) as { song_uuid: string }[]
    ).map(row => row.song_uuid)
  const chart = '{title: Holy}\n[G]Holy, holy'

  // The first team's song goes in as it is
  const first = await send('writer', 'church-lib', 'team-a-holy', chart)
  assert.equal(first.status, 201)
  assert.equal(((await first.json()) as { mergedInto?: string }).mergedInto, undefined)

  // The second team's copy of the same chart, under its own id, is told back as the first: nothing is added
  const second = await send('writer', 'church-lib', 'team-b-holy', chart)
  assert.equal(second.status, 200)
  const told = (await second.json()) as { song: { songUuid: string }; mergedInto: string }
  assert.equal(told.mergedInto, 'team-a-holy')
  assert.equal(told.song.songUuid, 'team-a-holy')
  assert.deepEqual(rows('church-lib'), ['team-a-holy'])

  // The same song sent again under its own id is an update of it, not a merge; a different chart is another song
  assert.equal((await send('writer', 'church-lib', 'team-a-holy', chart, 1)).status, 200)
  assert.equal(
    (
      (await (await send('writer', 'church-lib', 'team-a-holy', chart, 1)).json()) as {
        mergedInto?: string
      }
    ).mergedInto,
    undefined
  )
  const edited = await send(
    'writer',
    'church-lib',
    'team-b-edited',
    '{title: Holy}\n[G]Holy, holy, HOLY'
  )
  assert.equal(edited.status, 201)
  assert.deepEqual(rows('church-lib'), ['team-a-holy', 'team-b-edited'])

  // A person's own library keeps both, as it always did
  assert.equal((await send('solo', 'own-lib', 'one', chart)).status, 201)
  assert.equal((await send('solo', 'own-lib', 'two', chart)).status, 201)
  assert.deepEqual(rows('own-lib'), ['one', 'two'])

  // Two senders of one chart at once: whichever the database takes first is the song, and the other is told so
  const [a, b] = await Promise.all([
    send('writer', 'church-lib', 'race-a', '{title: Race}\n[D]x'),
    send('writer', 'church-lib', 'race-b', '{title: Race}\n[D]x'),
  ])
  assert.deepEqual([a.status, b.status].sort(), [200, 201])
  assert.equal(rows('church-lib').filter(id => id.startsWith('race')).length, 1)
})
