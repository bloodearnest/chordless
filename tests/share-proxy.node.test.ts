/**
 * The worker's share link download (worker/src/share.ts): what it asks Drive for, what it
 * answers, and that it never says "ended" about a share unless Drive does.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleShareDownload, type ShareCache, shareFileId } from '../worker/src/share.ts'

const ID = '1gaujHBXmLfJDPtBn5plrCrTukHnkIB8Y'
const env = { GOOGLE_API_KEY: 'test-key' }
const ciphertext: Uint8Array<ArrayBuffer> = new Uint8Array([1, 2, 3, 4, 5])

function memoryCache(): ShareCache & { size: number } {
  const entries = new Map<string, Response>()
  return {
    get size() {
      return entries.size
    },
    async match(request) {
      return entries.get(request.url)?.clone()
    },
    async put(request, response) {
      entries.set(request.url, response)
    },
  }
}

/** A stand-in for Drive that records the URLs it was asked for */
function fakeDrive(respond: () => Response | Promise<Response>) {
  const urls: string[] = []
  const fetchDrive = (async (input: string) => {
    urls.push(String(input))
    return respond()
  }) as unknown as typeof fetch
  return { urls, fetchDrive }
}

const get = (headers: Record<string, string> = {}, method = 'GET') =>
  new Request(`https://chordless.app/api/share/${ID}`, { method, headers })

test('shareFileId: reads the id from the path, and nothing else', () => {
  assert.equal(shareFileId(`/api/share/${ID}`), ID)
  assert.equal(shareFileId('/api/share/'), null)
  assert.equal(shareFileId(`/api/share/${ID}/more`), null)
  assert.equal(shareFileId('/api/other'), null)
})

test('relays the ciphertext, fetched from Drive with the key', async () => {
  const drive = fakeDrive(() => new Response(ciphertext))
  const res = await handleShareDownload(get(), ID, env, { fetchDrive: drive.fetchDrive })
  assert.equal(res.status, 200)
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), ciphertext)
  assert.equal(res.headers.get('Content-Type'), 'application/octet-stream')
  assert.ok(res.headers.get('ETag'))
  assert.equal(
    drive.urls[0],
    `https://www.googleapis.com/drive/v3/files/${ID}?alt=media&supportsAllDrives=true&key=test-key`
  )
})

test('the ETag follows the content, and a matching If-None-Match gets a 304', async () => {
  const etagFor = async (bytes: Uint8Array<ArrayBuffer>) => {
    const drive = fakeDrive(() => new Response(bytes))
    const res = await handleShareDownload(get(), ID, env, { fetchDrive: drive.fetchDrive })
    return res.headers.get('ETag') as string
  }
  const etag = await etagFor(ciphertext)
  assert.equal(await etagFor(ciphertext), etag)
  assert.notEqual(await etagFor(new Uint8Array([9, 9, 9])), etag)

  const drive = fakeDrive(() => new Response(ciphertext))
  const res = await handleShareDownload(get({ 'If-None-Match': etag }), ID, env, {
    fetchDrive: drive.fetchDrive,
  })
  assert.equal(res.status, 304)
  assert.equal(res.headers.get('ETag'), etag)
  assert.equal((await res.arrayBuffer()).byteLength, 0)
})

test('a share Drive says is not there is 404 "ended"', async () => {
  const drive = fakeDrive(() => new Response('{}', { status: 404 }))
  const res = await handleShareDownload(get(), ID, env, { fetchDrive: drive.fetchDrive })
  assert.equal(res.status, 404)
})

test('anything else from Drive is a 502, never "ended"', async () => {
  for (const status of [403, 429, 500, 503]) {
    const drive = fakeDrive(() => new Response('Sorry...', { status }))
    const res = await handleShareDownload(get(), ID, env, { fetchDrive: drive.fetchDrive })
    assert.equal(res.status, 502, `Drive ${status}`)
  }
  const unreachable = (async () => {
    throw new TypeError('network')
  }) as unknown as typeof fetch
  const res = await handleShareDownload(get(), ID, env, { fetchDrive: unreachable })
  assert.equal(res.status, 502)
})

test('the cache answers repeat requests without asking Drive again', async () => {
  const cache = memoryCache()
  const drive = fakeDrive(() => new Response(ciphertext))
  const deps = { fetchDrive: drive.fetchDrive, cache }
  const first = await handleShareDownload(get(), ID, env, deps)
  const second = await handleShareDownload(get(), ID, env, deps)
  assert.equal(drive.urls.length, 1)
  assert.equal(second.headers.get('ETag'), first.headers.get('ETag'))
  assert.deepEqual(new Uint8Array(await second.arrayBuffer()), ciphertext)
})

test('the cache is short-lived, so updates and revocations reach people', async () => {
  const cache = memoryCache()
  const drive = fakeDrive(() => new Response(ciphertext))
  await handleShareDownload(get(), ID, env, { fetchDrive: drive.fetchDrive, cache })
  const cached = await cache.match(new Request(`https://chordless.app/api/share/${ID}`))
  assert.equal(cached?.headers.get('Cache-Control'), 'public, max-age=60')
})

