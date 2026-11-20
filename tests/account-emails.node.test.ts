/**
 * An address belongs to one account (migrations/0009_account_emails.sql): the table's primary key says so, and
 * `accountOf` (the one place an account is found or made for a login) joins a login to the account that has its address.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { accountInfo } from '../worker/src/account.ts'
import { accountOfMailbox } from '../worker/src/email-login.ts'
import type { Env } from '../worker/src/env.ts'
import { accountOf, claimAddress, ownerOfAddress } from '../worker/src/team-state.ts'
import { d1Db } from './d1-db.ts'

const NOW = new Date('2026-11-19T12:00:00.000Z')

function world() {
  const { db, sql } = d1Db()
  return { db, sql, env: { DB: db } as unknown as Env }
}

describe('an address belongs to one account', () => {
  test('the database refuses a second owner', () => {
    const { sql } = world()
    for (const account of ['a', 'b']) {
      sql
        .prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)')
        .run(account, NOW.toISOString())
    }
    const add = (account: string) =>
      sql
        .prepare('INSERT INTO account_emails (email, account_id, created_at) VALUES (?, ?, ?)')
        .run('ann@example.com', account, NOW.toISOString())
    add('a')
    assert.throws(() => add('b'), /UNIQUE|PRIMARY/)
  })

  test('a Google login and an emailed code on one address are one account, whichever came first', async () => {
    const { db } = world()
    const google = (await accountOf(
      db,
      { provider: 'google', sub: 'g1', email: 'Ann@Example.com' },
      true,
      NOW
    )) as string
    assert.equal(await accountOfMailbox(db, 'ann@example.com', NOW), google)
    const w2 = world()
    const mailbox = await accountOfMailbox(w2.db, 'bob@example.com', NOW)
    const bob = await accountOf(
      w2.db,
      { provider: 'google', sub: 'g2', email: 'bob@example.com' },
      true,
      NOW
    )
    assert.equal(bob, mailbox)
    assert.equal(await ownerOfAddress(w2.db, 'BOB@example.com'), mailbox)
  })

  test('a Google login whose address is not verified makes its own account and claims nothing', async () => {
    const { db } = world()
    const owner = await accountOfMailbox(db, 'ann@example.com', NOW)
    const stranger = (await accountOf(
      db,
      { provider: 'google', sub: 'g9', email: 'ann@example.com' },
      true,
      NOW,
      false
    )) as string
    assert.notEqual(stranger, owner)
    assert.equal(await ownerOfAddress(db, 'ann@example.com'), owner)
  })

  test('a claim for an address another account has is refused, and says who has it', async () => {
    const { db } = world()
    const ann = await accountOfMailbox(db, 'ann@example.com', NOW)
    const bob = await accountOfMailbox(db, 'bob@example.com', NOW)
    assert.equal(await claimAddress(db, bob, 'ann@example.com', NOW), ann)
    assert.equal(await claimAddress(db, ann, 'ann2@example.com', NOW), ann)
    assert.equal(await ownerOfAddress(db, 'ann2@example.com'), ann)
  })

  test('a Google login that changes address adds the new one, or keeps the old if it is taken', async () => {
    const { db, env } = world()
    const ann = (await accountOf(
      db,
      { provider: 'google', sub: 'g1', email: 'ann@old.example' },
      true,
      NOW
    )) as string
    const bob = await accountOfMailbox(db, 'bob@example.com', NOW)
    await accountOf(db, { provider: 'google', sub: 'g1', email: 'ann@new.example' }, true, NOW)
    assert.equal(await ownerOfAddress(db, 'ann@new.example'), ann)
    await accountOf(db, { provider: 'google', sub: 'g1', email: 'bob@example.com' }, true, NOW)
    assert.equal(await ownerOfAddress(db, 'bob@example.com'), bob)
    const info = await accountInfo(env, ann)
    assert.deepEqual(info.emails.map(each => each.email).sort(), [
      'ann@new.example',
      'ann@old.example',
      'bob@example.com',
    ])
  })

  test('the account lists each address once, the Google one marked', async () => {
    const { db, env } = world()
    const ann = (await accountOf(
      db,
      { provider: 'google', sub: 'g1', email: 'ann@example.com' },
      true,
      NOW
    )) as string
    await accountOfMailbox(db, 'ann@example.com', NOW)
    assert.deepEqual((await accountInfo(env, ann)).emails, [
      { email: 'ann@example.com', provider: 'google' },
    ])
  })
})

test('two first sign-ins at once on one address leave one account, and the loser leaves no orphan', async () => {
  const { db, sql } = world()
  // (another login claims the address between this one finding it free and making its account)
  const racing = {
    prepare: db.prepare.bind(db),
    batch: async (statements: Parameters<typeof db.batch>[0]) => {
      sql
        .prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)')
        .run('rival', NOW.toISOString())
      sql
        .prepare('INSERT INTO account_emails (email, account_id, created_at) VALUES (?, ?, ?)')
        .run('ann@example.com', 'rival', NOW.toISOString())
      return db.batch(statements)
    },
  } as unknown as typeof db
  const account = await accountOf(
    racing,
    { provider: 'google', sub: 'g1', email: 'ann@example.com' },
    true,
    NOW
  )
  assert.equal(account, 'rival')
  assert.deepEqual(
    sql
      .prepare('SELECT account_id FROM account_identities WHERE sub = ?')
      .all('g1')
      .map(row => ({ ...row })),
    [{ account_id: 'rival' }]
  )
  assert.equal((sql.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n, 1)
})

describe('the migration', () => {
  test('claims each address for the oldest login that has it', () => {
    const { sql } = world()
    // (the table is made empty by the migrations; this is the backfill's statement run over rows as they were)
    const at = (n: number) => `2026-11-0${n}T00:00:00.000Z`
    for (const account of ['first', 'second']) {
      sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(account, at(1))
    }
    const insert = sql.prepare(
      'INSERT INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run('google', 'old', 'first', 'ann@example.com', at(1), at(1))
    insert.run('email', 'ann@example.com', 'second', 'ann@example.com', at(2), at(2))
    sql.exec(`INSERT OR IGNORE INTO account_emails (email, account_id, created_at)
      SELECT email, account_id, created_at FROM account_identities WHERE email <> '' ORDER BY created_at, provider, sub`)
    assert.deepEqual(
      sql
        .prepare('SELECT account_id FROM account_emails')
        .all()
        .map(row => ({ ...row })),
      [{ account_id: 'first' }]
    )
  })
})
