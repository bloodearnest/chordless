import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleChurch } from '../worker/src/church.ts'
import type { Env } from '../worker/src/env.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { handleTeamRoutes } from '../worker/src/team-routes.ts'
import { spacesOf, TeamSpaceState } from '../worker/src/team-state.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

test('a signed-in person creates a church and its library, and only admins change it', async () => {
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
  for (const id of ['admin', 'reader', 'stranger'])
    sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(id, now)
  const token = async (id: string) =>
    signAccessToken({ accountId: id, sessionId: 's', email: `${id}@example.com` }, env)
  const call = async (who: string | null, method: string, path: string, body?: unknown) =>
    handleChurch(
      new Request(`https://chordless.test${path}`, {
        method,
        headers: who
          ? { Authorization: `Bearer ${await token(who)}`, 'Content-Type': 'application/json' }
          : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env
    )
  const data = { name: ' St Mary ', country: 'GB', city: 'York', licences: { extra: true } }
  assert.equal((await call(null, 'GET', '/api/churches')).status, 401)
  assert.equal((await call('admin', 'POST', '/api/churches', { ...data, city: '' })).status, 400)
  // (the country is a two-letter ISO code: a name, a lower-case code or a code that is none is refused)
  for (const country of ['England', 'gb', 'UK', 'GBR', 'ZZ', ''])
    assert.equal(
      (await call('admin', 'POST', '/api/churches', { ...data, country })).status,
      400,
      country
    )
  assert.equal(
    (await call('admin', 'POST', '/api/churches', { ...data, postcode: null, ccliLicence: '' }))
      .status,
    201
  )
  assert.equal((await call('admin', 'POST', '/api/churches', { ...data, name: 'x\n' })).status, 400)
  assert.equal((await call('admin', 'POST', '/api/churches', { ...data, name: 1 })).status, 400)
  assert.equal(
    (await call('admin', 'POST', '/api/churches', { ...data, name: 'x'.repeat(201) })).status,
    400
  )
  assert.equal((await call('stranger', 'PUT', '/api/churches/missing', data)).status, 404)
  assert.equal((await call('admin', 'DELETE', '/api/churches')).status, 404)
  const response = await call('admin', 'POST', '/api/churches', data)
  assert.equal(response.status, 201)
  const { id } = (await response.json()) as { id: string }
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM libraries WHERE church_id = ?').get(id)?.n, 1)
  const teams = (await (await call('admin', 'GET', `/api/churches/${id}/teams`)).json()) as {
    id: string
    name: string
    archivedAt: string | null
  }[]
  assert.equal(teams.length, 1)
  assert.equal(teams[0].name, 'St Mary Worship Team')
  assert.deepEqual(await spacesOf(db, { provider: 'chordless', sub: 'admin' }), [])
  assert.equal(
    await new TeamSpaceState(db, teams[0].id).roleOf({ provider: 'chordless', sub: 'admin' }),
    null
  )
  assert.equal(
    (await call('admin', 'POST', `/api/churches/${id}/teams`, { name: 'Evening' })).status,
    201
  )
  assert.equal(
    (await call('admin', 'DELETE', `/api/churches/${id}/teams/${teams[0].id}`)).status,
    204
  )
  assert.equal((await call('admin', 'PUT', `/api/churches/${id}/teams/${teams[0].id}`)).status, 204)
  const inviteResponse = await call(
    'admin',
    'POST',
    `/api/churches/${id}/teams/${teams[0].id}/invites`,
    { email: 'someone@example.com', role: 'reader' }
  )
  assert.equal(inviteResponse.status, 201)
  const invitation = (await inviteResponse.json()) as { code: string }
  assert.equal(
    (
      await call('stranger', 'POST', '/api/church-invites/join', {
        teamId: teams[0].id,
        code: invitation.code,
      })
    ).status,
    200
  )
  assert.equal(
    sql
      .prepare('SELECT role FROM church_members WHERE church_id = ? AND account_id = ?')
      .get(id, 'stranger')?.role,
    'reader'
  )
  assert.equal(
    sql
      .prepare('SELECT count(*) AS n FROM followed_teams WHERE account_id = ? AND space_id = ?')
      .get('stranger', teams[0].id)?.n,
    1
  )
  assert.equal(
    (
      await call('reader', 'POST', '/api/church-invites/join', {
        teamId: teams[0].id,
        code: invitation.code,
      })
    ).status,
    404
  )
  assert.equal((await call('admin', 'DELETE', `/api/churches/${id}/members/stranger`)).status, 204)
  assert.equal(
    sql.prepare('SELECT count(*) AS n FROM followed_teams WHERE account_id = ?').get('stranger')?.n,
    0
  )
  const adminInvite = (await (
    await call('admin', 'POST', `/api/churches/${id}/teams/${teams[0].id}/invites`, {
      email: 'reader@example.com',
      role: 'admin',
    })
  ).json()) as { code: string }
  assert.equal(
    (
      await call('stranger', 'POST', '/api/church-invites/join', {
        teamId: teams[0].id,
        code: adminInvite.code,
      })
    ).status,
    403
  )

  assert.equal(
    sql
      .prepare('SELECT role FROM church_members WHERE church_id = ? AND account_id = ?')
      .get(id, 'admin')?.role,
    'admin'
  )
  sql
    .prepare(
      "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, 'reader', ?)"
    )
    .run(id, 'reader', now)
  assert.equal(
    (
      await call('reader', 'POST', '/api/church-invites/join', {
        teamId: teams[0].id,
        code: adminInvite.code,
      })
    ).status,
    200
  )
  assert.equal(
    sql
      .prepare('SELECT role FROM church_members WHERE church_id = ? AND account_id = ?')
      .get(id, 'reader')?.role,
    'reader'
  )
  assert.equal((await call('stranger', 'GET', `/api/churches/${id}`)).status, 404)
  assert.equal((await call('reader', 'GET', `/api/churches/${id}`)).status, 200)
  assert.equal((await call('reader', 'PUT', `/api/churches/${id}`, data)).status, 403)
  assert.equal((await call('stranger', 'GET', `/api/churches/${id}/members`)).status, 404)
  assert.equal((await call('stranger', 'GET', `/api/churches/${id}/teams`)).status, 404)
  assert.equal((await call('admin', 'POST', `/api/churches/${id}/members`, {})).status, 404)
  assert.equal((await call('admin', 'GET', `/api/churches/${id}/teams/${teams[0].id}`)).status, 404)
  assert.equal((await call('admin', 'GET', '/api/church-invites/join')).status, 404)
  assert.equal(
    (
      await call('admin', 'POST', `/api/churches/${id}/teams/missing/invites`, {
        email: 'a@example.com',
        role: 'reader',
      })
    ).status,
    404
  )
  assert.equal(
    (await call('admin', 'POST', `/api/churches/${id}/teams/${teams[0].id}/follow`)).status,
    404
  )
  assert.equal((await call('reader', 'GET', `/api/churches/${id}/members`)).status, 200)
  // an address is shown to an admin, for a person with no name, and to no one else
  sql
    .prepare('INSERT INTO account_emails (email, account_id, created_at) VALUES (?, ?, ?)')
    .run('reader@example.com', 'reader', new Date().toISOString())
  const listed = async (who: string) =>
    (await (await call(who, 'GET', `/api/churches/${id}/members`)).json()) as {
      id: string
      email: string | null
    }[]
  assert.equal(
    (await listed('admin')).find(member => member.id === 'reader')?.email,
    'reader@example.com'
  )
  assert.equal((await listed('reader')).find(member => member.id === 'reader')?.email, null)
  assert.equal((await call('reader', 'GET', `/api/churches/${id}/teams`)).status, 200)
  assert.equal(
    (await call('reader', 'PUT', `/api/churches/${id}/teams/${teams[0].id}/follow`)).status,
    204
  )
  assert.equal(
    (await call('reader', 'DELETE', `/api/churches/${id}/teams/${teams[0].id}/follow`)).status,
    204
  )
  assert.equal(
    (await call('stranger', 'PUT', `/api/churches/${id}/teams/${teams[0].id}/follow`)).status,
    404
  )
  assert.equal(
    (await call('reader', 'PUT', `/api/churches/${id}/teams/missing/follow`)).status,
    404
  )
  assert.equal(
    (await call('admin', 'PUT', `/api/churches/${id}/members/missing`, { role: 'reader' })).status,
    404
  )
  assert.equal(
    (await call('admin', 'GET', `/api/churches/${id}/teams/${teams[0].id}/invites`)).status,
    404
  )
  assert.equal(
    (
      await call('admin', 'POST', `/api/churches/${id}/teams/${teams[0].id}/invites`, {
        role: 'owner',
        email: 'x@example.com',
      })
    ).status,
    400
  )
  assert.equal(
    (
      await call('admin', 'POST', `/api/churches/${id}/teams/${teams[0].id}/invites`, {
        role: 'reader',
        email: 'invalid',
      })
    ).status,
    400
  )
  assert.equal(
    (await call('reader', 'POST', `/api/churches/${id}/teams`, { name: 'No' })).status,
    403
  )
  assert.equal(
    (await call('reader', 'DELETE', `/api/churches/${id}/teams/${teams[0].id}`)).status,
    403
  )
  assert.equal((await call('admin', 'DELETE', `/api/churches/${id}/teams/other`)).status, 404)
  // deleting for good: not by a reader, not a team that is in use, only an archived one, and it takes what it held with it
  const doomed = `/api/churches/${id}/teams/${teams[0].id}?permanent`
  assert.equal((await call('reader', 'DELETE', doomed)).status, 403)
  assert.equal((await call('admin', 'DELETE', doomed)).status, 404)
  assert.equal(
    (await call('admin', 'DELETE', `/api/churches/${id}/teams/${teams[0].id}`)).status,
    204
  )
  assert.equal((await call('admin', 'DELETE', doomed)).status, 204)
  assert.equal(
    sql.prepare('SELECT count(*) AS n FROM teams WHERE space_id = ?').get(teams[0].id)?.n,
    0
  )
  assert.equal(
    (await call('admin', 'PUT', `/api/churches/${id}/members/reader`, { role: 'owner' })).status,
    400
  )

  assert.equal(
    (await call('reader', 'PUT', `/api/churches/${id}/members/admin`, { role: 'reader' })).status,
    403
  )
  assert.equal(
    (await call('admin', 'PUT', `/api/churches/${id}/members/admin`, { role: 'reader' })).status,
    409
  )
  assert.equal((await call('admin', 'DELETE', `/api/churches/${id}/members/admin`)).status, 409)
  assert.equal(
    (await call('admin', 'PUT', `/api/churches/${id}/members/reader`, { role: 'admin' })).status,
    204
  )
  assert.equal(
    (await call('admin', 'PUT', `/api/churches/${id}/members/admin`, { role: 'reader' })).status,
    204
  )
  assert.equal((await call('reader', 'DELETE', `/api/churches/${id}/members/admin`)).status, 204)
  assert.equal((await call('reader', 'DELETE', `/api/churches/${id}/members/reader`)).status, 409)
  sql
    .prepare(
      "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, 'admin', 'admin', ?)"
    )
    .run(id, now)

  assert.equal(
    (await call('admin', 'PUT', `/api/churches/${id}`, { ...data, name: 'New name' })).status,
    200
  )
  const list = (await (await call('admin', 'GET', '/api/churches')).json()) as { name: string }[]
  assert.ok(list.some(row => row.name === 'New name'))
  const matches = await call('reader', 'GET', '/api/churches/matches?licence=12345')
  assert.equal(matches.status, 200)
  assert.equal((await call('reader', 'GET', '/api/churches/matches')).status, 400)
  assert.equal(
    (await call('admin', 'POST', '/api/churches', { ...data, licences: [] })).status,
    400
  )
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), [])
  const noDb = { ...env, DB: undefined }
  assert.equal(
    (await handleChurch(new Request('https://chordless.test/api/churches'), noDb)).status,
    503
  )
})

