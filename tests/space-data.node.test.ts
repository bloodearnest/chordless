/**
 * A space's data in D1 (worker/src/space-data.ts, migrations/0012_space_data.sql), through the Worker's router: the
 * whole of it read in one answer, records written a record at a time from the version they were made from, who may
 * write what, and what a team that has not moved is told.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as jose from 'jose'
import type { SpaceData, SpaceSetlist } from '../src/js/space-data-types.ts'
import type { Env } from '../worker/src/env.ts'
import { googleProvider, type Identity } from '../worker/src/identity.ts'
import { handleRequest } from '../worker/src/router.ts'
import type { ShareCache } from '../worker/src/share.ts'
import { storageOf } from '../worker/src/space-data.ts'
import type { TeamDeps } from '../worker/src/team-context.ts'
import { TeamSpaceState } from '../worker/src/team-state.ts'
import { d1Db } from './d1-db.ts'

const ORIGIN = 'https://chordless.test'
const SPACE = 'space-aaaaaaaa'
const OTHER = 'space-bbbbbbbb'
const NOW = new Date('2026-11-20T10:00:00.000Z')
const env0 = {
  GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  JWE_ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
  SESSION_SIGNING_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
}
const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true })
const jwk = { ...(await jose.exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const keys = jose.createLocalJWKSet({ keys: [jwk] })

const ann: Identity = { provider: 'google', sub: 'g-ann', email: 'ann@example.com' } // owner
const bob: Identity = { provider: 'google', sub: 'g-bob', email: 'bob@example.com' } // writer, leads some
const cat: Identity = { provider: 'google', sub: 'g-cat', email: 'cat@example.com' } // reader
const dan: Identity = { provider: 'google', sub: 'g-dan', email: 'dan@example.com' } // admin
const eve: Identity = { provider: 'google', sub: 'g-eve', email: 'eve@example.com' } // writer, leads none
const stranger: Identity = { provider: 'google', sub: 'g-fay', email: 'fay@example.com' }

const idToken = ({ sub, email }: Identity) =>
  new jose.SignJWT({ email, email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com')
    .setAudience(env0.GOOGLE_CLIENT_ID)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)

const json = async (response: Response) => (await response.json()) as Record<string, any>
const send = (
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

/** A team on D1 with an owner, a writer, a reader, an admin and a second writer; and another team still on Drive */
async function world(options: { moved?: boolean; clock?: boolean } = {}) {
  const { db, sql, fail } = d1Db()
  const teams = [
    new TeamSpaceState(db, SPACE, { now: () => NOW }),
    new TeamSpaceState(db, OTHER, { now: () => NOW }),
  ]
  await teams[0].create({ rootRef: 'root-a', name: 'Team', owner: ann })
  await teams[1].create({ rootRef: 'root-b', name: 'Other', owner: ann })
  await teams[0].setMember(bob, 'writer')
  await teams[0].setMember(cat, 'reader')
  await teams[0].setMember(dan, 'admin')
  await teams[0].setMember(eve, 'writer')
  if (options.moved !== false)
    sql.exec(`UPDATE teams SET storage = 'd1' WHERE space_id = '${SPACE}'`)
  const env = {
    ...env0,
    ASSETS: { fetch: async () => new Response('assets') },
    DB: db,
  } satisfies Env
  // (the files API is not under test: if a request reaches it, Drive is not there)
  const deps: TeamDeps = {
    providers: [googleProvider(env0, keys)],
    ...(options.clock === false ? {} : { now: () => NOW.getTime() }),
    fetch: (async () => new Response('no Drive here', { status: 503 })) as typeof fetch,
    google: {
      refreshAccessToken: (async () => ({ access_token: 'x', expires_in: 3600 })) as never,
    },
  }
  const cache: ShareCache = { match: async () => undefined, put: async () => {} }
  const call = async (path: string, who: Identity | null, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (who) headers.set('Authorization', `Bearer ${await idToken(who)}`)
    return handleRequest(
      new Request(
        path.startsWith('/api/') ? `${ORIGIN}${path}` : `${ORIGIN}/api/space/${SPACE}${path}`,
        { ...init, headers }
      ),
      env,
      { waitUntil() {} },
      cache,
      undefined,
      deps
    )
  }
  const data = async (who: Identity = ann, query = '') =>
    (await json(await call(`/data${query}`, who))) as unknown as SpaceData
  const put = (
    kind: string,
    id: string,
    record: unknown,
    who: Identity | null = bob,
    baseVersion: number | null = null
  ) => call(`/${kind}/${id}`, who, send('PUT', { baseVersion, record }))
  const rows = (query: string) =>
    sql
      .prepare(query)
      .all()
      .map(row => ({ ...row }))
  return { db, sql, call, data, put, rows, fail }
}

