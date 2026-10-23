/**
 * What a team space's Durable Object knows (worker/src/team-state.ts): the owner, the members and
 * their roles, the files in the space's tree and the owner's blob, over a Map standing in for the
 * object's storage.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Identity } from '../worker/src/identity.ts'
import { INVITE_TTL_MS, TeamSpaceState } from '../worker/src/team-state.ts'
import { MapStore } from './map-store.ts'

const ann: Identity = { provider: 'google', sub: 'g-1', email: 'Ann@Example.com' }
const bob: Identity = { provider: 'google', sub: 'g-2', email: 'bob@example.com' }
const cat: Identity = { provider: 'google', sub: 'g-3', email: 'cat@example.com' }
const NOW = new Date('2026-10-21T12:00:00Z')

async function made() {
  const store = new MapStore()
  const state = new TeamSpaceState(store, () => NOW)
  await state.create({ rootRef: 'root-1', name: 'Pat Church', owner: ann })
  return { store, state }
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
    const state = new TeamSpaceState(new MapStore())
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
    const state = new TeamSpaceState(new MapStore())
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
    assert.equal(await state.roleOf({ ...bob, email: 'someone-else@example.com' }), 'admin')
  })

  test('change when a member is set again, and keep when they joined', async () => {
    const { store, state } = await made()
    await state.setMember(bob, 'reader')
    const later = new TeamSpaceState(store, () => new Date('2027-01-01T00:00:00Z'))
    await later.setMember(bob, 'admin')
    assert.equal(await state.roleOf(bob), 'admin')
    const record = store.entries.get('member:google:g-2') as { since: string }
    assert.equal(record.since, NOW.toISOString())
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

  test('are noted in puts no bigger than Cloudflare takes', async () => {
    const { store, state } = await made()
    const refs = Array.from({ length: 300 }, (_, i) => `file-${i}`)
    await state.addRefs(refs)
    assert.deepEqual(
      store.puts.slice(1).map(keys => keys.length),
      [128, 128, 44]
    )
    assert.equal(await state.owns('file-299'), true)
    await state.addRefs([])
  })

  test('are written once: a repeat of the same refs writes nothing, and a new one only itself', async () => {
    const { store, state } = await made()
    await state.addRefs(['file-1', 'file-2', 'file-2'])
    assert.deepEqual(store.puts.at(-1), ['ref:file-1', 'ref:file-2'])
    const writes = store.puts.length
    await state.addRefs(['file-1', 'file-2'])
    assert.equal(store.puts.length, writes)
    await state.addRefs(['file-1', 'file-3'])
    assert.deepEqual(store.puts.at(-1), ['ref:file-3'])
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

test('stores nothing but the space, its members, its refs and the blob', async () => {
  const { store, state } = await made()
  await state.setMember(bob, 'writer')
  await state.addRefs(['file-1'])
  await state.setOwnerBlob('blob')
  const kinds = new Set([...store.entries.keys()].map(key => key.split(':')[0]))
  assert.deepEqual([...kinds].sort(), ['member', 'ownerBlob', 'ref', 'space'])
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
    const { store, state } = await made()
    const { code } = await state.createInvite('writer', 'bob@example.com', ann)
    assert.ok(!JSON.stringify([...store.entries]).includes(code), 'only a hash is stored')

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
    const { store, state } = await made()
    assert.equal(await state.redeemInvite('made-up', bob), null)
    const { code, expiresAt } = await state.createInvite('reader', 'bob@example.com', ann)
    assert.equal(
      new Date(expiresAt).getTime() - NOW.getTime(),
      INVITE_TTL_MS,
      'a week from the clock'
    )
    const later = new TeamSpaceState(store, () => new Date(NOW.getTime() + INVITE_TTL_MS + 1))
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
    const { state } = await made()
    const first = await state.createInvite('reader', 'cat@example.com', ann)
    await state.createInvite('writer', 'dan@example.com', bob)
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
  test('leaves nothing: no space, members, invites, refs or blob', async () => {
    const { store, state } = await made()
    await state.setMember(bob, 'writer')
    await state.createInvite('reader', 'cat@example.com', ann)
    await state.addRefs(['file-1'])
    await state.setOwnerBlob('blob')
    await state.destroy()
    assert.equal(store.entries.size, 0)
    assert.equal(await state.info(), null)
    assert.equal(await state.roleOf(bob), null)
  })
})
