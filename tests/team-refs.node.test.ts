/**
 * How a team space comes to know which files are in its tree (worker/src/team-refs.ts): the refs
 * a listing, an inventory or a create shows are noted in the space's Durable Object state, and
 * `owns` answers from them. The files are in the in-memory storage; the state is over a Map.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Identity } from '../worker/src/identity.ts'
import { handleTeamRequest, type TeamContext } from '../worker/src/team-api.ts'
import { notingRefs } from '../worker/src/team-refs.ts'
import { TeamSpaceState } from '../worker/src/team-state.ts'
import { MapStore } from './map-store.ts'
import { MemoryStorage } from './memory-storage.ts'
import { must } from './must.ts'

const ann: Identity = { provider: 'google', sub: 'g-1', email: 'ann@example.com' }
const bob: Identity = { provider: 'google', sub: 'g-2', email: 'bob@example.com' }
const input = (name: string) => ({ name, type: 'song', props: {} })

async function made() {
  const storage = new MemoryStorage()
  const root = (await storage.ensureRoot('Team', 'space-1')).ref
  const other = (await storage.ensureRoot('Elsewhere', 'space-2')).ref
  const state = new TeamSpaceState(new MapStore())
  await state.create({ rootRef: root, name: 'Team', owner: ann })
  /** What the owner's own sync makes, straight in Drive: the Worker never sees it */
  const direct = async (name: string, where = root) =>
    (await storage.space(where).create('songs', input(name), `${name} text`)).file.ref
  const space = notingRefs(storage.space(root), state)
  return { storage, root, other, state, space, direct }
}

describe('noting refs', () => {
  test('a file made straight in Drive is not known until the space is listed', async () => {
    const { state, space, direct } = await made()
    const ref = await direct('Amazing Grace')
    assert.equal(await state.owns(ref), false)
    await space.list('songs')
    assert.equal(await state.owns(ref), true)
  })

  test('an inventory notes every live file in the space, and none outside it', async () => {
    const { state, space, direct, other } = await made()
    const mine = await direct('A')
    const theirs = await direct('B', other)
    await space.inventory()
    assert.equal(await state.owns(mine), true)
    assert.equal(await state.owns(theirs), false)
  })

  test('a create or a create-many notes its files, and a failed one adds nothing', async () => {
    const { storage, root, state, space } = await made()
    const one = (await space.create('songs', input('One'), 'text')).file.ref
    const many = await space.createMany('songs', [
      { input: input('Two'), body: 'text' },
      { input: input('Three'), body: 'text' },
    ])
    for (const result of many) assert.equal(await state.owns(result?.file.ref ?? ''), true)
    assert.equal(await state.owns(one), true)

    const noted: string[] = []
    const refused = notingRefs(
      { ...storage.space(root), createMany: async (_, items) => items.map(() => null) },
      {
        addRefs: async refs => void noted.push(...refs),
        members: async () => [],
        ownedAmong: async () => [],
      }
    )
    assert.deepEqual(await refused.createMany('songs', [{ input: input('Four'), body: 't' }]), [
      null,
    ])
    assert.deepEqual(noted, [])
  })

  test('a file stays noted when it is binned', async () => {
    const { state, space, direct } = await made()
    const ref = await direct('Binned')
    await space.list('songs')
    await space.trash(ref)
    assert.equal(await state.owns(ref), true)
  })

  test('everything else passes straight through', async () => {
    const { space, direct } = await made()
    const ref = await direct('Plain')
    assert.equal(await space.readText(ref), 'Plain text')
    assert.deepEqual(await space.readMany([ref]), ['Plain text'])
    assert.equal((await space.status(ref))?.trashed, false)
    assert.ok((await space.update(ref, input('Plain'), 'changed')).intact)
    assert.equal(
      (await space.updateMany([{ ref, input: input('Plain'), body: 'again' }]))[0]?.intact,
      true
    )
    await space.unpublish(ref)
  })

  test('the members are the Durable Object’s, not the Drive folder’s permissions', async () => {
    const { storage, root, state } = await made()
    await state.setMember(bob, 'writer')
    const space = notingRefs(storage.space(root), state)
    assert.deepEqual(await space.members(), [
      { email: 'ann@example.com', role: 'owner' },
      { email: 'bob@example.com', role: 'writer' },
    ])
  })

  test("an error from the state is the call's error, not swallowed", async () => {
    const { storage, root } = await made()
    const broken = notingRefs(storage.space(root), {
      addRefs: async () => {
        throw new Error('storage unavailable')
      },
      members: async () => [],
      ownedAmong: async () => [],
    })
    await assert.rejects(broken.list('songs'), /storage unavailable/)
  })
})

describe('the feed of changes through the Worker', () => {
  test('notes the files it says changed, and only says gone what the space knows', async () => {
    const { state, space, direct, other, storage } = await made()
    const feed = must(space.changes)
    const start = await feed.start()

    const mine = await direct('Mine')
    const theirs = await direct('Theirs', other)
    const binned = await direct('Binned')
    await space.list('songs')
    storage.trash(theirs)
    storage.trash(binned)

    const seen = await feed.since(start)
    assert.deepEqual(
      seen.changed.map(change => change.file.ref),
      [mine]
    )
    assert.equal(await state.owns(mine), true)
    assert.equal(await state.owns(theirs), false)
    // (the binned file of the owner's other space is not told to a member; the space's own is)
    assert.deepEqual(seen.gone, [binned])
  })

  test('has no feed where the storage has none', async () => {
    const { storage, root, state } = await made()
    const bare = notingRefs({ ...storage.space(root), changes: null }, state)
    assert.equal(bare.changes, null)
  })
})

describe('a member of the team, with the owner syncing straight to Drive', () => {
  async function team() {
    const rig = await made()
    const context: TeamContext = {
      space: async () => rig.space,
      root: async () => ({ ref: rig.root, name: 'Team', trashed: false }),
      owns: (_, ref) => rig.state.owns(ref),
      ownedAmong: (_, refs) => rig.state.ownedAmong(refs),
    }
    const call = (path: string, init?: RequestInit) =>
      handleTeamRequest(
        new Request(`https://chordless.test/api/space/space-1${path}`, init),
        { spaceId: 'space-1', rest: path.split('?')[0] },
        context,
        'reader'
      )
    return { ...rig, call }
  }

  test('cannot read a file the owner made until they have listed the space, as a sync does', async () => {
    const { call, direct } = await team()
    const ref = await direct('Made by the owner')

    assert.equal((await call(`/files/${ref}/text`)).status, 404)

    const listed = (await (await call('/files?collection=songs')).json()) as { ref: string }[]
    assert.deepEqual(
      listed.map(file => file.ref),
      [ref]
    )
    const read = await call(`/files/${ref}/text`)
    assert.equal(read.status, 200)
    assert.equal(await read.text(), 'Made by the owner text')
  })

  test('cannot read a file of another space, listed or not', async () => {
    const { call, direct, other } = await team()
    const foreign = await direct('Not ours', other)
    await call('/files?collection=songs')
    assert.equal((await call(`/files/${foreign}/text`)).status, 404)
  })
})
