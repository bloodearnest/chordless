// Playwright test runner for browser-based tests
import { expect, test } from '@playwright/test'

test.describe('Application Pages', () => {
  test('home page should load', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#home-view', { timeout: 5000 })
    const homeView = await page.locator('#home-view').count()
    expect(homeView).toBe(1)
  })

  test('setlist page should load', async ({ page }) => {
    // /setlist.html causes an infinite redirect in wrangler; use the routed URL.
    // SW must be active first so /setlist/test-uuid is routed to setlist.html.
    await page.goto('/')
    await page.waitForFunction(() =>
      navigator.serviceWorker.ready.then(reg => reg.active?.state === 'activated')
    )
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

    await page.goto('/setlist/test-uuid')
    await expect(page).toHaveTitle('Setlist - Chordless')
    await page.waitForSelector('#song-view', { timeout: 5000 })
    expect(await page.locator('#song-view').count()).toBe(1)
  })
})

test.describe('Loading', () => {
  test('modal content is hidden until app-modal is defined', async ({ page }) => {
    // Hold app-modal.js until we've checked, so the element stays undefined
    let releaseModal
    const modalHeld = new Promise(resolve => {
      releaseModal = resolve
    })
    await page.route(/\/components\/app-modal\.js$/, async route => {
      await modalHeld
      await route.continue()
    })

    await page.goto('/', { waitUntil: 'commit' })
    const input = page.locator('#create-setlist-modal input').first()
    await input.waitFor({ state: 'attached' })
    expect(await page.evaluate(() => customElements.get('app-modal'))).toBeUndefined()
    await expect(input).toBeHidden()

    releaseModal()
    await page.waitForFunction(() => customElements.get('app-modal'))
    await expect(input).toBeHidden()
  })
})
