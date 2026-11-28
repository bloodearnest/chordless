/**
 * migrations/0025_follow_adopted_teams.sql: the people of a team that moved into a church follow it (data only). A team
 * that has not moved, one that ended, a person who is no longer in the church, and a follow already there are left as they are.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

const DIRECTORY = new URL('../migrations/', import.meta.url)
const THIS = '0025_follow_adopted_teams.sql'
const T = '2026-11-28T10:00:00.000Z'

function migrated(upTo: 'before' | 'after'): DatabaseSync {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(DIRECTORY).sort()) {
    if (upTo === 'before' && file >= THIS) break
    sql.exec(readFileSync(new URL(file, DIRECTORY), 'utf8'))
  }
  return sql
}

test('the people of an adopted team follow it, and nothing else changes', () => {
  const sql = migrated('before')
  const run = (text: string, ...values: (string | null)[]) => sql.prepare(text).run(...values)
  for (const id of ['owner', 'member', 'left', 'other'])
    run('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)', id, T)
  run(
    `INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at) VALUES ('c', 'C', 'GB', 'York', '{}', ?, ?)`,
    T,
    T
  )
  for (const account of ['owner', 'member', 'other'])
    run(
      `INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES ('c', ?, 'writer', ?)`,
      account,
      T
    )
  const team = (id: string, church: string | null, ended: string | null) =>
    run(
      `INSERT INTO teams (space_id, name, owner_account_id, owner_email, owner_provider, owner_sub, created_at, updated_at, church_id, ended_at) VALUES (?, ?, 'owner', 'o@example.com', 'google', 's', ?, ?, ?, ?)`,
      id,
      id,
      T,
      T,
      church,
      ended
    )
  team('adopted', 'c', null)
  team('drive', null, null)
  team('ended', 'c', T)
  for (const space of ['adopted', 'drive', 'ended'])
    for (const account of ['member', 'left'])
      run(
        `INSERT INTO team_members (space_id, account_id, role, joined_at) VALUES (?, ?, 'writer', ?)`,
        space,
        account,
        T
      )
  run(`INSERT INTO followed_teams (account_id, space_id) VALUES ('member', 'adopted')`)

  sql.exec(readFileSync(new URL(THIS, DIRECTORY), 'utf8'))
  const follows = (
    sql
      .prepare('SELECT space_id AS s, account_id AS a FROM followed_teams ORDER BY 1, 2')
      .all() as {
      s: string
      a: string
    }[]
  ).map(row => `${row.s}:${row.a}`)
  assert.deepEqual(follows, ['adopted:member', 'adopted:owner'])
  // (and again: the same)
  sql.exec(readFileSync(new URL(THIS, DIRECTORY), 'utf8'))
  assert.equal(sql.prepare('SELECT count(*) AS n FROM followed_teams').get()?.n, 2)
  assert.equal(migrated('after') instanceof DatabaseSync, true)
})
