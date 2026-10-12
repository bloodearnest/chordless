// The About page: the version and updates, offline use, installing, and the device's storage
import { expect, openApp, test } from './fixtures.ts'

/** A registration the app can be told about an update through, and a storage that can be asked */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const registration = new EventTarget() as EventTarget & Record<string, unknown>
    registration.waiting = null
    registration.installing = null
    const calls = { updates: 0, persist: 0 }
    registration.update = async () => {
      calls.updates++
    }
    const worker = new EventTarget() as EventTarget & { state: string }
    worker.state = 'installing'
    ;(window as unknown as { fake: object }).fake = {
      registration,
      worker,
      calls,
      persisted: false,
    }
    ServiceWorkerContainer.prototype.getRegistration = async () =>
      registration as unknown as ServiceWorkerRegistration

    const state = (window as unknown as { fake: { persisted: boolean; calls: typeof calls } }).fake
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: async () => state.persisted,
        persist: async () => {
          state.calls.persist++
          state.persisted = true
          return true
        },
        estimate: async () => ({ usage: 3_200_000, quota: 24_000_000_000 }),
      },
    })
  })
})

test('the About page has its four panels, and the version that is running', async ({ page }) => {
  await openApp(page, '/about')
  const about = page.locator('app-about')
  for (const heading of ['Version', 'Offline', 'Install', 'Storage on this device']) {
    await expect(about.getByRole('heading', { name: heading })).toBeVisible()
  }
  await expect(about.locator('#app-version')).toContainText(/Version [0-9a-z]+/)
  await expect(about.locator('#app-version')).not.toContainText('unknown')
  // And when its files last changed (the date of the last commit to the app)
  await expect(about.locator('#app-version')).toContainText(/released \d{1,2} \w+ \d{4}/)
})

test('checking for updates, and an update that arrives', async ({ page }) => {
  await openApp(page, '/about')
  const about = page.locator('app-about')
  const status = about.locator('#update-status')
  await expect(status).toHaveAttribute('data-state', 'current')

  await about.getByRole('button', { name: 'Check for updates' }).click()
  await expect(status).toContainText('Checked just now')
  expect(
    await page.evaluate(
      () => (window as unknown as { fake: { calls: { updates: number } } }).fake.calls.updates
    )
  ).toBe(1)

  // A new version installs: the page says so, and reloading takes it
  await page.evaluate(() => {
    const { registration, worker } = (
      window as unknown as { fake: { registration: any; worker: any } }
    ).fake
    registration.installing = worker
    registration.waiting = {
      postMessage: (message: { type: string }) => {
        sessionStorage.setItem('asked', message.type)
        navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))
      },
    }
    registration.dispatchEvent(new Event('updatefound'))
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
  })
  await expect(status).toHaveAttribute('data-state', 'ready')
  await expect(status).toHaveAttribute('data-look', 'warn')

  const reloaded = page.waitForEvent('load')
  await about.getByRole('button', { name: 'Reload now' }).click()
  await reloaded
  expect(await page.evaluate(() => sessionStorage.getItem('asked'))).toBe('SKIP_WAITING')
})

test('the install panel offers the browser prompt when there is one', async ({ page }) => {
  await openApp(page, '/about')
  const about = page.locator('app-about')
  await expect(about.locator('#install-status')).toHaveAttribute('data-state', 'none')

  await page.evaluate(() => {
    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {
          sessionStorage.setItem('prompted', 'yes')
        },
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      })
    )
  })
  await expect(about.locator('#install-status')).toHaveAttribute('data-state', 'prompt')
  await about.getByRole('button', { name: 'Install Chordless' }).click()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('prompted'))).toBe('yes')
})

test('the storage panel says whether the browser will keep the data, and can ask it to', async ({
  page,
}) => {
  await openApp(page, '/about')
  const about = page.locator('app-about')
  const status = about.locator('#storage-status')
  await expect(status).toHaveAttribute('data-state', 'best-effort')
  await expect(status).toContainText('Using 3.2 MB')
  // Not the quota, which a browser reports as it likes
  await expect(status).not.toContainText('24 GB')

  await about.getByRole('button', { name: 'Ask the browser to keep it' }).click()
  await expect(status).toHaveAttribute('data-state', 'persistent')
  await expect(status).toHaveAttribute('data-look', 'good')
  await expect(about.getByRole('button', { name: 'Ask the browser to keep it' })).toHaveCount(0)
})

test("the menu's About item opens the page", async ({ page }) => {
  await openApp(page, '/')
  await page.getByRole('button', { name: 'Navigation menu' }).click()
  await page.locator('nav-menu').getByRole('link', { name: 'About' }).click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.locator('about-view')).toBeVisible()
})

test('the install panel says why installing is worth it', async ({ page }) => {
  await openApp(page, '/about')
  const about = page.locator('app-about')
  await about.getByRole('button', { name: 'Why install?' }).click()
  await expect(about.getByRole('dialog', { name: 'Why install Chordless?' })).toBeVisible()
  await expect(about.locator('why-install .why')).toContainText('Your songs stay put')
})
