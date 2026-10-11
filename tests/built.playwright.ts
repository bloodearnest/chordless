// The production build (npm run build, served by vite preview): what the dev server can't show.
import { expect, test, waitForServiceWorker } from './fixtures.ts'

// Every view the router has, by the URL that shows it
const VIEWS = [
  ['/songs', 'library-view'],
  ['/storage', 'storage-view'],
  ['/preferences', 'preferences-view'],
  ['/import-song', 'import-song-view'],
  ['/bookmarklet', 'bookmarklet-view'],
  ['/no/such/page', 'not-found-view'],
]

test('the service worker is a classic script, which older browsers can run', async ({ page }) => {
  const source = await (await page.request.get('/service-worker.js')).text()
  expect(source).not.toMatch(/^\s*(import|export)\s/m)
  await page.goto('/')
  const type = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return registration.active?.scriptURL
  })
  expect(type).toMatch(/\/service-worker\.js$/)
})

test('after one visit, every view opens with no network', async ({ page, context }) => {
  // Only the home page is visited online: the worker must have cached the rest at install
  await page.goto('/')
  await waitForServiceWorker(page)

  await context.setOffline(true)
  try {
    for (const [path, view] of VIEWS) {
      await page.goto(path)
      await expect(page.locator(view), path).toBeVisible()
    }
  } finally {
    await context.setOffline(false)
  }
})

test('the files it caches are the files the build made', async ({ page }) => {
  await page.goto('/')
  await waitForServiceWorker(page)
  const { cached, shell } = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => /^cache-[0-9a-f]{12}$/.test(name))
    const cache = await caches.open(names[0])
    const keys = await cache.keys()
    return {
      cached: keys.map(request => new URL(request.url).pathname),
      shell: !!(await cache.match('/')),
    }
  })
  expect(shell).toBe(true)
  expect(cached).toContain('/manifest.webmanifest')
  // The lazily loaded views and their code
  expect(cached.filter(path => /\/assets\/.*-view-.*\.js$/.test(path)).length).toBeGreaterThan(5)
  expect(cached).not.toContain('/service-worker.js')
})