const setlist = (id: string, over: Partial<SpaceSetlist> = {}) => ({
  setlistId: id,
  date: '2026-11-22',
  time: '10:30',
  type: 'Church Service',
  name: 'Advent 1',
  leaderId: null,
  createdBy: 'bob@example.com',
  createdAt: '2026-11-01T09:00:00.000Z',
  body: { share: null },
  songs: [
    {
      songUuid: 'song-1',
      songId: 'ccli-1',
      title: 'Amazing Grace',
      ccli: '1',
      key: 'G',
      tempo: 90,
      notes: 'repeat\nthe last line',
      annotations: [{ at: 1 }],
      extra: { local: true },
    },
    {
      songUuid: 'song-2',
      songId: 'title-how-great',
      title: 'How Great',
      ccli: null,
      key: null,
      tempo: null,
      notes: '',
      annotations: [],
      extra: {},
    },
  ],
  ...over,
})
const person = (id: string, over: Record<string, unknown> = {}) => ({
  personId: id,
  name: 'Bob Brown',
  emails: ['Bob@Example.com'],
  teamMember: null,
  mergedInto: null,
  ...over,
})
const song = (uuid: string, over: Record<string, unknown> = {}) => ({
  songUuid: uuid,
  songId: 'ccli-1',
  title: 'Amazing Grace',
  ccli: '1',
  key: 'G',
  licence: '471102',
  isDefault: true,
  variantOf: null,
  variantLabel: 'Original',
  contentHash: 'abc',
  fileRef: 'drive-file-1',
  ...over,
})

describe('reading a space', () => {
  test('answers the whole of it, empty, with a tag, and is not modified for the tag it was given', async () => {
    const { call } = await world()
    const answer = await call('/data', cat)
    assert.equal(answer.status, 200)
    assert.deepEqual(await json(answer), {
      songs: [],
      setlists: [],
      people: [],
      padSets: [],
      from: '2025-11-20',
    })
    const tag = answer.headers.get('ETag') as string
    assert.match(tag, /^"[0-9a-f]{32}"$/)
    const again = await call('/data', cat, { headers: { 'If-None-Match': tag } })
    assert.equal(again.status, 304)
    assert.equal(await again.text(), '')
  })

  test('is for members only: a stranger and a person signed out are turned away', async () => {
    const { call } = await world()
    assert.equal((await call('/data', stranger)).status, 403)
    assert.equal((await call('/data', null)).status, 401)
  })

  test('has every kind of record, with the songs of a setlist in order and what was kept as it came', async () => {
    const { put, data } = await world()
    await put('songs', 'song-1', song('song-1'))
    await put('people', 'p1', person('p1'))
    await put('pad-sets', 'pad-1', { padSetId: 'pad-1', name: 'Warm Pads' })
    await put('setlists', 'set-1', setlist('set-1'))
    const all = await data(cat)
    assert.deepEqual(
      all.songs.map(each => [each.songUuid, each.licence, each.isDefault, each.version]),
      [['song-1', '471102', true, 1]]
    )
    assert.deepEqual(
      all.people.map(each => [each.personId, each.emails]),
      [['p1', ['bob@example.com']]]
    )
    assert.deepEqual(
      all.padSets.map(each => each.name),
      ['Warm Pads']
    )
    const [first] = all.setlists
    assert.deepEqual(
      first.songs.map(each => each.songUuid),
      ['song-1', 'song-2']
    )
    assert.equal(first.songs[0].notes, 'repeat\nthe last line')
    assert.deepEqual(first.songs[0].annotations, [{ at: 1 }])
    assert.deepEqual(first.songs[0].extra, { local: true })
    assert.deepEqual(first.body, { share: null })
    assert.equal(first.modifiedAt, NOW.toISOString())
  })

  test('changes its tag when anything in it changes, and when a record goes', async () => {
    const { call, put } = await world()
    const tag = async () => (await call('/data', cat)).headers.get('ETag')
    const empty = await tag()
    await put('setlists', 'set-1', setlist('set-1'))
    const one = await tag()
    assert.notEqual(one, empty)
    await put('setlists', 'set-1', setlist('set-1', { name: 'Renamed' }), bob, 1)
    const renamed = await tag()
    assert.notEqual(renamed, one)
    await call('/setlists/set-1', dan, send('DELETE'))
    assert.equal(await tag(), empty)
  })

  test('holds the setlists of the last year by default, and every one when asked, which is what a first sync does', async () => {
    const { put, data } = await world()
    await put('setlists', 'old', setlist('old', { date: '2024-03-03' }))
    await put('setlists', 'recent', setlist('recent', { date: '2025-12-01' }))
    await put('setlists', 'next', setlist('next', { date: '2027-01-03' }))
    const recent = await data(cat)
    assert.deepEqual(
      recent.setlists.map(each => each.setlistId),
      ['recent', 'next']
    )
    assert.equal(recent.from, '2025-11-20')
    const everything = await data(cat, '?all=1')
    assert.deepEqual(
      everything.setlists.map(each => each.setlistId),
      ['old', 'recent', 'next']
    )
    assert.equal(everything.from, null)
  })

  test('does not mix spaces: another team’s records are not in this one’s data', async () => {
    const { put, data, sql } = await world()
    sql.exec(`UPDATE teams SET storage = 'd1' WHERE space_id = '${OTHER}'`)
    await put('setlists', 'mine', setlist('mine'))
    sql.exec(
      `INSERT INTO space_people (space_id, person_id, name, modified_at) VALUES ('${OTHER}', 'theirs', 'Zed', '${NOW.toISOString()}')`
    )
    const mine = await data(ann)
    assert.deepEqual(mine.people, [])
    assert.deepEqual(
      mine.setlists.map(each => each.setlistId),
      ['mine']
    )
  })
})

