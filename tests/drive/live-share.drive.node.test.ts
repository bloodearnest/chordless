/**
 * Live sync of a share, through the real things (docs/LIVE_SYNC.md, docs/DRIVE_TESTS.md): a share
 * file in the test account's real Drive, the real Worker (in workerd, through the wrangler test
 * harness) and real WebSockets. A sharer uploads a new version, tells the room, and a recipient who
 * has no account is told, fetches the share as the app does and finds the new version. It prints how
 * long that took, which is what live sync's design could only estimate.
 *
 * `just test-live-share`. Not part of `just test` or CI: it needs the test account's credentials
 * (.drive-test.env) and the dev project's Drive key (.dev.vars), and calls Google.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createTestHarness } from 'wrangler'
import { createDriveApi } from '../../src/js/drive-client.ts'
import { fileInput, shareFileMetadata, updateInput } from '../../src/js/drive-metadata.ts'
import { CHANGED, FOLLOW_UPS_MS } from '../../src/js/live-protocol.ts'
import { buildShareBundle } from '../../src/js/share-bundle.ts'
import {
  decryptBundle,
  encryptBundle,
  generateLiveSecret,
  generateShareKey,
} from '../../src/js/share-crypto.ts'
import { createDriveStorage } from '../../src/js/storage/drive-storage.ts'
import type { SpaceStorage } from '../../src/js/storage/types.ts'
import { accessTokens, credentialsFromEnv } from './node-side.ts'

const found = credentialsFromEnv(process.env)
const apiKey = process.env.GOOGLE_API_KEY
const missing = [
  ...('missing' in found ? found.missing : []),
  ...(apiKey ? [] : ['GOOGLE_API_KEY']),
]
const skip = missing.length > 0 && `needs ${missing.join(', ')} (see docs/DRIVE_TESTS.md)`

const secrets = {
  // (the Drive key is the dev project's real one; the rest only has to be shaped as the real ones are)
  GOOGLE_CLIENT_ID: '123456789-testclient.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-test-client-secret',
  GOOGLE_API_KEY: apiKey ?? `AIza${'x'.repeat(35)}`,
  JWE_ENCRYPTION_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
}
const worker = createTestHarness({ workers: [{ configPath: 'wrangler.toml', secrets }] })

/** A socket as the harness gives it */
type Socket = WebSocket & { accept(): void }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('live sync of a share, against a real Drive and the real Worker', { skip }, () => {
  let space: SpaceStorage
  let trashFolder: () => Promise<void>
  const key = generateShareKey()
  const secret = generateLiveSecret()
  let fileId = ''

  const bundleNamed = (name: string) =>
    buildShareBundle(
      { date: '2099-01-01', time: '10:30', type: 'Church Service', name, owner: 'Live Test' },
      [],
      { expires: '2099-01-02', setlistId: 'live-share-test' }
    )

  /** The share as a recipient fetches it from the Worker: its setlist's name, and how long it took */
  async function fetchShare(fresh: boolean) {
    const started = performance.now()
    const response = await worker.fetch(`/api/share/${fileId}${fresh ? '?fresh=1' : ''}`)
    if (!response.ok) return { status: response.status, ms: performance.now() - started }
    const bundle = await decryptBundle(key, new Uint8Array(await response.arrayBuffer()))
    return { status: 200, name: bundle.setlist.name, ms: performance.now() - started }
  }

  /** A device joining the share's room, as a page does: `chordless` and, for the sharer, the secret */
  async function join(proof?: string) {
    const answer = (await worker.fetch(`/api/share/${fileId}/live`, {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': proof ? `chordless, ${proof}` : 'chordless',
      },
    })) as Response & { webSocket: Socket | null }
    assert.equal(answer.status, 101, `joining the room answered ${answer.status}`)
    const socket = answer.webSocket
    assert.ok(socket)
    socket.accept()
    const heard: number[] = []
    socket.addEventListener('message', event => {
      if (String(event.data) === CHANGED) heard.push(performance.now())
    })
    const closed: number[] = []
    socket.addEventListener('close', event => closed.push(event.code))
    return { socket, heard, closed }
  }

  before(async () => {
    if (skip || 'missing' in found) return
    await worker.listen()
    const api = createDriveApi({
      getAccessToken: accessTokens(found.credentials, { cachePath: '.drive-test/token.json' }),
    })
    const storage = createDriveStorage(api)
    const name = `chordless-drive-test live-share ${crypto.randomUUID().slice(0, 8)}`
    const root = (await storage.ensureRoot(name, crypto.randomUUID())).ref
    space = storage.space(root)
    trashFolder = () => api.trashFile(root)

    // The sharer makes the share, as createShare does: a public, encrypted file
    const metadata = shareFileMetadata(
      { id: 'live-share-test' },
      { spaceId: null, expires: '2099-01-02' }
    )
    const { file } = await space.create(
      'shares',
      fileInput(metadata),
      await encryptBundle(key, bundleNamed('version 1')),
      { publicLink: true }
    )
    fileId = file.ref
  })

  after(async () => {
    if (skip) return
    // (the public link goes first: a file in the bin can still be read by anyone who has the link)
    if (fileId) await space.unpublish(fileId).catch(() => {})
    await trashFolder?.().catch(() => {})
    await worker.close()
  })

  test('a recipient is told of an update, fetches it, and finds it', {
    timeout: 120_000,
  }, async t => {
    // The first version reaches a recipient who has just opened the link
    let first = await fetchShare(false)
    for (let i = 0; first.status !== 200 && i < 10; i++) {
      await sleep(1000)
      first = await fetchShare(false)
    }
    assert.equal(first.name, 'version 1', 'a new share can be downloaded through the Worker')

    const sharer = await join(secret)
    const recipient = await join()
    const another = await join()

    // The sharer updates the share, and when that is done says so: the order the app keeps
    const metadata = shareFileMetadata(
      { id: 'live-share-test' },
      { spaceId: null, expires: '2099-01-02' }
    )
    await space.update(
      fileId,
      updateInput(metadata, 'share'),
      await encryptBundle(key, bundleNamed('version 2'))
    )
    const uploaded = performance.now()
    sharer.socket.send(CHANGED)

    // Told: the recipients, and not the sharer
    for (let i = 0; recipient.heard.length === 0 && i < 50; i++) await sleep(100)
    assert.equal(recipient.heard.length, 1, 'the recipient was told')
    assert.equal(another.heard.length, 1, 'so was everyone else listening')
    assert.equal(sharer.heard.length, 0, 'the sharer was not told its own word')
    const told = recipient.heard[0] - uploaded

    // ...and does what the app does (live-sync.ts): fetch at once, and again after each of the follow-ups
    let seenAfter: number | null = null
    let seenBy = ''
    for (const after of [0, ...FOLLOW_UPS_MS]) {
      await sleep(Math.max(0, recipient.heard[0] + after - performance.now()))
      if ((await fetchShare(true)).name === 'version 2') {
        seenAfter = performance.now() - uploaded
        seenBy = after === 0 ? 'the fetch at once' : `the fetch ${after} ms after being told`
        break
      }
    }
    t.diagnostic(
      `told ${Math.round(told)} ms after the sharer said it; the update ${
        seenAfter === null
          ? `was not there by the last fetch, ${FOLLOW_UPS_MS.at(-1)} ms after being told`
          : `was found by ${seenBy}, ${Math.round(seenAfter)} ms after the upload finished`
      }`
    )
    assert.notEqual(seenAfter, null, 'the app finds the new version by its last fetch')

    // Nobody who listens may send
    recipient.socket.send(CHANGED)
    for (let i = 0; recipient.closed.length === 0 && i < 30; i++) await sleep(100)
    assert.deepEqual(recipient.closed, [1008])
  })

  test('another secret cannot send for the sharer', async () => {
    const squatter = await worker.fetch(`/api/share/${fileId}/live`, {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': `chordless, ${generateLiveSecret()}`,
      },
    })
    assert.equal(squatter.status, 403)
  })
})
