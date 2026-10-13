// Songs reaching the import page from outside it: a share from another app (through the service
// worker), and a file the system opened with the installed app (through Chrome's launchQueue)
import type { Page } from '@playwright/test'
import { expect, openApp, test } from './fixtures.ts'
import { makePdf } from './make-pdf.ts'

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

/** What another app's share makes, with one PDF */
async function sharePdf(page: Page, name: string, lines: string[]) {
  const bytes = [...makePdf(lines)]
  await Promise.all([
    page.waitForURL(/\/import-song$/),
    page.evaluate(
      ({ bytes, name }) => {
        const form = document.createElement('form')
        form.method = 'POST'
        form.action = '/share-target'
        form.enctype = 'multipart/form-data'
        const input = document.createElement('input')
        input.type = 'file'
        input.name = 'files'
        const transfer = new DataTransfer()
        transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }))
        input.files = transfer.files
        form.append(input)
        document.body.append(form)
        form.submit()
      },
      { bytes, name }
    ),
  ])
}

test('a PDF chart shared to the app finds its song in the library', async ({ page }) => {
  await openApp(page, '/')
  await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const { createSong } = await import('/js/song-utils.ts')
    await getCurrentDB() // opens the library the song is saved to
    await createSong('{title: Great Is He}\n{key: D}\n[D]Words here', { title: 'Great Is He' })
  })
  await sharePdf(page, 'Great Is He - G.pdf', ['Great Is He', 'Key of G'])
  await expect(page.locator('song-import')).toContainText('Great Is He')
  await expect(page.locator('song-import')).toContainText('Save to Library Only')

  // Added to a setlist, it is in the chart's key; the library's song keeps its own
  await page.getByRole('button', { name: /Create New Setlist/ }).click()
  await page.getByRole('button', { name: /Create & Add Song/ }).click()
  await page.waitForURL(/\/setlist\//)
  const keys = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const setlists = await (await getCurrentDB()).getAllSetlists()
    return setlists.flatMap(setlist => setlist.songs.map(song => song.key))
  })
  expect(keys).toEqual(['G'])
})

test('a PDF chart whose song is not in the library links to SongSelect', async ({ page }) => {
  await openApp(page, '/')
  await sharePdf(page, 'Unheard Of Anthem - D.pdf', [
    'Unheard Of Anthem',
    'Key of D',
    'CCLI Song # 1234567',
  ])
  const unmatched = page.locator('song-import .unmatched')
  await expect(unmatched).toContainText('Unheard Of Anthem')
  await expect(unmatched.getByRole('link')).toHaveAttribute(
    'href',
    /songselect\.ccli\.com\/songs\/1234567/
  )
})
