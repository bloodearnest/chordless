/**
 * A team space's pad sets through the Worker (worker/src/team-pads.ts): who may read, upload and
 * replace them, that an upload by anyone below an admin only adds, the limits on what is taken, and
 * that nothing outside the space's own `pads/` is reached. The pads are in the in-memory storage
 * and the space's tree is noted in its state over a Map, as the Worker does it.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { TeamRole } from '../src/js/team-roles.ts'
import type { Identity } from '../worker/src/identity.ts'
import { handleTeamRequest, type TeamContext } from '../worker/src/team-api.ts'
import { MAX_PAD_BYTES } from '../worker/src/team-pads.ts'
import { notingPadRefs, notingRefs } from '../worker/src/team-refs.ts'
import { TeamSpaceState } from '../worker/src/team-state.ts'
import { d1Db } from './d1-db.ts'
import { MemoryStorage } from './memory-storage.ts'

const ann: Identity = { provider: 'google', sub: 'g-1', email: 'ann@example.com' }
const mp3 = (bytes: number[] = [1, 2, 3]) =>
  new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' })

async function made() {
  const storage = new MemoryStorage()
  const root = (await storage.ensureRoot('Team', 'space-1')).ref
  const elsewhere = (await storage.ensureRoot('Elsewhere', 'space-2')).ref
  const state = new TeamSpaceState(d1Db().db, 'space-test')
  await state.create({ rootRef: root, name: 'Team', owner: ann })
  const context: TeamContext = {
    space: async () => notingRefs(storage.space(root), state),
    pads: async () => notingPadRefs(storage.padsIn(root), state),
    root: async () => ({ ref: root, name: 'Team', trashed: false }),
    owns: (_, ref) => state.owns(ref),
    ownedAmong: (_, refs) => state.ownedAmong(refs),
  }
  /** A request to the space as someone of this role */
  const call = (role: TeamRole, path: string, init?: RequestInit) =>
    handleTeamRequest(
      new Request(`https://chordless.test/api/space/space-1${path}`, init),
      { spaceId: 'space-1', rest: path },
      context,
      role,
      { provider: 'google', sub: role, email: `${role}@example.com` }
    )
  const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const put = (audio: Blob): RequestInit => ({
    method: 'PUT',
    headers: { 'Content-Type': audio.type },
    body: audio,
  })
  /** Make a set as someone of this role, and give its ref */
  const makeSet = async (role: TeamRole, name: string) => {
    const response = await call(role, '/pads', json({ name }))
    assert.equal(response.status, 200)
    return ((await response.json()) as { ref: string }).ref
  }
  return { storage, root, elsewhere, call, json, put, makeSet }
}

