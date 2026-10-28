// Live mode: Go live from a setlist's header, and what stays on across pages
import { expect, seedSetlist, test } from './fixtures.ts'

/** A wake lock that counts what is asked of it */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const log = { locks: 0, released: 0 }
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
  })
})

const log = page => page.evaluate(() => (window as unknown as { liveLog: object }).liveLog)

test('Go live from the header: live, kept across pages, and left from the overview', async ({
  page,
}) => {
  await seedSetlist(page)
  await page.goto('/setlist/seeded-setlist')
  const overview = page.locator('setlist-overview')
  const button = page.locator('#live-button')
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute('aria-pressed', 'false')

  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('live_state'))).toContain(
    '/setlist/seeded-setlist'
  )

  // The button is for the overview: a song has the whole header to itself
  await overview.locator('song-card').first().click()
  await expect(page).toHaveURL(/\/song\/0$/)
  await expect(button).toBeHidden()

  // The library is another page: still live, and the screen is still held
  await page.locator('#app-header').getByRole('button', { name: 'Navigation menu' }).click()
  await page.locator('nav-menu').getByRole('link', { name: 'Song Library' }).click()
  await expect(page).toHaveURL(/\/songs$/)
  expect(await log(page)).toMatchObject({ released: 0 })
  expect(await page.evaluate(() => localStorage.getItem('live_state'))).not.toBeNull()

  // Back on the overview it is still red, and pressing it leaves, but the open
  // setlist still holds the screen awake
  await page.goBack()
  await page.goBack()
  await expect(page).toHaveURL(/\/setlist\/seeded-setlist$/)
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => log(page)).toMatchObject({ released: 0 })
  expect(await page.evaluate(() => localStorage.getItem('live_state'))).toBeNull()
})

test('still live after the page is reloaded: the screen is held again', { tag: '@logic' }, async ({
  page,
}) => {
  await seedSetlist(page)
  await page.goto('/setlist/seeded-setlist')
  await page.locator('#live-button').click()
  await page.reload()
  await expect(page.locator('#live-button')).toHaveAttribute('aria-pressed', 'true')
  // (a page's log starts again when it loads)
  await expect.poll(() => log(page)).toMatchObject({ locks: 1 })
})

test('taking over from another setlist', { tag: '@logic' }, async ({ page }) => {
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