describe('writing a record', () => {
  test('makes it at version 1, and changes it from the version it was made from, replacing its songs', async () => {
    const { put, data } = await world()
    const made = await put('setlists', 'set-1', setlist('set-1'))
    assert.equal(made.status, 200)
    assert.deepEqual(await json(made), { version: 1 })
    const changed = await put(
      'setlists',
      'set-1',
      setlist('set-1', { name: 'Renamed', songs: [setlist('x').songs[1]] }),
      bob,
      1
    )
    assert.deepEqual(await json(changed), { version: 2 })
    const [row] = (await data()).setlists
    assert.deepEqual(
      [row.name, row.version, row.songs.map(each => each.songUuid)],
      ['Renamed', 2, ['song-2']]
    )
  })

  test('refuses a change made from an out-of-date version, with the record as it now is, and writes nothing', async () => {
    const { put, data } = await world()
    await put('setlists', 'set-1', setlist('set-1'))
    await put('setlists', 'set-1', setlist('set-1', { name: 'Theirs' }), eve, 1)
    const stale = await put(
      'setlists',
      'set-1',
      setlist('set-1', { name: 'Mine', songs: [] }),
      bob,
      1
    )
    assert.equal(stale.status, 409)
    const body = await json(stale)
    assert.equal(body.error, 'conflict')
    assert.deepEqual(
      [body.current.name, body.current.version, body.current.songs.length],
      ['Theirs', 2, 2]
    )
    const [row] = (await data()).setlists
    assert.deepEqual(
      [row.name, row.songs.length],
      ['Theirs', 2],
      'the stale change left it alone, songs and all'
    )
  })

  test('refuses to make what is there, and says so for every kind', async () => {
    const { put } = await world()
    for (const [kind, record] of [
      ['setlists', setlist('a')],
      ['songs', song('s')],
      ['people', person('p')],
      ['pad-sets', { padSetId: 'q', name: 'Pads' }],
    ] as const) {
      const id = (record as unknown as Record<string, string>)[
        { setlists: 'setlistId', songs: 'songUuid', people: 'personId', 'pad-sets': 'padSetId' }[
          kind
        ]
      ]
      assert.equal((await put(kind, id, record, ann)).status, 200, kind)
      const again = await put(kind, id, record, ann)
      assert.equal(again.status, 409, kind)
      assert.equal((await json(again)).current.version, 1)
    }
  })

  test('says a record is missing when a change was made from a version of one that has since been deleted', async () => {
    const { put, call } = await world()
    await put('people', 'p1', person('p1'))
    await call('/people/p1', dan, send('DELETE'))
    const answer = await put('people', 'p1', person('p1', { name: 'Changed' }), bob, 1)
    assert.equal(answer.status, 404)
    assert.equal((await json(answer)).error, 'missing')
  })

  test('keeps a setlist id to one space: another team’s setlist is not shown, nor taken', async () => {
    const { put, call, sql } = await world()
    sql.exec(`UPDATE teams SET storage = 'd1' WHERE space_id = '${OTHER}'`)
    await call(
      `/api/space/${OTHER}/setlists/shared-id`,
      ann,
      send('PUT', { baseVersion: null, record: setlist('shared-id', { name: 'Secret' }) })
    )
    const taken = await put('setlists', 'shared-id', setlist('shared-id'), ann)
    assert.equal(taken.status, 409)
    assert.deepEqual(
      (await json(taken)).current,
      null,
      'nothing of the other space’s record is given away'
    )
    const changed = await put('setlists', 'shared-id', setlist('shared-id'), ann, 1)
    assert.equal(
      changed.status,
      404,
      'a change to a record of another space is a change to one that is not here'
    )
  })

  test('refuses what is not a record, and says what is wrong, and writes nothing', async () => {
    const { put, rows } = await world()
    const refused = async (record: unknown, why: RegExp, kind = 'setlists', id = 'set-1') => {
      const answer = await put(kind, id, record, ann)
      assert.equal(answer.status, 400)
      assert.match(String((await json(answer)).error), why)
    }
    await refused(setlist('set-1', { date: 'next Sunday' }), /date/)
    await refused(setlist('other-id'), /not this setlist/)
    await refused(setlist('set-1', { name: 'two\nlines' }), /name/)
    await refused(
      setlist('set-1', {
        songs: Array.from({ length: 301 }, (_, n) => ({
          ...setlist('x').songs[1],
          songUuid: `s${n}`,
        })),
      }),
      /songs/
    )
    await refused(setlist('set-1', { songs: [{ ...setlist('x').songs[0], tempo: 90.5 }] }), /tempo/)
    await refused(setlist('set-1', { body: 'not an object' as never }), /body/)
    await refused(person('p1', { name: '' }), /name/, 'people', 'p1')
    await refused(song('s1', { songId: undefined }), /songId/, 'songs', 's1')
    await refused(setlist('bad id!'), /id/, 'setlists', 'bad id!')
    assert.deepEqual(rows('SELECT setlist_id FROM space_setlists'), [])
    assert.deepEqual(rows('SELECT * FROM space_setlist_songs'), [])
  })

  test('deletes a setlist with its songs, and answers a delete of one that is gone with the same', async () => {
    const { put, call, rows } = await world()
    await put('setlists', 'set-1', setlist('set-1'))
    assert.equal((await call('/setlists/set-1', dan, send('DELETE'))).status, 200)
    assert.deepEqual(rows('SELECT * FROM space_setlists'), [])
    assert.deepEqual(rows('SELECT * FROM space_setlist_songs'), [], 'its songs went with it')
    assert.equal(
      (await call('/setlists/set-1', dan, send('DELETE'))).status,
      200,
      'what a delete asks for is done'
    )
  })

  test('refuses a delete made from an out-of-date version, with the record as it is', async () => {
    const { put, call, data } = await world()
    await put('setlists', 'set-1', setlist('set-1'))
    await put('setlists', 'set-1', setlist('set-1', { name: 'Newer' }), bob, 1)
    const stale = await call('/setlists/set-1?baseVersion=1', dan, send('DELETE'))
    assert.equal(stale.status, 409)
    assert.equal((await json(stale)).current.name, 'Newer')
    assert.equal((await data()).setlists.length, 1)
    assert.equal((await call('/setlists/set-1?baseVersion=2', dan, send('DELETE'))).status, 200)
  })
})

