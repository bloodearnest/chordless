/**
 * The broker spike (worker/src/spike-broker.ts, throwaway): the owner hands the Worker a folder,
 * and a member, who is who the Google ID token says and has the role they were given, gets only
 * what is in it, through the owner's token. Google and Drive are replaced.
 */

import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { type BlobData, encryptBlob } from '../worker/src/blob.ts'
import type { Env } from '../worker/src/env.ts'
import { handleRequest } from '../worker/src/router.ts'
import type { GoogleApi } from '../worker/src/session.ts'
import {
  forgetSpikeSpaces,
  handleSpikeDrive,
  handleSpikeEnable,
  handleSpikeUpload,
} from '../worker/src/spike-broker.ts'

const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  JWE_ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
  ASSETS: { fetch: async () => new Response('assets') },
} satisfies Env

const OWNER = { email: 'ann@example.com', sub: 'sub-ann' }
const blobData = (over: Partial<BlobData> = {}): BlobData => ({
  owner_email: OWNER.email,
  owner_sub: OWNER.sub,
  scopes: 'https://www.googleapis.com/auth/drive.file',
  refresh_token: 'refresh-token',
  created_at: '2026-10-19T12:00:00.000Z',
  blob_id: 'blob-1',
  kid: 'default',
  ...over,
})

/** ID tokens are just "email" or "email:sub" here; "bad" is refused */
let refreshes = 0
let omitExpiry = false
const google = {
  verifyIdToken: async (token: string) => {
    if (token === 'bad') throw new Error('bad signature')
    if (token === 'no-email') return { sub: 'sub-x' }
    const [email, sub] = token.split(':')
    return { email, sub: sub ?? `sub-${email}` }
  },
  refreshAccessToken: async () => {
    refreshes++
    return { access_token: `access-${refreshes}`, expires_in: omitExpiry ? undefined : 3600 }
  },
} as unknown as GoogleApi

/** A Drive with a team folder, a file and subfolder in it, and a file outside it */
const FILES: Record<string, { name: string; parents: string[]; content?: string }> = {
  team: { name: 'Team', parents: ['mydrive'] },
  mydrive: { name: 'My Drive', parents: [] },
  song: { name: 'song.cho', parents: ['team'], content: '{title: Song}' },
  sub: { name: 'sub', parents: ['team'] },
  deep: { name: 'deep.cho', parents: ['sub'], content: 'deep' },
  outside: { name: 'private.txt', parents: ['mydrive'], content: 'secret' },
  bin: { name: 'chart.bin', parents: ['team'] },
}
const driveCalls: { url: string; auth: string | null; method: string }[] = []
const created: string[] = []
const fakeDrive = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input)
  const headers = new Headers(init.headers)
  driveCalls.push({ url, auth: headers.get('Authorization'), method: init.method ?? 'GET' })
  if (init.method === 'POST') {
    created.push(String(init.body))
    return Response.json({ id: 'new', name: 'created' })
  }
  if (url.includes('/files?q=')) {
    const files = Object.entries(FILES)
      .filter(([, file]) => file.parents.includes('team'))
      .map(([id, file]) => ({ id, name: file.name }))
    return Response.json({ files })
  }
  const id = decodeURIComponent(/\/files\/([^?]+)/.exec(url)?.[1] ?? '')
  const file = FILES[id]
  if (!file) return Response.json({ error: 'not found' }, { status: 404 })
  if (url.includes('fields=parents')) return Response.json({ parents: file.parents })
  if (url.includes('alt=media')) {
    return id === 'bin'
      ? new Response(new Uint8Array([1, 2]))
      : new Response(file.content ?? '', { headers: { 'Content-Type': 'text/plain' } })
  }
  return Response.json({ id, name: file.name, parents: file.parents })
}) as typeof fetch

