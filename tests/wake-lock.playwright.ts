// Keeping the screen awake while a setlist is open, and the Preferences panel for it
import { expect, openApp, seedSetlist, test } from './fixtures.ts'

/** A navigator.wakeLock that counts the locks asked for and let go */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // On battery unless a test plugs it in (a desktop browser says it is on mains)
    const battery = Object.assign(new EventTarget(), { charging: false })
    ;(window as unknown as { battery: typeof battery }).battery = battery
    Object.defineProperty(navigator, 'getBattery', {
      configurable: true,
      value: async () => battery,
    })
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

test('the Preferences panel shows the state, and keeps the screen awake on request', async ({
  page,
}) => {
  await openApp(page, '/preferences')
  const panel = page.locator('app-preferences')
  const status = panel.locator('#wake-lock-status')
  await expect(status).toHaveAttribute('data-state', 'idle')
  await expect(status).toContainText('Ready')

  // Asked for here, it is held on this page, and let go when stopped
  await panel.getByRole('button', { name: 'Keep awake now' }).click()
  await expect(status).toHaveAttribute('data-state', 'active')
  await expect(status).toHaveAttribute('data-look', 'good')
  await expect(status).toContainText('Awake')
  expect(await log(page)).toMatchObject({ requested: 1, released: 0 })
  await panel.getByRole('button', { name: 'Stop keeping awake' }).click()
  await expect(status).toHaveAttribute('data-state', 'idle')
  expect(await log(page)).toMatchObject({ released: 1 })

  // When the device refuses, it says so, and offers to ask again
  await page.evaluate(() => {
    ;(window as unknown as { wakeLockLog: { refuse: boolean } }).wakeLockLog.refuse = true
  })
  await panel.getByRole('button', { name: 'Keep awake now' }).click()
  await expect(status).toHaveAttribute('data-state', 'failed')
  await expect(status).toHaveAttribute('data-look', 'bad')
  await expect(status).toContainText('NotAllowedError')
  await expect(panel.getByRole('button', { name: 'Ask again' })).toBeVisible()

  await panel.getByRole('checkbox', { name: 'Keep the screen awake' }).uncheck()
  await expect(panel.locator('#keep-awake-limit')).toBeDisabled()
})

test('the longest time with no touch is chosen in Preferences, and is an hour at first', async ({
  page,
}) => {
  await openApp(page, '/preferences')
  const panel = page.locator('app-preferences')
  const limit = panel.locator('#keep-awake-limit')
  await expect(limit).toHaveValue('60')
  await expect(limit.locator('option')).toHaveText([
    '15 minutes',
    '30 minutes',
    '1 hour',
    '2 hours',
    '4 hours',
    'No limit',
  ])

  await panel.getByRole('button', { name: 'Keep awake now' }).click()
  await expect(panel.locator('#wake-lock-status')).toContainText('1 hour')
  await limit.selectOption('30')
  await expect(panel.locator('#wake-lock-status')).toContainText('30 minutes')
  expect(await page.evaluate(() => localStorage.getItem('keep_awake_minutes'))).toBe('30')
  await limit.selectOption('0')
  await expect(panel.locator('#wake-lock-status')).not.toContainText('no touch for')
})

test('there is no time limit while charging', async ({ page }) => {
  await openApp(page, '/preferences')
  const panel = page.locator('app-preferences')
  const status = panel.locator('#wake-lock-status')
  await panel.getByRole('button', { name: 'Keep awake now' }).click()
  await expect(status).toContainText('until there is no touch for 1 hour')

  await page.evaluate(() => {
    const { battery } = window as unknown as { battery: EventTarget & { charging: boolean } }
    battery.charging = true
    battery.dispatchEvent(new Event('chargingchange'))
  })
  await expect(status).toContainText('no time limit while it is charging')
  await expect(status).not.toContainText('no touch for')
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
  await expect(status).toHaveAttribute('data-state', 'active')
  await expect(status).toHaveAttribute('data-look', 'good')
  await expect(status).toContainText('Awake')
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
