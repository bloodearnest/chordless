import { expect, test } from '@playwright/test'

// Wait for the SW to be installed, activated, and controlling the page.
// skipWaiting + clients.claim means this happens on first load, but
// there's still a brief async gap we need to bridge.
async function waitForSW(page) {
  await page.waitForFunction(() => {
    return navigator.serviceWorker.ready.then(reg => reg.active?.state === 'activated')
  })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
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
  // This would have caught the .html redirect bug: fetching /storage.html redirected
  // to /storage, and browser navigations use redirect:manual so the SW response failed.
  await page.goto('/storage')
  await expect(page).toHaveTitle('Storage - Chordless')

  await page.goto('/songs')
  await expect(page).toHaveTitle('Song Library - Chordless')

  await page.goto('/setlist/test-uuid')
  await expect(page).toHaveTitle('Setlist - Chordless')
})

test('page reloads successfully while offline', async ({ page, context }) => {
  // Load the page so the SW installs and populates the cache
  await page.goto('/')
  await waitForSW(page)

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
