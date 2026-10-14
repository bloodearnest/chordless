// Opening a share link: a recipient with no account, in a browser that has never seen the app.
// The worker's download (/api/share/<id>, which asks Google Drive) is replaced by a stub that
// serves a file encrypted here; Drive itself is covered by the sync tests against fake-drive.
// Service workers are blocked so the page's own requests are the ones the stub sees.
import type { BrowserContext, Page } from '@playwright/test'
import { buildShareBundle } from '../src/js/share-bundle.ts'
import { encryptBundle, generateShareKey, shareUrl } from '../src/js/share-crypto.ts'
import { makeEntry } from './builders.ts'
import { expect, seedSetlist, test } from './fixtures.ts'

const FILE = 'abcdefghijklmnop1234'

const bundle = (over: { expires?: string; chart?: string } = {}) =>
  buildShareBundle(
    { date: '2099-10-11', time: '10:30', type: 'Church Service', name: '', owner: 'Ann Smith' },
    [
      {
        entry: makeEntry({ order: 0, songId: 'a', key: 'A', notes: 'repeat 4x' }),
        title: 'Amazing Grace',
        songKey: 'G',
        chordpro:
          over.chart ?? '{title: Amazing Grace}\n{key: G}\n\n[G]Amazing [C]grace how [G]sweet',
      },
      {
        entry: makeEntry({ order: 1, songId: 'b', key: 'D', notes: '' }),
        title: 'Be Still',
        songKey: 'D',
        chordpro: '{title: Be Still}\n{key: D}\n\n[D]Be still and [A]know',
      },
    ],
    { expires: over.expires ?? '2099-12-31' }
  )

/** Stub the worker's download for the share: 200 with the file, 304 for the same ETag, or a status */
async function serveShare(
  context: BrowserContext,
  key: string,
  options: { status?: number; etag?: string; bundle?: ReturnType<typeof bundle> } = {}
) {
  const requests: string[] = []
  await context.route(`**/api/share/${FILE}`, async route => {
    requests.push(route.request().headers()['if-none-match'] ?? '')
    if (options.status) return route.fulfill({ status: options.status })
    const etag = options.etag ?? '"v1"'
    if (route.request().headers()['if-none-match'] === etag) {
      return route.fulfill({ status: 304, headers: { ETag: etag } })
    }
    const body = Buffer.from(await encryptBundle(key, options.bundle ?? bundle()))
    return route.fulfill({
      status: 200,
      headers: { ETag: etag, 'Content-Type': 'application/octet-stream' },
      body,
    })
  })
  return requests
}

