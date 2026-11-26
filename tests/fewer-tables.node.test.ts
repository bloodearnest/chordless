/**
 * migrations/0024_fewer_tables.sql: the overlays and the pad sets that were tables become documents, and what the tables
 * held is carried over. Tried on rows as the code before it wrote them (docs/SCHEMA_RULES.md).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

const DIRECTORY = new URL('../migrations/', import.meta.url)
const THIS = '0024_fewer_tables.sql'
const T = '2026-11-25T10:00:00.000Z'

function migrated(upTo: 'before' | 'after'): DatabaseSync {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(DIRECTORY).sort()) {
    if (upTo === 'before' && file >= THIS) break
    sql.exec(readFileSync(new URL(file, DIRECTORY), 'utf8'))
  }
  return sql
}

const tables = (sql: DatabaseSync) =>
  (
    sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map(row => row.name)

test('the overlays and pad sets of before are carried into their documents, and the tables go', () => {
  const sql = migrated('before')
  const run = (text: string, ...values: (string | number | null)[]) =>
    sql.prepare(text).run(...values)
  for (const id of ['me', 'you', 'none'])
    run('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)', id, T)
  run(`INSERT INTO libraries (library_id, account_id, created_at) VALUES ('lib-me', 'me', ?)`, T)
  run(`INSERT INTO libraries (library_id, account_id, created_at) VALUES ('lib-you', 'you', ?)`, T)
  run(
    `INSERT INTO libraries (library_id, account_id, created_at) VALUES ('lib-none', 'none', ?)`,
    T
  )
  run(
    `INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, modified_at) VALUES ('lib-me', 'u1', 's1', 'S', 1, ?)`,
    T
  )
  run(
    `INSERT INTO setlists (setlist_id, account_id, date, time, type, name, created_at, modified_at) VALUES ('set', 'me', '2026-11-22', '', '', 'Sunday', ?, ?)`,
    T,
    T
  )
  run(
    `INSERT INTO setlist_overlays (account_id, setlist_id, body, modified_at) VALUES ('me', 'set', '{"capo":2}', ?)`,
    T
  )
  run(
    `INSERT INTO song_overlays (account_id, library_id, song_uuid, body, modified_at) VALUES ('me', 'lib-me', 'u1', '{"capo":3}', ?)`,
    T
  )
  run(
    `INSERT INTO account_preferences (account_id, body, modified_at) VALUES ('me', '{"pitch":"Bb"}', ?)`,
    T
  )
  run(
    `INSERT INTO account_preferences (account_id, body, modified_at) VALUES ('you', '{"tuning":"-1"}', ?)`,
    T
  )
  run(
    `INSERT INTO library_pad_sets (library_id, pad_set_id, name, modified_at) VALUES ('lib-me', 'p1', 'Warm', ?)`,
    T
  )
  run(
    `INSERT INTO library_pad_sets (library_id, pad_set_id, name, modified_at) VALUES ('lib-me', 'p2', 'Bright', ?)`,
    T
  )
  sql.exec(readFileSync(new URL(THIS, DIRECTORY), 'utf8'))

  const documents = sql
    .prepare('SELECT account_id, body, version FROM account_overlays ORDER BY account_id')
    .all() as {
    account_id: string
    body: string
    version: number
  }[]
  assert.deepEqual(
    documents.map(row => [row.account_id, JSON.parse(row.body), row.version]),
    [
      [
        'me',
        { settings: { pitch: 'Bb' }, setlists: { set: { capo: 2 } }, songs: { u1: { capo: 3 } } },
        1,
      ],
      ['you', { settings: { tuning: '-1' }, setlists: {}, songs: {} }, 1],
    ],
    'an account with something has its document, and one with nothing has none'
  )
  const sets = (id: string) => {
    const row = sql
      .prepare('SELECT pad_sets, pad_sets_version FROM libraries WHERE library_id = ?')
      .get(id) as {
      pad_sets: string
      pad_sets_version: number
    }
    return [
      JSON.parse(row.pad_sets)
        .map((each: { id: string; name: string }) => [each.id, each.name])
        .sort(),
      row.pad_sets_version,
    ]
  }
  assert.deepEqual(sets('lib-me'), [
    [
      ['p1', 'Warm'],
      ['p2', 'Bright'],
    ].sort(),
    1,
  ])
  assert.deepEqual(sets('lib-you'), [[], 1], 'a library with none has an empty list')
  for (const gone of [
    'setlist_overlays',
    'song_overlays',
    'account_preferences',
    'library_pad_sets',
  ])
    assert.ok(!tables(sql).includes(gone), gone)
  assert.ok(tables(sql).includes('account_overlays'))

  // The rules of what is new: an object, a version, and a list of sets that is a list
  assert.throws(() =>
    sql
      .prepare(
        "INSERT INTO account_overlays (account_id, body, modified_at) VALUES ('none', '[]', ?)"
      )
      .run(T)
  )
  sql
    .prepare(
      "INSERT INTO account_overlays (account_id, body, modified_at) VALUES ('none', '{}', ?)"
    )
    .run(T)
  assert.throws(
    () => sql.prepare("UPDATE account_overlays SET body = '{}' WHERE account_id = 'none'").run(),
    /stale_version/
  )
  assert.throws(() =>
    sql.prepare("UPDATE libraries SET pad_sets = '{}' WHERE library_id = 'lib-none'").run()
  )
  assert.throws(() =>
    sql.prepare('UPDATE libraries SET pad_sets_version = 0 WHERE library_id = ?').run('lib-none')
  )
})

test('on an empty database it adds an empty document table and no sets', () => {
  const sql = migrated('after')
  assert.equal(sql.prepare('SELECT count(*) AS n FROM account_overlays').get()?.n, 0)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM libraries').get()?.n, 0)
})