const post = (path: string, body: unknown) =>
  new Request(`https://chordless.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const bodyOf = async (response: Response) => (await response.json()) as Record<string, unknown>

async function enable(members: { email: string; role: string }[], over: object = {}) {
  const blob = await encryptBlob(blobData(), env)
  const response = await handleSpikeEnable(
    post('/dev/spike/enable', {
      blob,
      id_token: `${OWNER.email}:${OWNER.sub}`,
      folderId: 'team',
      members,
      ...over,
    }),
    env,
    google
  )
  return response
}

const asMember = (spaceId: string, who: string, op: string, extra: object = {}) =>
  handleSpikeDrive(
    post('/dev/spike/drive', { spaceId, id_token: who, op, ...extra }),
    env,
    google,
    fakeDrive
  )

describe('enabling a space', () => {
  beforeEach(() => {
    forgetSpikeSpaces()
    refreshes = 0
    driveCalls.length = 0
    created.length = 0
  })

  test('gives an id for the owner, and refuses a blob that is not theirs', async () => {
    const ok = await enable([{ email: 'bea@example.com', role: 'reader' }])
    assert.equal(ok.status, 200)
    assert.match(String((await bodyOf(ok)).spaceId), /^[0-9a-f-]{36}$/)

    const stolen = await enable([], { id_token: 'mallory@example.com' })
    assert.equal(stolen.status, 403)
  })

  test('wants everything, and a role that is reader or writer', async () => {
    const missing = await enable([], { folderId: undefined })
    assert.equal(missing.status, 400)
    const badRole = await enable([{ email: 'bea@example.com', role: 'admin' }])
    assert.equal(badRole.status, 400)
    const noEmail = await enable([{ email: '', role: 'reader' }])
    assert.equal(noEmail.status, 400)
  })
})

describe('a member using a space', () => {
  let spaceId = ''
  beforeEach(async () => {
    forgetSpikeSpaces()
    refreshes = 0
    driveCalls.length = 0
    created.length = 0
    const response = await enable([
      { email: 'Bea@Example.com', role: 'reader' },
      { email: 'cal@example.com', role: 'writer' },
    ])
    spaceId = String((await bodyOf(response)).spaceId)
  })

  test('lists the folder, with the owner’s token and not their own', async () => {
    const response = await asMember(spaceId, 'bea@example.com', 'list')
    assert.equal(response.status, 200)
    const names = ((await bodyOf(response)).files as { name: string }[]).map(f => f.name).sort()
    assert.deepEqual(names, ['chart.bin', 'song.cho', 'sub'])
    assert.equal(response.headers.get('X-Spike-Member'), 'bea@example.com (reader)')
    assert.equal(driveCalls[0]?.auth, 'Bearer access-1')
    assert.match(driveCalls[0]?.url ?? '', /supportsAllDrives=true/)
  })

  test('reads a file, and one in a folder inside it, as it streams through', async () => {
    const song = await asMember(spaceId, 'bea@example.com', 'read', { fileId: 'song' })
    assert.equal(await song.text(), '{title: Song}')
    assert.equal(song.headers.get('Content-Type'), 'text/plain')
    const deep = await asMember(spaceId, 'bea@example.com', 'read', { fileId: 'deep' })
    assert.equal(await deep.text(), 'deep')
    const meta = await asMember(spaceId, 'bea@example.com', 'get', { fileId: 'song' })
    assert.equal((await bodyOf(meta)).name, 'song.cho')
  })

  test('refuses a file outside the folder, and the folder above it', async () => {
    for (const fileId of ['outside', 'mydrive', 'no-such-file', '']) {
      const response = await asMember(spaceId, 'bea@example.com', 'read', { fileId })
      assert.equal(response.status, 403, fileId)
    }
    assert.ok(!driveCalls.some(call => call.url.includes('alt=media')), 'nothing was fetched')
  })

  test('gives a type to what Drive gives none for, and takes a token with no expiry as short', async () => {
    omitExpiry = true
    const bin = await asMember(spaceId, 'bea@example.com', 'read', { fileId: 'bin' })
    assert.equal(bin.headers.get('Content-Type'), 'application/octet-stream')
    assert.deepEqual([...new Uint8Array(await bin.arrayBuffer())], [1, 2])
    await asMember(spaceId, 'bea@example.com', 'list')
    assert.equal(refreshes, 1, 'kept for the 3000 s it was given')
    omitExpiry = false
  })

  test('refuses an ID token with no email', async () => {
    assert.equal((await asMember(spaceId, 'no-email', 'list')).status, 403)
  })

  test('asks Google for the owner’s token once, while it is good', async () => {
    await asMember(spaceId, 'bea@example.com', 'list')
    await asMember(spaceId, 'bea@example.com', 'list')
    assert.equal(refreshes, 1)
  })

  test('is told apart by who they are: not a member, not signed in, no such space', async () => {
    const stranger = await asMember(spaceId, 'dan@example.com', 'list')
    assert.equal(stranger.status, 403)
    assert.equal(stranger.headers.get('X-Spike-Member'), 'dan@example.com (not a member)')
    assert.equal((await asMember(spaceId, 'bad', 'list')).status, 401)
    assert.equal((await asMember('nope', 'bea@example.com', 'list')).status, 404)
    const noToken = await handleSpikeDrive(post('/dev/spike/drive', { spaceId }), env, google)
    assert.equal(noToken.status, 404)
    assert.equal(driveCalls.length, 0, 'Drive was not asked')
  })

  test('lets a writer create a file, and not a reader', async () => {
    const reader = await asMember(spaceId, 'bea@example.com', 'create', { name: 'x.txt' })
    assert.equal(reader.status, 403)
    assert.equal(created.length, 0)

    const noName = await asMember(spaceId, 'cal@example.com', 'create')
    assert.equal(noName.status, 400)
    const writer = await asMember(spaceId, 'cal@example.com', 'create', {
      name: 'x.txt',
      content: 'hello',
    })
    assert.equal(writer.status, 200)
    assert.match(created[0] ?? '', /"parents":\["team"\]/)
    assert.match(created[0] ?? '', /hello/)
    const empty = await asMember(spaceId, 'cal@example.com', 'create', { name: 'y.txt' })
    assert.equal(empty.status, 200)
  })

  test('refuses what it does not know', async () => {
    assert.equal(
      (await asMember(spaceId, 'bea@example.com', 'delete', { fileId: 'song' })).status,
      400
    )
  })
})

describe('the routes', () => {
  const ctx = { waitUntil() {} }
  const cache = { match: async () => undefined, put: async () => {} }
  const send = (path: string, withDev: boolean, init: RequestInit = {}) =>
    handleRequest(
      new Request(`https://chordless.test${path}`, init),
      { ...env, ...(withDev && { DEV_PAGES: '1' }) },
      ctx,
      cache,
      google
    )
  const json = (body: unknown, headers: Record<string, string> = {}) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

  test('are not there unless the dev pages are on', async () => {
    for (const path of ['/dev/spike/enable', '/dev/spike/drive']) {
      assert.equal((await send(path, false, json({}))).status, 404, path)
    }
  })

  test('are answered when they are, and refused to a page from another origin', async () => {
    assert.equal((await send('/dev/spike/enable', true, json({}))).status, 400)
    assert.equal((await send('/dev/spike/drive', true, json({}))).status, 404)
    const cross = await send('/dev/spike/drive', true, json({}, { Origin: 'https://evil.example' }))
    assert.equal(cross.status, 403)
  })
})

