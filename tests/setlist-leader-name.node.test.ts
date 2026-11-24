/**
 * migrations/0020_setlist_leader_name.sql: a setlist's leader in words. Rows from before it pass its check (the
 * new column is NULL), and after it a name is never beside a leader account and is 1 to 200 characters long.
 * (Who may write one, a person on their own setlist, and a team only keeping one, is the Worker's.)
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

const DIRECTORY = new URL('../migrations/', import.meta.url)
const THIS = '0020_setlist_leader_name.sql'
const T = '2026-11-24T10:00:00.000Z'

function migrated(upTo: 'before' | 'after'): DatabaseSync {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(DIRECTORY).sort()) {
    if (upTo === 'before' && file >= THIS) break
    sql.exec(readFileSync(new URL(file, DIRECTORY), 'utf8'))
  }
  return sql
}

const insert = (
  sql: DatabaseSync,
  id: string,
  owner: { team?: string; account?: string },
  leader: { id?: string; name?: string | null } = {}
) =>
  sql
    .prepare(`INSERT INTO setlists (setlist_id, space_id, account_id, date, time, type, name, leader_id, leader_name, created_at, modified_at)
    VALUES (?, ?, ?, '2026-11-22', '', '', 'Sunday', ?, ?, ?, ?)`)
    .run(
      id,
      owner.team ?? null,
      owner.account ?? null,
      leader.id ?? null,
      leader.name ?? null,
      T,
      T
    )

function seed(sql: DatabaseSync) {
  sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run('me', T)
  sql
    .prepare(`INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at)
    VALUES ('c', 'C', 'GB', 'York', '{}', ?, ?)`)
    .run(T, T)
  sql
    .prepare(`INSERT INTO teams (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at, church_id)
    VALUES ('team', 'T', 'me', 'me@example.com', 'google', 's', ?, ?, 'c')`)
    .run(T, T)
}

test('setlists from before the column are kept, with no name', () => {
  const sql = migrated('before')
  seed(sql)
  sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run('you', T)
  sql
    .prepare(`INSERT INTO setlists (setlist_id, space_id, date, time, type, name, leader_id, created_at, modified_at)
    VALUES ('old', 'team', '2026-11-22', '', '', 'Old', 'you', ?, ?)`)
    .run(T, T)
  sql.exec(readFileSync(new URL(THIS, DIRECTORY), 'utf8'))
  const row = sql
    .prepare("SELECT leader_id, leader_name FROM setlists WHERE setlist_id = 'old'")
    .get()
  assert.deepEqual({ ...row }, { leader_id: 'you', leader_name: null })
})

test('a name has no leader account beside it, and is 1 to 200 characters', () => {
  const sql = migrated('after')
  seed(sql)
  insert(sql, 'named', { account: 'me' }, { name: 'Sam' })
  insert(sql, 'myself', { account: 'me' }, { id: 'me' })
  insert(sql, 'nobody', { account: 'me' })
  insert(sql, 'long', { account: 'me' }, { name: 'x'.repeat(200) })
  insert(sql, 'person', { team: 'team' }, { id: 'me' })
  assert.throws(() => insert(sql, 'both', { account: 'me' }, { id: 'me', name: 'Sam' }), /CHECK/)
  insert(sql, 'kept', { team: 'team' }, { name: 'Sam' }) // a team's, kept from before
  assert.throws(
    () => insert(sql, 'team-both', { team: 'team' }, { id: 'me', name: 'Sam' }),
    /CHECK/
  )
  assert.throws(() => insert(sql, 'empty', { account: 'me' }, { name: '' }), /CHECK/)
  assert.throws(
    () => insert(sql, 'too-long', { account: 'me' }, { name: 'x'.repeat(201) }),
    /CHECK/
  )
  // a setlist made a team's, or given a leader, loses to the same rule
  assert.throws(
    () =>
      sql
        .prepare(
          "UPDATE setlists SET leader_id = 'me', version = version + 1 WHERE setlist_id = 'named'"
        )
        .run(),
    /CHECK/
  )
})