async function recipient(browser, { firstUse = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-GB' })
  // The first-use setup modal blocks the page: these tests have answered it already
  if (!firstUse) await context.addInitScript(() => localStorage.setItem('setup-done', '1'))
  return { context, page: await context.newPage() }
}

const linkTo = (key: string) => new URL(shareUrl('http://localhost', FILE, key))

async function openLink(page: Page, key: string) {
  const link = linkTo(key)
  await page.goto(`${link.pathname}${link.hash}`)
}

test.describe('A setlist shared by link', () => {
  test('a first-time visitor is asked how they read, then sees the setlist', async ({
    browser,
  }) => {
    const key = generateShareKey()
    const { context, page } = await recipient(browser, { firstUse: true })
    await serveShare(context, key)

    await openLink(page, key)
    const modal = page.getByRole('dialog', { name: 'Welcome to Chordless' })
    await expect(modal).toBeVisible()
    const setup = page.locator('first-use-setup')
    await setup.getByRole('radio', { name: /^Lyrics only/ }).check()
    await setup.getByRole('button', { name: 'Continue' }).click()

    await expect(page.locator('setlist-overview')).toContainText('Amazing Grace')
    expect(await page.evaluate(() => localStorage.getItem('musician_type'))).toBe('singer')
    await context.close()
  })

  test('opens for someone with no account: the overview, then each song, read-only', async ({
    browser,
  }) => {
    const key = generateShareKey()
    const { context, page } = await recipient(browser)
    await serveShare(context, key)

    await openLink(page, key)
    const header = page.locator('#app-header')
    await expect(header).toContainText(/Sun,? 11 Oct/)
    await expect(page.locator('setlist-overview')).toContainText('Amazing Grace')
    await expect(page.locator('setlist-overview')).toContainText('Be Still')

    // Nothing to edit, and no way into edit mode
    await expect(header.locator('.edit-toggle, [aria-label*="dit mode" i]')).toHaveCount(0)
    await expect(page.locator('body')).not.toHaveClass(/edit-mode/)
    // ...though the setlist's details can be read, with no way to edit, delete or share it
    await expect(header.locator('.info-button')).toHaveCount(1)
    await header.locator('.info-button').click()
    const info = page.locator('setlist-info-dialog')
    await expect(info).toContainText('Ann Smith')
    await expect(info.locator('.edit-button')).toHaveCount(0)
    await page.keyboard.press('Escape')
    // The reader isn't offered sharing
    await expect(page.locator('setlist-share')).toHaveCount(0)

    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/\/s\/abcdefghijklmnop1234\/song\/0$/)
    await expect(header).toContainText('Amazing Grace')
    await expect(page.locator('#main-content')).toContainText('grace how')

    await page.keyboard.press('ArrowRight')
    await expect(header).toContainText('Be Still')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page).toHaveURL(/\/s\/abcdefghijklmnop1234$/)
    await context.close()
  })

  test('opens again without the key in the URL, and asks whether anything changed', async ({
    browser,
  }) => {
    const key = generateShareKey()
    const { context, page } = await recipient(browser)
    const requests = await serveShare(context, key)

    await openLink(page, key)
    await expect(page.locator('setlist-overview')).toContainText('Amazing Grace')

    await page.goto(`/s/${FILE}`)
    await expect(page.locator('setlist-overview')).toContainText('Amazing Grace')
    expect(requests).toEqual(['', '"v1"'])
    await context.close()
  })

  test('shows a changed setlist when it is opened again', async ({ browser }) => {
    const key = generateShareKey()
    const { context, page } = await recipient(browser)
    await serveShare(context, key)
    await openLink(page, key)
    await expect(page.locator('setlist-overview')).toContainText('Amazing Grace')

    await context.unroute(`**/api/share/${FILE}`)
    await serveShare(context, key, {
      etag: '"v2"',
      bundle: bundle({ chart: '{title: Amazing Grace (new)}\n{key: G}\n\n[G]Changed line' }),
    })
    await page.goto(`/s/${FILE}`)
    await expect(page.locator('setlist-overview')).toContainText('Amazing Grace (new)')
    await context.close()
  })

  test('says the share has ended, and keeps nothing, when it was stopped', async ({ browser }) => {
    const key = generateShareKey()
    const { context, page } = await recipient(browser)
    await serveShare(context, key)
    await openLink(page, key)
    await expect(page.locator('setlist-overview')).toContainText('Amazing Grace')

    await context.unroute(`**/api/share/${FILE}`)
    await serveShare(context, key, { status: 404 })
    await page.goto(`/s/${FILE}`)
    await expect(page.locator('#share-status')).toHaveText('This share has ended')

    // The setlist is gone from this device, and its songs are kept
    const kept = await page.evaluate(
      () =>
        new Promise<{ setlists: number; songs: number }>((resolve, reject) => {
          const open = indexedDB.open('shared-with-me')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result
            const tx = db.transaction(['setlists', 'songs'], 'readonly')
            const setlists = tx.objectStore('setlists').count()
            const songs = tx.objectStore('songs').count()
            tx.oncomplete = () => {
              db.close()
              resolve({ setlists: setlists.result, songs: songs.result })
            }
          }
        })
    )
    expect(kept).toEqual({ setlists: 0, songs: 2 })
    await context.close()
  })

  test('says so when the link has lost its key', async ({ browser }) => {
    const { context, page } = await recipient(browser)
    await serveShare(context, generateShareKey())
    await page.goto(`/s/${FILE}`)
    await expect(page.locator('#share-status')).toHaveText('This link is incomplete')
    await context.close()
  })

  test('does not open a share that has already expired', async ({ browser }) => {
    const key = generateShareKey()
    const { context, page } = await recipient(browser)
    await serveShare(context, key, { bundle: bundle({ expires: '2020-01-01' }) })
    await openLink(page, key)
    await expect(page.locator('#share-status')).toHaveText('This share has ended')
    await context.close()
  })

  test('is listed under "Shared with me" on the home page, until it ends', async ({ browser }) => {
    const key = generateShareKey()
    const { context, page } = await recipient(browser)
    await serveShare(context, key)
    await openLink(page, key)
    await expect(page.locator('setlist-overview')).toContainText('Amazing Grace')

    await page.goto('/')
    const group = page.locator('setlist-group', { hasText: 'Shared with me' })
    await expect(group).toContainText('Ann Smith')
    await expect(page.locator('welcome-card')).toHaveCount(0)
    await group.getByRole('link').first().click()
    await expect(page).toHaveURL(/\/s\/abcdefghijklmnop1234$/)
    await expect(page.locator('setlist-overview')).toContainText('Be Still')

    await context.unroute(`**/api/share/${FILE}`)
    await serveShare(context, key, { status: 404 })
    await page.goto(`/s/${FILE}`)
    await expect(page.locator('#share-status')).toHaveText('This share has ended')
    await page.goto('/')
    await expect(page.locator('setlist-group', { hasText: 'Shared with me' })).toHaveCount(0)
    await context.close()
  })

  test('goes to the setlist, with no download, for someone who has it in their organisation', async ({
    page,
  }) => {
    const setlistId = '3f2a9c10-7b1e-4d55-9a6c-0e8f12345678'
    const url = await seedSetlist(page, { setlistId })
    const key = generateShareKey()
    const requests = await serveShare(page.context(), key)

    const link = new URL(shareUrl('http://localhost', FILE, key, setlistId))
    await page.goto(`${link.pathname}${link.hash}`)
    await expect(page).toHaveURL(new RegExp(`${url}$`))
    expect(requests).toEqual([])

    // A link for a setlist they don't have is opened as a share
    const other = new URL(
      shareUrl('http://localhost', FILE, key, 'aaaaaaaa-7b1e-4d55-9a6c-0e8f12345678')
    )
    await page.goto(`${other.pathname}${other.hash}`)
    await expect(page).toHaveURL(/\/s\/abcdefghijklmnop1234$/)
    await expect(page.locator('setlist-overview')).toContainText('Be Still')
    expect(requests).toHaveLength(1)
  })

  test('its songs are in the song library, to read and to add to it', async ({ browser }) => {
    const key = generateShareKey()
    const { context, page } = await recipient(browser)
    await serveShare(context, key)
    await openLink(page, key)
    await expect(page.locator('setlist-overview')).toContainText('Amazing Grace')

    await page.goto('/songs')
    const card = page.locator('song-card', { hasText: 'Be Still' })
    await expect(card).toContainText('From Shared with me')
    await card.click()
    await expect(page.locator('#library-song-source')).toContainText('From Shared with me')
    await expect(page.locator('#library-song-content')).toContainText('Be still and')

    await page.locator('#add-to-library').click()
    await expect(page.locator('#library-song-source')).toHaveCount(0)
    await expect(page.locator('#library-song-content')).toContainText('Be still and')
    await page.goto('/songs')
    await expect(page.locator('song-card', { hasText: 'Be Still' })).not.toContainText(
      'From Shared with me'
    )
    await context.close()
  })
})