describe('who may write', () => {
  test('a reader reads and nothing else', async () => {
    const { put, call } = await world()
    for (const [kind, record] of [
      ['setlists', setlist('a')],
      ['songs', song('s')],
      ['people', person('p')],
    ] as const) {
      const id = (record as unknown as Record<string, string>)[
        { setlists: 'setlistId', songs: 'songUuid', people: 'personId' }[kind]
      ]
      assert.equal((await put(kind, id, record, cat)).status, 403, kind)
    }
    await put('setlists', 'a', setlist('a'), ann)
    assert.equal((await call('/setlists/a', cat, send('DELETE'))).status, 403)
  })

  test('a writer changes setlists, songs and people, but deletes only a setlist they lead, or made', async () => {
    const { put, call, rows } = await world()
    await put('people', 'p-bob', person('p-bob'), bob)
    await put(
      'setlists',
      'led',
      setlist('led', { leaderId: 'p-bob', createdBy: 'dan@example.com' }),
      dan
    )
    await put('setlists', 'made', setlist('made', { createdBy: 'bob@example.com' }), bob)
    await put('setlists', 'theirs', setlist('theirs', { createdBy: 'dan@example.com' }), dan)
    assert.equal(
      (await call('/setlists/led', bob, send('DELETE'))).status,
      200,
      'the leader’s address is Bob’s'
    )
    assert.equal(
      (await call('/setlists/made', bob, send('DELETE'))).status,
      200,
      'with no leader, the maker'
    )
    const refused = await call('/setlists/theirs', bob, send('DELETE'))
    assert.equal(refused.status, 403)
    assert.match(String((await json(refused)).error), /leader of a setlist or an admin/)
    assert.deepEqual(rows('SELECT setlist_id FROM space_setlists'), [{ setlist_id: 'theirs' }])
    // (a writer who leads none, and made none, has no setlist to delete)
    assert.equal((await call('/setlists/theirs', eve, send('DELETE'))).status, 403)
  })

  test('follows a merged person to the one they became, to find the leader', async () => {
    const { put, call } = await world()
    await put('people', 'old-bob', person('old-bob', { emails: [], mergedInto: 'new-bob' }), dan)
    await put('people', 'new-bob', person('new-bob'), dan)
    await put(
      'setlists',
      'set-1',
      setlist('set-1', { leaderId: 'old-bob', createdBy: null as never }),
      dan
    )
    assert.equal((await call('/setlists/set-1', bob, send('DELETE'))).status, 200)
  })

  test('an admin or the owner deletes any setlist, and a writer’s own is a writer’s to change', async () => {
    const { put, call } = await world()
    await put('setlists', 'a', setlist('a', { createdBy: 'eve@example.com' }), eve)
    await put('setlists', 'b', setlist('b', { createdBy: 'eve@example.com' }), eve)
    assert.equal((await call('/setlists/a', dan, send('DELETE'))).status, 200)
    assert.equal((await call('/setlists/b', ann, send('DELETE'))).status, 200)
  })

  test('a member of any role adds a pad set, and only an admin changes or deletes one', async () => {
    const { put, call } = await world()
    assert.equal(
      (await put('pad-sets', 'pad-1', { padSetId: 'pad-1', name: 'Warm' }, cat)).status,
      200
    )
    assert.equal(
      (await put('pad-sets', 'pad-1', { padSetId: 'pad-1', name: 'Warmer' }, bob, 1)).status,
      403
    )
    assert.equal((await call('/pad-sets/pad-1', bob, send('DELETE'))).status, 403)
    assert.equal(
      (await put('pad-sets', 'pad-1', { padSetId: 'pad-1', name: 'Warmer' }, dan, 1)).status,
      200
    )
    assert.equal((await call('/pad-sets/pad-1', dan, send('DELETE'))).status, 200)
  })

  test('any member names the person who is them, and no one else’s', async () => {
    const { put, call, data } = await world()
    await put('people', 'p-cat', person('p-cat', { name: 'Cat', emails: ['cat@example.com'] }), dan)
    const named = await call('/people/p-cat/name', cat, send('PUT', { name: '  Catherine ' }))
    assert.equal(named.status, 200)
    const [row] = (await data(cat)).people
    assert.deepEqual([row.name, row.version], ['Catherine', 2])
    const other = await call('/people/p-cat/name', eve, send('PUT', { name: 'Not hers' }))
    assert.equal(other.status, 403)
    assert.equal((await call('/people/p-cat/name', cat, send('PUT', { name: '' }))).status, 400)
    assert.equal((await call('/people/nobody/name', cat, send('PUT', { name: 'X' }))).status, 404)
  })
})

