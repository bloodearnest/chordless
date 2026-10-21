/**
 * How the Worker reaches a team space's Drive (worker/src/team-drive.ts): the owner's access token
 * made from the blob the space's Durable Object holds, and the app's own Drive code run with it
 * against the in-memory Drive.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { type BlobData, encryptBlob } from '../worker/src/blob.ts'
import type { Identity } from '../worker/src/identity.ts'
import { CredentialError, ownerAccessToken, teamDrive } from '../worker/src/team-drive.ts'
import { type SpaceInfo, TeamSpaceState } from '../worker/src/team-state.ts'
import { FakeDrive } from './fake-drive.ts'
import { MapStore } from './map-store.ts'

const env = {
  JWE_ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
}
const ann: Identity = { provider: 'google', sub: 'g-1', email: 'ann@example.com' }
const TOKEN = 'fake-drive-token'
const now = () => Date.now()

const blobFor = (sub = 'g-1', blobId: string = crypto.randomUUID()) =>
  encryptBlob(
    {
      owner_email: 'ann@example.com',
      owner_sub: sub,
      scopes: 'drive.file',
      refresh_token: `refresh-${blobId}`,
      created_at: '2026-10-21T00:00:00Z',
      blob_id: blobId,
      kid: 'default',
    } satisfies BlobData,
    env
  )

/** What Google says to a refresh: counted, and as slow as a test needs */
function google(over: Partial<{ expires_in: number; fail: unknown }> = {}) {
  const calls: string[] = []
  return {
    calls,
    refreshAccessToken: (async (refreshToken: string) => {
      calls.push(refreshToken)
      await new Promise(resolve => setTimeout(resolve, 5))
      if (over.fail) throw over.fail
      return { access_token: TOKEN, expires_in: 'expires_in' in over ? over.expires_in : 3600 }
    }) as never,
  }
}

async function space(blob?: string) {
  const state = new TeamSpaceState(new MapStore())
  await state.create({ rootRef: 'root-1', name: 'Team', owner: ann })
  if (blob) await state.setOwnerBlob(blob)
  return { state, info: (await state.info()) as SpaceInfo }
}

describe('the owner’s access token', () => {
  test('is made from the blob in the space, with the refresh token inside it', async () => {
    const { state, info } = await space(await blobFor('g-1', 'blob-a'))
    const fake = google()
    const token = ownerAccessToken({ room: state, info, env, google: fake, now })
    assert.equal(await token(), TOKEN)
    assert.deepEqual(fake.calls, ['refresh-blob-a'])
  })

  test('is made once for many calls at once, and again when the hour is nearly up', async () => {
    const { state, info } = await space(await blobFor('g-1', 'blob-b'))
    const fake = google({ expires_in: 3600 })
    let clock = Date.now()
    const token = ownerAccessToken({ room: state, info, env, google: fake, now: () => clock })

    await Promise.all(Array.from({ length: 10 }, () => token()))
    assert.equal(fake.calls.length, 1)

    clock += 50 * 60 * 1000
    await token()
    assert.equal(fake.calls.length, 1, 'ten minutes left: still good')

    clock += 6 * 60 * 1000
    await token()
    assert.equal(fake.calls.length, 2, 'under five minutes left: made again')
  })

  test('is made again next time when Google gives no lifetime for it', async () => {
    const { state, info } = await space(await blobFor('g-1', 'blob-f'))
    const fake = google({ expires_in: undefined })
    const token = ownerAccessToken({ room: state, info, env, google: fake, now })
    await token()
    await token()
    assert.equal(fake.calls.length, 2)
  })

  test('says so when sharing is not set up, with no blob', async () => {
    const { state, info } = await space()
    const token = ownerAccessToken({ room: state, info, env, google: google(), now })
    await assert.rejects(token(), error => {
      assert.ok(error instanceof CredentialError)
      assert.equal(error.status, 409)
      assert.match(error.message, /not set up/)
      return true
    })
  })

  test('refuses a blob that is not the owner’s, and asks Google nothing', async () => {
    const { state, info } = await space(await blobFor('someone-else', 'blob-c'))
    const fake = google()
    const token = ownerAccessToken({ room: state, info, env, google: fake, now })
    await assert.rejects(token(), /not the space owner/)
    assert.deepEqual(fake.calls, [])
  })

  test('asks the owner to reconnect when Google no longer honours the sign-in, and tries again next time', async () => {
    const { state, info } = await space(await blobFor('g-1', 'blob-d'))
    const fake = google({ fail: { error: 'invalid_grant' } })
    const token = ownerAccessToken({ room: state, info, env, google: fake, now })
    await assert.rejects(token(), error => {
      assert.ok(error instanceof CredentialError)
      assert.equal(error.status, 409)
      assert.match(error.message, /reconnect/)
      return true
    })
    await assert.rejects(token(), /reconnect/)
    assert.equal(fake.calls.length, 2, 'a failure is not remembered')
  })

  test('passes on any other failure of Google’s as it is', async () => {
    const { state, info } = await space(await blobFor('g-1', 'blob-e'))
    const token = ownerAccessToken({
      room: state,
      info,
      env,
      google: google({ fail: new Error('Google is down') }),
      now,
    })
    await assert.rejects(token(), /Google is down/)
  })

  test('is not made from a blob the Worker cannot open', async () => {
    const { state, info } = await space('not-a-blob')
    await assert.rejects(ownerAccessToken({ room: state, info, env, google: google(), now })())
  })
})

