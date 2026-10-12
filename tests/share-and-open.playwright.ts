// Songs reaching the import page from outside it: a share from another app (through the service
// worker), and a file the system opened with the installed app (through Chrome's launchQueue)
import { expect, openApp, test } from './fixtures.ts'

const chart = '{title: Shared Song}\n{key: G}\n\n[G]Amazing [C]grace'

test('something shared to the app opens the import page with the song', async ({ page }) => {
  await openApp(page, '/')

  // What another app's share makes: a multipart POST to the share target, as a navigation
  await Promise.all([
    page.waitForURL(/\/import-song$/),
    page.evaluate(chartText => {
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = '/share-target'
      form.enctype = 'multipart/form-data'
      const input = document.createElement('input')
      input.type = 'file'
      input.name = 'files'
      const transfer = new DataTransfer()
      transfer.items.add(new File([chartText], 'Shared Song.cho', { type: 'text/plain' }))
      input.files = transfer.files
      form.append(input)
      document.body.append(form)
      form.submit()
    }, chart),
  ])

  await expect(page.locator('song-import')).toContainText('Shared Song')
  // Taken once: a reload does not import it again
  await page.reload()
  await expect(page.locator('song-import')).not.toContainText('Shared Song')
})

test('text shared to the app is imported as a song', async ({ page }) => {
  await openApp(page, '/')
  await Promise.all([
    page.waitForURL(/\/import-song$/),
    page.evaluate(chartText => {
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = '/share-target'
      form.enctype = 'multipart/form-data'
      // (a textarea: an input would strip the line breaks a chart has)
      const text = document.createElement('textarea')
      text.name = 'text'
      text.value = chartText
      form.append(text)
      document.body.append(form)
      form.submit()
    }, '{title: Words From Notes}\n[D]Some words'),
  ])
  await expect(page.locator('song-import')).toContainText('Words From Notes')
})

test('a file the system opened with the app is imported', async ({ page }) => {
  // Chrome gives launches to a consumer set on launchQueue: keep it, to launch with
  await page.addInitScript(() => {
    const queue = {
      setConsumer(consumer: unknown) {
        ;(window as unknown as { launch: unknown }).launch = consumer
      },
    }
    Object.defineProperty(window, 'launchQueue', { configurable: true, value: queue })
  })
  await openApp(page, '/')
  await page.waitForFunction(() => (window as unknown as { launch?: unknown }).launch)
  await page.evaluate(chartText => {
    const launch = (window as unknown as { launch: (params: object) => Promise<void> }).launch
    const file = new File([chartText], 'Opened Song.cho')
    return launch({ files: [{ getFile: async () => file }] })
  }, '{title: Opened Song}\n[A]Opened words')

  await expect(page).toHaveURL(/\/import-song$/)
  await expect(page.locator('song-import')).toContainText('Opened Song')
})

test('a shortcut or link for the open window goes there, without a second window', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const queue = {
      setConsumer(consumer: unknown) {
        ;(window as unknown as { launch: unknown }).launch = consumer
      },
    }
    Object.defineProperty(window, 'launchQueue', { configurable: true, value: queue })
  })
  await openApp(page, '/')
  await page.waitForFunction(() => (window as unknown as { launch?: unknown }).launch)
  await page.evaluate(() => {
    const launch = (window as unknown as { launch: (params: object) => Promise<void> }).launch
    return launch({ targetURL: `${location.origin}/songs` })
  })
  await expect(page).toHaveURL(/\/songs$/)
  await expect(page.locator('library-view')).toBeVisible()
})