describe('a batch', () => {
  test('answers each change on its own: one that is refused or out of date does not stop the others', async () => {
    const { call, put } = await world()
    // (made by Dan, so Bob neither made it nor leads it)
    await put('setlists', 'a', setlist('a', { createdBy: 'dan@example.com' }), dan)
    const answer = await call('/batch', cat, send('POST', { ops: [] }))
    assert.deepEqual(await json(answer), { results: [] })
    const mixed = await call(
      '/batch',
      bob,
      send('POST', {
        ops: [
          { kind: 'person', op: 'put', id: 'p1', baseVersion: null, record: person('p1') },
          { kind: 'setlist', op: 'put', id: 'a', baseVersion: 7, record: setlist('a') },
          {
            kind: 'pad-set',
            op: 'put',
            id: 'q',
            baseVersion: 3,
            record: { padSetId: 'q', name: 'x' },
          },
          { kind: 'person', op: 'put', id: 'p2', baseVersion: null, record: { personId: 'p2' } },
          { kind: 'song', op: 'put', id: 's1', baseVersion: null, record: song('s1') },
          { kind: 'setlist', op: 'delete', id: 'a', baseVersion: 1 },
        ],
      })
    )
    assert.equal(mixed.status, 200)
    const { results } = await json(mixed)
    assert.deepEqual(
      results.map((each: { status: string }) => each.status),
      ['ok', 'conflict', 'forbidden', 'invalid', 'ok', 'forbidden'],
      'the writer may not change a pad set, nor delete a setlist they do not lead'
    )
    assert.equal(results[1].current.version, 1)
    assert.equal(results[0].version, 1)
  })

  test('holds no more than a hundred changes, and only changes', async () => {
    const { call } = await world()
    const ops = Array.from({ length: 101 }, (_, n) => ({
      kind: 'person',
      op: 'delete',
      id: `p${n}`,
    }))
    assert.equal((await call('/batch', bob, send('POST', { ops }))).status, 400)
    assert.equal((await call('/batch', bob, send('POST', { ops: 'no' }))).status, 400)
    assert.equal((await call('/batch', bob, send('POST', { ops: [5] }))).status, 400)
    const unknown = await json(
      await call(
        '/batch',
        bob,
        send('POST', { ops: [{ kind: 'sandwich', op: 'put', id: 'x', baseVersion: null }] })
      )
    )
    assert.equal(unknown.results[0].status, 'invalid')
  })
})

