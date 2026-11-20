/**
 * The schema clean-up (migrations/0011_schema_cleanup.sql, docs/SCHEMA_AUDIT.md): the tables as they were
 * before it, filled with rows as production has them, taken through it; and the schema it leaves.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'

const DIRECTORY = new URL('../migrations/', import.meta.url)
const T = '2026-11-01T10:00:00.000Z'

/** A database with the migrations before the clean-up applied, then `before`, then the clean-up (if asked) */
function database(before?: (sql: DatabaseSync) => void, clean = true): DatabaseSync {
  const sql = new DatabaseSync(':memory:')
  const files = readdirSync(DIRECTORY).sort()
  for (const file of files.filter(each => each < '0011')) {
    sql.exec(readFileSync(new URL(file, DIRECTORY), 'utf8'))
  }
  before?.(sql)
  if (clean) {
    for (const file of files.filter(each => each >= '0011')) {
      sql.exec(readFileSync(new URL(file, DIRECTORY), 'utf8'))
    }
  }
  return sql
}

const rows = (sql: DatabaseSync, query: string) =>
  sql
    .prepare(query)
    .all()
    .map(row => ({ ...row }))

/** Production's shape: a team with an owner and members, one member with no account on the row, and the rest */
function production(sql: DatabaseSync) {
  for (const [id, name] of [
    ['a1', 'Ann'],
    ['a2', 'Bob'],
    ['a3', null],
  ]) {
    sql
      .prepare('INSERT INTO accounts (account_id, name, created_at) VALUES (?, ?, ?)')
      .run(id, name, T)
  }
  const identity = sql.prepare(
    'INSERT INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
  identity.run('google', 'g1', 'a1', 'ann@x.com', T, T)
  identity.run('google', 'g2', 'a2', 'bob@x.com', T, T)
  identity.run('email', 'bob@hotmail.com', 'a2', 'bob@hotmail.com', T, T)
  identity.run('google', 'g3', 'a3', 'cat@x.com', T, T)
  const address = sql.prepare(
    'INSERT INTO account_emails (email, account_id, created_at) VALUES (?, ?, ?)'
  )
  address.run('ann@x.com', 'a1', T)
  address.run('bob@x.com', 'a2', T)
  address.run('cat@x.com', 'a3', T)
  sql
    .prepare(
      "INSERT INTO account_drive (account_id, blob, google_email, scope, created_at, updated_at) VALUES ('a1', 'blob-a1', 'ann@x.com', 'drive.file', ?, ?)"
    )
    .run(T, T)
  const session = sql.prepare(
    'INSERT INTO sessions (session_id, account_id, email, token_hash, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  session.run('s-ok', 'a1', 'ann@x.com', 'h1', T, T, '2027-01-01T00:00:00.000Z')
  session.run('s-orphan', 'gone', 'x@x.com', 'h2', T, T, '2027-01-01T00:00:00.000Z')
  sql.exec(`INSERT INTO teams
    (space_id, name, owner_email, created_at, updated_at, root_ref, owner_provider, owner_sub, owner_account_id, credential, ccli_licence)
    VALUES ('t1', 'Pat Church', 'ann@x.com', '${T}', '${T}', 'root-1', 'google', 'g1', 'a1', 'owner', '471102')`)
  sql.exec(`INSERT INTO teams
    (space_id, name, owner_email, created_at, updated_at, ended_at, root_ref, owner_provider, owner_sub, owner_account_id, credential)
    VALUES ('t2', 'Gone Church', 'bob@x.com', '${T}', '${T}', '${T}', '', 'google', 'g2', 'a2', 'service-account')`)
  // (Bob's row has its account; Cat's, made by the first Worker, has none, only the key of her login)
  sql.exec(`INSERT INTO team_members (space_id, identity, email, role, since, account_id) VALUES
    ('t1', 'google:g2', 'bob@x.com', 'writer', '${T}', 'a2'),
    ('t1', 'google:g3', 'cat@x.com', 'reader', '${T}', NULL)`)
  sql.exec(`INSERT INTO team_member_emails (space_id, email, account_id, source) VALUES
    ('t1', 'bob@x.com', 'a2', 'signin'), ('t1', 'bobby@x.com', 'a2', 'invite'), ('t1', 'cat@x.com', 'a3', 'signin')`)
  sql.exec(`INSERT INTO team_invites (space_id, id, email, role, created_by, created_at, expires_at, emailed_at)
    VALUES ('t1', 'inv-1', 'dee@x.com', 'reader', 'ann@x.com', '${T}', '2026-12-01T00:00:00.000Z', NULL)`)
  // (one code and link as the Worker makes them, and one from before 0006, which had neither)
  sql.exec(`INSERT INTO login_codes (address_hash, code_hash, created_at, expires_at, window_start, link_hash, address, code, next)
    VALUES ('ah1', 'ch1', '${T}', '2026-11-04T10:00:00.000Z', '${T}', 'lh1', 'ann@x.com', '123456', '/setlist/s1')`)
  sql.exec(`INSERT INTO login_codes (address_hash, code_hash, created_at, expires_at, window_start)
    VALUES ('ah-old', 'ch-old', '2026-01-01T00:00:00.000Z', '2026-01-01T00:10:00.000Z', '2026-01-01T00:00:00.000Z')`)
  sql.exec("INSERT INTO team_refs (space_id, ref) VALUES ('t1', 'file-1'), ('t1', 'file-2')")
  sql.exec("INSERT INTO team_credentials (space_id, blob) VALUES ('t1', 'owner-blob')")
  sql.exec(`INSERT INTO team_events (space_id, at, kind, by_email, detail) VALUES
    ('t1', '${T}', 'created', 'ann@x.com', NULL), ('t1', '${T}', 'licence', 'ann@x.com', '{"from":null,"to":"471102"}'),
    ('t2', '${T}', 'ended', 'bob@x.com', NULL)`)
}

describe('the clean-up, on rows as they are in production', () => {
  const sql = database(production)

  test('keeps the accounts, their logins, addresses and Drive connection as they were', () => {
    assert.deepEqual(rows(sql, 'SELECT account_id, name FROM accounts ORDER BY account_id'), [
      { account_id: 'a1', name: 'Ann' },
      { account_id: 'a2', name: 'Bob' },
      { account_id: 'a3', name: null },
    ])
    assert.equal(rows(sql, 'SELECT * FROM account_identities').length, 4)
    assert.equal(rows(sql, 'SELECT * FROM account_emails').length, 3)
    assert.deepEqual(rows(sql, 'SELECT account_id, blob FROM account_drive'), [
      { account_id: 'a1', blob: 'blob-a1' },
    ])
  })

  test('drops a session whose account is gone, and keeps the other', () => {
    assert.deepEqual(rows(sql, 'SELECT session_id FROM sessions'), [{ session_id: 's-ok' }])
  })

  test('keeps both teams, turning an unset root into NULL and keeping the owner login', () => {
    assert.deepEqual(
      rows(
        sql,
        'SELECT space_id, owner_account_id, owner_provider, owner_sub, root_ref, credential, ccli_licence, ended_at FROM teams ORDER BY space_id'
      ),
      [
        {
          space_id: 't1',
          owner_account_id: 'a1',
          owner_provider: 'google',
          owner_sub: 'g1',
          root_ref: 'root-1',
          credential: 'owner',
          ccli_licence: '471102',
          ended_at: null,
        },
        {
          space_id: 't2',
          owner_account_id: 'a2',
          owner_provider: 'google',
          owner_sub: 'g2',
          root_ref: null,
          credential: 'service-account',
          ccli_licence: null,
          ended_at: T,
        },
      ]
    )
  })

  test('keys members by account, finding the account of a row that had none from its login', () => {
    assert.deepEqual(
      rows(
        sql,
        'SELECT space_id, account_id, role, invited_as, joined_at FROM team_members ORDER BY account_id'
      ),
      [
        {
          space_id: 't1',
          account_id: 'a2',
          role: 'writer',
          invited_as: 'bobby@x.com',
          joined_at: T,
        },
        { space_id: 't1', account_id: 'a3', role: 'reader', invited_as: null, joined_at: T },
      ]
    )
  })

  test('keeps the invite, the refs, the credential and the log (with the old `at` as `created_at`), in order', () => {
    assert.deepEqual(rows(sql, 'SELECT id, email, role, created_by FROM team_invites'), [
      { id: 'inv-1', email: 'dee@x.com', role: 'reader', created_by: 'ann@x.com' },
    ])
    assert.deepEqual(
      rows(sql, 'SELECT ref FROM team_refs ORDER BY ref').map(row => row.ref),
      ['file-1', 'file-2']
    )
    assert.deepEqual(rows(sql, 'SELECT blob FROM team_credentials'), [{ blob: 'owner-blob' }])
    assert.deepEqual(
      rows(sql, 'SELECT id, space_id, created_at, kind FROM team_events ORDER BY id'),
      [
        { id: 1, space_id: 't1', created_at: T, kind: 'created' },
        { id: 2, space_id: 't1', created_at: T, kind: 'licence' },
        { id: 3, space_id: 't2', created_at: T, kind: 'ended' },
      ]
    )
    sql
      .prepare("INSERT INTO team_events (space_id, created_at, kind) VALUES ('t1', ?, 'licence')")
      .run(T)
    assert.equal(
      rows(sql, 'SELECT max(id) AS id FROM team_events')[0].id,
      4,
      'the next id carries on'
    )
  })

  test('keeps a sign-in code and its link, and drops one from before links that could not be used', () => {
    assert.deepEqual(
      rows(
        sql,
        'SELECT address_hash, link_hash, address, code, next, sent, attempts FROM login_codes'
      ),
      [
        {
          address_hash: 'ah1',
          link_hash: 'lh1',
          address: 'ann@x.com',
          code: '123456',
          next: '/setlist/s1',
          sent: 1,
          attempts: 0,
        },
      ]
    )
  })

  test('has no table of addresses a team noted: they are the account’s', () => {
    assert.deepEqual(
      rows(sql, "SELECT name FROM sqlite_schema WHERE name = 'team_member_emails'"),
      []
    )
  })

  test('leaves nothing that breaks a foreign key', () => {
    assert.deepEqual(rows(sql, 'PRAGMA foreign_key_check'), [])
  })
})

describe('the clean-up refuses, and leaves the old schema whole, rather than guess', () => {
  // (D1 runs a migration as one transaction, and undoes it if a statement fails: tried on a local D1 with a
  // migration that created a table, dropped another, then failed. The test does the same by hand.)
  const refuses = (before: (sql: DatabaseSync) => void, why: RegExp) => {
    const sql = database(before, false)
    sql.exec('BEGIN')
    assert.throws(
      () => sql.exec(readFileSync(new URL('0011_schema_cleanup.sql', DIRECTORY), 'utf8')),
      why
    )
    sql.exec('ROLLBACK')
    const columns = rows(sql, "SELECT name FROM pragma_table_info('team_members')").map(
      row => row.name
    )
    assert.ok(columns.includes('identity'), 'the old tables are all still there')
    assert.deepEqual(
      rows(sql, "SELECT name FROM sqlite_schema WHERE name LIKE '%\\_v2' ESCAPE '\\'"),
      []
    )
  }
  /** What the migration is run over: an owner, and one member the test shapes */
  const withOwner = (sql: DatabaseSync, member: string) => {
    sql.exec(`INSERT INTO accounts (account_id, created_at) VALUES ('a1', '${T}')`)
    sql.exec(`INSERT INTO teams
      (space_id, name, owner_email, created_at, updated_at, root_ref, owner_provider, owner_sub, owner_account_id)
      VALUES ('t1', 'T', 'a@x.com', '${T}', '${T}', 'r', 'google', 'g1', 'a1')`)
    sql.exec(member)
  }

  test('for a member whose login has no account', () => {
    refuses(
      sql =>
        withOwner(
          sql,
          `INSERT INTO team_members (space_id, identity, email, role, since) VALUES ('t1', 'google:nobody', 'n@x.com', 'reader', '${T}')`
        ),
      /NOT NULL/
    )
  })

  test('for a team whose owner login is empty', () => {
    refuses(sql => {
      sql.exec(`INSERT INTO accounts (account_id, created_at) VALUES ('a1', '${T}')`)
      sql.exec(`INSERT INTO teams (space_id, name, owner_email, created_at, updated_at, owner_account_id)
          VALUES ('t1', 'T', 'a@x.com', '${T}', '${T}', 'a1')`)
    }, /CHECK/)
  })

  test('for a live team with no owner account', () => {
    refuses(
      sql =>
        sql.exec(`INSERT INTO teams (space_id, name, owner_email, created_at, updated_at, owner_provider, owner_sub)
          VALUES ('t1', 'T', 'a@x.com', '${T}', '${T}', 'google', 'g1')`),
      /CHECK/
    )
  })

  test('for two logins of one account that are both members of one team', () => {
    refuses(sql => {
      withOwner(sql, "INSERT INTO accounts (account_id, created_at) VALUES ('a2', '" + T + "')")
      sql.exec(`INSERT INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at) VALUES
          ('google', 'g2', 'a2', 'b@x.com', '${T}', '${T}'), ('email', 'b@x.com', 'a2', 'b@x.com', '${T}', '${T}')`)
      sql.exec(`INSERT INTO team_members (space_id, identity, email, role, since, account_id) VALUES
          ('t1', 'google:g2', 'b@x.com', 'reader', '${T}', 'a2'), ('t1', 'email:b@x.com', 'b@x.com', 'writer', '${T}', 'a2')`)
    }, /UNIQUE|PRIMARY/)
  })
})

describe('the schema it leaves', () => {
  const sql = database(production)

  test('has every table STRICT', () => {
    const lax = rows(
      sql,
      "SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND strict = 0"
    )
      .map(row => String(row.name))
      .filter(name => !name.startsWith('sqlite_') && name !== 'd1_migrations')
    assert.deepEqual(lax, [])
  })

  test('has a foreign key on every column that names an account or a space (but the log’s address)', () => {
    const tables = rows(
      sql,
      "SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table'"
    )
      .map(row => String(row.name))
      .filter(name => !name.startsWith('sqlite_') && name !== 'd1_migrations')
    const unkeyed: string[] = []
    for (const table of tables) {
      const keyed = new Set(
        rows(sql, `PRAGMA foreign_key_list(${table})`).map(row => String(row.from))
      )
      for (const column of rows(sql, `PRAGMA table_info(${table})`).map(row => String(row.name))) {
        // (a team is never deleted, and `teams.space_id` is its own key)
        if (
          (column === 'account_id' || column === 'space_id' || column === 'owner_account_id') &&
          !keyed.has(column) &&
          !(table === 'teams' && column === 'space_id')
        ) {
          unkeyed.push(`${table}.${column}`)
        }
      }
    }
    // (the primary key of `accounts` and of the keyed-by-itself one-to-ones is its own key: they name no other table)
    assert.deepEqual(
      unkeyed.filter(each => each !== 'accounts.account_id'),
      []
    )
  })

  test('refuses a sign-in code with no link, an address in capitals, or two with one link', () => {
    const insert = (hash: string, link: string | null, address: string) => () =>
      sql.exec(`INSERT INTO login_codes (address_hash, code_hash, created_at, expires_at, window_start, link_hash, address, code)
        VALUES ('${hash}', 'c', '${T}', '${T}', '${T}', ${link ? `'${link}'` : 'NULL'}, '${address}', '1')`)
    assert.throws(insert('x1', null, 'a@x.com'), /NOT NULL/)
    assert.throws(insert('x2', 'l2', 'A@X.com'), /CHECK/)
    insert('x3', 'l3', 'a@x.com')()
    assert.throws(insert('x4', 'l3', 'b@x.com'), /UNIQUE/)
  })

  test('refuses what the code never writes: a member of no account, a role that does not exist, a credential that is not one', () => {
    const run = (query: string) => () => sql.exec(query)
    assert.throws(
      run(
        `INSERT INTO team_members (space_id, account_id, role, joined_at) VALUES ('t1', 'nobody', 'reader', '${T}')`
      ),
      /FOREIGN KEY/
    )
    assert.throws(
      run(
        `INSERT INTO team_members (space_id, account_id, role, joined_at) VALUES ('t1', 'a1', 'owner', '${T}')`
      ),
      /CHECK/
    )
    assert.throws(run("UPDATE teams SET credential = 'other' WHERE space_id = 't1'"), /CHECK/)
    assert.throws(
      run(
        "INSERT INTO account_emails (email, account_id, created_at) VALUES ('Mixed@Case.com', 'a1', '" +
          T +
          "')"
      ),
      /CHECK/
    )
  })

  test('deletes a member with their account, and a team’s rows with its team', () => {
    sql.exec("DELETE FROM accounts WHERE account_id = 'a3'")
    assert.deepEqual(rows(sql, "SELECT account_id FROM team_members WHERE account_id = 'a3'"), [])
    sql.exec("DELETE FROM teams WHERE space_id = 't2'")
    assert.deepEqual(rows(sql, "SELECT id FROM team_events WHERE space_id = 't2'"), [])
  })
})
