// Live mode: Go live on a setlist's overview, the indicator in the shell, and what stays on
import { expect, openApp, seedSetlist, test } from './fixtures.ts'

/** A wake lock and a fullscreen that count what is asked of them */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const log = { locks: 0, released: 0, fullscreen: 0, exits: 0 }
    ;(window as unknown as { liveLog: typeof log }).liveLog = log
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          log.locks++
          const lock = new EventTarget() as EventTarget & { release: () => Promise<void> }
          lock.release = async () => {
            log.released++
            lock.dispatchEvent(new Event('release'))
          }
          return lock
        },
      },
    })
    let element: Element | null = null
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: async () => {
        log.exits++
        element = null
      },
    })
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: async function (this: Element) {
        log.fullscreen++
        element = this
      },
    })
  })
})

const log = page => page.evaluate(() => (window as unknown as { liveLog: object }).liveLog)

test('Go live on the overview: live now, in fullscreen, with an indicator that follows to other pages', async ({
  page,
}) => {
  await seedSetlist(page)
  await page.goto('/setlist/seeded-setlist')
  const overview = page.locator('setlist-overview')
  await expect(page.locator('#live-button')).toBeVisible()
  await expect(page.locator('live-indicator')).toBeHidden()

  await page.locator('#live-button').click()
  await expect(page.locator('#live-button')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('live-indicator')).toBeVisible()
  await expect(page.locator('live-indicator')).toContainText('Live:')
  expect(await log(page)).toMatchObject({ fullscreen: 1 })
  expect(await page.evaluate(() => localStorage.getItem('live_state'))).toContain(
    '/setlist/seeded-setlist'
  )

  // On a song of the live setlist the indicator stays out of the way
  await overview.locator('song-card').first().click()
  await expect(page).toHaveURL(/\/song\/0$/)
  await expect(page.locator('live-indicator')).toBeHidden()

  // The library is another page: still live, and the screen is still held
  await page.locator('#app-header').getByRole('button', { name: 'Navigation menu' }).click()
  await page.locator('nav-menu').getByRole('link', { name: 'Song Library' }).click()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(page.locator('live-indicator')).toBeVisible()
  expect(await log(page)).toMatchObject({ released: 0 })

  // Leaving live, with two taps, lets go of everything
  await page.locator('live-indicator').getByRole('button', { name: /Live/ }).click()
  await page.locator('live-indicator').getByRole('button', { name: 'Leave live' }).click()
  await expect(page.locator('live-indicator')).toBeHidden()
  await expect.poll(() => log(page)).toMatchObject({ released: 1, exits: 1 })
  expect(await page.evaluate(() => localStorage.getItem('live_state'))).toBeNull()
})

test('the indicator takes you back to the live setlist', async ({ page }) => {
  await seedSetlist(page)
  await page.goto('/setlist/seeded-setlist')
  await page.locator('#live-button').click()
  await openApp(page, '/songs')
  // (the page can still be replaced by the app's one reload under load, even once the menu is
  // open: do the whole thing again until it has worked)
  const link = page.locator('live-indicator').getByRole('link', { name: 'Open the live setlist' })
  await expect(async () => {
    await page.locator('live-indicator').getByRole('button', { name: /Live/ }).click()
    await link.click({ timeout: 2000 })
    await expect(page).toHaveURL(/\/setlist\/seeded-setlist$/, { timeout: 2000 })
  }).toPass()
})

test('still live after the page is reloaded: the screen is held and fullscreen asked for again', async ({
  page,
}) => {
  await seedSetlist(page)
  await page.goto('/setlist/seeded-setlist')
  await page.locator('#live-button').click()
  await page.reload()
  await expect(page.locator('#live-button')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('live-indicator')).toBeVisible()
  // (a page's log starts again when it loads)
  await expect.poll(() => log(page)).toMatchObject({ locks: 1, fullscreen: 1 })
})

test('with fullscreen turned off in Preferences, going live does not ask for it', async ({
  page,
}) => {
  await seedSetlist(page)
  await page.evaluate(() => localStorage.setItem('fullscreen_while_live', 'false'))
  await page.goto('/setlist/seeded-setlist')
  await page.locator('#live-button').click()
  await expect(page.locator('#live-button')).toHaveAttribute('aria-pressed', 'true')
  expect(await log(page)).toMatchObject({ fullscreen: 0 })
})

test('taking over from another setlist', async ({ page }) => {
  await seedSetlist(page)
  await page.evaluate(() =>
    localStorage.setItem(
      'live_state',
      JSON.stringify({ url: '/setlist/another', title: 'Other', startedAt: 1 })
    )
  )
  await page.goto('/setlist/seeded-setlist')
  await expect(page.locator('#live-button')).toHaveAttribute('aria-label', 'Take over live here')
  await page.locator('#live-button').click()
  await expect(page.locator('#live-button')).toHaveAttribute('aria-pressed', 'true')
})
