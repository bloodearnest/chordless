import assert from 'node:assert/strict'
import { test } from 'node:test'
import { d1Db } from './d1-db.ts'

const now = '2026-11-22T00:00:00.000Z'

test('library songs are scoped, versioned and cascade with their library', () => {
  const { sql } = d1Db()
  sql.exec('PRAGMA foreign_keys = ON')
  sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run('a', now)
  sql
    .prepare('INSERT INTO libraries (library_id, account_id, created_at) VALUES (?, ?, ?)')
    .run('l', 'a', now)
  const insert = sql.prepare(
    'INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, modified_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  insert.run('l', 'song', 'title-song', 'Song', 1, now)
  assert.throws(() => insert.run('missing', 'song', 'title-song', 'Song', 1, now))
  assert.throws(
    () =>
      sql.prepare("UPDATE library_songs SET source_history = '[]' WHERE library_id = 'l'").run(),
    /stale_version/
  )
  assert.throws(() =>
    sql
      .prepare("UPDATE library_songs SET source_history = '{}', version = 2 WHERE library_id = 'l'")
      .run()
  )
  sql
    .prepare(
      'UPDATE library_songs SET source_history = \'[{"pdf":"ref"}]\', version = 2 WHERE library_id = \'l\''
    )
    .run()
  sql.prepare("DELETE FROM libraries WHERE library_id = 'l'").run()
  assert.equal(sql.prepare('SELECT count(*) AS n FROM library_songs').get()?.n, 0)
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), [])
})
