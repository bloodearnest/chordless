// Playwright test runner for browser-based tests
import { expect, test } from '@playwright/test'

test.describe('Application Pages', () => {
  test('home page should load', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#home-view', { timeout: 5000 })
    const homeView = await page.locator('#home-view').count()
    expect(homeView).toBe(1)
  })

  test('setlist page should load', async ({ page }) => {
    // /setlist.html causes an infinite redirect in wrangler; use the routed URL.
    // SW must be active first so /setlist/test-uuid is routed to setlist.html.
    await page.goto('/')
    await page.waitForFunction(() =>
      navigator.serviceWorker.ready.then(reg => reg.active?.state === 'activated')
    )
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

    await page.goto('/setlist/test-uuid')
    await expect(page).toHaveTitle('Setlist - Chordless')
    await page.waitForSelector('#song-view', { timeout: 5000 })
    expect(await page.locator('#song-view').count()).toBe(1)
  })

  test('every page follows the system dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    const background = async url => {
      await page.goto(url)
      await page.waitForFunction(() => document.documentElement.style.length > 0)
      return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    }
    const dark = await background('/songs')
    for (const url of ['/import-song', '/bookmarklet', '/storage']) {
      expect(await background(url), url).toBe(dark)
    }
  })
})

test.describe('Loading', () => {
  test('modal content is hidden until app-modal is defined', async ({ page }) => {
    // Hold app-modal.js until we've checked, so the element stays undefined
    let releaseModal
    const modalHeld = new Promise(resolve => {
      releaseModal = resolve
    })
    await page.route(/\/components\/app-modal\.js$/, async route => {
      await modalHeld
      await route.continue()
    })

    await page.goto('/', { waitUntil: 'commit' })
    const input = page.locator('#create-setlist-modal setlist-details-form')
    await input.waitFor({ state: 'attached' })
    expect(await page.evaluate(() => customElements.get('app-modal'))).toBeUndefined()
    await expect(input).toBeHidden()

    releaseModal()
    await page.waitForFunction(() => customElements.get('app-modal'))
    await expect(input).toBeHidden()
  })
})

/** Open the app once so it sets up its organisation and database (the first
 * visit reloads when the service worker takes control), then add a test song,
 * and optionally a setlist containing it. */
async function seedSong(page, { setlistId = null } = {}) {
  await page.goto('/songs')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  // The app reloads itself when the service worker first takes control, which
  // can land mid-seed. A page loaded under the worker doesn't, so reload first.
  await page.reload()
  await page.evaluate(async setlistId => {
    const { getCurrentDB } = await import('/js/db.js')
    const db = await getCurrentDB()
    const content = '{title: Info Test Song}\n{key: G}\n\n[G]Amazing [C]grace'
    await db.saveChordPro({
      id: 'chordpro-info-test',
      content,
      contentHash: 'test',
      lastModified: Date.now(),
    })
    await db.saveSong({
      uuid: 'info-test-song',
      id: 'title-info-test-song',
      title: 'Info Test Song',
      titleNormalized: 'infotestsong',
      isDefault: true,
      chordproFileId: 'chordpro-info-test',
      modifiedDate: new Date().toISOString(),
    })
    if (setlistId) {
      await db.saveSetlist({
        id: setlistId,
        date: '2026-10-11',
        time: '10:30',
        type: 'Church Service',
        name: '',
        owner: 'Ann',
        songs: [{ songId: 'title-info-test-song', key: 'A' }],
        createdDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      })
    }
  }, setlistId)
}

/** Call a method of the app's database, e.g. fromDB(page, 'getSong', uuid) */
function fromDB(page, method, arg) {
  return page.evaluate(
    async ({ method, arg }) => {
      const { getCurrentDB } = await import('/js/db.js')
      return (await getCurrentDB())[method](arg)
    },
    { method, arg }
  )
}

