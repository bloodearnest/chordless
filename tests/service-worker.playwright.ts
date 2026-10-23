import { expect, fromDB, seedSetlist, test, waitForServiceWorker } from './fixtures.ts'

// Wait for the SW to be installed, activated and controlling the page, and for the
// page's one reload on the first visit to be over.
async function waitForSW(page) {
  await page.waitForFunction(() => {
    return navigator.serviceWorker.ready.then(reg => reg.active?.state === 'activated')
  })
  await waitForServiceWorker(page)
}

test('SW registers and controls the page on first load', async ({ page }) => {
  await page.goto('/')
  await waitForSW(page)
  const state = await page.evaluate(() => navigator.serviceWorker.controller?.state)
  expect(state).toBe('activated')
})

test('direct navigation to SPA route serves app shell', async ({ page }) => {
  // Validates server-side SPA fallback — first-time visitor to a deep link
  // gets the app shell, not a 404 or JSON error
  await page.goto('/setlist/test-uuid-direct-nav')
  await expect(page).toHaveTitle(/Chordless/)
})

test('SW routes non-root pages to correct HTML', async ({ page }) => {
  // Prime the SW by loading the app first
  await page.goto('/')
  await waitForSW(page)

  // Navigate to a non-root route through the SW and verify the correct page loads.
  // This would have caught the .html redirect bug: fetching /account.html redirected
  // to /account, and browser navigations use redirect:manual so the SW response failed.
  await page.goto('/account')
  await expect(page).toHaveTitle('Account and Teams - Chordless')

  await page.goto('/songs')
  await expect(page).toHaveTitle('Song Library - Chordless')

  await page.goto('/setlist/test-uuid')
  await expect(page).toHaveTitle('Setlist - Chordless')
})

test('page reloads successfully while offline', async ({ page, context, browserName }) => {
  // (the dev server has no precache, so what the worker has cached when the network goes depends
  // on timing, and WebKit under load is slower than Chromium: offline use is tested on the
  // build, in built.playwright.ts, which runs on WebKit too)
  test.skip(browserName === 'webkit', 'Offline use is tested on the build')
  // Load the page so the SW installs and populates the cache
  await page.goto('/')
  await waitForSW(page)
  // The dev server has no precache: modules are cached as the worker fetches them, and the
  // first load was not controlled by it, so load again with it in control and let that finish
  await page.reload()
  await page.waitForLoadState('networkidle')

  await context.setOffline(true)
  try {
    // This was broken before the SW handleRoute fix:
    // ERR_INTERNET_DISCONNECTED because the SW was bypassed or crashed
    await page.reload()
    await expect(page).toHaveTitle(/Chordless/)
  } finally {
    await context.setOffline(false)
  }
})

test('a setlist opened online can be reloaded while offline', async ({
  page,
  context,
  browserName,
}) => {
  // (the dev server has no precache, so what the worker has cached when the network goes depends
  // on timing, and WebKit under load is slower than Chromium: offline use is tested on the
  // build, in built.playwright.ts, which runs on WebKit too)
  test.skip(browserName === 'webkit', 'Offline use is tested on the build')
  // Only the home page is precached; the other pages are cached when first opened
  await seedSetlist(page, { setlistId: 'offline-setlist' })
  await page.goto('/setlist/offline-setlist')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('setlist-overview')).toBeVisible()

  await context.setOffline(true)
  try {
    await page.reload()
    await expect(page).toHaveTitle(/^Sun,? 11 Oct - Chordless$/)
    await expect(page.locator('setlist-overview')).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})

// A few actions reload the page on purpose (they replace the database under every view).
// They must work with no network, which is when a band most needs the app.
test.describe('Reloads on purpose, while offline', () => {
  /** Open the Account and Teams view, and let the service worker cache what it needs to restart */
  async function openAccountOnline(page) {
    await seedSetlist(page, { setlistId: 'offline-reload-setlist' })
    await page.goto('/account')
    await waitForSW(page)
    await expect(page.locator('account-view')).toBeVisible()
    await page.waitForLoadState('networkidle')
  }

  test('restarting with no network', async ({ page, context, browserName }) => {
    // (the dev server has no precache, so what the worker has cached when the network goes depends
    // on timing, and WebKit under load is slower than Chromium: offline use is tested on the
    // build, in built.playwright.ts, which runs on WebKit too)
    test.skip(browserName === 'webkit', 'Offline use is tested on the build')
    await openAccountOnline(page)
    await context.setOffline(true)
    try {
      await page.reload()
      // The app came back from the service worker's cache, with its data
      await expect(page.locator('account-view')).toBeVisible()
      await expect(page).toHaveTitle('Account and Teams - Chordless')
      expect(await fromDB(page, 'getSetlist', 'offline-reload-setlist')).toBeTruthy()
    } finally {
      await context.setOffline(false)
    }
  })

  test('switching space, then restarting, with no network', async ({
    page,
    context,
    browserName,
  }) => {
    // (the dev server has no precache, so what the worker has cached when the network goes depends
    // on timing, and WebKit under load is slower than Chromium: offline use is tested on the
    // build, in built.playwright.ts, which runs on WebKit too)
    test.skip(browserName === 'webkit', 'Offline use is tested on the build')
    await openAccountOnline(page)
    await context.setOffline(true)
    try {
      await Promise.all([
        page.waitForEvent('load'),
        page.evaluate(async () => {
          const { getCurrentSpace, switchSpace } = await import('/js/space.ts')
          await switchSpace(getCurrentSpace().id as string)
        }),
      ])
      await expect(page.locator('account-view')).toBeVisible()
      await expect(page).toHaveTitle('Account and Teams - Chordless')
    } finally {
      await context.setOffline(false)
    }
  })
})
