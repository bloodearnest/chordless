// The menu button's dot and the menu's first item, when a new version of the app is ready
import { expect, openApp, test } from './fixtures.ts'

/** Give the app a registration it can be told about an update through, and a worker to ask */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const registration = new EventTarget() as EventTarget & {
      waiting: null | { postMessage: (message: unknown) => void }
      installing: null | (EventTarget & { state: string })
      update: () => Promise<void>
    }
    registration.waiting = null
    registration.installing = null
    registration.update = async () => {}
    const worker = new EventTarget() as EventTarget & { state: string }
    worker.state = 'installing'
    ;(window as unknown as { fakeUpdate: object }).fakeUpdate = { registration, worker }
    ServiceWorkerContainer.prototype.getRegistration = async () =>
      registration as unknown as ServiceWorkerRegistration
  })
})

/** A new version installs while the app is open */
const installNewVersion = page =>
  page.evaluate(() => {
    const { registration, worker } = (
      window as unknown as { fakeUpdate: { registration: any; worker: any } }
    ).fakeUpdate
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

test('there is no dot or update item until a new version is ready', async ({ page }) => {
  await openApp(page, '/')
  const header = page.locator('app-header').first()
  await expect(header.locator('.update-dot')).toHaveCount(0)
  await header.getByRole('button', { name: 'Navigation menu' }).click()
  await expect(page.locator('nav-menu').getByRole('button', { name: /Update ready/ })).toHaveCount(
    0
  )
})

test('a ready update puts a dot on the menu button and the first item in the menu', async ({
  page,
}) => {
  await openApp(page, '/')
  await installNewVersion(page)

  const header = page.locator('app-header').first()
  await expect(header.locator('.update-dot')).toBeVisible()
  const button = header.getByRole('button', { name: 'Navigation menu, update ready' })
  await button.click()

  const items = page.locator('nav-menu .nav-menu-item')
  await expect(items.first()).toContainText('Update ready: reload')
})

test('choosing the item asks the new worker to take over, and reloads the page', async ({
  page,
}) => {
  await openApp(page, '/')
  await installNewVersion(page)
  await page
    .locator('app-header')
    .first()
    .getByRole('button', { name: /Navigation menu/ })
    .click()

  const reloaded = page.waitForEvent('load')
  await page
    .locator('nav-menu')
    .getByRole('button', { name: /Update ready/ })
    .click()
  await reloaded
  expect(await page.evaluate(() => sessionStorage.getItem('asked'))).toBe('SKIP_WAITING')
})