describe('a team that has not moved', () => {
  test('is told so, for the data and for a write', async () => {
    const { call } = await world({ moved: false })
    const answer = await call('/data', bob)
    assert.equal(answer.status, 409)
    assert.deepEqual(await json(answer), { error: 'not_moved' })
    assert.equal(
      (await call('/setlists/a', bob, send('PUT', { baseVersion: null, record: setlist('a') })))
        .status,
      409
    )
  })

  test('is not asked about a person’s name through this: the files API names people for a team on Drive', async () => {
    const { call } = await world({ moved: false })
    const answer = await call('/people/p-bob/name', bob, send('PUT', { name: 'Bob' }))
    // (not `not_moved`: the request went on to the files API, which has no Drive for this team and says so itself)
    assert.notEqual((await json(answer)).error, 'not_moved')
  })
})

describe('every space at once', () => {
  test('answers for each space the person is in that has moved, saying so for one that has not, and which are unchanged', async () => {
    const { call, put } = await world()
    await put('setlists', 'a', setlist('a'))
    const first = await json(await call('/api/spaces/data', bob, send('POST', {})))
    assert.deepEqual(Object.keys(first.spaces).sort(), [SPACE])
    assert.equal(first.spaces[SPACE].data.setlists.length, 1)
    assert.match(first.spaces[SPACE].etag, /^"/)
    const owner = await json(await call('/api/spaces/data', ann, send('POST', {})))
    assert.deepEqual(
      owner.spaces[OTHER],
      { moved: false },
      'the owner is in both, and one is still on Drive'
    )
    const again = await json(
      await call(
        '/api/spaces/data',
        bob,
        send('POST', { etags: { [SPACE]: first.spaces[SPACE].etag } })
      )
    )
    assert.deepEqual(again.spaces[SPACE], { unchanged: true, etag: first.spaces[SPACE].etag })
    const everything = await json(
      await call(
        '/api/spaces/data',
        bob,
        send('POST', { all: true, etags: { [SPACE]: first.spaces[SPACE].etag } })
      )
    )
    assert.equal(
      everything.spaces[SPACE].data.from,
      null,
      'a different window is a different answer'
    )
  })

  test('needs a person signed in, and a POST', async () => {
    const { call } = await world()
    assert.equal((await call('/api/spaces/data', null, send('POST', {}))).status, 401)
    assert.equal((await call('/api/spaces/data', bob, { method: 'GET' })).status, 404)
  })
})

describe('what it keeps', () => {
  test('is rows with real columns, and nothing but metadata: no song text', async () => {
    const { put, rows } = await world()
    await put('songs', 'song-1', song('song-1'))
    const [row] = rows('SELECT * FROM space_songs')
    assert.deepEqual(Object.keys(row).sort(), [
      'ccli',
      'content_hash',
      'file_ref',
      'is_default',
      'licence',
      'modified_at',
      'song_id',
      'song_key',
      'song_uuid',
      'space_id',
      'title',
      'variant_label',
      'variant_of',
      'version',
    ])
  })

  test('is gone with the team, which is never deleted: its rows follow it if it ever is', async () => {
    const { put, sql, rows } = await world()
    await put('setlists', 'set-1', setlist('set-1'))
    await put('people', 'p1', person('p1'))
    sql.exec(`DELETE FROM teams WHERE space_id = '${SPACE}'`)
    for (const table of [
      'space_setlists',
      'space_setlist_songs',
      'space_people',
      'space_songs',
      'space_pad_sets',
    ]) {
      assert.deepEqual(rows(`SELECT * FROM ${table}`), [], table)
    }
  })
})

describe('the edges', () => {
  test('answers a request with no clock given by the real one', async () => {
    const { data } = await world({ clock: false })
    const year = new Date().getUTCFullYear()
    assert.match((await data(cat)).from ?? '', new RegExp(`^${year - 1}-\\d\\d-\\d\\d$`))
  })

  test('knows a space that is not a live team has nowhere its records are kept', async () => {
    const { db } = await world()
    assert.equal(await storageOf(db, 'space-nobody'), null)
    assert.equal(await storageOf(db, SPACE), 'd1')
  })

  test('changes a song, a person and a pad set from their version, and refuses an out-of-date change to each', async () => {
    const { put, data } = await world()
    await put('songs', 's1', song('s1'), bob)
    await put('people', 'p1', person('p1'), bob)
    await put('pad-sets', 'q1', { padSetId: 'q1', name: 'Warm' }, bob)
    assert.deepEqual(
      await json(
        await put('songs', 's1', song('s1', { title: 'Renamed', isDefault: false }), bob, 1)
      ),
      { version: 2 }
    )
    assert.deepEqual(
      await json(await put('people', 'p1', person('p1', { name: 'Robert' }), bob, 1)),
      { version: 2 }
    )
    assert.deepEqual(
      await json(await put('pad-sets', 'q1', { padSetId: 'q1', name: 'Warmer' }, dan, 1)),
      { version: 2 }
    )
    const now = await data()
    assert.deepEqual([now.songs[0].title, now.songs[0].isDefault], ['Renamed', false])
    assert.equal(now.people[0].name, 'Robert')
    assert.equal(now.padSets[0].name, 'Warmer')
    for (const [kind, record] of [
      ['songs', song('s1')],
      ['people', person('p1')],
      ['pad-sets', { padSetId: 'q1', name: 'x' }],
    ] as const) {
      const id = (record as unknown as Record<string, string>)[
        { songs: 'songUuid', people: 'personId', 'pad-sets': 'padSetId' }[kind]
      ]
      assert.equal((await put(kind, id, record, dan, 1)).status, 409, kind)
    }
  })

  test('fills in what a record leaves out: a setlist with no body, songs with no notes, a song with no label, a person with no addresses', async () => {
    const { put, data } = await world()
    const { body: _body, ...bare } = setlist('s')
    const lean = { ...bare, songs: [{ songUuid: 'x', songId: 'title-x', title: 'X' }] }
    assert.equal((await put('setlists', 's', lean)).status, 200)
    assert.equal(
      (await put('songs', 'a', { songUuid: 'a', songId: 'title-a', title: 'A' })).status,
      200
    )
    assert.equal((await put('people', 'p', { personId: 'p', name: 'Pat' })).status, 200)
    assert.equal((await put('setlists', 'empty', setlist('empty', { songs: [] }))).status, 200)
    const all = await data()
    assert.deepEqual(all.setlists.find(each => each.setlistId === 's')?.songs[0], {
      songUuid: 'x',
      songId: 'title-x',
      title: 'X',
      ccli: null,
      key: null,
      tempo: null,
      notes: '',
      annotations: [],
      extra: {},
    })
    assert.deepEqual(all.setlists.find(each => each.setlistId === 's')?.body, {})
    assert.deepEqual(all.setlists.find(each => each.setlistId === 'empty')?.songs, [])
    assert.deepEqual(
      [all.songs[0].variantLabel, all.songs[0].ccli, all.songs[0].isDefault],
      ['', null, false]
    )
    assert.deepEqual([all.people[0].emails, all.people[0].teamMember], [[], null])
  })

  test('refuses a record that is not the one the route names, or not an object, for every kind', async () => {
    const { put } = await world()
    for (const [kind, record] of [
      ['songs', song('other')],
      ['people', person('other')],
      ['pad-sets', { padSetId: 'other', name: 'x' }],
      ['songs', 'text'],
      ['people', null],
      ['pad-sets', [1]],
    ] as const) {
      const answer = await put(kind, 'wanted', record)
      assert.equal(answer.status, 400, `${kind} ${JSON.stringify(record).slice(0, 20)}`)
    }
  })

  test('refuses a name or a note that is not text, and keeps a line break in a note', async () => {
    const { put, data } = await world()
    assert.equal((await put('people', 'p', person('p', { name: 5 }))).status, 400)
    assert.equal((await put('people', 'p', person('p', { emails: ['a'.repeat(300)] }))).status, 400)
    assert.equal((await put('pad-sets', 'q', { padSetId: 'q', name: 'x'.repeat(101) })).status, 400)
    const song0 = setlist('n').songs[0]
    assert.equal(
      (await put('setlists', 'n', setlist('n', { songs: [{ ...song0, notes: 'bell\u0007' }] })))
        .status,
      400
    )
    assert.equal(
      (
        await put(
          'setlists',
          'n',
          setlist('n', { songs: [{ ...song0, notes: 'one\ntwo\tthree' }] })
        )
      ).status,
      200
    )
    assert.equal((await data()).setlists[0].songs[0].notes, 'one\ntwo\tthree')
    assert.equal((await put('setlists', 'm', setlist('m', { songs: [5 as never] }))).status, 400)
    assert.equal(
      (await put('setlists', 'm', setlist('m', { songs: [{ ...song0, songUuid: 'bad id' }] })))
        .status,
      400
    )
  })

  test('refuses a change that does not name the version it was made from, or names one that is not', async () => {
    const { call, put } = await world()
    await put('setlists', 'a', setlist('a'))
    const attempt = (body: unknown) => call('/setlists/a', bob, send('PUT', body))
    assert.equal((await attempt({ record: setlist('a') })).status, 400, 'no baseVersion')
    assert.equal((await attempt({ baseVersion: 0, record: setlist('a') })).status, 400)
    assert.equal((await attempt({ baseVersion: 1.5, record: setlist('a') })).status, 400)
    assert.equal((await attempt({ baseVersion: 'one', record: setlist('a') })).status, 400)
    assert.equal((await call('/setlists/a?baseVersion=abc', dan, send('DELETE'))).status, 400)
    assert.equal((await call('/setlists/a?baseVersion=0', dan, send('DELETE'))).status, 400)
  })

  test('answers a delete of what is gone from a version as done, and refuses a writer who does not lead the leader’s setlist', async () => {
    const { call, put } = await world()
    assert.equal((await call('/people/nobody?baseVersion=3', dan, send('DELETE'))).status, 200)
    await put('people', 'p-other', person('p-other', { emails: ['someone@example.com'] }), dan)
    await put(
      'setlists',
      'led',
      setlist('led', { leaderId: 'p-other', createdBy: 'bob@example.com' }),
      dan
    )
    assert.equal(
      (await call('/setlists/led', bob, send('DELETE'))).status,
      403,
      'the leader is someone else, and made it does not matter when there is one'
    )
    await put(
      'setlists',
      'unfound',
      setlist('unfound', { leaderId: 'no-such-person', createdBy: 'bob@example.com' }),
      dan
    )
    assert.equal(
      (await call('/setlists/unfound', bob, send('DELETE'))).status,
      200,
      'a leader who cannot be found leaves the maker'
    )
    await put(
      'setlists',
      'legacy',
      setlist('legacy', { body: { ownerId: 'bob@example.com' }, createdBy: 'dan@example.com' }),
      dan
    )
    assert.equal(
      (await call('/setlists/legacy', bob, send('DELETE'))).status,
      200,
      'an old setlist names its leader by address'
    )
  })

  test('is a 500, not a conflict, when the database is down, and a 404 for a request it has no route for', async () => {
    const { call, put, fail } = await world()
    await put('setlists', 'a', setlist('a'))
    assert.equal((await call('/setlists/a', bob, send('PATCH', {}))).status, 404)
    assert.equal((await call('/nonsense/x', bob, send('PUT', {}))).status, 404)
    fail(true)
    const down = await put('setlists', 'b', setlist('b'))
    assert.equal(down.status, 500)
    fail(false)
    assert.equal(
      (await put('setlists', 'b', setlist('b'))).status,
      200,
      'and nothing was half-written'
    )
  })

  test('gives up on a leader who was merged round in a circle, and refuses a writer who is not the leader', async () => {
    const { put, call } = await world()
    await put('people', 'a', person('a', { emails: [], mergedInto: 'b' }), dan)
    await put('people', 'b', person('b', { emails: [], mergedInto: 'a' }), dan)
    await put(
      'setlists',
      'round',
      setlist('round', { leaderId: 'a', createdBy: 'dan@example.com' }),
      dan
    )
    assert.equal((await call('/setlists/round', bob, send('DELETE'))).status, 403)
  })

  test('is a 502, and writes nothing, when the database fails in the middle of a change: an error it does not know is the Worker’s, not a conflict', async () => {
    const { db, put, call, data } = await world()
    await put('setlists', 'a', setlist('a'))
    const batch = db.batch.bind(db)
    db.batch = async () => {
      throw new Error('the disk is full')
    }
    assert.equal((await put('setlists', 'b', setlist('b'))).status, 502)
    assert.equal((await put('setlists', 'a', setlist('a'), bob, 1)).status, 502)
    assert.equal((await call('/setlists/a', dan, send('DELETE'))).status, 502)
    db.batch = batch
    assert.deepEqual(
      (await data()).setlists.map(each => each.setlistId),
      ['a']
    )
  })

  test('refuses a change of a kind it does not know in a batch, and a name that is not text', async () => {
    const { call, put } = await world()
    const result = await json(
      await call(
        '/batch',
        bob,
        send('POST', { ops: [{ kind: 'person', op: 'patch', id: 'p', baseVersion: null }] })
      )
    )
    assert.equal(result.results[0].status, 'invalid')
    await put('people', 'p-cat', person('p-cat', { emails: ['cat@example.com'] }), dan)
    assert.equal((await call('/people/p-cat/name', cat, send('PUT', { name: 5 }))).status, 400)
  })

  test('refuses a name that is too long or has a control character', async () => {
    const { put, call } = await world()
    await put('people', 'p-cat', person('p-cat', { emails: ['cat@example.com'] }), dan)
    assert.equal(
      (await call('/people/p-cat/name', cat, send('PUT', { name: 'x'.repeat(101) }))).status,
      400
    )
    assert.equal(
      (await call('/people/p-cat/name', cat, send('PUT', { name: 'two\nlines' }))).status,
      400
    )
    await put(
      'people',
      'merged',
      person('merged', { emails: ['cat@example.com'], mergedInto: 'p-cat' }),
      dan
    )
    assert.equal(
      (await call('/people/merged/name', cat, send('PUT', { name: 'Gone' }))).status,
      404,
      'a merged person is not named'
    )
  })
})
