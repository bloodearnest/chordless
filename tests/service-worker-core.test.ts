/**
 * The service worker's behaviour (js/service-worker-core.ts), run in a page with a fake worker
 * scope, a fake fetch, and the page's own Cache API under names of the test's own. The real
 * worker, installed in a browser, is in service-worker.playwright.ts.
 */
import { expect } from '@open-wc/testing'
import * as AuthDB from '../src/js/auth-db.ts'
import {
  startServiceWorker,
  type WorkerConfig,
  type WorkerScope,
} from '../src/js/service-worker-core.ts'
import { SHARED_CACHE_NAME, takeShared } from '../src/js/shared-incoming.ts'
import { deleteDatabase, installFakeTimers, suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

// Waits in real time, for while the test's fake timers are installed
const realSetTimeout = window.setTimeout.bind(window)
const realWait = (ms: number) => new Promise<void>(resolve => realSetTimeout(resolve, ms))

/** The page's CacheStorage with every name given a prefix of the test's own, so nothing else is touched */
function isolated(
  real: CacheStorage,
  prefix: string
): CacheStorage & { names(): Promise<string[]> } {
  const mine = async () => (await real.keys()).filter(name => name.startsWith(prefix))
  return {
    open: name => real.open(prefix + name),
    delete: name => real.delete(prefix + name),
    has: name => real.has(prefix + name),
    keys: async () => (await mine()).map(name => name.slice(prefix.length)),
    names: async () => (await mine()).map(name => name.slice(prefix.length)),
    async match(request, options) {
      for (const name of await mine()) {
        const found = await (await real.open(name)).match(request, options)
        if (found) return found
      }
      return undefined
    },
  } as CacheStorage & { names(): Promise<string[]> }
}

type Listener = (event: never) => void

/** A worker scope that keeps its listeners for the test to call */
function fakeScope() {
  const listeners: Record<string, Listener> = {}
  const log: string[] = []
  const clients: Array<{ postMessage(message: unknown, transfer: Transferable[]): void }> = []
  const scope = {
    registration: { active: null as unknown },
    location: { origin: 'https://app.test' },
    clients: {
      claim: async () => {
        log.push('claim')
      },
      matchAll: async () => clients,
    },
    skipWaiting: async () => {
      log.push('skipWaiting')
    },
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener
    },
  } satisfies Record<string, unknown> as unknown as WorkerScope
  return { scope, listeners, log, clients }
}