test.describe('Song info', () => {
  test('info button on the songs page opens the song info dialog', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page)

    await page.goto('/songs#info-test-song')
    await page.reload()
    // The header shows the song once it has loaded; info refers to it from then on
    await expect(page.locator('#library-app-header')).toContainText('Info Test Song')
    await page.locator('#library-app-header .info-button').click()

    const modal = page.locator('#library-song-info-dialog app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await expect(modal).toHaveAttribute('heading', 'Info Test Song')
    await expect(page.locator('#library-song-info-dialog song-info')).toContainText('Key')
    expect(errors).toEqual([])
  })

  test('info button on a setlist song opens the song info dialog', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'info-test-setlist' })

    await page.goto('/setlist/info-test-setlist#song-0')
    // The header shows the song once it has loaded; info refers to it from then on
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header .info-button').click()

    const modal = page.locator('#song-info-dialog app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await expect(modal).toHaveAttribute('heading', 'Info Test Song')
    // Played in this setlist, so it appears in the history
    await expect(page.locator('#song-info-dialog song-info')).toContainText('Ann')
    expect(errors).toEqual([])
  })

  test('info button on the setlist overview opens the setlist info dialog', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'info-test-setlist' })

    await page.goto('/setlist/info-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
    await page.locator('#app-header .info-button').click()

    const modal = page.locator('#setlist-info-dialog app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await expect(modal).toHaveAttribute('heading', 'Sunday, 11 October 2026')
    const info = page.locator('#setlist-info-dialog setlist-info')
    await expect(info).toContainText('Ann')
    await expect(info).toContainText('1 song')
    expect(errors).toEqual([])
  })

  test('a leader entered when creating a setlist appears in its info', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
    await page.reload() // see seedSong: avoid the app's first-load reload mid-test

    await page.locator('#create-setlist-button').click()
    const form = page.locator('#create-setlist-form')
    await form.locator('#name').fill('Leader Test')
    await form.locator('#leader').selectOption('other')
    await form.locator('#leader-other').fill('  Ann  ')
    await form.locator('button[type="submit"]').click()
    await page.waitForURL(/\/setlist\//)
    // The redirect from the home page logs an aborted view transition and a null
    // rejection; only check for errors on the new setlist page itself
    errors.length = 0

    // The info button does nothing until the new setlist has loaded
    const modal = page.locator('#setlist-info-dialog app-modal')
    await expect(async () => {
      await page.locator('#app-header .info-button').click()
      await expect(modal).toHaveAttribute('open', '', { timeout: 500 })
    }).toPass()
    await expect(page.locator('#setlist-info-dialog setlist-info')).toContainText('Ann')
    expect(errors).toEqual([])
  })

  test('setlist details can be edited from the info dialog', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'edit-test-setlist' })
    await page.goto('/setlist/edit-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)

    await page.locator('#app-header .info-button').click()
    const dialog = page.locator('#setlist-info-dialog')
    await dialog.locator('.edit-button').click()
    const form = dialog.locator('setlist-details-form')
    // The setlist's current leader is selected
    await expect(form.locator('#leader option:checked')).toHaveText('Ann')
    // Type with real key presses: page shortcuts (space starts the song, arrows
    // change song) must leave text fields alone
    await form.locator('#leader').selectOption('other')
    const leader = form.locator('#leader-other')
    await leader.pressSequentially('Ben Smith')
    await leader.press('ArrowLeft')
    await leader.press('ArrowLeft')
    await leader.pressSequentially('-')
    await expect(leader).toHaveValue('Ben Smi-th')
    await form.locator('#date').fill('2026-10-18')
    await form.locator('#name').fill('Harvest')
    await form.locator('button[type="submit"]').click()

    // Back to read-only, showing the saved details
    const modal = dialog.locator('app-modal')
    await expect(modal).toHaveAttribute('heading', 'Sunday, 18 October 2026 - Harvest')
    await expect(dialog.locator('setlist-info')).toContainText('Ben Smi-th')
    // The page header uses the short format (with the year once 2026 is past)
    await expect(page.locator('#app-header')).toContainText(/Sun,? 18 Oct( 2026)? - Harvest/)

    // Saved: still there after a reload
    await page.reload()
    const saved = await page.evaluate(async () => {
      const { getCurrentDB } = await import('/js/db.js')
      return (await getCurrentDB()).getSetlist('edit-test-setlist')
    })
    expect(saved).toMatchObject({
      owner: 'Ben Smi-th',
      ownerId: '',
      date: '2026-10-18',
      name: 'Harvest',
    })
    expect(errors).toEqual([])
  })

  test('cancelling a setlist details edit changes nothing', async ({ page }) => {
    await seedSong(page, { setlistId: 'cancel-test-setlist' })
    await page.goto('/setlist/cancel-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)

    await page.locator('#app-header .info-button').click()
    const dialog = page.locator('#setlist-info-dialog')
    await dialog.locator('.edit-button').click()
    await dialog.locator('setlist-details-form #leader').selectOption('other')
    await dialog.locator('setlist-details-form #leader-other').fill('Not saved')
    await dialog.locator('setlist-details-form .cancel').click()

    await expect(dialog.locator('setlist-info')).toContainText('Ann')
    const saved = await page.evaluate(async () => {
      const { getCurrentDB } = await import('/js/db.js')
      return (await getCurrentDB()).getSetlist('cancel-test-setlist')
    })
    expect(saved.owner).toBe('Ann')
  })
})

