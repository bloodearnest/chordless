/**
 * Opening a share leaves one span saying how it went (src/js/share-receiver.ts, docs/OBSERVABILITY.md):
 * the outcome, where the setlist came from (the download, the worker's 304, the copy on the device)
 * and what it cost.
 */
import { expect } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { buildShareBundle } from '../src/js/share-bundle.ts'
import { encryptBundle, generateShareKey } from '../src/js/share-crypto.ts'
import { openShare, SHARED_DB_ID } from '../src/js/share-receiver.ts'
import { makeEntry } from './builders.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const exporter = new InMemorySpanExporter()
const FILE = `file-${crypto.randomUUID()}`
const key = generateShareKey()

beforeEach(() => {
  localStorage.clear()
  setTelemetryPreference(true)
  trace.disable()
  trace.setGlobalTracerProvider(
    new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
  )
  exporter.reset()
})

afterEach(async () => {
  trace.disable()
  localStorage.clear()
  await deleteDatabase(SHARED_DB_ID)
})

const bundle = (expires = '2099-01-01') =>
  buildShareBundle(
    { date: '2026-10-11', time: '10:30', type: 'Church Service', name: '' },
    'Ann Smith',
    [
      {
        entry: makeEntry({ order: 0, songId: 'x', key: 'A' }),
        title: 'Alpha',
        songKey: 'G',
        chordpro: '{title: Alpha}\n{key: G}\n[G]Alpha line',
      },
    ],
    { expires }
  )

const served = async (expires?: string) => {
  const body = await encryptBundle(key, bundle(expires))
  return (async (_url: string, init?: RequestInit) => {
    if (new Headers(init?.headers).get('If-None-Match') === '"e1"') {
      return new Response(null, { status: 304 })
    }
    return new Response(body, {
      headers: { ETag: '"e1"', 'Content-Type': 'application/octet-stream' },
    })
  }) as unknown as typeof fetch
}

const offline = (async () => {
  throw new TypeError('Failed to fetch')
}) as unknown as typeof fetch

const status = (code: number) =>
  (async () => new Response(null, { status: code })) as unknown as typeof fetch

/** Open a share and give the one span it made */
async function opened(hashKey: string, fetchFile: typeof fetch, today = '2026-10-12') {
  exporter.reset()
  const result = await openShare(FILE, hashKey, { fetchFile, today })
  if (result.state === 'ready') result.db.db?.close()
  const spans = exporter.getFinishedSpans().filter(span => span.name === 'chordless.share.open')
  expect(spans).to.have.length(1)
  return spans[0].attributes
}

describe('the span of opening a share', () => {
  it('says a first open downloaded it, with its size and songs', async () => {
    const attributes = await opened(key, await served())
    expect(attributes).to.include({
      'chordless.share.id': FILE,
      'chordless.share.outcome': 'ready',
      'chordless.share.via': 'downloaded',
      'chordless.share.had_copy': false,
      'chordless.share.key_from_link': true,
      'chordless.share.songs': 1,
      'chordless.share.http_status': 200,
    })
    expect(attributes['chordless.share.bytes']).to.be.greaterThan(0)
    expect(attributes).to.have.property('chordless.share.decrypt_ms')
    expect(attributes).to.have.property('chordless.share.open_ms')
  })

  it('says a later open found the worker’s copy unchanged', async () => {
    const fetchFile = await served()
    await opened(key, fetchFile)
    const attributes = await opened('', fetchFile)
    expect(attributes).to.include({
      'chordless.share.outcome': 'ready',
      'chordless.share.via': 'not_modified',
      'chordless.share.had_copy': true,
      'chordless.share.key_from_link': false,
    })
  })

  it('says it was shown from the device when there was no answer', async () => {
    await opened(key, await served())
    expect(await opened('', offline)).to.include({
      'chordless.share.outcome': 'ready',
      'chordless.share.via': 'local_copy',
      'chordless.share.reason': 'offline',
    })
    expect(await opened('', status(502))).to.include({
      'chordless.share.via': 'local_copy',
      'chordless.share.reason': 'server_error',
      'chordless.share.http_status': 502,
    })
  })

  it('says why a share could not be opened', async () => {
    expect(await opened(key, offline)).to.include({
      'chordless.share.outcome': 'unavailable',
      'chordless.share.reason': 'offline',
    })
    expect(await opened('', status(404))).to.include({
      'chordless.share.outcome': 'needs-key',
    })
    expect(await opened(key, status(404))).to.include({
      'chordless.share.outcome': 'ended',
      'chordless.share.http_status': 404,
    })
    expect(await opened(generateShareKey(), await served())).to.include({
      'chordless.share.outcome': 'bad-key',
    })
    expect(await opened(key, await served('2026-10-01'))).to.include({
      'chordless.share.outcome': 'ended',
      'chordless.share.expired': true,
    })
  })

  it('says so when the open threw, and still throws', async () => {
    const broken = (async () => ({
      status: 200,
      ok: true,
      headers: {
        get: () => {
          throw new Error('boom')
        },
      },
    })) as unknown as typeof fetch
    exporter.reset()
    let thrown: unknown
    try {
      await openShare(FILE, key, { fetchFile: broken, today: '2026-10-12' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).to.be.instanceOf(Error)
    const [span] = exporter.getFinishedSpans().filter(({ name }) => name === 'chordless.share.open')
    expect(span.attributes['chordless.share.outcome']).to.equal('error')
  })
})