test('?fresh=1 skips an answer older than a few seconds, and Drive is asked once for all who ask', async () => {
  const cache = memoryCache()
  let clock = 1_000_000
  const drive = fakeDrive(() => new Response(ciphertext))
  const deps = { fetchDrive: drive.fetchDrive, cache, now: () => clock }
  const fresh = () =>
    handleShareDownload(new Request(`https://chordless.app/api/share/${ID}?fresh=1`), ID, env, deps)

  await handleShareDownload(get(), ID, env, deps)
  clock += 500
  await fresh()
  assert.equal(drive.urls.length, 1, 'half a second old: it will do')

  clock += 1500
  await fresh()
  await fresh()
  await fresh()
  assert.equal(
    drive.urls.length,
    2,
    'two seconds: Drive is asked, once, and the answer kept for the rest'
  )

  clock += 10_000
  await handleShareDownload(get(), ID, env, deps)
  assert.equal(drive.urls.length, 2, 'an ordinary request still takes what is there')
})

test('?fresh=1 is the same answer: only how old it may be is different', async () => {
  const cache = memoryCache()
  const drive = fakeDrive(() => new Response(ciphertext))
  const deps = { fetchDrive: drive.fetchDrive, cache, now: () => 1 }
  const plain = await handleShareDownload(get(), ID, env, deps)
  const fresh = await handleShareDownload(
    new Request(`https://chordless.app/api/share/${ID}?fresh=1`),
    ID,
    env,
    deps
  )
  assert.equal(fresh.headers.get('ETag'), plain.headers.get('ETag'))
  assert.equal(fresh.headers.get('X-Cached-At'), null, 'the cache’s note is not given out')
  assert.equal(drive.urls.length, 1)
})

test('"ended" is cached briefly too; errors are not cached', async () => {
  const cache = memoryCache()
  const gone = fakeDrive(() => new Response('{}', { status: 404 }))
  await handleShareDownload(get(), ID, env, { fetchDrive: gone.fetchDrive, cache })
  await handleShareDownload(get(), ID, env, { fetchDrive: gone.fetchDrive, cache })
  assert.equal(gone.urls.length, 1)

  const errorCache = memoryCache()
  const broken = fakeDrive(() => new Response('Sorry...', { status: 429 }))
  await handleShareDownload(get(), ID, env, { fetchDrive: broken.fetchDrive, cache: errorCache })
  assert.equal(errorCache.size, 0)
})

test('refuses what is not a share: bad ids, big files, other methods, no key', async () => {
  const drive = fakeDrive(() => new Response(ciphertext))
  const deps = { fetchDrive: drive.fetchDrive }

  for (const bad of ['short', 'has/slash-in-it-xx', '../../etc/passwd', 'x'.repeat(200)]) {
    const res = await handleShareDownload(get(), bad, env, deps)
    assert.equal(res.status, 404, bad)
  }
  assert.equal(drive.urls.length, 0, 'bad ids never reach Drive')

  const post = await handleShareDownload(get({}, 'POST'), ID, env, deps)
  assert.equal(post.status, 405)

  const noKey = await handleShareDownload(get(), ID, {}, deps)
  assert.equal(noKey.status, 503)

  const big = fakeDrive(() => new Response(new Uint8Array(1024 * 1024 + 1)))
  const tooBig = await handleShareDownload(get(), ID, env, { fetchDrive: big.fetchDrive })
  assert.equal(tooBig.status, 502)
})

test('refuses a file that says it is too big before reading it', async () => {
  let read = false
  const body = new ReadableStream(
    {
      pull(controller) {
        read = true
        controller.close()
      },
    },
    { highWaterMark: 0 }
  )
  const drive = fakeDrive(
    () => new Response(body, { headers: { 'Content-Length': String(1024 * 1024 + 1) } })
  )
  const res = await handleShareDownload(get(), ID, env, { fetchDrive: drive.fetchDrive })
  assert.equal(res.status, 502)
  assert.equal(read, false)
})

test('hands the caching to waitUntil when the runtime gives one, and does not wait for it', async () => {
  const cache = memoryCache()
  const pending: Promise<unknown>[] = []
  const drive = fakeDrive(() => new Response(ciphertext))
  const res = await handleShareDownload(get(), ID, env, {
    fetchDrive: drive.fetchDrive,
    cache,
    waitUntil: promise => pending.push(promise),
  })
  assert.equal(res.status, 200)
  assert.equal(pending.length, 1)
  await Promise.all(pending)
  assert.equal(cache.size, 1)
})

test('a HEAD gets the headers and no body', async () => {
  const drive = fakeDrive(() => new Response(ciphertext))
  const res = await handleShareDownload(get({}, 'HEAD'), ID, env, { fetchDrive: drive.fetchDrive })
  assert.equal(res.status, 200)
  assert.ok(res.headers.get('ETag'))
  assert.equal((await res.arrayBuffer()).byteLength, 0)
})

test('an answer in the cache with no content type is given as plain text', async () => {
  const cache = memoryCache()
  await cache.put(
    new Request(`https://chordless.app/api/share/${ID}`),
    new Response('old', { headers: { 'Content-Type': '' } })
  )
  const cached = await cache.match(new Request(`https://chordless.app/api/share/${ID}`))
  cached?.headers.delete('Content-Type')
  const bare: ShareCache = { match: async () => cached, put: async () => {} }
  const res = await handleShareDownload(get(), ID, env, { cache: bare })
  assert.equal(res.headers.get('Content-Type'), 'text/plain')
})
