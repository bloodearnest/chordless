/**
 * The rebuild of team_setlists as setlists (migrations/0019_setlists_by_owner.sql): a setlist is owned by
 * a team or by an account, one of the two. Rows are written as the code before it wrote them, then it is
 * applied, and each row has to come out as it went in, owned by its team.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

const DIRECTORY = new URL('../migrations/', import.meta.url)
const THIS = '0019_setlists_by_owner.sql'

/** A database with the migrations before this one applied */
function before(): DatabaseSync {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(DIRECTORY).sort()) {
    if (file >= THIS) break
    sql.exec(readFileSync(new URL(file, DIRECTORY), 'utf8'))
  }
  return sql
}

/** Applied as D1 does: all of it, or none */
function apply(sql: DatabaseSync) {
  sql.exec('BEGIN')
  try {
    sql.exec(readFileSync(new URL(THIS, DIRECTORY), 'utf8'))
    sql.exec('COMMIT')
  } catch (error) {
    sql.exec('ROLLBACK')
    throw error
  }
}

const T = '2026-11-20T10:00:00.000Z'

function church(sql: DatabaseSync, id: string, team: string | null) {
  sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(`owner-${id}`, T)
  if (team !== 'none') {
    sql
      .prepare(`INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at)
      VALUES (?, 'Church', 'GB', 'York', '{}', ?, ?)`)
      .run(id, T, T)
    sql
      .prepare('INSERT INTO libraries (library_id, church_id, created_at) VALUES (?, ?, ?)')
      .run(`library-${id}`, id, T)
  }
  if (team !== null)
    sql
      .prepare(`INSERT INTO teams (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at, church_id)
      VALUES (?, 'Team', ?, 'o@example.com', 'google', 'sub', ?, ?, ?)`)
      .run(`team-${id}`, `owner-${id}`, T, T, team === 'none' ? null : id)
}

const setlist = (sql: DatabaseSync, id: string, team: string, over: Record<string, string> = {}) =>
  sql
    .prepare(`INSERT INTO team_setlists (space_id, setlist_id, date, time, type, name, leader_id, created_by, created_at, body, songs, version, modified_at)
    VALUES (?, ?, '2026-11-22', '10:00', 'Sunday', ?, NULL, 'someone', ?, ?, ?, 3, ?)`)
    .run(
      team,
      id,
      over.name ?? 'Morning',
      T,
      over.body ?? '{"notes":"hi"}',
      over.songs ?? '[{"songUuid":"s1"}]',
      T
    )

test('each setlist comes out as it went in, owned by its team', () => {
  const sql = before()
  church(sql, 'a', 'team')
  church(sql, 'b', 'team')
  setlist(sql, 'one', 'team-a')
  setlist(sql, 'two', 'team-a', { name: 'Evening', body: '{}', songs: '[]' })
  setlist(sql, 'three', 'team-b')
  apply(sql)

  const rows = sql.prepare('SELECT * FROM setlists ORDER BY setlist_id').all() as Record<
    string,
    unknown
  >[]
  assert.deepEqual(
    rows.map(row => [row.setlist_id, row.space_id, row.account_id, row.name, row.version]),
    [
      ['one', 'team-a', null, 'Morning', 3],
      ['three', 'team-b', null, 'Morning', 3],
      ['two', 'team-a', null, 'Evening', 3],
    ]
  )
  assert.equal(rows[0].body, '{"notes":"hi"}')
  assert.equal(rows[0].songs, '[{"songUuid":"s1"}]')
  assert.equal(rows[0].created_by, 'someone')
  assert.equal(
    sql.prepare("SELECT 1 FROM sqlite_master WHERE name = 'team_setlists'").get(),
    undefined
  )
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), [])
})

test('a team that has no church is copied as it was', () => {
  const sql = before()
  church(sql, 'x', 'none')
  setlist(sql, 'orphan', 'team-x')
  apply(sql)
  assert.equal(
    sql.prepare("SELECT space_id FROM setlists WHERE setlist_id = 'orphan'").get()?.space_id,
    'team-x'
  )
})

test('a setlist is still refused a stale version, and goes with its team', () => {
  const sql = before()
  church(sql, 'a', 'team')
  setlist(sql, 'one', 'team-a')
  apply(sql)
  assert.throws(() => sql.prepare("UPDATE setlists SET name = 'x'").run(), /stale_version/)
  sql.prepare("UPDATE setlists SET name = 'x', version = 4").run()
  sql.prepare("DELETE FROM teams WHERE space_id = 'team-a'").run()
  assert.equal(sql.prepare('SELECT count(*) AS n FROM setlists').get()?.n, 0)
})

test('a personal setlist is owned by an account, and by exactly one owner', () => {
  const sql = before()
  church(sql, 'a', 'team')
  apply(sql)
  sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run('me', T)
  const insert = (id: string, team: string | null, account: string | null) =>
    sql
      .prepare(`INSERT INTO setlists (setlist_id, space_id, account_id, date, time, type, name, created_at, modified_at)
      VALUES (?, ?, ?, '2026-11-22', '10:00', 'Sunday', 'Mine', ?, ?)`)
      .run(id, team, account, T, T)
  insert('mine', null, 'me')
  insert('theirs', 'team-a', null)
  assert.throws(() => insert('both', 'team-a', 'me'), /CHECK/)
  assert.throws(() => insert('neither', null, null), /CHECK/)
  assert.throws(() => insert('nobody', null, 'no-such-account'), /FOREIGN KEY/)
  sql.prepare("DELETE FROM accounts WHERE account_id = 'me'").run()
  assert.deepEqual(
    sql
      .prepare('SELECT setlist_id FROM setlists ORDER BY setlist_id')
      .all()
      .map(row => row.setlist_id),
    ['theirs']
  )
})