describe('a big file streamed up through the Worker', () => {
  const bytes = (n: number) => {
    const data = new Uint8Array(n)
    for (let at = 0; at < n; at += 65536) {
      crypto.getRandomValues(data.subarray(at, Math.min(at + 65536, n)))
    }
    return data
  }
  let spaceId = ''
  let sessionRequests: { url: string; headers: Headers; body: string }[] = []
  let putBody: Uint8Array | null = null
  let sessionStatus = 200
  let locationHeader: string | null = 'https://upload.test/session/1'

  const driveWithUploads = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (init.method === 'POST') {
      sessionRequests.push({
        url,
        headers: new Headers(init.headers),
        body: String(init.body),
      })
      const headers: Record<string, string> = {}
      if (locationHeader) headers.Location = locationHeader
      return new Response('{}', { status: sessionStatus, headers })
    }
    // The file arrives as a stream: read it as it does
    const chunks: Uint8Array[] = []
    const reader = (init.body as ReadableStream<Uint8Array>).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    putBody = new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer())
    return Response.json({ id: 'big-file', size: String(putBody.length) })
  }) as typeof fetch

  const upload = (
    who: string,
    data: Uint8Array | null,
    over: { name?: string; length?: string } = {}
  ) =>
    handleSpikeUpload(
      new Request(
        `https://chordless.test/dev/spike/upload?space=${spaceId}${over.name === '' ? '' : `&name=${over.name ?? 'big.bin'}`}`,
        {
          method: 'POST',
          headers: {
            'X-Id-Token': who,
            ...(data && { 'Content-Length': over.length ?? String(data.length) }),
          },
          body: data ? new Blob([data as BlobPart]) : null,
        }
      ),
      env,
      google,
      driveWithUploads
    )

  beforeEach(async () => {
    forgetSpikeSpaces()
    refreshes = 0
    sessionRequests = []
    putBody = null
    sessionStatus = 200
    locationHeader = 'https://upload.test/session/1'
    const response = await enable([
      { email: 'bea@example.com', role: 'reader' },
      { email: 'cal@example.com', role: 'writer' },
    ])
    spaceId = String((await bodyOf(response)).spaceId)
  })

  test('puts the file in Drive as it arrives, in the folder, with the owner’s token', async () => {
    const data = bytes(3 * 1024 * 1024 + 17)
    const response = await upload('cal@example.com', data)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('X-Spike-Member'), 'cal@example.com (writer)')
    assert.equal((await bodyOf(response)).id, 'big-file')
    assert.deepEqual(putBody, data)

    const [session] = sessionRequests
    assert.match(session?.url ?? '', /uploadType=resumable/)
    assert.match(session?.url ?? '', /supportsAllDrives=true/)
    assert.equal(session?.headers.get('Authorization'), 'Bearer access-1')
    assert.equal(session?.headers.get('X-Upload-Content-Length'), String(data.length))
    assert.match(session?.body ?? '', /"parents":\["team"\]/)
  })

  test('goes through a stream of exactly its length where Workers has one', async () => {
    const lengths: number[] = []
    ;(globalThis as { FixedLengthStream?: unknown }).FixedLengthStream = class extends (
      TransformStream
    ) {
      constructor(length: number) {
        super()
        lengths.push(length)
      }
    }
    try {
      const data = bytes(1000)
      const response = await upload('cal@example.com', data)
      assert.equal(response.status, 200)
      assert.deepEqual(lengths, [1000])
      assert.deepEqual(putBody, data)
    } finally {
      delete (globalThis as { FixedLengthStream?: unknown }).FixedLengthStream
    }
  })

  test('refuses a reader, a stranger and a bad ID token, before Drive is asked', async () => {
    assert.equal((await upload('bea@example.com', bytes(10))).status, 403)
    const stranger = await upload('dan@example.com', bytes(10))
    assert.equal(stranger.status, 403)
    assert.equal(stranger.headers.get('X-Spike-Member'), 'dan@example.com (not a member)')
    assert.equal((await upload('bad', bytes(10))).status, 401)
    assert.equal(sessionRequests.length, 0)
  })

  test('wants the space, the name, and a length it can accept', async () => {
    assert.equal((await upload('cal@example.com', bytes(10), { name: '' })).status, 404)
    assert.equal((await upload('cal@example.com', null)).status, 400)
    assert.equal((await upload('cal@example.com', bytes(10), { length: 'lots' })).status, 400)
    assert.equal((await upload('cal@example.com', bytes(10), { length: '999999999' })).status, 400)
    assert.equal(sessionRequests.length, 0)
  })

  test('refuses a call with no space, and an ID token with no email', async () => {
    const noSpace = await handleSpikeUpload(
      new Request('https://chordless.test/dev/spike/upload?name=x', {
        method: 'POST',
        headers: { 'X-Id-Token': 'cal@example.com', 'Content-Length': '3' },
        body: new Blob(['abc']),
      }),
      env,
      google,
      driveWithUploads
    )
    assert.equal(noSpace.status, 404)
    assert.equal((await upload('no-email', bytes(10))).status, 403)
    assert.equal(sessionRequests.length, 0)
  })

  test('says so when Drive will not start the upload', async () => {
    sessionStatus = 403
    assert.equal((await upload('cal@example.com', bytes(10))).status, 403)
    sessionStatus = 200
    locationHeader = null
    assert.equal((await upload('cal@example.com', bytes(10))).status, 502)
    sessionStatus = 0
    locationHeader = null
  })
})
