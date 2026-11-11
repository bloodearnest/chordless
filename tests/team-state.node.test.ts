/**
 * What a team space is (worker/src/team-state.ts, in D1): the owner, the members and
 * their roles, the files in the space's tree and the owner's blob, over a Map standing in for the
 * object's storage.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Identity } from '../worker/src/identity.ts'
import { INVITE_TTL_MS, TeamSpaceState } from '../worker/src/team-state.ts'
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
      { email: 'ann@example.com', role: 'owner' },
      { email: 'bob@example.com', role: 'writer' },
      { email: 'cat@example.com', role: 'reader' },
    ])
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
    'team_credentials',
    'team_events',
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

  test('are for the invited email only: another account is turned away, and the code stays good', async () => {
    const { state } = await made()
    const { code } = await state.createInvite('writer', 'bob@example.com', ann)

    assert.equal(await state.redeemInvite(code, cat), 'other-account')
    assert.equal(await state.roleOf(cat), null)
    assert.equal(await state.redeemInvite(code, bob), 'writer', 'the invited person still can')
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
    assert.deepEqual(dropped, [
      'google:g-2',
      'google:g-2',
      'google:g-2',
      'google:g-3',
      'google:g-3',
      undefined,
    ])
    assert.equal((await state.fetch?.(new Request('https://x.test')))?.status, 200)
  })
})
