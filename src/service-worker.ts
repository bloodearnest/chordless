// Service Worker for offline-first operation
// Built as a classic script by vite-plugins/service-worker.js, which defines the three
// constants below: the files to precache, a version (a hash of them), and when they were released.
// The behaviour is in js/service-worker-core.ts, which a test can run with fakes.
/* v8 ignore start -- the worker's own start-up: the Playwright tests run it, and service-worker-core.ts is what the unit tests cover */
import { startServiceWorker, type WorkerScope } from './js/service-worker-core.ts'

declare const self: ServiceWorkerGlobalScope

startServiceWorker(self as unknown as WorkerScope, caches, (input, init) => fetch(input, init), {
  precache: __PRECACHE__,
  cacheVersion: __CACHE_VERSION__,
  releasedAt: __RELEASE_DATE__,
})
/* v8 ignore stop */