test('a role removed during a settings request cannot write', async () => {
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
  sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run('admin', now)
  sql
    .prepare(
      'INSERT INTO churches (church_id, name, country, city, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run('c', 'Church', 'GB', 'York', now, now)
  sql
    .prepare(
      "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES ('c', 'admin', 'admin', ?)"
    )
    .run(now)
  const wrapped = {
    ...db,
    prepare(query: string) {
      const statement = db.prepare(query)
      if (!query.startsWith('UPDATE churches SET')) return statement
      return {
        ...statement,
        bind(...args: unknown[]) {
          const bound = statement.bind(...args)
          return {
            ...bound,
            async run() {
              sql
                .prepare(
                  "DELETE FROM church_members WHERE church_id = 'c' AND account_id = 'admin'"
                )
                .run()
              return bound.run()
            },
          }
        },
      }
    },
  }
  const token = await signAccessToken(
    { accountId: 'admin', sessionId: 's', email: 'admin@example.com' },
    env
  )
  const response = await handleChurch(
    new Request('https://chordless.test/api/churches/c', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Changed', country: 'GB', city: 'York' }),
    }),
    { ...env, DB: wrapped }
  )
  assert.equal(response.status, 403)
  assert.equal(sql.prepare("SELECT name FROM churches WHERE church_id = 'c'").get()?.name, 'Church')
})

