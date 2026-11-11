/**
 * The register of teams (worker/src/team-register.ts): a D1 table that outlives a team. The
 * database is SQLite (node:sqlite) with the migration file applied as it stands, so the SQL
 * and the schema are tested together.
 */
import assert from 'node:assert/strict'
import type { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'
import { TeamRegister } from '../worker/src/team-register.ts'
import { registerDb } from './register-db.ts'

const NOW = new Date('2026-11-12T09:00:00Z')
const team = {
  spaceId: 'space-aaaaaaaa',
  name: 'St Mary’s',
  ownerEmail: 'Ann@Example.com',
  createdAt: '2026-11-01T10:00:00Z',
}

/** The rows as plain objects (SQLite's have no prototype) */
const rows = (sql: DatabaseSync, query: string) =>
  sql
    .prepare(query)
    .all()
    .map(row => ({ ...row }))

describe('the register of teams', () => {
  test('a new team is a row, with its owner in lower case, its first member, and a created event', async () => {
    const { db, sql } = registerDb()
    await new TeamRegister(db, () => NOW).created(team, 'Ann@Example.com', null, 1)
    assert.deepEqual(rows(sql, 'SELECT * FROM teams'), [
      {
        space_id: 'space-aaaaaaaa',
        name: 'St Mary’s',
        owner_email: 'ann@example.com',
        created_at: '2026-11-01T10:00:00Z',
        ccli_licence: null,
        members: 1,
        ended_at: null,
        updated_at: NOW.toISOString(),
      },
    ])
    assert.deepEqual(rows(sql, 'SELECT kind, by_email, detail, at FROM team_events'), [
      { kind: 'created', by_email: 'ann@example.com', detail: null, at: NOW.toISOString() },
    ])
  })

  test('a team made with a licence number has it, and the event that set it', async () => {
    const { db, sql } = registerDb()
    await new TeamRegister(db, () => NOW).created(team, 'ann@example.com', '471102', 1)
    assert.equal(rows(sql, 'SELECT ccli_licence FROM teams')[0].ccli_licence, '471102')
    assert.deepEqual(
      rows(sql, 'SELECT kind, detail FROM team_events ORDER BY id').map(({ kind, detail }) => [
        kind,
        detail && JSON.parse(String(detail)),
      ]),
      [
        ['created', null],
        ['licence', { from: null, to: '471102' }],
      ]
    )
  })

  test('a licence change updates the number and is logged with who did it, from and to, clearing included', async () => {
    const { db, sql } = registerDb()
    const register = new TeamRegister(db, () => NOW)
    await register.created(team, 'ann@example.com', null, 1)
    await register.licence(team, 'dan@example.com', null, '471102')
    await register.licence(team, 'Ann@example.com', '471102', null)
    assert.equal(rows(sql, 'SELECT ccli_licence FROM teams')[0].ccli_licence, null)
    assert.deepEqual(
      rows(sql, "SELECT by_email, detail FROM team_events WHERE kind = 'licence' ORDER BY id").map(
        ({ by_email, detail }) => [by_email, JSON.parse(String(detail))]
      ),
      [
        ['dan@example.com', { from: null, to: '471102' }],
        ['ann@example.com', { from: '471102', to: null }],
      ]
    )
  })

  test('the member count follows, with no event', async () => {
    const { db, sql } = registerDb()
    const register = new TeamRegister(db, () => NOW)
    await register.created(team, 'ann@example.com', null, 1)
    await register.members(team, 4)
    assert.equal(rows(sql, 'SELECT members FROM teams')[0].members, 4)
    assert.equal(rows(sql, 'SELECT COUNT(*) AS n FROM team_events')[0].n, 1)
  })

  test('ending sharing marks the team and keeps it, with its number and its history', async () => {
    const { db, sql } = registerDb()
    const register = new TeamRegister(db, () => NOW)
    await register.created(team, 'ann@example.com', '471102', 1)
    await register.ended(team, 'ann@example.com')
    const [row] = rows(sql, 'SELECT ccli_licence, ended_at FROM teams')
    assert.deepEqual(row, { ccli_licence: '471102', ended_at: NOW.toISOString() })
    assert.deepEqual(
      rows(sql, 'SELECT kind FROM team_events ORDER BY id').map(each => each.kind),
      ['created', 'licence', 'ended']
    )
  })

  test('a write that was lost is made good by the next: the team’s row is made, or brought up to date, by any write', async () => {
    const { db, sql, fail } = registerDb()
    const register = new TeamRegister(db, () => NOW)
    fail(true)
    await assert.rejects(register.created(team, 'ann@example.com', '471102', 1), /down/)
    assert.deepEqual(rows(sql, 'SELECT * FROM teams'), [])
    fail(false)
    await register.licence({ ...team, name: 'St Mary’s Music' }, 'ann@example.com', null, '471102')
    assert.deepEqual(rows(sql, 'SELECT name, ccli_licence FROM teams'), [
      { name: 'St Mary’s Music', ccli_licence: '471102' },
    ])
  })

  test('is dated by the clock when none is given', async () => {
    const { db, sql } = registerDb()
    await new TeamRegister(db).created(team, 'ann@example.com', null, 1)
    const age =
      Date.now() -
      new Date(String(rows(sql, 'SELECT updated_at FROM teams')[0].updated_at)).getTime()
    assert.ok(age >= 0 && age < 60_000)
  })

  test('answers a question CCLI might ask: the teams that say they hold a licence number', async () => {
    const { db, sql } = registerDb()
    const register = new TeamRegister(db, () => NOW)
    await register.created(team, 'ann@example.com', '471102', 1)
    await register.created(
      { ...team, spaceId: 'space-bbbbbbbb', name: 'Other' },
      'bob@example.com',
      '999',
      1
    )
    assert.deepEqual(
      rows(sql, "SELECT name, owner_email FROM teams WHERE ccli_licence = '471102'"),
      [{ name: 'St Mary’s', owner_email: 'ann@example.com' }]
    )
  })
})
