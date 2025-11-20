// Playwright test runner for browser-based tests
import { expect, test } from '@playwright/test'

const BASE_URL = 'http://localhost:8000'

test.describe('Template Tests', () => {
  test('should run all template tests successfully', async ({ page }) => {
    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('Browser console error:', msg.text())
      }
    })

    // Listen for page errors
    page.on('pageerror', error => {
      console.error('Page error:', error)
    })

    // Navigate to template test page
    await page.goto(`${BASE_URL}/tests/template-test.html`)

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

test.describe('Service Worker Tests', () => {
  test('should have service worker registered and active', async ({ page }) => {
    // Navigate to SW test page
    await page.goto(`${BASE_URL}/tests/test-sw.html`)

    // Wait for status check to complete
    await page.waitForSelector('#status .status', { timeout: 5000 })

    // Check if service worker is active
    const statusOk = await page.locator('#status .status.ok').count()

    if (statusOk === 0) {
      // Get the actual status message
      const statusText = await page.locator('#status').textContent()
      console.log('Service Worker status:', statusText)

      // If SW not registered, try to register it
      const hasRegisterButton = await page.locator('button:text("Register Service Worker")').count()
      if (hasRegisterButton > 0) {
        console.log('Service Worker not registered, registering now...')
        await page.click('button:text("Register Service Worker")')
        await page.waitForNavigation()

        // Check again after registration
        await page.waitForSelector('#status .status', { timeout: 5000 })
        const statusOkAfterReg = await page.locator('#status .status.ok').count()
        expect(statusOkAfterReg).toBe(1)
      } else {
        // SW registered but not controlling - might need reload
        const hasReloadButton = await page.locator('button:text("Reload Page")').count()
        if (hasReloadButton > 0) {
          console.log('Service Worker not controlling page, reloading...')
          await page.click('button:text("Reload Page")')
          await page.waitForNavigation()

          await page.waitForSelector('#status .status', { timeout: 5000 })
          const statusOkAfterReload = await page.locator('#status .status.ok').count()
          expect(statusOkAfterReload).toBe(1)
        }
      }
    } else {
      console.log('✓ Service Worker is active and controlling page')
    }

    // Get logs
    const logs = await page.locator('#logs').textContent()
    if (logs) {
      console.log('\nService Worker logs:')
      console.log(logs)
    }
  })
})

test.describe('Application Pages', () => {
  test('home page should load', async ({ page }) => {
    // Just navigate to the home page directly
    await page.goto(`${BASE_URL}/`)

    // Wait for the content to load
    await page.waitForSelector('#home-view', { timeout: 5000 })

    // Check that home view exists
    const homeView = await page.locator('#home-view').count()
    expect(homeView).toBe(1)

    // Check for main heading
    const heading = await page.locator('h1').textContent()
    expect(heading).toBe('Setalight')

    console.log('✓ Home page loaded successfully')
  })

  test('setlist page HTML structure', async ({ page }) => {
    // Test the setlist.html file directly (not the routed URL)
    await page.goto(`${BASE_URL}/setlist.html`)

    // Check we got the right page
    const title = await page.title()
    expect(title).toBe('Setlist - Setalight')

    // Wait for the setlist view structure
    await page.waitForSelector('#song-view', { timeout: 5000 })

    // Check that the setlist view structure exists
    const songView = await page.locator('#song-view').count()
    expect(songView).toBe(1)

    // Verify key UI elements exist
    const editModeToggle = await page.locator('#edit-mode-toggle').count()
    expect(editModeToggle).toBe(1)

    const infoButton = await page.locator('#info-button').count()
    expect(infoButton).toBe(1)

    console.log('✓ Setlist page structure is correct')
  })
})
