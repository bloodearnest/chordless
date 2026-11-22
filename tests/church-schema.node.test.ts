import assert from 'node:assert/strict'
import { test } from 'node:test'
import { d1Db } from './d1-db.ts'

const now = '2026-11-22T00:00:00.000Z'

test('church and personal libraries have one valid owner and do not disturb existing Teams', () => {
  const { sql } = d1Db()
  sql.exec('PRAGMA foreign_keys = ON')
  sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run('a', now)
  sql
    .prepare(
      'INSERT INTO churches (church_id, name, country, city, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run('c', 'Church', 'GB', 'York', now, now)
  const library = sql.prepare(
    'INSERT INTO libraries (library_id, church_id, account_id, created_at) VALUES (?, ?, ?, ?)'
  )
  library.run('l1', 'c', null, now)
  library.run('l2', null, 'a', now)
  assert.throws(() => library.run('none', null, null, now))
  assert.throws(() => library.run('both', 'c', 'a', now))
  assert.throws(() => library.run('duplicate-church', 'c', null, now))
  assert.throws(() => library.run('duplicate-account', null, 'a', now))
  assert.throws(() => library.run('missing', 'missing', null, now))
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), [])
})

test('church licence metadata must be a JSON object', () => {
  const { sql } = d1Db()
  const insert = sql.prepare(
    'INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  assert.throws(() => insert.run('c', 'Church', 'GB', 'York', '[]', now, now))
  insert.run('c', 'Church', 'GB', 'York', '{}', now, now)
})