test.describe('Song import', () => {
  /** Open the import page and hand it a song, as the bookmarklet would */
  async function importSong(page, title) {
    await page.goto('/import-song')
    await page.waitForFunction(() => customElements.get('song-import'))
    await page.locator('song-import').evaluate(
      (element, title) =>
        element.receive({
          chordproText: `{title: ${title}}\n{key: D}\n\n[D]Hello [G]world`,
          metadata: { title },
          source: 'songselect',
        }),
      title
    )
  }

  /** Deliver a message to the import page as if posted by the bookmarklet */
  function postMessageFrom(page, origin, data) {
    return page.evaluate(
      ({ origin, data }) => window.dispatchEvent(new MessageEvent('message', { origin, data })),
      { origin, data }
    )
  }

  test('shows a failed SongSelect download, and ignores other sites', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/import-song')
    await page.waitForFunction(() => customElements.get('song-import'))
    const songImport = page.locator('song-import')
    const failed = { type: 'CHORDLESS_IMPORT_FAILED', data: { message: 'Download failed: 403' } }

    await postMessageFrom(page, 'https://evil.example', failed)
    await expect(songImport).toContainText('Waiting for song data')

    await postMessageFrom(page, 'https://songselect.ccli.com', failed)
    await expect(songImport.getByRole('alert')).toContainText('Download failed: 403')
    expect(errors).toEqual([])
  })

  test('saves a new song to the library only', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page)
    await importSong(page, 'Imported Song')

    await expect(page.getByRole('heading', { name: /Imported Song/ })).toBeVisible()
    expect(errors).toEqual([]) // leaving the page logs an aborted view transition
    await page.locator('song-import .library-only').click()
    await page.waitForURL(/\/songs#/)

    const uuid = new URL(page.url()).hash.slice(1)
    const song = await fromDB(page, 'getSong', uuid)
    expect(song.title).toBe('Imported Song')
  })

  test('adds a new song to a new setlist', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page)
    await importSong(page, 'Imported Song')

    await page.locator('song-import .new-setlist').click()
    const modal = page.locator('song-import app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await modal.locator('#name').fill('Import Test')
    expect(errors).toEqual([]) // leaving the page logs an aborted view transition
    await modal.locator('button[type="submit"]').click()
    await page.waitForURL(/\/setlist\//)

    const setlistId = new URL(page.url()).pathname.split('/').pop()
    const setlist = await fromDB(page, 'getSetlist', setlistId)
    expect(setlist.name).toBe('Import Test')
    expect(setlist.songs.map(s => s.songId)).toEqual(['title-importedsong'])
  })

  test('adds a song already in the library to an existing setlist', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'import-test-setlist' })
    await importSong(page, 'Info Test Song')

    const songImport = page.locator('song-import')
    await expect(songImport).toContainText('already exists in your library')
    await songImport.locator('.use-existing').click()
    await expect(songImport.locator('select')).toHaveValue('import-test-setlist')
    expect(errors).toEqual([]) // leaving the page logs an aborted view transition
    await songImport.locator('.add').click()
    await page.waitForURL(/\/setlist\/import-test-setlist/)

    const setlist = await fromDB(page, 'getSetlist', 'import-test-setlist')
    expect(setlist.songs.map(s => s.songUuid)).toEqual([undefined, 'info-test-song'])
    const chart = await fromDB(page, 'getChordPro', 'chordpro-info-test')
    expect(chart.content).toContain('[G]Amazing [C]grace')
  })

  test('updates a song already in the library with the imported one', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page)
    await importSong(page, 'Info Test Song')

    const songImport = page.locator('song-import')
    await expect(songImport).toContainText('already exists in your library')
    await songImport.locator('.update').click()
    expect(errors).toEqual([]) // leaving the page logs an aborted view transition
    await songImport.locator('.library-only').click()
    await page.waitForURL(/\/songs#info-test-song/)

    const chart = await fromDB(page, 'getChordPro', 'chordpro-info-test')
    expect(chart.content).toContain('[D]Hello [G]world')
    const song = await fromDB(page, 'getSong', 'info-test-song')
    expect(song.key).toBe('D')
    expect(song.id).toBe('title-info-test-song')
  })
})

