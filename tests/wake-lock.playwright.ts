// Keeping the screen awake while a setlist is open, and the Preferences panel for it
import { expect, openApp, seedSetlist, test } from './fixtures.ts'

/** A navigator.wakeLock that counts the locks asked for and let go */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const log = { requested: 0, released: 0, refuse: false }
    ;(window as unknown as { wakeLockLog: typeof log }).wakeLockLog = log
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          if (log.refuse) throw new DOMException('refused', 'NotAllowedError')
          log.requested++
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

const log = page => page.evaluate(() => (window as unknown as { wakeLockLog: object }).wakeLockLog)

test('a setlist keeps the screen awake, and leaving it lets go', async ({ page }) => {
  await seedSetlist(page)
  await page.goto('/setlist/seeded-setlist')
  await expect.poll(() => log(page)).toMatchObject({ requested: 1, released: 0 })

  // Moving to a song in the same setlist keeps the one lock
  await page.locator('setlist-overview song-card').first().click()
  await expect(page).toHaveURL(/\/song\/0$/)
  expect(await log(page)).toMatchObject({ requested: 1, released: 0 })

  // Another page of the app, reached in place (a page load would drop the document), lets go
  await page.locator('#app-header').getByRole('button', { name: 'Navigation menu' }).click()
  await page.locator('nav-menu').getByRole('link', { name: 'Song Library' }).click()
  await expect(page).toHaveURL(/\/songs$/)
  await expect.poll(() => log(page)).toMatchObject({ released: 1 })
})

test('the library and the home page do not ask for the screen', async ({ page }) => {
  await openApp(page, '/')
  await openApp(page, '/songs')
  expect(await log(page)).toMatchObject({ requested: 0 })
})

test('the Preferences panel shows the state, and the switch turns it off', async ({ page }) => {
  await openApp(page, '/preferences')
  const panel = page.locator('app-preferences')
  const status = panel.locator('#wake-lock-status')
  await expect(status).toContainText('Ready')

  // With no setlist open, checking asks for a lock and lets it go at once
  await panel.getByRole('button', { name: 'Check now' }).click()
  await expect(status).toContainText('checked just now')
  expect(await log(page)).toMatchObject({ requested: 1, released: 1 })

  await page.evaluate(() => {
    ;(window as unknown as { wakeLockLog: { refuse: boolean } }).wakeLockLog.refuse = true
  })
  await panel.getByRole('button', { name: 'Check now' }).click()
  await expect(status).toContainText('NotAllowedError')

  await panel.getByRole('checkbox', { name: 'Keep the screen awake' }).uncheck()
  await expect(status).toContainText('Off')
  await expect(panel.getByRole('button', { name: /Check now|Ask again/ })).toHaveCount(0)
})

test('turning it off in Preferences stops a setlist from asking', async ({ page }) => {
  await seedSetlist(page)
  await page.goto('/preferences')
  await page
    .locator('app-preferences')
    .getByRole('checkbox', { name: 'Keep the screen awake' })
    .uncheck()
  await page.goto('/setlist/seeded-setlist')
  await expect(page.locator('setlist-overview song-card').first()).toBeVisible()
  expect(await log(page)).toMatchObject({ requested: 0 })
})

test("the menu's Preferences modal shows the state of the page under it", async ({ page }) => {
  await seedSetlist(page)
  await page.goto('/setlist/seeded-setlist')
  await expect.poll(() => log(page)).toMatchObject({ requested: 1 })
  const openPreferences = async () => {
    await page.getByRole('button', { name: 'Navigation menu' }).click()
    await page.locator('nav-menu').getByRole('button', { name: 'Preferences' }).click()
    return page.locator('nav-menu app-preferences #wake-lock-status')
  }

  // Over a setlist, the screen is being held
  const status = await openPreferences()
  await expect(status).toContainText('Active')
  await page.keyboard.press('Escape')

  // Over the library, it is not
  await page.getByRole('button', { name: 'Navigation menu' }).click()
  await page.locator('nav-menu').getByRole('link', { name: 'Song Library' }).click()
  await expect(page).toHaveURL(/\/songs$/)
  await expect.poll(() => log(page)).toMatchObject({ released: 1 })
  await page.getByRole('button', { name: 'Navigation menu' }).click()
  await page.locator('nav-menu').getByRole('button', { name: 'Preferences' }).click()
  await expect(status).toContainText('Ready')
})