describe('team pad sets', () => {
  test('a team member uploads a new set, and every member lists it and plays it', async () => {
    const { call, put, makeSet } = await made()
    const set = await makeSet('reader', 'Warm pads')
    assert.equal((await call('reader', `/pads/${set}/files/C`, put(mp3([7, 8])))).status, 204)

    const sets = (await (await call('writer', '/pads')).json()) as { name: string }[]
    assert.deepEqual(
      sets.map(each => each.name),
      ['Warm pads']
    )
    const files = (await (await call('writer', `/pads/${set}/files`)).json()) as {
      ref: string
      padKey: string
    }[]
    assert.deepEqual(
      files.map(file => file.padKey),
      ['C']
    )
    const audio = await call('writer', `/pads/files/${files[0]?.ref}`)
    assert.equal(audio.status, 200)
    assert.equal(audio.headers.get('Content-Type'), 'audio/mpeg')
    assert.equal(audio.headers.get('Cache-Control'), 'no-store')
    assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())], [7, 8])
  })

  test('below an admin, an upload only adds: a set or a key that is there is not replaced', async () => {
    const { call, json, put, makeSet } = await made()
    const set = await makeSet('admin', 'Warm pads')
    await call('admin', `/pads/${set}/files/C`, put(mp3()))

    for (const role of ['reader', 'writer'] as const) {
      const again = await call(role, '/pads', json({ name: 'Warm pads' }))
      assert.equal(again.status, 409)
      assert.match(((await again.json()) as { error: string }).error, /another name/)
      assert.equal((await call(role, `/pads/${set}/files/C`, put(mp3()))).status, 409)
      assert.equal((await call(role, `/pads/${set}/trash`, { method: 'POST' })).status, 403)
    }
    // (a key the set lacks can still be added: an upload that stopped half way can be finished)
    assert.equal((await call('reader', `/pads/${set}/files/D`, put(mp3()))).status, 204)
  })

  test('an admin replaces a set: its files go to the bin, and it is filled again', async () => {
    const { call, put, makeSet } = await made()
    const set = await makeSet('reader', 'Warm pads')
    await call('reader', `/pads/${set}/files/C`, put(mp3([1])))

    assert.equal(await makeSet('admin', 'Warm pads'), set)
    assert.equal((await call('admin', `/pads/${set}/trash`, { method: 'POST' })).status, 204)
    assert.deepEqual(await (await call('admin', `/pads/${set}/files`)).json(), [])
    assert.equal((await call('admin', `/pads/${set}/files/C`, put(mp3([2])))).status, 204)
  })

  test('takes a key by its other names, and refuses what is not a pad', async () => {
    const { call, put, makeSet } = await made()
    const set = await makeSet('reader', 'Warm pads')
    assert.equal((await call('reader', `/pads/${set}/files/Bb`, put(mp3()))).status, 204)
    const files = (await (await call('reader', `/pads/${set}/files`)).json()) as {
      padKey: string
    }[]
    assert.deepEqual(
      files.map(file => file.padKey),
      ['A#']
    )

    assert.equal((await call('reader', `/pads/${set}/files/H`, put(mp3()))).status, 400)
    const text = new Blob(['not audio'], { type: 'text/plain' })
    assert.equal((await call('reader', `/pads/${set}/files/D`, put(text))).status, 415)
    assert.equal((await call('reader', `/pads/${set}/files/D`, put(mp3([])))).status, 400)
    const big = new Blob([new Uint8Array(MAX_PAD_BYTES + 1)], { type: 'audio/mpeg' })
    assert.equal((await call('reader', `/pads/${set}/files/D`, put(big))).status, 413)
  })

  test('refuses a pad said to be too big before reading it, and a path or method it does not have', async () => {
    const { call, makeSet } = await made()
    const set = await makeSet('reader', 'Warm pads')
    const said = await call('reader', `/pads/${set}/files/C`, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(MAX_PAD_BYTES + 1) },
      body: new Uint8Array([1]),
    })
    assert.equal(said.status, 413)
    assert.equal((await call('reader', `/pads/${set}/files/C`)).status, 404)
    assert.equal((await call('reader', `/pads/${set}/files`, { method: 'POST' })).status, 404)
    assert.equal((await call('reader', '/pads', { method: 'PUT' })).status, 404)
  })

  test('says there is no such space when the space has no pads to give', async () => {
    const { call } = await made()
    const none = (path: string) =>
      handleTeamRequest(
        new Request(`https://chordless.test/api/space/space-9${path}`),
        { spaceId: 'space-9', rest: path },
        {
          space: async () => null,
          pads: async () => null,
          root: async () => null,
          owns: async () => false,
          ownedAmong: async () => [],
        },
        'admin',
        ann
      )
    assert.equal((await none('/pads')).status, 404)
    assert.equal((await call('reader', '/pads')).status, 200)
  })

  test('a set has a name of one line, up to 100 characters', async () => {
    const { call, json } = await made()
    for (const name of ['', '   ', 'a'.repeat(101), 'two\nlines', 42]) {
      assert.equal((await call('reader', '/pads', json({ name }))).status, 400)
    }
  })

  test('reaches nothing outside the space’s pads: not another space’s', async () => {
    const { storage, elsewhere, call, put } = await made()
    const theirs = await storage.padsIn(elsewhere).ensureSet('Theirs')
    await storage.padsIn(elsewhere).addFile(theirs, 'C', mp3())
    const [theirFile] = await storage.padsIn(elsewhere).listFiles(theirs)

    assert.deepEqual(await (await call('reader', '/pads')).json(), [])
    for (const ref of [theirs]) {
      assert.equal((await call('admin', `/pads/${ref}/files`)).status, 404)
      assert.equal((await call('admin', `/pads/${ref}/files/C`, put(mp3()))).status, 404)
      assert.equal((await call('admin', `/pads/${ref}/trash`, { method: 'POST' })).status, 404)
    }
    assert.equal((await call('admin', `/pads/files/${theirFile?.ref}`)).status, 404)
    assert.equal((await call('admin', '/pads/nonsense/path/here')).status, 404)
  })

  test('a file of the space is not read until its set has been listed', async () => {
    const { storage, root, call } = await made()
    // (made by the owner's own sync, straight in Drive: the Worker has not seen it)
    const set = await storage.padsIn(root).ensureSet('The owner’s')
    await storage.padsIn(root).addFile(set, 'C', mp3())
    const [file] = await storage.padsIn(root).listFiles(set)

    assert.equal((await call('reader', `/pads/files/${file?.ref}`)).status, 404)
    await call('reader', '/pads')
    await call('reader', `/pads/${set}/files`)
    assert.equal((await call('reader', `/pads/files/${file?.ref}`)).status, 200)
  })
})