test.describe('Navigation menu', () => {
  for (const path of [
    '/',
    '/songs',
    '/setlist/menu-test-setlist',
    '/preferences',
    '/storage',
    '/bookmarklet',
  ]) {
    test(`opens and closes on ${path}`, async ({ page }) => {
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await seedSong(page, { setlistId: 'menu-test-setlist' })
      await page.goto(path)

      // Either the page's own menu button or the app-header's
      const button = page.locator('#nav-menu-button, app-header .nav-menu-button').first()
      const menu = page.locator('nav-menu .nav-menu-popover')
      // Pages wire up once their scripts have run, so retry the first click
      await expect(async () => {
        await button.click()
        await expect(menu).toBeVisible({ timeout: 500 })
      }).toPass()
      await expect(menu.getByText('Song Library')).toBeVisible()

      await button.click()
      await expect(menu).toBeHidden()
      expect(errors).toEqual([])
    })
  }
})

test.describe('Media player settings', () => {
  test('turning the media player off in preferences hides it on setlists', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'player-test-setlist' })

    await page.goto('/setlist/player-test-setlist')
    await expect(page.locator('media-player')).toBeVisible()

    await page.goto('/preferences')
    const masterToggle = page.locator('media-player-settings .master-toggle')
    await masterToggle.click()
    await expect(masterToggle).not.toHaveClass(/active/)

    await page.goto('/setlist/player-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
    await expect(page.locator('media-player')).toBeHidden()
    expect(errors).toEqual([])
  })
})

test.describe('Storage page', () => {
  test('clearing local data asks first, then clears it', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'clear-test-setlist' })
    await page.goto('/storage')

    const clearButton = page.locator('storage-page .storage-button.danger')
    const modal = page.locator('storage-page #clear-data-modal')

    // Cancelling keeps everything
    await clearButton.click()
    await expect(modal).toHaveAttribute('open', '')
    await modal.locator('.modal-btn-cancel').click()
    await expect(modal).not.toHaveAttribute('open', '')
    expect(await fromDB(page, 'getSetlist', 'clear-test-setlist')).toBeTruthy()

    // Confirming clears it and reloads
    await clearButton.click()
    await Promise.all([page.waitForEvent('load'), modal.locator('.modal-btn-confirm').click()])
    expect(await fromDB(page, 'getSetlist', 'clear-test-setlist')).toBeFalsy()
    expect(errors).toEqual([])
  })
})
