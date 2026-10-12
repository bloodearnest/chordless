// The production build (npm run build, served by vite preview): what the dev server can't show.
import { expect, test, waitForServiceWorker } from './fixtures.ts'
import { must } from './must.ts'

// Every view the router has, by the URL that shows it
const VIEWS = [
  ['/songs', 'library-view'],
  ['/storage', 'storage-view'],
  ['/preferences', 'preferences-view'],
  ['/import-song', 'import-song-view'],
  ['/bookmarklet', 'bookmarklet-view'],
  ['/about', 'about-view'],
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

test('the security headers are on the page, its deep links and the service worker', async ({
  request,
}) => {
  for (const path of ['/', '/songs', '/service-worker.js', '/boot.js']) {
    const headers = (await request.get(path)).headers()
    expect(headers['content-security-policy'], path).toContain("default-src 'self'")
    expect(headers['x-content-type-options'], path).toBe('nosniff')
  }
})

/** Collect the Content-Security-Policy violations the page reports (the browser also reports them while enforcing) */
async function collectViolations(page) {
  const violations: string[] = []
  await page.exposeFunction('reportViolation', (text: string) => violations.push(text))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      // @ts-expect-error: the function exposed by the test
      window.reportViolation(
        `${event.violatedDirective} blocked ${event.blockedURI} at ${event.sourceFile}:${event.lineNumber}`
      )
    })
  })
  return violations
}

test('the page has something to paint before any script runs', async ({ request }) => {
  const html = await (await request.get('/')).text()
  expect(html).toContain('class="boot-shell"')
})

test('the first visit is controlled by the service worker without a reload, where it can be', async ({
  page,
}) => {
  let loads = 0
  page.on('load', () => loads++)
  await page.goto('/')
  await waitForServiceWorker(page)
  // A reload would come after the worker is active: give it time to happen
  await page.waitForTimeout(500)
  expect(loads).toBe(1)
})

test('hashed files can be cached for good, the page and the worker are revalidated', async ({
  request,
}) => {
  const html = await (await request.get('/')).text()
  const asset = must(html.match(/\/assets\/index-[\w-]+\.js/))[0]
  expect((await request.get(asset)).headers()['cache-control']).toContain('immutable')
  expect((await request.get('/service-worker.js')).headers()['cache-control']).not.toContain(
    'immutable'
  )
})

test('robots.txt is a text file, not the app shell', async ({ request }) => {
  const response = await request.get('/robots.txt')
  expect(response.headers()['content-type']).toContain('text/plain')
  expect(await response.text()).toContain('Disallow: /')
})

test('every view runs with no Content-Security-Policy violations', async ({ page }) => {
  const violations = await collectViolations(page)
  await page.goto('/')
  await waitForServiceWorker(page)
  for (const [path, view] of VIEWS) {
    await page.goto(path)
    await expect(page.locator(view), path).toBeVisible()
  }
  expect(violations).toEqual([])
})

test('the real app is named Chordless, not the dev name', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest.name).toBe('Chordless')
  expect(manifest.short_name).toBe('Chordless')
  expect(manifest.theme_color).toBe('#2c3e50')
})
