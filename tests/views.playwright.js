import { enterEditMode, expect, openApp, seedSetlist, test } from './fixtures.js'

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

  test('opening a setlist from the home page shows it without loading the page', async ({
    page,
  }) => {
    await seedSetlist(page, { setlistId: 'link-setlist' })
    await openApp(page, '/')
    await markDocument(page)
    await page.locator('setlist-group').first().getByRole('link').first().click()
    await expect(page).toHaveURL(/\/setlist\/link-setlist$/)
    await expect(page).toHaveTitle('Setlist - Chordless')
    await expect(page.locator('setlist-view')).toBeVisible()
    await expect(page.locator('setlist-overview')).toBeVisible()
    expect(await isSameDocument(page)).toBe(true)
  })

  test('the media player lives in the shell, and shows only while playing off a setlist', async ({
    page,
  }) => {
    await openApp(page, '/')
    const player = page.locator('#media-player')
    await expect(player).toHaveCount(1)
    await expect(player).toBeHidden()
    await markDocument(page)

    await chooseFromMenu(page, 'Storage')
    await expect(page.locator('storage-view')).toBeVisible()
    await expect(player).toBeHidden()

    // Playing shows it wherever you are, and it's the same player throughout
    await player.evaluate(element => {
      element._activeSongId = 'a-song'
    })
    await expect(player).toBeVisible()
    await expect(player).toHaveAttribute('active', '')
    await chooseFromMenu(page, 'Song Library')
    await expect(page.locator('library-view')).toBeVisible()
    await expect(player).toBeVisible()
    expect(await isSameDocument(page)).toBe(true)

    await player.evaluate(element => {
      element._activeSongId = null
    })
    await expect(player).toBeHidden()
  })

  test('the page title reaches screen readers when the view changes', async ({ page }) => {
    await openApp(page, '/')
    await chooseFromMenu(page, 'Storage')
    await expect(page.locator('#route-announcer')).toHaveText('Storage - Chordless')
  })
})

test.describe('The setlist view', () => {
  test('opening a song, and going back, moves through the history without loading a page', async ({
    page,
  }) => {
    const url = await seedSetlist(page)
    await page.goto(url)
    const header = page.locator('#app-header')
    await expect(header).toContainText(/Sun,? 11 Oct/)
    await markDocument(page)

    await page.locator('setlist-overview song-card').first().click()
    await expect(page).toHaveURL(/\/setlist\/seeded-setlist\/song\/0$/)
    await expect(header).toContainText('Alpha')

    await page.goBack()
    await expect(page).toHaveURL(/\/setlist\/seeded-setlist$/)
    await expect(header).toContainText(/Sun,? 11 Oct/)

    await page.goForward()
    await expect(header).toContainText('Alpha')
    expect(await isSameDocument(page)).toBe(true)
  })

  test('a song that is not in the setlist shows the overview', async ({ page }) => {
    const url = await seedSetlist(page)
    await page.goto(`${url}/song/99`)
    await expect(page).toHaveURL(/\/setlist\/seeded-setlist$/)
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
  })

  test('the menu lists the setlist songs only while on the setlist', async ({ page }) => {
    const url = await seedSetlist(page)
    await page.goto(url)
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
    await markDocument(page)

    await page.getByRole('button', { name: 'Navigation menu' }).click()
    await expect(page.locator('nav-menu').getByRole('button', { name: 'Alpha' })).toBeVisible()

    await page.locator('nav-menu').getByRole('link', { name: 'Storage' }).click()
    await expect(page.locator('storage-view')).toBeVisible()
    await page.getByRole('button', { name: 'Navigation menu' }).click()
    await expect(page.locator('nav-menu').getByRole('link', { name: 'Storage' })).toBeVisible()
    await expect(page.locator('nav-menu').getByRole('button', { name: 'Alpha' })).toHaveCount(0)
    expect(await isSameDocument(page)).toBe(true)
  })

  test('the keyboard shortcuts of the setlist stop when it is left', async ({ page }) => {
    const url = await seedSetlist(page)
    await page.goto(`${url}/song/0`)
    await expect(page.locator('#app-header')).toContainText('Alpha')
    await chooseFromMenu(page, 'Storage')
    await expect(page.locator('storage-view')).toBeVisible()

    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await expect(page).toHaveURL(/\/storage$/)
  })

  test('leaving a setlist in edit mode leaves edit mode', async ({ page }) => {
    const url = await seedSetlist(page)
    // A song's edit mode is set on <body>, which outlives the view
    await page.goto(`${url}/song/0`)
    await expect(page.locator('#app-header')).toContainText('Alpha')
    await enterEditMode(page)
    await expect(page.locator('body')).toHaveClass(/edit-mode/)

    await chooseFromMenu(page, 'Storage')
    await expect(page.locator('storage-view')).toBeVisible()
    await expect(page.locator('body')).not.toHaveClass(/edit-mode/)
  })

  test('the media player, and its audio, carry on across a move off the setlist', async ({
    page,
  }) => {
    const url = await seedSetlist(page)
    await page.goto(url)
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
    const player = page.locator('#media-player')
    await expect(player).toBeVisible()

    // Keep hold of the player's audio, and pretend a song is playing
    await player.evaluate(element => {
      window.playerElement = element
      window.audioContext = element._audioContext
      element._activeSongId = 'a-song'
    })

    await chooseFromMenu(page, 'Song Library')
    await expect(page.locator('library-view')).toBeVisible()
    await chooseFromMenu(page, 'Setlists')
    await expect(page.locator('home-view')).toBeVisible()

    const same = await page.evaluate(() => {
      const element = document.getElementById('media-player')
      return {
        sameElement: element === window.playerElement,
        sameAudio:
          element._audioContext === window.audioContext && window.audioContext !== undefined,
        stillActive: element.hasAttribute('active'),
      }
    })
    expect(same).toEqual({ sameElement: true, sameAudio: true, stillActive: true })
    await expect(player).toBeVisible()
  })

  test('a URL that is no page shows the not-found view', async ({ page }) => {
    await openApp(page, '/')
    await page.goto('/no/such/page')
    await expect(page.locator('not-found-view')).toBeVisible()
    await expect(page).toHaveTitle('Not found - Chordless')
    await page.getByRole('link', { name: 'Go to the setlists' }).click()
    await expect(page.locator('home-view')).toBeVisible()
  })
})