describe('the service worker', () => {
  let prefix: string
  let caches: ReturnType<typeof isolated>
  let scope: ReturnType<typeof fakeScope>
  let fetched: string[]
  let fetchImpl: (request: Request | string, init?: RequestInit) => Promise<Response>

  const config = (overrides: Partial<WorkerConfig> = {}): WorkerConfig => ({
    precache: [],
    cacheVersion: 'v1',
    releasedAt: '2026-10-01',
    ...overrides,
  })

  function start(overrides: Partial<WorkerConfig> = {}) {
    startServiceWorker(
      scope.scope,
      caches,
      (async (input: Request | string, init?: RequestInit) => {
        fetched.push(typeof input === 'string' ? input : new URL(input.url).pathname)
        return fetchImpl(input, init)
      }) as typeof fetch,
      config(overrides)
    )
  }

  beforeEach(async () => {
    prefix = `sw-test-${crypto.randomUUID()}-`
    caches = isolated(window.caches, prefix)
    scope = fakeScope()
    fetched = []
    fetchImpl = async () => new Response('from the network')
  })

  afterEach(async () => {
    for (const name of await caches.names()) await caches.delete(name)
    await deleteDatabase('auth')
  })

  /** Send the worker a fetch event; the response it gave, or null if it left the request alone */
  async function fetchEvent(
    url: string,
    init: RequestInit & { mode?: string } = {}
  ): Promise<Response | null> {
    const full = new URL(url, 'https://app.test').href
    const request =
      init.mode === 'navigate'
        ? ({ url: full, method: 'GET', mode: 'navigate', headers: new Headers() } as Request)
        : new Request(full, init)
    let given: Response | Promise<Response> | null = null
    scope.listeners.fetch({
      request,
      respondWith: (r: Response | Promise<Response>) => (given = r),
    } as never)
    return given
  }

  const textOf = async (response: Response | null) => (await response?.text()) ?? null

  /** Wait for something that happens after the response, such as a cache write */
  async function until(condition: () => Promise<boolean>) {
    for (let i = 0; i < 100; i++) {
      if (await condition()) return
      await wait(10)
    }
    throw new Error('Timed out waiting')
  }

  describe('installing and activating', () => {
    it('precaches its files, and takes over at once the first time', async () => {
      start({ precache: ['/package.json'] })
      let waited: Promise<unknown> = Promise.resolve()
      scope.listeners.install({ waitUntil: (p: Promise<unknown>) => (waited = p) } as never)
      await waited
      expect(await (await caches.open('cache-v1')).match('/package.json')).to.not.equal(undefined)
      expect(scope.log).to.deep.equal(['skipWaiting'])
    })

    it('waits for the page to ask when it replaces a worker that is active', async () => {
      scope.scope.registration.active = {}
      start()
      scope.listeners.install({ waitUntil: () => {} } as never)
      expect(scope.log).to.deep.equal([])
    })

    it('removes the caches of other versions when it activates, and keeps its own', async () => {
      for (const name of [
        'cache-v1',
        'cache-old',
        'padsets-cache-v1',
        'runtime-v1',
        SHARED_CACHE_NAME,
        'stray',
      ]) {
        await caches.open(name)
      }
      start()
      let waited: Promise<unknown> = Promise.resolve()
      scope.listeners.activate({ waitUntil: (p: Promise<unknown>) => (waited = p) } as never)
      await waited
      expect((await caches.names()).sort()).to.deep.equal(
        ['cache-v1', 'padsets-cache-v1', 'runtime-v1', SHARED_CACHE_NAME].sort()
      )
      expect(scope.log).to.deep.equal(['claim'])
    })
  })

  describe('messages', () => {
    /** Send a message with a port, and the reply on it (null if it never replies) */
    function send(message: unknown, withPort = true): Promise<Record<string, unknown> | null> {
      const channel = new MessageChannel()
      const reply = new Promise<Record<string, unknown> | null>(resolve => {
        channel.port1.onmessage = event => resolve(event.data)
        setTimeout(() => resolve(null), 150)
      })
      scope.listeners.message({ data: message, ports: withPort ? [channel.port2] : [] } as never)
      return reply
    }

    beforeEach(() => start())

    it('says which version it is', async () => {
      expect(await send({ type: 'GET_VERSION', messageId: 'm1' })).to.deep.equal({
        messageId: 'm1',
        success: true,
        version: 'v1',
        released: '2026-10-01',
      })
    })

    it('skips waiting when asked', async () => {
      await send({ type: 'SKIP_WAITING' })
      expect(scope.log).to.deep.equal(['skipWaiting'])
    })

    it('keeps, gives back, exports, imports and deletes the blob', async () => {
      expect(
        (await send({ type: 'STORE_BLOB', data: { blob: 'b', metadata: { id_token: 't' } } }))
          ?.success
      ).to.equal(true)
      const got = await send({ type: 'GET_BLOB' })
      expect((got?.data as AuthDB.StoredBlob | undefined)?.blob).to.equal('b')
      const exported = await send({ type: 'EXPORT_BLOB' })
      const backup = exported?.backup as AuthDB.BlobBackup
      expect(backup.blob).to.equal('b')
      expect((await send({ type: 'DELETE_BLOB' }))?.success).to.equal(true)
      expect((await send({ type: 'GET_BLOB' }))?.data).to.equal(undefined)
      expect((await send({ type: 'IMPORT_BLOB', data: { backup } }))?.success).to.equal(true)
      expect((await AuthDB.getBlob())?.blob).to.equal('b')
    })

    it('answers a message that fails with its error', async () => {
      const reply = await send({ type: 'IMPORT_BLOB', data: { backup: { version: 9 } } })
      expect(reply).to.include({ success: false, error: 'Invalid backup format' })
      const noData = await send({ type: 'STORE_BLOB' })
      expect(noData?.success).to.equal(false)
    })

    it('answers nothing to a message without a port, or of a kind it does not know', async () => {
      expect(await send({ type: 'GET_VERSION' }, false)).to.equal(null)
      expect(await send({ type: 'NO_SUCH_THING', messageId: 'x' })).to.equal(null)
      expect(await send(null)).to.equal(null)
    })

    it('lists the pending operations', async () => {
      await AuthDB.queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
      const reply = await send({ type: 'GET_PENDING_OPERATIONS' })
      expect(reply?.operations).to.have.length(1)
    })

    describe('the operation queue', () => {
      let calls: Array<{ path: string; body: Record<string, string> }>
      let token: string | null

      beforeEach(async () => {
        calls = []
        token = 'id-token'
        await AuthDB.storeBlob('blob')
        scope.clients.push({
          postMessage: (message, transfer) => {
            expect(message).to.deep.equal({ type: 'REQUEST_ID_TOKEN' })
            ;(transfer[0] as MessagePort).postMessage({ idToken: token })
          },
        })
        fetchImpl = async (path, init) => {
          calls.push({ path: String(path), body: JSON.parse(String(init?.body)) })
          return Response.json({ ok: true })
        }
      })

      /** Operations as they stand once the worker has processed the queue */
      async function allOperations() {
        const db = await AuthDB.initAuthDB()
        const all = await new Promise<AuthDB.QueuedOperation[]>(resolve => {
          const request = db.transaction('operation-queue').objectStore('operation-queue').getAll()
          request.onsuccess = () => resolve(request.result)
        })
        db.close()
        return all
      }
      const settled = async () => (await AuthDB.getPendingOperations()).length === 0

      it('sends a queued invite and a queued revoke to the Worker, and marks them done', async () => {
        const invite = await send({
          type: 'QUEUE_INVITE',
          data: { file_id: 'f1', email: 'a@example.com' },
        })
        const revoke = await send({
          type: 'QUEUE_REVOKE',
          data: { file_id: 'f2', permission_id: 'p' },
        })
        expect(invite?.operationId).to.be.a('number')
        expect(revoke?.operationId).to.be.a('number')
        // (each queued operation starts a run, and two runs may both take the same one)
        await until(async () => calls.length >= 2 && (await settled()))
        expect([...new Set(calls.map(call => call.path))].sort()).to.deep.equal([
          '/session/invite',
          '/session/revoke',
        ])
        const inviteCall = calls.find(call => call.path === '/session/invite')
        expect(inviteCall?.body).to.deep.equal({
          blob: 'blob',
          id_token: 'id-token',
          file_id: 'f1',
          email: 'a@example.com',
        })
        await until(async () => (await allOperations()).every(op => op.status === 'completed'))
      })

      it('processes the queue when asked, and when the device is back online', async () => {
        await AuthDB.queueOperation({ type: 'revoke', file_id: 'f', permission_id: 'p' })
        expect((await send({ type: 'PROCESS_QUEUE' }))?.success).to.equal(true)
        await until(async () => calls.length === 1 && (await settled()))
        await AuthDB.queueOperation({ type: 'revoke', file_id: 'g', permission_id: 'p' })
        scope.listeners.online(undefined as never)
        await until(async () => calls.length === 2 && (await settled()))
      })

      async function failedWith(message: string) {
        await until(async () => (await settled()) && (await allOperations()).length > 0)
        const [op] = await allOperations()
        expect(op.status).to.equal('failed')
        expect(op.last_error).to.equal(message)
        expect(op.retry_count).to.equal(1)
      }

      it('fails an operation when there is no blob', async () => {
        await AuthDB.deleteBlob()
        await AuthDB.queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
        await send({ type: 'PROCESS_QUEUE' })
        await failedWith('No auth blob found - user needs to re-authenticate')
      })

      it('fails an operation when no page is open to give an ID token', async () => {
        scope.clients.length = 0
        await AuthDB.queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
        await send({ type: 'PROCESS_QUEUE' })
        await failedWith('No ID token available - user needs to refresh session')
      })

      it('fails an operation when the page gives no ID token', async () => {
        token = null
        await AuthDB.queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
        await send({ type: 'PROCESS_QUEUE' })
        await failedWith('No ID token available - user needs to refresh session')
      })

      it('fails an operation when the page does not answer in time', async () => {
        const clock = installFakeTimers()
        try {
          scope.clients.length = 0
          scope.clients.push({ postMessage: () => {} })
          await AuthDB.queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
          scope.listeners.online(undefined as never)
          // (the queue reads the database, in real time, before it asks the page)
          await realWait(100)
          await clock.tick(5000)
        } finally {
          clock.uninstall()
        }
        await failedWith('No ID token available - user needs to refresh session')
      })

      it('fails an operation the Worker refuses, with its reason, or a general one', async () => {
        fetchImpl = async () => Response.json({ error: 'Not yours' }, { status: 403 })
        await AuthDB.queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
        await AuthDB.queueOperation({ type: 'revoke', file_id: 'f', permission_id: 'p' })
        await send({ type: 'PROCESS_QUEUE' })
        await until(async () => (await settled()) && (await allOperations()).length === 2)
        expect((await allOperations()).map(op => op.last_error)).to.deep.equal([
          'Not yours',
          'Not yours',
        ])

        fetchImpl = async () => Response.json({}, { status: 500 })
        await AuthDB.queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
        await AuthDB.queueOperation({ type: 'revoke', file_id: 'f', permission_id: 'p' })
        await send({ type: 'PROCESS_QUEUE' })
        await until(async () => (await settled()) && (await allOperations()).length === 4)
        expect((await allOperations()).map(op => op.last_error).slice(2)).to.deep.equal([
          'Invite failed',
          'Revoke failed',
        ])
      })

      it('gives up on an operation that has failed three times', async () => {
        await AuthDB.queueOperation({ type: 'invite', file_id: 'f', email: 'a@example.com' })
        const db = await AuthDB.initAuthDB()
        await new Promise<void>(resolve => {
          const tx = db.transaction('operation-queue', 'readwrite')
          const store = tx.objectStore('operation-queue')
          store.getAll().onsuccess = event => {
            for (const op of (event.target as IDBRequest).result)
              store.put({ ...op, retry_count: 3 })
          }
          tx.oncomplete = () => resolve()
        })
        db.close()
        await send({ type: 'PROCESS_QUEUE' })
        await failedWith('Exceeded retry limit').catch(async () => {
          const [op] = await allOperations()
          expect(op.last_error).to.equal('Exceeded retry limit')
        })
        expect(calls).to.deep.equal([])
      })

      it('fails an operation of a kind it does not know', async () => {
        const db = await AuthDB.initAuthDB()
        await new Promise<void>(resolve => {
          const tx = db.transaction('operation-queue', 'readwrite')
          tx.objectStore('operation-queue').add({
            type: 'bogus',
            status: 'pending',
            retry_count: 0,
            timestamp: '',
          })
          tx.oncomplete = () => resolve()
        })
        db.close()
        await send({ type: 'PROCESS_QUEUE' })
        await failedWith('Unknown operation type: bogus')
      })

      it('carries on when the queue cannot be read', async () => {
        await deleteDatabase('auth')
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('auth', 5)
          request.onsuccess = () => {
            request.result.close()
            resolve()
          }
          request.onerror = () => reject(request.error)
        })
        const reply = await send({ type: 'PROCESS_QUEUE' })
        expect(reply?.success).to.equal(true)
        await wait(50)
      })
    })
  })

  describe('requests', () => {
    it('leaves alone what is not the app: Google sign-in, other sites, the dev pages', async () => {
      start()
      for (const url of [
        'https://accounts.google.com/gsi/client',
        'https://elsewhere.test/x.js',
        '/dev',
        '/dev/page',
      ]) {
        expect(await fetchEvent(url), url).to.equal(null)
      }
      expect(fetched).to.deep.equal([])
    })

    it('redirects what is shared to the app to the import page, keeping it', async () => {
      start()
      const form = new FormData()
      form.append('files', new File(['{title: Shared}'], 'shared.cho', { type: 'text/plain' }))
      form.append('text', 'some words')
      const response = await fetchEvent('/share-target', { method: 'POST', body: form })
      const done = await response
      expect(done?.status).to.equal(303)
      expect(done?.headers.get('Location')).to.equal('https://app.test/import-song')
      const shared = await takeShared(caches)
      expect(shared?.text).to.equal('some words')
      expect(shared?.files.map(file => file.name)).to.deep.equal(['shared.cho'])
    })

    it('still redirects when what was shared cannot be read, or when it is only a visit', async () => {
      start()
      const broken = await await fetchEvent('/share-target', { method: 'POST', body: 'not a form' })
      expect(broken?.status).to.equal(303)
      const visit = await await fetchEvent('/share-target')
      expect(visit?.status).to.equal(303)
      expect(await takeShared(caches)).to.equal(null)
    })

    it('sends the Worker its own requests to the network', async () => {
      start()
      for (const url of ['/api/songs', '/oauth/callback', '/session/refresh']) {
        expect(await textOf(await fetchEvent(url))).to.equal('from the network')
      }
      expect(fetched).to.deep.equal(['/api/songs', '/oauth/callback', '/session/refresh'])
    })

    it('serves the precached files from the cache, or the network when one is missing', async () => {
      start({ precache: ['/assets/app.js', '/assets/other.js', '/'] })
      await (await caches.open('cache-v1')).put('/assets/app.js', new Response('cached app'))
      expect(await textOf(await fetchEvent('/assets/app.js'))).to.equal('cached app')
      expect(fetched).to.deep.equal([])
      expect(await textOf(await fetchEvent('/assets/other.js'))).to.equal('from the network')
    })

    describe('scripts and styles (network first)', () => {
      it('serves them from the network and keeps a copy', async () => {
        start()
        expect(await textOf(await fetchEvent('/js/a.js'))).to.equal('from the network')
        await until(async () => (await (await caches.open('cache-v1')).keys()).length === 1)
      })

      it('does not keep a failure', async () => {
        start()
        fetchImpl = async () => new Response('nope', { status: 500 })
        expect((await fetchEvent('/css/a.css'))?.status).to.equal(500)
        await wait(30)
        expect((await (await caches.open('cache-v1')).keys()).length).to.equal(0)
      })

      it('serves the copy it has when the network is down, or fails if it has none', async () => {
        start()
        await (await caches.open('cache-v1')).put(
          new Request('https://app.test/js/a.js'),
          new Response('old copy')
        )
        fetchImpl = async () => {
          throw new TypeError('offline')
        }
        expect(await textOf(await fetchEvent('/js/a.js'))).to.equal('old copy')
        expect((await fetchEvent('/js/missing.js'))?.type).to.equal('error')
      })
    })

    it('passes html files through', async () => {
      start()
      expect(await textOf(await fetchEvent('/page.html'))).to.equal('from the network')
    })

    describe('pages', () => {
      it('serves the app shell for every page, and keeps it when there is no precache', async () => {
        start()
        fetchImpl = async () => new Response('the shell')
        expect(await textOf(await fetchEvent('/setlist/1', { mode: 'navigate' }))).to.equal(
          'the shell'
        )
        expect(fetched).to.deep.equal(['/'])
        await until(async () => (await (await caches.open('cache-v1')).match('/')) !== undefined)
      })

      it('also serves it to a request that accepts html', async () => {
        start()
        const response = await fetchEvent('/somewhere', { headers: { Accept: 'text/html,*/*' } })
        expect(await textOf(response)).to.equal('from the network')
        expect(fetched).to.deep.equal(['/'])
      })

      it('does not replace the cached shell of a precached version', async () => {
        start({ precache: ['/'] })
        await textOf(await fetchEvent('/', { mode: 'navigate' }))
        await wait(30)
        expect((await (await caches.open('cache-v1')).keys()).length).to.equal(0)
      })

      it('gives a failed shell as it is, without keeping it', async () => {
        start()
        fetchImpl = async () => new Response('bad', { status: 502 })
        expect((await fetchEvent('/x', { mode: 'navigate' }))?.status).to.equal(502)
        await wait(30)
        expect((await (await caches.open('cache-v1')).keys()).length).to.equal(0)
      })

      it('serves the cached shell offline, or says it is offline', async () => {
        start()
        fetchImpl = async () => {
          throw new TypeError('offline')
        }
        const offline = await fetchEvent('/x', { mode: 'navigate' })
        expect(offline?.status).to.equal(503)
        expect(await offline?.text()).to.equal('Offline')
        await (await caches.open('cache-v1')).put('/', new Response('cached shell'))
        expect(await textOf(await fetchEvent('/x', { mode: 'navigate' }))).to.equal('cached shell')
      })
    })

    describe('pad sets', () => {
      it('serves a kept asset, or says it is not available offline', async () => {
        start()
        await (await caches.open('padsets-cache-v1')).put(
          new Request('https://app.test/pad-sets/a/1.mp3'),
          new Response('asset')
        )
        expect(await textOf(await fetchEvent('/pad-sets/a/1.mp3'))).to.equal('asset')
        const missing = await fetchEvent('/pad-sets/a/2.mp3')
        expect(missing?.status).to.equal(404)
        expect(await missing?.text()).to.equal('Pad set asset not available offline')
      })
    })

    describe('images and fonts (network first)', () => {
      it('serves them from the network and keeps a copy without the query', async () => {
        start()
        expect(await textOf(await fetchEvent('/icons/a.png?t=1'))).to.equal('from the network')
        await until(
          async () =>
            (await (await caches.open('runtime-v1')).match('https://app.test/icons/a.png')) !==
            undefined
        )
      })

      it('does not keep a failure', async () => {
        start()
        fetchImpl = async () => new Response('', { status: 500 })
        await fetchEvent('/icons/b.svg')
        await wait(30)
        expect((await (await caches.open('runtime-v1')).keys()).length).to.equal(0)
      })

      it('serves the kept copy offline, whatever the query, or a 404', async () => {
        start()
        await (await caches.open('runtime-v1')).put(
          new Request('https://app.test/icons/c.png'),
          new Response('kept')
        )
        fetchImpl = async () => {
          throw new TypeError('offline')
        }
        expect(await textOf(await fetchEvent('/icons/c.png?t=2'))).to.equal('kept')
        expect((await fetchEvent('/icons/none.png'))?.status).to.equal(404)
      })
    })

    describe('the manifest', () => {
      it('comes from the network, or the cache offline, or a 404', async () => {
        start()
        expect(await textOf(await fetchEvent('/manifest.webmanifest'))).to.equal('from the network')
        fetchImpl = async () => {
          throw new TypeError('offline')
        }
        expect((await fetchEvent('/manifest.webmanifest'))?.status).to.equal(404)
        await (await caches.open('cache-v1')).put(
          new Request('https://app.test/manifest.webmanifest'),
          new Response('{}')
        )
        expect(await textOf(await fetchEvent('/manifest.webmanifest'))).to.equal('{}')
      })
    })

    it('fetches anything else from the network', async () => {
      start()
      expect(await textOf(await fetchEvent('/data.bin'))).to.equal('from the network')
    })
  })
})