describe('Drive for a team space', () => {
  let drive: FakeDrive
  beforeEach(() => {
    drive = new FakeDrive()
  })
  const viaFake = ((input: RequestInfo | URL, init?: RequestInit) =>
    drive.handle(input, init)) as typeof fetch

  test('runs the app’s own Drive code with the owner’s token, in the space’s folder', async () => {
    const backend = teamDrive(async () => TOKEN, viaFake)
    const { ref: root } = await backend.ensureRoot('Team', 'space-1')
    const team = backend.space(root)

    const made = await team.create(
      'songs',
      { name: 'amazing-grace.txt', type: 'text/plain', props: { songId: 's1' } },
      'Amazing grace'
    )
    assert.equal(made.intact, true)
    assert.deepEqual(
      (await team.list('songs')).map(file => file.name),
      ['amazing-grace.txt']
    )
    assert.equal(await team.readText(made.file.ref), 'Amazing grace')
    await team.trash(made.file.ref)
    assert.deepEqual(await team.list('songs'), [])
    assert.equal((await team.status(made.file.ref))?.trashed, true)
  })

  test('keeps two spaces’ tokens apart when their calls are interleaved', async () => {
    const seen: { space: string; token: string }[] = []
    /** A space's fetch: notes the token the Drive code sent, and gives the fake the one it knows */
    const fetchFor = (space: string) =>
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>
        seen.push({ space, token: headers.Authorization.replace('Bearer ', '') })
        return drive.handle(input, {
          ...init,
          headers: { ...headers, Authorization: `Bearer ${TOKEN}` },
        })
      }) as typeof fetch
    const one = teamDrive(async () => 'token-of-one', fetchFor('one'))
    const two = teamDrive(async () => 'token-of-two', fetchFor('two'))

    const [a, b] = await Promise.all([one.ensureRoot('One', 'a'), two.ensureRoot('Two', 'b')])
    await Promise.all([
      one.space(a.ref).create('songs', { name: 'a.txt', type: 'text/plain', props: {} }, 'a'),
      two.space(b.ref).create('songs', { name: 'b.txt', type: 'text/plain', props: {} }, 'b'),
    ])

    assert.ok(seen.length > 4)
    for (const { space, token } of seen) assert.equal(token, `token-of-${space}`)
  })
})
