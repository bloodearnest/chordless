/**
 * What a team space is (worker/src/team-state.ts, in D1): the owner, the members and
 * their roles, the files in the space's tree and the owner's blob, over a Map standing in for the
 * object's storage.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'
import type { Identity } from '../worker/src/identity.ts'
import { accountOf, INVITE_TTL_MS, spacesOf, TeamSpaceState } from '../worker/src/team-state.ts'
import { d1Db } from './d1-db.ts'

const ann: Identity = { provider: 'google', sub: 'g-1', email: 'Ann@Example.com' }
const bob: Identity = { provider: 'google', sub: 'g-2', email: 'bob@example.com' }
const cat: Identity = { provider: 'google', sub: 'g-3', email: 'cat@example.com' }
const NOW = new Date('2026-10-21T12:00:00Z')

const SPACE = 'space-aaaaaaaa'

/** A space made at NOW, over a database of its own; `at` gives a state for the same space at another time */
async function made() {
  const { db, sql } = d1Db()
  const state = new TeamSpaceState(db, SPACE, { now: () => NOW })
  await state.create({ rootRef: 'root-1', name: 'Pat Church', owner: ann })
  const at = (when: Date) => new TeamSpaceState(db, SPACE, { now: () => when })
  const rows = (query: string) =>
    sql
      .prepare(query)
      .all()
      .map(row => ({ ...row }))
  return { db, sql, state, at, rows }
}

describe('making a space', () => {
  test('records the root, the name and the owner, with the owner email in lower case', async () => {
    const { state } = await made()
    assert.deepEqual(await state.info(), {
      rootRef: 'root-1',
      name: 'Pat Church',
      owner: { provider: 'google', sub: 'g-1', email: 'ann@example.com' },
      createdAt: NOW.toISOString(),
    })
  })

  test('is dated by the clock when none is given', async () => {
    const state = new TeamSpaceState(d1Db().db, SPACE)
    await state.create({ rootRef: 'root-1', name: 'Pat Church', owner: ann })
    const age = Date.now() - new Date((await state.info())?.createdAt ?? 0).getTime()
    assert.ok(age >= 0 && age < 60_000)
  })

  test('is done once: a second make changes nothing and says so', async () => {
    const { state } = await made()
    assert.equal(await state.create({ rootRef: 'other', name: 'Other', owner: bob }), false)
    assert.equal((await state.info())?.rootRef, 'root-1')
    assert.equal(await state.roleOf(bob), null)
  })

  test('a space that was never made has no info, no roles and no members', async () => {
    const state = new TeamSpaceState(d1Db().db, SPACE)
    assert.equal(await state.info(), null)
    assert.equal(await state.roleOf(ann), null)
    assert.deepEqual(await state.members(), [])
    await assert.rejects(state.setMember(bob, 'writer'), /No such space/)
  })
})

describe('roles', () => {
  test('the owner is the owner, a member has their role, anyone else has none', async () => {
    const { state } = await made()
    await state.setMember(bob, 'writer')
    assert.equal(await state.roleOf(ann), 'owner')
    assert.equal(await state.roleOf(bob), 'writer')
    assert.equal(await state.roleOf(cat), null)
  })

  test('are by account, not email: the same sub from another provider is a stranger', async () => {
    const { state } = await made()
    await state.setMember(bob, 'admin')
    assert.equal(await state.roleOf({ ...bob, provider: 'elsewhere' }), null)
    assert.equal(await state.roleOf({ provider: bob.provider, sub: bob.sub }), 'admin')
  })

  test('change when a member is set again, and keep when they joined', async () => {
    const { state, at, rows } = await made()
    await state.setMember(bob, 'reader')
    await at(new Date('2027-01-01T00:00:00Z')).setMember(bob, 'admin')
    assert.equal(await state.roleOf(bob), 'admin')
    assert.equal(rows('SELECT since FROM team_members')[0].since, NOW.toISOString())
  })

  test('are gone when a member is removed, and removing a stranger is fine', async () => {
    const { state } = await made()
    await state.setMember(bob, 'writer')
    await state.removeMember(bob)
    await state.removeMember(cat)
    assert.equal(await state.roleOf(bob), null)
  })

  test('the owner cannot be made a member, and cannot be removed by removing a member', async () => {
    const { state } = await made()
    await assert.rejects(state.setMember(ann, 'reader'), /owner is not a member/)
    await state.removeMember(ann)
    assert.equal(await state.roleOf(ann), 'owner')
  })
})

