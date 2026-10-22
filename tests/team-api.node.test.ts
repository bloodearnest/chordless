/**
 * The team space API (worker/src/team-api.ts): who may do what, what it refuses, and that it
 * keeps a member to their space. The storage behind it is the in-memory one. `TeamStorage`
 * (the client) is tested against it in storage-team.test.ts, with the conformance suite.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { atLeast, teamSpacePath } from '../worker/src/team-api.ts'
import { makeTeamRig, ORIGIN } from './team-context.ts'

const file = { name: 'a.txt', props: {}, type: 'text/plain' }

/** A request to the team API as a token, and what came back */
async function call(
  rig: Awaited<ReturnType<typeof makeTeamRig>>,
  method: string,
  path: string,
  { token = 'writer-token', body }: { token?: string | null; body?: unknown } = {}
) {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await rig.fetch(`${ORIGIN}/api/space/space-1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, text, json: () => JSON.parse(text) }
}

test('the path of a team space request is the space id and the rest', () => {
  assert.deepEqual(teamSpacePath('/api/space/abc/files'), { spaceId: 'abc', rest: '/files' })
  assert.deepEqual(teamSpacePath('/api/space/a%20b'), { spaceId: 'a b', rest: '/' })
  assert.equal(teamSpacePath('/api/share/abc'), null)
  assert.equal(teamSpacePath('/api/space/'), null)
})

test('roles rank reader, writer, admin, owner', () => {
  assert.equal(atLeast('reader', 'writer'), false)
  assert.equal(atLeast('writer', 'writer'), true)
  assert.equal(atLeast('admin', 'writer'), true)
  assert.equal(atLeast('owner', 'admin'), true)
})

test('asks for a sign-in first, and says nothing of a space to someone who is not in it', async () => {
  const rig = await makeTeamRig()
  rig.roles.set('stranger', 'none')
  assert.equal((await call(rig, 'GET', '/root', { token: null })).status, 401)
  assert.equal((await call(rig, 'GET', '/root', { token: 'unknown' })).status, 401)
  assert.equal((await call(rig, 'GET', '/root', { token: 'stranger' })).status, 403)
  // (a space that is not there looks the same as one that is not theirs)
  const none = await rig.fetch(`${ORIGIN}/api/space/nope/root`, {
    headers: { Authorization: 'Bearer stranger' },
  })
  assert.equal(none.status, 403)
  const gone = await rig.fetch(`${ORIGIN}/api/space/nope/root`, {
    headers: { Authorization: 'Bearer writer-token' },
  })
  assert.equal(gone.status, 404)
})

test('a space whose root has gone has no root to describe', async () => {
  const rig = await makeTeamRig()
  rig.storage.removeRoot(rig.spaces[0].root)
  assert.equal((await call(rig, 'GET', '/root')).status, 404)
})

test('writes need a writer: a reader gets 403 on every kind of write, and nothing changes', async () => {
  const rig = await makeTeamRig()
  rig.roles.set('reader', 'reader')
  const { file: made } = await rig.storage.space(rig.spaces[0].root).create('songs', file, 'one')
  const as = { token: 'reader' }
  const writes: [string, string, unknown][] = [
    ['POST', '/files?collection=songs', { input: file, body: 'x' }],
    ['POST', '/create-many?collection=songs', { items: [{ input: file, body: 'x' }] }],
    ['PUT', `/files/${made.ref}`, { input: file, body: 'x' }],
    ['POST', '/update-many', { items: [{ ref: made.ref, input: file, body: 'x' }] }],
    ['POST', `/files/${made.ref}/trash`, undefined],
    ['POST', `/files/${made.ref}/unpublish`, undefined],
  ]
  for (const [method, path, body] of writes) {
    assert.equal((await call(rig, method, path, { ...as, body })).status, 403, `${method} ${path}`)
  }
  assert.equal(rig.storage.writes().filter(w => w.op !== 'ensureRoot').length, 1) // the setup's
  assert.equal(rig.storage.file(made.ref).content, 'one')
  assert.equal(rig.storage.file(made.ref).trashed, false)
})

test('answers the reads of every member', async () => {
  const rig = await makeTeamRig()
  rig.roles.set('reader', 'reader')
  rig.storage.addMember(rig.spaces[0].root, { email: 'pat@example.com', name: 'Pat' } as never)
  const { file: made } = await rig.storage.space(rig.spaces[0].root).create('songs', file, 'one')
  const as = { token: 'reader' }
  assert.equal((await call(rig, 'GET', '/members', as)).json()[0].email, 'pat@example.com')
  assert.equal((await call(rig, 'GET', '/files?collection=songs', as)).json().length, 1)
  assert.deepEqual((await call(rig, 'GET', '/inventory', as)).json(), [made.ref])
  assert.equal((await call(rig, 'GET', `/files/${made.ref}`, as)).json().name, 'a.txt')
  assert.equal((await call(rig, 'GET', `/files/${made.ref}/text`, as)).text, 'one')
  assert.equal((await call(rig, 'GET', '/root', as)).json().canWrite, false)
})

test("says a space's root is the space itself, not the folder in the storage behind it", async () => {
  const rig = await makeTeamRig()
  const root = (await call(rig, 'GET', '/root')).json()
  assert.equal(root.ref, 'space-1')
  assert.notEqual(root.ref, rig.spaces[0].root)
  assert.equal(root.name, 'Team space-1')
})

test('writes: create, update and trash a file; unpublish ends a share link', async () => {
  const rig = await makeTeamRig()
  const made = (
    await call(rig, 'POST', '/files?collection=songs', { body: { input: file, body: 'one' } })
  ).json()
  assert.equal(made.file.name, 'a.txt')
  const ref = made.file.ref
  const updated = await call(rig, 'PUT', `/files/${ref}`, { body: { input: file, body: 'two' } })
  assert.equal(updated.json().file.ref, ref)
  assert.equal(rig.storage.file(ref).content, 'two')
  assert.equal((await call(rig, 'POST', `/files/${ref}/trash`)).status, 204)
  assert.equal(rig.storage.file(ref).trashed, true)
})

test('a share can be public and unpublished; nothing else can be public', async () => {
  const rig = await makeTeamRig()
  const share = (
    await call(rig, 'POST', '/files?collection=shares', {
      body: { input: file, body: 'cipher', publicLink: true },
    })
  ).json()
  const ref = share.file.ref
  assert.equal(rig.storage.publicDownload(ref).status, 200)
  assert.equal((await call(rig, 'POST', `/files/${ref}/unpublish`)).status, 204)
  assert.equal(rig.storage.publicDownload(ref).status, 404)
  const song = await call(rig, 'POST', '/files?collection=songs', {
    body: { input: file, body: 'x', publicLink: true },
  })
  assert.equal(song.status, 400)
  assert.equal((await call(rig, 'POST', '/files/nope/unpublish')).status, 404)
})

test('reads and updates many files, with null in the place of one that is not in the space', async () => {
  const rig = await makeTeamRig()
  const mine = await rig.storage.space(rig.spaces[0].root).create('songs', file, 'mine')
  const theirs = await rig.storage.space(rig.spaces[1].root).create('songs', file, 'theirs')
  const read = await call(rig, 'POST', '/read-many', {
    body: { refs: [theirs.file.ref, mine.file.ref] },
  })
  assert.deepEqual(read.json().texts, [null, 'mine'])
  const update = await call(rig, 'POST', '/update-many', {
    body: {
      items: [
        { ref: mine.file.ref, input: file, body: 'mine, changed' },
        { ref: theirs.file.ref, input: file, body: 'taken' },
      ],
    },
  })
  const { results } = update.json()
  assert.equal(results[0].file.ref, mine.file.ref)
  assert.equal(results[1], null)
  assert.equal(rig.storage.file(theirs.file.ref).content, 'theirs')
  const many = await call(rig, 'POST', '/create-many?collection=setlists', {
    body: { items: [{ input: { ...file, name: 'b.json' }, body: '{}' }] },
  })
  assert.equal(many.json().results[0].file.name, 'b.json')
})

test("keeps to the space: the status, text, update and trash of another space's file", async () => {
  const rig = await makeTeamRig()
  const theirs = await rig.storage.space(rig.spaces[1].root).create('songs', file, 'theirs')
  const ref = theirs.file.ref
  assert.equal((await call(rig, 'GET', `/files/${ref}`)).status, 404)
  assert.equal((await call(rig, 'GET', `/files/${ref}/text`)).status, 404)
  assert.equal(
    (await call(rig, 'PUT', `/files/${ref}`, { body: { input: file, body: 'x' } })).status,
    404
  )
  assert.equal((await call(rig, 'POST', `/files/${ref}/trash`)).status, 204)
  assert.equal(rig.storage.file(ref).content, 'theirs')
  assert.equal(rig.storage.file(ref).trashed, false)
})

test('refuses what it cannot make sense of, with 400', async () => {
  const rig = await makeTeamRig()
  const bad: [string, string, unknown][] = [
    ['POST', '/files?collection=nope', { input: file, body: 'x' }],
    ['POST', '/files', { input: file, body: 'x' }],
    ['GET', '/files', undefined],
    ['POST', '/files?collection=songs', 'not json'],
    ['POST', '/files?collection=songs', '[1]'],
    ['POST', '/files?collection=songs', { input: file }],
    ['POST', '/files?collection=songs', { input: { name: 'a' }, body: 'x' }],
    ['POST', '/files?collection=songs', { input: { ...file, props: { a: 1 } }, body: 'x' }],
    ['POST', '/files?collection=songs', { input: { ...file, props: [] }, body: 'x' }],
    ['POST', '/create-many?collection=songs', { items: 'x' }],
    ['POST', '/update-many', { items: [{ input: file, body: 'x' }] }],
    ['POST', '/update-many', { items: [5] }],
    ['POST', '/read-many', { refs: [1] }],
    ['POST', '/read-many', {}],
  ]
  for (const [method, path, body] of bad) {
    assert.equal((await call(rig, method, path, { body })).status, 400, `${method} ${path}`)
  }
})

test('says 404 to a route it does not have', async () => {
  const rig = await makeTeamRig()
  assert.equal((await call(rig, 'GET', '/nothing')).status, 404)
  assert.equal((await call(rig, 'DELETE', '/files/abc')).status, 404)
})

test('passes on the status of a client error from the storage, and calls any other a bad gateway', async () => {
  const rig = await makeTeamRig()
  const { file: made } = await rig.storage.space(rig.spaces[0].root).create('songs', file, 'one')
  rig.storage.fail('readText', { status: 409 })
  assert.equal((await call(rig, 'GET', `/files/${made.ref}/text`)).status, 409)
  rig.storage.fail('readText', { status: 500 })
  const failed = await call(rig, 'GET', `/files/${made.ref}/text`)
  assert.equal(failed.status, 502)
  assert.match(failed.json().error, /Injected 500/)
  rig.storage.fail('list', { network: true })
  assert.equal((await call(rig, 'GET', '/files?collection=songs')).status, 502)
})