test('an existing Drive team is adopted by a church: members carried over by role, one change, and only by someone who owns both', async () => {
  const { db, sql } = d1Db()
  const env = {
    DB: db,
    SESSION_SIGNING_KEY: key(),
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    JWE_ENCRYPTION_KEY: key(),
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  const T = '2026-11-27T10:00:00.000Z'
  const run = (text: string, ...values: (string | null)[]) => sql.prepare(text).run(...values)
  for (const id of ['owner', 'admin2', 'writer1', 'writer2', 'reader1', 'stranger', 'other-admin'])
    run('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)', id, T)
  const team = (id: string, owner: string) =>
    run(
      `INSERT INTO teams (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at) VALUES (?, ?, ?, ?, 'google', 's', ?, ?)`,
      id,
      id,
      owner,
      `${owner}@example.com`,
      T,
      T
    )
  team('team-alpha', 'owner')
  team('team-bravo', 'owner')
  for (const [account, role] of [
    ['admin2', 'admin'],
    ['writer1', 'writer'],
    ['writer2', 'writer'],
    ['reader1', 'reader'],
  ])
    run(
      'INSERT INTO team_members (space_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)',
      'team-alpha',
      account,
      role,
      T
    )
  // (the second team has people who are in the first too, and the owner is not on either list)
  for (const [account, role] of [
    ['writer1', 'admin'],
    ['writer2', 'reader'],
  ])
    run(
      'INSERT INTO team_members (space_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)',
      'team-bravo',
      account,
      role,
      T
    )
  const call = async (who: string, method: string, path: string) =>
    handleChurch(
      new Request(`https://chordless.test${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await signAccessToken({ accountId: who, sessionId: 's', email: `${who}@example.com` }, env)}`,
          'Content-Type': 'application/json',
        },
      }),
      env
    )
  const made = await call('owner', 'POST', '/api/churches')
  assert.equal(made.status, 400, 'a church needs its details')
  const church = (
    (await (
      await handleChurch(
        new Request('https://chordless.test/api/churches', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await signAccessToken({ accountId: 'owner', sessionId: 's', email: 'owner@example.com' }, env)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'St Mary', country: 'GB', city: 'York' }),
        }),
        env
      )
    ).json()) as { id: string }
  ).id
  const adopt = (who: string, team: string, id = church) =>
    call(who, 'POST', `/api/churches/${id}/teams/${team}/adopt`)
  const roles = () =>
    Object.fromEntries(
      (
        sql
          .prepare('SELECT account_id, role FROM church_members WHERE church_id = ?')
          .all(church) as { account_id: string; role: string }[]
      ).map(row => [row.account_id, row.role])
    )

  // Not by someone outside the church, not for a team that is not theirs, not for one that is not there, and not by GET
  assert.equal((await adopt('stranger', 'team-alpha')).status, 404, 'not in the church')
  sql
    .prepare(
      "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, 'other-admin', 'admin', ?)"
    )
    .run(church, T)
  assert.equal(
    (await adopt('other-admin', 'team-alpha')).status,
    404,
    'a church admin who is not of the team'
  )
  assert.equal((await adopt('owner', 'no-such-team')).status, 404)
  assert.equal(
    (await call('owner', 'GET', `/api/churches/${church}/teams/team-alpha/adopt`)).status,
    404
  )
  assert.equal(
    sql
      .prepare(
        "SELECT count(*) AS n FROM teams WHERE church_id IS NOT NULL AND space_id LIKE 'team-%'"
      )
      .get()?.n,
    0,
    'nothing changed'
  )

  // The first team: its members come across with their roles, and the team is the church's, with its id
  const first = (await (await adopt('owner', 'team-alpha')).json()) as {
    teamId: string
    churchId: string
    members: number
  }
  assert.deepEqual(
    { ...first, members: undefined },
    { teamId: 'team-alpha', churchId: church, members: undefined }
  )
  assert.deepEqual(roles(), {
    owner: 'admin',
    admin2: 'admin',
    writer1: 'writer',
    writer2: 'writer',
    reader1: 'reader',
    'other-admin': 'admin',
  })
  assert.equal(
    sql.prepare("SELECT church_id AS c FROM teams WHERE space_id = 'team-alpha'").get()?.c,
    church
  )
  assert.equal(
    sql.prepare("SELECT church_id AS c FROM teams WHERE space_id = 'team-bravo'").get()?.c,
    null,
    'the other team is as it was'
  )
  // its people follow it (and no one follows the team that has not moved)
  const followers = (id: string) =>
    (
      sql
        .prepare('SELECT account_id AS a FROM followed_teams WHERE space_id = ? ORDER BY 1')
        .all(id) as { a: string }[]
    ).map(row => row.a)
  assert.deepEqual(
    followers('team-alpha'),
    ['admin2', 'owner', 'reader1', 'writer1', 'writer2'].sort()
  )
  assert.deepEqual(followers('team-bravo'), [])

  // Again: nothing changes. The second team: people in both keep the higher role, and nobody is lowered
  assert.equal(
    ((await (await adopt('owner', 'team-alpha')).json()) as { already?: boolean }).already,
    true
  )
  assert.equal((await adopt('owner', 'team-bravo')).status, 200)
  assert.deepEqual(roles(), {
    owner: 'admin',
    admin2: 'admin',
    writer1: 'admin',
    writer2: 'writer',
    reader1: 'reader',
    'other-admin': 'admin',
  })
  // (the church was made with a team of its own, and has the two that were adopted besides)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM teams WHERE church_id = ?').get(church)?.n, 3)

  // A team of another church is not taken: the other church's admin is told so
  const rival = (
    (await (
      await handleChurch(
        new Request('https://chordless.test/api/churches', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await signAccessToken({ accountId: 'owner', sessionId: 's', email: 'owner@example.com' }, env)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'St Paul', country: 'GB', city: 'Leeds' }),
        }),
        env
      )
    ).json()) as { id: string }
  ).id
  assert.equal((await adopt('owner', 'team-alpha', rival)).status, 409)
  assert.equal(
    sql.prepare("SELECT church_id AS c FROM teams WHERE space_id = 'team-alpha'").get()?.c,
    church
  )

  // An older app that still asks the Drive routes for it is told to update, if it is a member of the church, and not otherwise
  const old = async (who: string, team: string) =>
    handleTeamRoutes(
      new Request(`https://chordless.test/api/space/${team}/files`, {
        headers: {
          Authorization: `Bearer ${await signAccessToken({ accountId: who, sessionId: 's', email: `${who}@example.com` }, env)}`,
        },
      }),
      env
    )
  const told = await old('writer1', 'team-alpha')
  assert.equal(told.status, 410)
  assert.match(((await told.json()) as { error: string }).error, /update the app/)
  assert.equal(
    (await old('stranger', 'team-alpha')).status,
    403,
    'someone outside the church is told nothing of it'
  )
  assert.equal((await old('writer1', 'no-such-team')).status, 403)

  // The Drive team routes no longer see it (their listing is of teams with no church)
  const seen = await spacesOf(db, { provider: 'chordless', sub: 'owner' })
  assert.deepEqual(
    seen.map(each => each.spaceId ?? (each as { id?: string }).id),
    []
  )
})
