// Playwright test runner for browser-based tests
import { expect, test } from '@playwright/test'

test.describe('Template Tests', () => {
  test('should run all template tests successfully', async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') console.error('Browser console error:', msg.text())
    })
    page.on('pageerror', error => console.error('Page error:', error))

    await page.goto('/tests/template-test.html')

    // Wait for tests to complete by checking for summary div to change from "loading"
    await page.waitForSelector('#test-summary:not(.loading)', { timeout: 10000 })

    // Get test summary
    const summary = await page.locator('#test-summary').textContent()
    console.log('Template tests:', summary)

    // Check if all tests passed
    const hasPassed = await page.locator('#test-summary.summary-pass').count()
    expect(hasPassed).toBe(1)

    // Get test count from summary
    const failedTests = await page.locator('.test-fail').count()
    expect(failedTests).toBe(0)

    // Log all test results
    const results = await page.locator('#test-results > div').allTextContents()
    console.log('\nTest results:')
    results.forEach(result => console.log(result))
  })
})

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
