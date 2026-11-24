import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleChurch } from '../worker/src/church.ts'
import type { Env } from '../worker/src/env.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { applyTeamSetlist, handleTeamSetlists } from '../worker/src/team-setlists.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

test('church setlists enforce membership, library ownership and versions', async () => {
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
  for (const id of ['admin', 'writer', 'reader', 'outsider'])
    sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(id, now)
  const req = async (who: string, method: string, path: string, body?: unknown) =>
    new Request(`https://example.test${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await signAccessToken({ accountId: who, sessionId: 's', email: `${who}@example.com` }, env)}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const church = await handleChurch(
    await req('admin', 'POST', '/api/churches', { name: 'Church', country: 'GB', city: 'York' }),
    env
  )
  const { id } = (await church.json()) as { id: string }
  for (const role of ['writer', 'reader'])
    sql
      .prepare(
        'INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)'
      )
      .run(id, role, role, now)
  const team = sql.prepare('SELECT space_id FROM teams WHERE church_id = ?').get(id)
    ?.space_id as string
  const library = sql.prepare('SELECT library_id FROM libraries WHERE church_id = ?').get(id)
    ?.library_id as string
  const other = await handleChurch(
    await req('outsider', 'POST', '/api/churches', { name: 'Other', country: 'GB', city: 'Leeds' }),
    env
  )
  const otherId = ((await other.json()) as { id: string }).id
  const otherLibrary = sql
    .prepare('SELECT library_id FROM libraries WHERE church_id = ?')
    .get(otherId)?.library_id as string
  sql
    .prepare(
      'INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, modified_at) VALUES (?, ?, ?, ?, 1, ?)'
    )
    .run(otherLibrary, 'foreign', 'foreign', 'Foreign', now)
  sql
    .prepare(
      'INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, modified_at) VALUES (?, ?, ?, ?, 1, ?)'
    )
    .run(library, 'song', 'song', 'Song', now)
  const call = async (who: string, resource: string, body?: unknown) =>
    handleTeamSetlists(
      await req(who, body ? 'POST' : 'GET', `/api/teams/${team}/${resource}`, body),
      env
    )
  const song = {
    songUuid: 'song',
    songId: 'song',
    title: 'Song',
    ccli: null,
    key: 'D',
    tempo: 100,
    notes: 'repeat',
    annotations: [{ kind: 'note' }],
    extra: { custom: true },
  }
  const record = {
    setlistId: 'set',
    date: '2026-11-22',
    time: '',
    type: '',
    name: 'Sunday',
    leaderId: 'writer',
    createdBy: 'writer@example.com',
    createdAt: now,
    body: { custom: 'value' },
    songs: [song],
  }
  const put = (baseVersion: number | null, data = record) => ({
    kind: 'setlist',
    id: 'set',
    op: 'put',
    baseVersion,
    record: data,
  })
  const broken = {
    ...record,
    get date(): string {
      throw new Error('unexpected parser failure')
    },
  }
  await assert.rejects(
    applyTeamSetlist(
      db,
      team,
      { church: id, library, role: 'admin', archived: null },
      'admin',
      put(null, broken)
    ),
    /unexpected parser failure/
  )
  const batch = async (who: string, op: unknown) =>
    (
      (await (await call(who, 'batch', { ops: [op] })).json()) as {
        results: { status: string; current?: unknown }[]
      }
    ).results[0]
  assert.equal(
    (
      await handleTeamSetlists(new Request('https://example.test/api/teams/x/data'), {
        ...env,
        DB: undefined,
      })
    ).status,
    503
  )
  assert.equal(
    (await handleTeamSetlists(new Request('https://example.test/api/teams/x/data'), env)).status,
    401
  )
  assert.equal(
    (await handleTeamSetlists(await req('admin', 'GET', '/api/teams/invalid'), env)).status,
    404
  )
  assert.equal(
    (await handleTeamSetlists(await req('admin', 'POST', `/api/teams/${team}/data`, {}), env))
      .status,
    404
  )
  assert.equal((await call('admin', 'batch', { ops: Array(101).fill({}) })).status, 400)
  assert.equal((await batch('admin', {})).status, 'invalid')
  assert.equal(
    (await batch('admin', { kind: 'setlist', id: 'set', op: 'delete', baseVersion: -1 })).status,
    'invalid'
  )
  assert.equal((await batch('admin', { kind: 'setlist', id: 'absent', op: 'delete' })).status, 'ok')
  assert.equal(
    (await batch('admin', { kind: 'setlist', id: 'set', op: 'put', baseVersion: 0, record }))
      .status,
    'invalid'
  )
  assert.equal((await batch('admin', put(null, { ...record, date: 'bad' }))).status, 'invalid')
  // A team's leader is a person: a name in words is for a personal setlist
  const named = { ...record, leaderName: 'Sam' }
  assert.equal((await batch('admin', put(null, named))).status, 'invalid')
  assert.equal(
    (await batch('admin', { ...put(1), id: 'absent', record: { ...record, setlistId: 'absent' } }))
      .status,
    'missing'
  )
  assert.equal((await call('outsider', 'data')).status, 404)
  assert.equal((await batch('reader', put(null))).status, 'forbidden')
  assert.equal(
    (await batch('writer', put(null, { ...record, songs: [{ ...song, songUuid: 'other' }] })))
      .status,
    'invalid'
  )
  assert.equal(
    (await batch('writer', put(null, { ...record, songs: [{ ...song, songUuid: 'foreign' }] })))
      .status,
    'invalid'
  )
  assert.equal(
    (await batch('writer', put(null, { ...record, leaderId: 'reader' }))).status,
    'invalid'
  )
  assert.equal((await batch('writer', put(null))).status, 'ok')
  assert.equal((await batch('admin', put(null))).status, 'conflict')
  const response = await call('reader', 'data')
  const etag = response.headers.get('ETag') as string
  const cached = await req('reader', 'GET', `/api/teams/${team}/data`)
  cached.headers.set('If-None-Match', etag)
  assert.equal((await handleTeamSetlists(cached, env)).status, 304)
  const data = (await response.json()) as { setlists: (typeof record)[] }
  assert.deepEqual(data.setlists[0].songs, [song])
  assert.equal((await batch('admin', put(1, { ...record, name: 'Changed' }))).status, 'ok')
  const conflict = await batch('writer', put(1))
  assert.equal(conflict.status, 'conflict')
  assert.equal((conflict.current as { name: string }).name, 'Changed')
  sql
    .prepare(
      "UPDATE church_members SET role = 'reader' WHERE church_id = ? AND account_id = 'writer'"
    )
    .run(id)
  assert.equal(
    (await batch('admin', put(2, { ...record, name: 'Historical leader' }))).status,
    'ok'
  )
  const history = (await (await call('reader', 'data')).json()) as {
    people: { personId: string; leaderEligible: boolean }[]
  }
  assert.equal(history.people.find(person => person.personId === 'writer')?.leaderEligible, false)
  sql.prepare('DELETE FROM church_members WHERE church_id = ? AND account_id = ?').run(id, 'writer')
  const removed = (await (await call('reader', 'data')).json()) as {
    people: { personId: string; leaderEligible: boolean }[]
  }
  assert.equal(removed.people.find(person => person.personId === 'writer')?.leaderEligible, false)
  const staleAccess = { church: id, library, role: 'writer', archived: null }
  assert.equal(
    (await applyTeamSetlist(db, team, staleAccess, 'writer', put(3))).status,
    'forbidden'
  )
  assert.equal(
    (
      await applyTeamSetlist(db, team, staleAccess, 'writer', {
        kind: 'setlist',
        id: 'set',
        op: 'delete',
        baseVersion: 3,
      })
    ).status,
    'forbidden'
  )
  assert.equal(
    (await batch('admin', { kind: 'setlist', id: 'set', op: 'delete', baseVersion: 1 })).status,
    'conflict'
  )
  assert.equal(
    (await batch('admin', { kind: 'setlist', id: 'set', op: 'delete', baseVersion: 3 })).status,
    'ok'
  )
  // A leader kept as a name, from before there were accounts for them: kept through changes to the rest of the
  // setlist (whatever the record carries), and replaced when a leader is chosen
  sql
    .prepare(`INSERT INTO setlists (setlist_id, space_id, date, time, type, name, leader_id, leader_name, created_at, modified_at)
    VALUES ('old', ?, '2026-11-22', '', '', 'Old', NULL, 'Sam', ?, ?)`)
    .run(team, now, now)
  const leaderNameOf = () =>
    sql.prepare("SELECT leader_name FROM setlists WHERE setlist_id = 'old'").get()?.leader_name
  const old = (baseVersion: number, data: Record<string, unknown>) => ({
    kind: 'setlist',
    id: 'old',
    op: 'put',
    baseVersion,
    record: { ...record, setlistId: 'old', ...data },
  })
  assert.equal(
    (await batch('admin', old(1, { name: 'Renamed', leaderId: null, leaderName: 'Sam' }))).status,
    'ok'
  )
  assert.equal(leaderNameOf(), 'Sam', 'kept')
  assert.equal(
    (await batch('admin', old(2, { name: 'Again', leaderId: null, leaderName: 'Someone else' })))
      .status,
    'ok'
  )
  assert.equal(leaderNameOf(), 'Sam', 'not changed from here')
  assert.equal((await batch('admin', old(3, { leaderId: 'admin' }))).status, 'ok')
  assert.equal(leaderNameOf(), null, 'replaced by the person chosen')
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), [])
})