describe('members', () => {
  test('lists the owner first, then the others by email, ', async () => {
    const { state } = await made()
    await state.setMember(cat, 'reader')
    await state.setMember(bob, 'writer')
    assert.deepEqual(await state.members(), [
      { email: 'ann@example.com', emails: ['ann@example.com'], role: 'owner' },
      { email: 'bob@example.com', emails: ['bob@example.com'], role: 'writer' },
      { email: 'cat@example.com', emails: ['cat@example.com'], role: 'reader' },
    ])
  })
})

describe('accounts', () => {
  /** The keys of the logins whose sockets were closed, in order */
  const dropping = () => {
    const dropped: (string | undefined)[] = []
    const sockets = {
      fetch: () => new Response(null, { status: 204 }),
      async dropSockets(identity?: string) {
        dropped.push(identity)
      },
    }
    return { dropped, sockets }
  }

  /** A second login (another provider) for an account: what a later sign-in method will add */
  const addLogin = (
    sql: DatabaseSync,
    account: string,
    provider: string,
    sub: string,
    email: string
  ) =>
    sql
      .prepare(
        `INSERT INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, 't', 't')`
      )
      .run(provider, sub, account, email)

  const accountOfLogin = (sql: DatabaseSync, identity: Identity) =>
    (
      sql
        .prepare('SELECT account_id FROM account_identities WHERE provider = ? AND sub = ?')
        .get(identity.provider, identity.sub) as { account_id: string } | undefined
    )?.account_id

  test('are made when a team operation first sees a login, never by a request that only asks', async () => {
    const { state, sql, db } = await made()
    const count = () => (sql.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n
    assert.equal(count(), 1, 'the owner’s, made with the space')
    assert.equal(await state.roleOf(cat), null)
    assert.deepEqual(await spacesOf(db, cat), [])
    assert.equal(count(), 1, 'asking about a stranger makes nothing')
    await state.setMember(bob, 'writer')
    assert.equal(count(), 2)
    await state.setMember(bob, 'reader')
    assert.equal(count(), 2, 'the same login is the same account')
  })

  test('record the owner’s, and the owner on another login is still the owner', async () => {
    const { state, sql } = await made()
    const owner = accountOfLogin(sql, ann)
    assert.ok(owner)
    assert.equal(
      (sql.prepare('SELECT owner_account_id AS id FROM teams').get() as { id: string }).id,
      owner
    )
    addLogin(sql, owner, 'microsoft', 'm-1', 'ann@work.example')
    assert.equal(await state.roleOf({ provider: 'microsoft', sub: 'm-1' }), 'owner')
    await assert.rejects(
      state.setMember({ provider: 'microsoft', sub: 'm-1', email: 'ann@work.example' }, 'admin'),
      /owner is not a member/
    )
  })

  test('give a member the same role on every login of their account, and find the team for each', async () => {
    const { state, sql, db } = await made()
    await state.setMember(bob, 'writer')
    addLogin(sql, accountOfLogin(sql, bob) as string, 'microsoft', 'm-2', 'bob@hotmail.example')
    const other = { provider: 'microsoft', sub: 'm-2' }
    assert.equal(await state.roleOf(other), 'writer')
    assert.deepEqual(
      (await spacesOf(db, other)).map(space => [space.spaceId, space.role]),
      [[SPACE, 'writer']]
    )
    // (joining again with the other login is the same member, not a second one)
    await state.setMember({ ...other, email: 'bob@hotmail.example' }, 'admin')
    assert.deepEqual(
      (await state.members()).map(member => [member.email, member.role]),
      [
        ['ann@example.com', 'owner'],
        ['bob@hotmail.example', 'admin'],
      ]
    )
  })

  test('list every address the team knows a member by, and any of them names the member', async () => {
    const { state, sql, rows } = await made()
    await state.setMember(bob, 'writer')
    sql
      .prepare(
        `INSERT INTO team_member_emails (space_id, email, account_id, source) VALUES (?, 'bob@hotmail.example', ?, 'invite')`
      )
      .run(SPACE, accountOfLogin(sql, bob) as string)
    assert.deepEqual((await state.members())[1], {
      email: 'bob@example.com',
      emails: ['bob@example.com', 'bob@hotmail.example'],
      role: 'writer',
    })
    assert.equal(await state.setRoleByEmail('Bob@Hotmail.example', 'reader'), true)
    assert.equal(await state.roleOf(bob), 'reader')
    assert.equal(await state.removeByEmail('bob@hotmail.example'), true)
    assert.equal(await state.roleOf(bob), null)
    assert.deepEqual(
      rows('SELECT email FROM team_member_emails'),
      [],
      'every address goes with them'
    )
    assert.equal(await state.removeByEmail('bob@hotmail.example'), false)
  })

  test('close the live sockets of every login of a member that changes or goes', async () => {
    const { db, sql } = await made()
    const { dropped, sockets } = dropping()
    const state = new TeamSpaceState(db, SPACE, { now: () => NOW, sockets })
    await state.setMember(bob, 'writer')
    addLogin(sql, accountOfLogin(sql, bob) as string, 'microsoft', 'm-2', 'bob@hotmail.example')
    dropped.length = 0
    // (a device signed in with a session is a socket under the account's own key, as well as the logins')
    const own = `chordless:${accountOfLogin(sql, bob)}`
    await state.setRoleByEmail('bob@example.com', 'reader')
    assert.deepEqual([...dropped].sort(), [own, 'google:g-2', 'microsoft:m-2'])
    dropped.length = 0
    await state.removeMember(bob)
    assert.deepEqual([...dropped].sort(), [own, 'google:g-2', 'microsoft:m-2'])
    assert.equal(await state.roleOf({ provider: 'microsoft', sub: 'm-2' }), null)
  })

  test('lose no account to a race: the login another request made first is the one used, and the loser leaves nothing', async () => {
    const { db, sql } = await made()
    const before = () =>
      (sql.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n
    const base = before()
    const batch = db.batch.bind(db)
    // (another request makes the same login's account between this one looking and writing)
    db.batch = async statements => {
      sql.exec("INSERT INTO accounts (account_id, created_at) VALUES ('first', 't')")
      sql.exec(
        "INSERT INTO account_identities (provider, sub, account_id, email, created_at, last_seen_at) VALUES ('google', 'g-5', 'first', 'eve@example.com', 't', 't')"
      )
      return batch(statements)
    }
    const eve = { provider: 'google', sub: 'g-5', email: 'eve@example.com' }
    assert.equal(await accountOf(db, eve, true), 'first')
    assert.equal(before(), base + 1, 'the account that lost is not left behind')
  })

  test('still work for a space made before accounts, whose owner has none recorded', async () => {
    const { state, sql } = await made()
    sql.exec('UPDATE teams SET owner_account_id = NULL')
    assert.equal(await state.roleOf(ann), 'owner')
    await assert.rejects(state.setMember(ann, 'admin'), /owner is not a member/)
    await state.setMember(bob, 'writer')
    assert.equal(await state.roleOf(bob), 'writer')
  })

  test('are not part of a space once sharing ends: its members and their addresses go, the accounts stay', async () => {
    const { state, rows } = await made()
    await state.setMember(bob, 'writer')
    await state.destroy(ann)
    assert.deepEqual(rows('SELECT * FROM team_members'), [])
    assert.deepEqual(rows('SELECT * FROM team_member_emails'), [])
    assert.equal(rows('SELECT * FROM accounts').length, 2)
  })

  test('still find a member the previous Worker made, with no account yet, by the key of their login', async () => {
    const { state, sql } = await made()
    sql
      .prepare(
        `INSERT INTO team_members (space_id, identity, email, role, since) VALUES (?, 'google:g-9', 'dee@example.com', 'reader', 't')`
      )
      .run(SPACE)
    const dee = { provider: 'google', sub: 'g-9', email: 'dee@example.com' }
    assert.equal(await state.roleOf(dee), 'reader')
    assert.equal((await state.members())[1].email, 'dee@example.com')
    assert.equal(await state.setRoleByEmail('dee@example.com', 'writer'), true)
    assert.equal(await state.roleOf(dee), 'writer')
    // (one more with no account, who leaves: nothing but their row to forget)
    sql
      .prepare(
        `INSERT INTO team_members (space_id, identity, email, role, since) VALUES (?, 'google:g-8', 'eve@example.com', 'reader', 't')`
      )
      .run(SPACE)
    assert.equal(await state.removeByEmail('eve@example.com'), true)
    assert.equal(await state.roleOf({ provider: 'google', sub: 'g-8' }), null)
    // (the next time they join, they get the account)
    await state.setMember(dee, 'writer')
    assert.ok(accountOfLogin(sql, dee))
    assert.equal(
      (
        sql
          .prepare('SELECT account_id AS id FROM team_members WHERE identity = ?')
          .get('google:g-9') as { id: string }
      ).id,
      accountOfLogin(sql, dee)
    )
  })
})

describe('the migration that made accounts (0003)', () => {
  test('gives each member and each owner an account, once between teams, and keeps the old columns right', () => {
    const directory = new URL('../migrations/', import.meta.url)
    const sql = new DatabaseSync(':memory:')
    for (const file of ['0001_team_register.sql', '0002_team_state.sql']) {
      sql.exec(readFileSync(new URL(file, directory), 'utf8'))
    }
    sql.exec(`INSERT INTO teams (space_id, name, owner_email, created_at, updated_at, root_ref, owner_provider, owner_sub)
      VALUES ('s1', 'A', 'ann@x.com', 't', 't', 'r', 'google', 'g-1'), ('s2', 'B', 'bob@x.com', 't', 't', 'r', 'google', 'g-2')`)
    sql.exec(`INSERT INTO team_members (space_id, identity, email, role, since)
      VALUES ('s1', 'google:g-2', 'bob@x.com', 'writer', 't'), ('s1', 'google:g-3', 'cat@x.com', 'reader', 't'),
             ('s2', 'google:g-1', 'ann@x.com', 'admin', 't')`)
    sql.exec(readFileSync(new URL('0003_accounts.sql', directory), 'utf8'))

    const one = (query: string) => sql.prepare(query).get() as Record<string, unknown>
    assert.equal(
      one('SELECT COUNT(*) AS n FROM accounts').n,
      3,
      'Ann owns one and is a member of the other: one account'
    )
    assert.equal(one('SELECT COUNT(*) AS n FROM account_identities').n, 3)
    assert.equal(one('SELECT COUNT(*) AS n FROM team_members WHERE account_id IS NULL').n, 0)
    assert.equal(one('SELECT COUNT(*) AS n FROM teams WHERE owner_account_id IS NULL').n, 0)
    assert.equal(
      one(`SELECT COUNT(*) AS n FROM team_members m JOIN teams t ON t.owner_account_id = m.account_id
             WHERE m.identity = 'google:g-1' AND t.space_id = 's1'`).n,
      1,
      'the same account is the owner of one and a member of the other'
    )
    assert.deepEqual(
      sql
        .prepare('SELECT space_id, email, source FROM team_member_emails ORDER BY space_id, email')
        .all()
        .map(row => ({ ...row })),
      [
        { space_id: 's1', email: 'bob@x.com', source: 'signin' },
        { space_id: 's1', email: 'cat@x.com', source: 'signin' },
        { space_id: 's2', email: 'ann@x.com', source: 'signin' },
      ]
    )
    assert.equal(
      one("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '_account_backfill'").n,
      0,
      'the scratch table is gone'
    )
    assert.equal(
      one("SELECT identity FROM team_members WHERE email = 'bob@x.com'").identity,
      'google:g-2',
      'the old columns stay'
    )
  })
})

describe('the files in the space', () => {
  test('are the ones noted, and nothing else', async () => {
    const { state } = await made()
    await state.addRefs(['file-1', 'file-2'])
    assert.equal(await state.owns('file-1'), true)
    assert.equal(await state.owns('file-2'), true)
    assert.equal(await state.owns('file-3'), false)
  })

  test('are picked out of a list of refs, in order, for what a feed says is gone', async () => {
    const { state } = await made()
    await state.addRefs(['file-1', 'file-2'])
    assert.deepEqual(await state.ownedAmong(['file-9', 'file-2', 'file-1']), ['file-2', 'file-1'])
    assert.deepEqual(await state.ownedAmong([]), [])
  })

  test('can be a great many: noted and picked out in pieces D1 takes', async () => {
    const { state } = await made()
    const refs = Array.from({ length: 1300 }, (_, i) => `file-${i}`)
    await state.addRefs(refs)
    assert.equal(await state.owns('file-1299'), true)
    assert.deepEqual(await state.ownedAmong([...refs, 'file-x']), refs)
    await state.addRefs([])
  })

  test('are written once: a repeat of the same refs adds none, and a new one only itself', async () => {
    const { state, rows } = await made()
    await state.addRefs(['file-1', 'file-2', 'file-2'])
    await state.addRefs(['file-1', 'file-2'])
    await state.addRefs(['file-1', 'file-3'])
    assert.deepEqual(
      rows('SELECT ref FROM team_refs ORDER BY ref').map(row => row.ref),
      ['file-1', 'file-2', 'file-3']
    )
  })
})

describe('the owner blob', () => {
  test('is kept as it was given, and can be cleared', async () => {
    const { state } = await made()
    assert.equal(await state.ownerBlob(), null)
    await state.setOwnerBlob('eyJ.encrypted.blob')
    assert.equal(await state.ownerBlob(), 'eyJ.encrypted.blob')
    await state.clearOwnerBlob()
    assert.equal(await state.ownerBlob(), null)
  })
})

test('keeps nothing but the space, its members, its refs, the blob, which credential it uses, and what happened', async () => {
  const { state, sql } = await made()
  await state.setMember(bob, 'writer')
  await state.addRefs(['file-1'])
  await state.setOwnerBlob('blob')
  const tables = (
    sql.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  )
    .map(row => row.name)
    .filter(name => name !== 'sqlite_sequence')
    .filter(name => (sql.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n > 0)
  assert.deepEqual(tables.sort(), [
    'account_emails',
    'account_identities',
    'accounts',
    'team_credentials',
    'team_events',
    'team_member_emails',
    'team_members',
    'team_refs',
    'teams',
  ])
  // (the credential is one word: which sign-in the Worker uses, never a key or a token)
  assert.equal(await state.credential(), 'owner')
})

describe('the credential', () => {
  test('is the owner’s for a space that is not there', async () => {
    assert.equal(await new TeamSpaceState(d1Db().db, 'nope').credential(), 'owner')
  })

  test('is the owner’s until switched; the switch forgets their sign-in, and a new one switches back', async () => {
    const { state } = await made()
    assert.equal(await state.credential(), 'owner')
    await state.setOwnerBlob('blob')
    await state.useServiceAccount()
    assert.equal(await state.credential(), 'service-account')
    assert.equal(await state.ownerBlob(), null)
    await state.setOwnerBlob('new blob')
    assert.equal(await state.credential(), 'owner')
    assert.equal(await state.ownerBlob(), 'new blob')
  })
})

describe('the CCLI licence number', () => {
  test('is none until set; setting, changing and clearing it are each logged, in order, with who and when', async () => {
    const { state } = await made()
    assert.deepEqual(await state.licence(), { ccliLicence: null, history: [] })
    assert.equal(await state.setLicence('471102', ann), true)
    assert.equal(await state.setLicence('471103', bob), true)
    assert.equal(await state.setLicence(null, ann), true)
    const { ccliLicence, history } = await state.licence()
    assert.equal(ccliLicence, null)
    const at = NOW.toISOString()
    assert.deepEqual(history, [
      { at, by: 'ann@example.com', from: null, to: '471102' },
      { at, by: 'bob@example.com', from: '471102', to: '471103' },
      { at, by: 'ann@example.com', from: '471103', to: null },
    ])
  })

  test('says no, and logs nothing, where it is already that', async () => {
    const { state } = await made()
    assert.equal(await state.setLicence(null, ann), false)
    await state.setLicence('471102', ann)
    assert.equal(await state.setLicence('471102', bob), false)
    assert.equal((await state.licence()).history.length, 1)
  })

  test('cannot be set for a space that was never made, and goes with the space', async () => {
    const state = new TeamSpaceState(d1Db().db, SPACE)
    await assert.rejects(state.setLicence('1', ann), /No such space/)
    const { state: made1 } = await made()
    await made1.setLicence('471102', ann)
    await made1.destroy(ann)
    assert.deepEqual(await made1.licence(), { ccliLicence: null, history: [] })
  })
})

describe('members, by email', () => {
  test('change role, and are removed, by email in any case; a stranger is false', async () => {
    const { state } = await made()
    await state.setMember(bob, 'reader')
    assert.equal(await state.setRoleByEmail('BOB@example.com', 'writer'), true)
    assert.equal(await state.roleOf(bob), 'writer')
    assert.equal(await state.setRoleByEmail('nobody@example.com', 'writer'), false)
    assert.equal(await state.removeByEmail('Bob@Example.com'), true)
    assert.equal(await state.roleOf(bob), null)
    assert.equal(await state.removeByEmail('bob@example.com'), false)
  })
})

describe('invites', () => {
  test('are redeemed once, for the role they were made with, and the code is not kept', async () => {
    const { state, rows } = await made()
    const { code } = await state.createInvite('writer', 'bob@example.com', ann)
    assert.ok(
      !JSON.stringify(rows('SELECT * FROM team_invites')).includes(code),
      'only a hash is stored'
    )

    assert.equal(await state.redeemInvite(code, bob), 'writer')
    assert.equal(await state.roleOf(bob), 'writer')
    assert.equal(await state.redeemInvite(code, cat), null, 'used up')
    assert.equal(await state.roleOf(cat), null)
  })

  test('are for whoever has the code, unless they are for an admin: the address is kept as theirs, and the join is noted', async () => {
    const { state, rows } = await made()
    const { code } = await state.createInvite('writer', 'bob@example.com', ann)

    assert.equal(await state.redeemInvite(code, cat), 'writer')
    assert.equal(await state.roleOf(cat), 'writer')
    assert.deepEqual((await state.members())[1], {
      email: 'cat@example.com',
      emails: ['cat@example.com', 'bob@example.com'],
      role: 'writer',
    })
    assert.deepEqual(rows('SELECT email, source FROM team_member_emails ORDER BY email'), [
      { email: 'bob@example.com', source: 'invite' },
      { email: 'cat@example.com', source: 'signin' },
    ])
    assert.deepEqual(
      rows("SELECT by_email, detail FROM team_events WHERE kind = 'joined_as_other'"),
      [{ by_email: 'cat@example.com', detail: JSON.stringify({ invitedAs: 'bob@example.com' }) }]
    )
    assert.equal(await state.redeemInvite(code, bob), null, 'used up')
  })

  test('are for the invited email only when they are for an admin: another account is turned away, and the code stays good', async () => {
    const { state } = await made()
    const { code } = await state.createInvite('admin', 'bob@example.com', ann)

    assert.equal(await state.redeemInvite(code, cat), 'other-account')
    assert.equal(await state.roleOf(cat), null)
    assert.equal(await state.redeemInvite(code, bob), 'admin', 'the invited person still can')
  })

  test('never take an address from another member: a label for one they already have is not kept', async () => {
    const { state, rows } = await made()
    await state.setMember(bob, 'admin')
    const { code } = await state.createInvite('reader', 'bob@example.com', ann)
    assert.equal(await state.redeemInvite(code, cat), 'reader')
    assert.deepEqual(rows("SELECT email FROM team_member_emails WHERE source = 'invite'"), [])
    assert.equal(
      (await state.members()).find(member => member.email === 'bob@example.com')?.role,
      'admin',
      'bob is still only himself'
    )
  })

  test('say what they are for without using them up, and nothing for one that is not good', async () => {
    const { state, at } = await made()
    const { code } = await state.createInvite('reader', 'bob@example.com', ann)
    assert.deepEqual(await state.inviteInfo(code), {
      teamName: 'Pat Church',
      role: 'reader',
      email: 'bob@example.com',
    })
    assert.deepEqual(
      await state.inviteInfo(code),
      await state.inviteInfo(code),
      'asking uses nothing'
    )
    assert.equal(await state.inviteInfo('made-up'), null)
    assert.equal(await at(new Date(NOW.getTime() + INVITE_TTL_MS + 1)).inviteInfo(code), null)
    await state.destroy(ann)
    assert.equal(await state.inviteInfo(code), null, 'the team ended')
  })

  test('are matched on the email whatever its case, and however it was typed', async () => {
    const { state } = await made()
    const { code } = await state.createInvite('reader', '  BOB@Example.COM ', ann)
    assert.equal(await state.redeemInvite(code, { ...bob, email: 'Bob@example.com' }), 'reader')
  })

  test('are not good when unknown or expired', async () => {
    const { state, at } = await made()
    assert.equal(await state.redeemInvite('made-up', bob), null)
    const { code, expiresAt } = await state.createInvite('reader', 'bob@example.com', ann)
    assert.equal(
      new Date(expiresAt).getTime() - NOW.getTime(),
      INVITE_TTL_MS,
      'a week from the clock'
    )
    const later = at(new Date(NOW.getTime() + INVITE_TTL_MS + 1))
    assert.equal(await later.redeemInvite(code, bob), null)
    assert.deepEqual(await later.invites(), [], 'an expired one is not listed')
  })

  test('that have run out are deleted when the next is made, and the others stay', async () => {
    const { state, at, rows } = await made()
    await state.createInvite('reader', 'old@example.com', ann)
    const week = new Date(NOW.getTime() + INVITE_TTL_MS + 1000)
    const fresh = at(week)
    await fresh.createInvite('reader', 'new@example.com', ann)
    assert.deepEqual(
      rows('SELECT email FROM team_invites ORDER BY email').map(row => row.email),
      ['new@example.com']
    )
    await at(new Date(week.getTime() + 1000)).createInvite('reader', 'next@example.com', ann)
    assert.equal(rows('SELECT email FROM team_invites').length, 2, 'one still open is kept')
  })

  test('are not used up by someone already in the space, who keeps their role', async () => {
    const { state } = await made()
    await state.setMember(bob, 'admin')
    const { code } = await state.createInvite('reader', 'cat@example.com', ann)
    assert.equal(await state.redeemInvite(code, bob), 'admin')
    assert.equal(await state.redeemInvite(code, ann), 'owner')
    assert.equal(await state.redeemInvite(code, cat), 'reader', 'still there for who it is for')
  })

  test('are listed with who they are for but without their codes, and can be revoked', async () => {
    const { state, at } = await made()
    const first = await state.createInvite('reader', 'cat@example.com', ann)
    await at(new Date(NOW.getTime() + 1000)).createInvite('writer', 'dan@example.com', bob)
    const listed = await state.invites()
    assert.deepEqual(
      listed.map(({ role, email, createdBy }) => ({ role, email, createdBy })),
      [
        { role: 'reader', email: 'cat@example.com', createdBy: 'ann@example.com' },
        { role: 'writer', email: 'dan@example.com', createdBy: 'bob@example.com' },
      ]
    )
    assert.ok(!JSON.stringify(listed).includes(first.code))

    assert.equal(await state.revokeInvite(listed[0].id), true)
    assert.equal(await state.revokeInvite(listed[0].id), false)
    assert.equal(await state.redeemInvite(first.code, cat), null)
  })
})

describe('forgetting a space', () => {
  test('leaves no members, invites, refs or blob, and no space; only the register of it stays', async () => {
    const { state, rows, at } = await made()
    await state.setMember(bob, 'writer')
    await state.createInvite('reader', 'cat@example.com', ann)
    await state.addRefs(['file-1'])
    await state.setOwnerBlob('blob')
    await state.setLicence('471102', ann)
    await at(new Date('2026-11-01T00:00:00Z')).destroy(ann)
    for (const table of ['team_members', 'team_invites', 'team_refs', 'team_credentials']) {
      assert.deepEqual(rows(`SELECT * FROM ${table}`), [], table)
    }
    assert.equal(await state.info(), null)
    assert.equal(await state.roleOf(bob), null)
    assert.equal(await state.roleOf(ann), null)
    assert.deepEqual(rows('SELECT name, owner_email, ccli_licence, ended_at FROM teams'), [
      {
        name: 'Pat Church',
        owner_email: 'ann@example.com',
        ccli_licence: '471102',
        ended_at: '2026-11-01T00:00:00.000Z',
      },
    ])
    assert.deepEqual(
      rows('SELECT kind FROM team_events ORDER BY id').map(row => row.kind),
      ['created', 'licence', 'ended']
    )
  })

  test('is done once, and a space that was never made is nothing to forget', async () => {
    const { state, rows } = await made()
    await state.destroy(ann)
    await state.destroy(ann)
    assert.equal(rows("SELECT * FROM team_events WHERE kind = 'ended'").length, 1)
    await new TeamSpaceState(d1Db().db, 'other-space').destroy(ann)
  })

  test('closes the live sockets of someone whose membership changed, or all of them', async () => {
    const dropped: (string | undefined)[] = []
    const { db } = d1Db()
    const state = new TeamSpaceState(db, SPACE, {
      sockets: {
        fetch: () => new Response(null, { status: 200 }),
        dropSockets: async identity => void dropped.push(identity),
      },
    })
    await state.create({ rootRef: 'r', name: 'Team', owner: ann })
    await state.setMember(bob, 'writer')
    await state.setRoleByEmail('bob@example.com', 'reader')
    await state.removeByEmail('bob@example.com')
    await state.setMember(cat, 'reader')
    await state.removeMember(cat)
    await state.destroy(ann)
    // (each change closes the logins' sockets and the account's own, for a device signed in with a session)
    assert.deepEqual(
      dropped.filter(key => !key?.startsWith('chordless:')),
      ['google:g-2', 'google:g-2', 'google:g-2', 'google:g-3', 'google:g-3', undefined]
    )
    assert.equal(dropped.filter(key => key?.startsWith('chordless:')).length, 5)
    assert.equal((await state.fetch?.(new Request('https://x.test')))?.status, 200)
  })
})
