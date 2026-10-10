import { expect, openApp, seedSetlist, test } from './fixtures.js'

// The pages that are views of the app shell change in place: the document, and
// anything living in it (the media player, to come), stays.

/** Mark the document, to tell later whether it was replaced */
const markDocument = page =>
  page.evaluate(() => {
    window.sameDocument = true
  })
const isSameDocument = page => page.evaluate(() => window.sameDocument === true)

async function chooseFromMenu(page, name) {
  await page.getByRole('button', { name: 'Navigation menu' }).click()
  await page.locator('nav-menu').getByRole('link', { name }).click()
}

test.describe('Moving between views', () => {
  test('a menu link to a view shows it without loading the page', async ({ page }) => {
    await openApp(page, '/')
    await expect(page.locator('home-view')).toBeVisible()
    await markDocument(page)

    await chooseFromMenu(page, 'Storage')

    await expect(page).toHaveURL(/\/storage$/)
    await expect(page).toHaveTitle('Storage - Chordless')
    await expect(page.locator('storage-view')).toBeVisible()
    await expect(page.locator('home-view')).toHaveCount(0)
    expect(await isSameDocument(page)).toBe(true)
    // The menu closes when the route changes
    await expect(page.locator('nav-menu .nav-menu-popover')).toBeHidden()
  })

  test('the back and forward buttons move between views', async ({ page }) => {
    await openApp(page, '/')
    await markDocument(page)
    await chooseFromMenu(page, 'Storage')
    await expect(page.locator('storage-view')).toBeVisible()

    await page.goBack()
    await expect(page.locator('home-view')).toBeVisible()
    await expect(page.locator('storage-view')).toHaveCount(0)
    await expect(page).toHaveTitle('Chordless')
    await expect(page).toHaveURL(/\/$/)

    await page.goForward()
    await expect(page.locator('storage-view')).toBeVisible()
    await expect(page).toHaveTitle('Storage - Chordless')
    expect(await isSameDocument(page)).toBe(true)
  })

  test('opening a view by its URL, and reloading it, shows it', async ({ page }) => {
    await openApp(page, '/storage')
    await expect(page.locator('storage-view')).toBeVisible()
    await page.reload()
    await expect(page.locator('storage-view')).toBeVisible()
    await expect(page).toHaveTitle('Storage - Chordless')
  })

  test('every view opens from its URL, with its own title', async ({ page }) => {
    const views = [
      ['/', 'home-view', 'Chordless'],
      ['/storage', 'storage-view', 'Storage - Chordless'],
      ['/preferences', 'preferences-view', 'Preferences - Chordless'],
      ['/import-song', 'import-song-view', 'Import Songs - Chordless'],
      ['/bookmarklet', 'bookmarklet-view', 'Bookmarklet - Chordless'],
      ['/songs', 'library-view', 'Song Library - Chordless'],
    ]
    await openApp(page, '/')
    for (const [path, tag, title] of views) {
      await page.goto(path)
      await expect(page.locator(tag), path).toBeVisible()
      await expect(page, path).toHaveTitle(title)
      // The only view in the outlet
      await expect(page.locator('#view-outlet > *'), path).toHaveCount(1)
    }
  })

  test('menu links move through the views without loading a page', async ({ page }) => {
    await openApp(page, '/')
    await markDocument(page)
    for (const [name, tag, title] of [
      ['Import Songs', 'import-song-view', 'Import Songs - Chordless'],
      ['SongSelect Import', 'bookmarklet-view', 'Bookmarklet - Chordless'],
      ['Storage', 'storage-view', 'Storage - Chordless'],
      ['Setlists', 'home-view', 'Chordless'],
    ]) {
      await chooseFromMenu(page, name)
      await expect(page.locator(tag), name).toBeVisible()
      await expect(page, name).toHaveTitle(title)
      await expect(page.locator('#view-outlet > *'), name).toHaveCount(1)
    }
    expect(await isSameDocument(page)).toBe(true)
  })

  test('a link to a page that is not a view yet loads the page', async ({ page }) => {
    await seedSetlist(page, { setlistId: 'link-setlist' })
    await openApp(page, '/')
    await markDocument(page)
    await page.locator('setlist-group').first().getByRole('link').first().click()
    await expect(page).toHaveURL(/\/setlist\/link-setlist/)
    await expect(page).toHaveTitle('Setlist - Chordless')
    expect(await isSameDocument(page)).toBe(false)
  })

  test('the page title reaches screen readers when the view changes', async ({ page }) => {
    await openApp(page, '/')
    await chooseFromMenu(page, 'Storage')
    await expect(page.locator('#route-announcer')).toHaveText('Storage - Chordless')
  })
})
