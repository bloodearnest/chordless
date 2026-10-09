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

  test('settings panels follow the theme, with matching text', async ({ page }) => {
    const lightness = rgb =>
      rgb
        .match(/\d+/g)
        .slice(0, 3)
        .reduce((sum, n) => sum + Number(n), 0)
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme })
      for (const [url, host] of [
        ['/storage', 'storage-page'],
        ['/preferences', 'app-preferences'],
      ]) {
        await page.goto(url)
        const panel = page.locator(`${host} .panel`).first()
        await expect(panel).toBeVisible()
        const { bg, text } = await panel.evaluate(element => ({
          bg: getComputedStyle(element).backgroundColor,
          text: getComputedStyle(element).color,
        }))
        const label = `${url} in ${scheme} mode`
        if (scheme === 'light') {
          expect(lightness(bg), label).toBeGreaterThan(600)
          expect(lightness(text), label).toBeLessThan(150)
        } else {
          expect(lightness(bg), label).toBeLessThan(150)
          expect(lightness(text), label).toBeGreaterThan(600)
        }
      }
    }
  })

  test('in dark mode a modal is lighter than the page beneath it, and edged', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/storage')
    await page.locator('storage-page').getByRole('button', { name: 'Clear Local Data' }).click()
    const card = page.locator('storage-page #clear-data-modal').locator('.modal-content')
    await expect(card).toBeVisible()
    const { cardBg, pageBg, border } = await card.evaluate(element => ({
      cardBg: getComputedStyle(element).backgroundColor,
      pageBg: getComputedStyle(document.body).backgroundColor,
      border: getComputedStyle(element).borderTopColor,
    }))
    const lightness = rgb =>
      rgb
        .match(/\d+/g)
        .slice(0, 3)
        .reduce((sum, n) => sum + Number(n), 0)
    expect(lightness(cardBg)).toBeGreaterThan(lightness(pageBg))
    expect(border).not.toBe('rgba(0, 0, 0, 0)')
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
    await expect(songImport).toContainText('Import ChordPro Files')
    await expect(songImport.getByRole('alert')).toHaveCount(0)

    await postMessageFrom(page, 'https://songselect.ccli.com', failed)
    await expect(songImport.getByRole('alert')).toContainText('Download failed: 403')
    expect(errors).toEqual([])
  })

  /** A file for the import page's file picker */
  function chordproFile(name, content, mimeType = '') {
    return { name, mimeType, buffer: Buffer.from(content) }
  }

  test('imports several files into a new setlist, skipping ones that are not text', async ({
    page,
  }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page)
    await page.goto('/import-song')
    const songImport = page.locator('song-import')
    await songImport.locator('input[type="file"]').setInputFiles([
      chordproFile('First.cho', '{title: First Song}\n\n[C]One'),
      // No title in the chart: named after the file
      chordproFile('Second Song.chordpro', '[D]Two'),
      chordproFile('photo.png', 'not a song', 'image/png'),
    ])

    await expect(page.getByRole('heading', { name: /2 songs/ })).toBeVisible()
    await expect(songImport.locator('.songs')).toContainText('First Song')
    await expect(songImport.locator('.songs')).toContainText('Second Song')
    await expect(songImport).toContainText('Not imported: photo.png: not a text file')

    await songImport.locator('.new-setlist').click()
    const modal = songImport.locator('app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await modal.locator('#name').fill('Files Test')
    expect(errors).toEqual([]) // leaving the page logs an aborted view transition
    await modal.locator('button[type="submit"]').click()
    await page.waitForURL(/\/setlist\//)

    const setlistId = new URL(page.url()).pathname.split('/').pop()
    const setlist = await fromDB(page, 'getSetlist', setlistId)
    expect(setlist.songs.map(s => s.songId)).toEqual(['title-firstsong', 'title-secondsong'])
  })

  test('imports pasted ChordPro into an existing setlist', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'paste-test-setlist' })
    await page.goto('/import-song')
    const songImport = page.locator('song-import')
    await songImport.locator('textarea').fill('{title: Pasted Song}\n\n[E]Pasted')
    await songImport.locator('.paste .add').click()

    await expect(page.getByRole('heading', { name: /Pasted Song/ })).toBeVisible()
    expect(errors).toEqual([]) // leaving the page logs an aborted view transition
    await songImport.locator('.add-to-setlist .add').click()
    await page.waitForURL(/\/setlist\/paste-test-setlist/)

    const setlist = await fromDB(page, 'getSetlist', 'paste-test-setlist')
    expect(setlist.songs.map(s => s.songId)).toEqual(['title-info-test-song', 'title-pastedsong'])
    const song = await fromDB(page, 'getSong', setlist.songs[1].songUuid)
    expect(song.importSource).toBe('paste')
  })

  test('says so when the pasted text is empty', async ({ page }) => {
    await page.goto('/import-song')
    const songImport = page.locator('song-import')
    await songImport.locator('.paste .add').click()
    await expect(songImport.getByRole('alert')).toContainText('No songs to import')
    await expect(songImport).toContainText('Import ChordPro Files')
  })

  test('asks about each song already in the library among several', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page)
    await page.goto('/import-song')
    const songImport = page.locator('song-import')
    await songImport
      .locator('input[type="file"]')
      .setInputFiles([
        chordproFile('a.cho', '{title: Info Test Song}\n\n[A]Updated'),
        chordproFile('b.cho', '{title: Brand New}\n\n[B]New'),
      ])

    await expect(songImport).toContainText('1 of these songs is already in your library')
    await expect(songImport.locator('.choices')).toHaveCount(0)
    await songImport.locator('.update-all').click()
    await expect(songImport.locator('.songs')).toContainText('updated')
    expect(errors).toEqual([]) // leaving the page logs an aborted view transition
    await songImport.locator('.library-only').click()
    await page.waitForURL(/\/songs$/)

    const chart = await fromDB(page, 'getChordPro', 'chordpro-info-test')
    expect(chart.content).toContain('[A]Updated')
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

test.describe('Bookmarklet page', () => {
  test('hides the phone and tablet tip on a computer', async ({ page }) => {
    await page.goto('/bookmarklet')
    await expect(page.locator('.touch-tip')).toBeHidden()
    await expect(page.getByText('Ctrl+D or Cmd+D')).toBeVisible()
  })

  test.describe('on a phone', () => {
    test.use({ isMobile: true, hasTouch: true, viewport: { width: 412, height: 900 } })

    test('hides the instructions that need a keyboard or bookmarks bar', async ({ page }) => {
      await page.goto('/bookmarklet')
      await expect(page.getByText('Ctrl+D or Cmd+D')).toBeHidden()
      await expect(page.getByText('Drag this button to your bookmarks bar')).toBeHidden()
      await expect(page.getByText('of any page, then edit it')).toBeVisible()
    })

    test('suggests importing the ChordPro file instead', async ({ page }) => {
      await page.goto('/bookmarklet')
      const tip = page.locator('.touch-tip')
      await expect(tip).toBeVisible()
      await expect(tip.getByRole('link', { name: 'Import Songs' })).toHaveAttribute(
        'href',
        '/import-song'
      )
    })
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

test.describe('Song settings', () => {
  test("the setlist's BPM survives a reload, over the library song's own", async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'bpm-test-setlist' })
    // Give the library song a tempo of its own
    await page.evaluate(async () => {
      const { getCurrentDB } = await import('/js/db.js')
      const db = await getCurrentDB()
      const chart = await db.getChordPro('chordpro-info-test')
      await db.saveChordPro({
        ...chart,
        content: chart.content.replace('{key: G}', '{key: G}\n{tempo: 72}'),
      })
    })
    const metadata = page.locator('#musical-metadata')
    const openSong = async () => {
      await page.goto('/setlist/bpm-test-setlist')
      await page.locator('setlist-overview song-card').first().click()
      await expect(page.locator('#app-header')).toContainText('Info Test Song')
    }

    await openSong()
    await expect.poll(() => metadata.evaluate(element => element.bpm)).toBe(72)
    await page.locator('#app-header .edit-toggle').click()
    await expect(metadata).toHaveAttribute('edit-mode')
    await metadata.click()
    const popover = page.locator('song-settings-popover')
    await popover.getByRole('button', { name: 'Increase BPM' }).click()
    await expect(popover.locator('.bpm-value')).toHaveText('73')
    await expect.poll(() => metadata.evaluate(element => element.bpm)).toBe(73)
    const setlist = await fromDB(page, 'getSetlist', 'bpm-test-setlist')
    expect(setlist.songs[0].tempo).toBe(73)

    await openSong()
    await expect.poll(() => metadata.evaluate(element => element.bpm)).toBe(73)
    expect(errors).toEqual([])
  })

  test('asking to reset a song closes the settings popover, which would cover the question', async ({
    page,
  }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'reset-test-setlist' })
    await page.goto('/setlist/reset-test-setlist')
    await page.locator('setlist-overview song-card').first().click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header .edit-toggle').click()
    await expect(page.locator('#musical-metadata')).toHaveAttribute('edit-mode')
    await page.locator('#musical-metadata').click()
    const popover = page.locator('song-settings-popover')
    await expect.poll(() => popover.evaluate(element => element.isOpen())).toBe(true)

    await popover.getByRole('button', { name: 'Reset song' }).click()
    const modal = page.locator('#reset-confirm-modal')
    await expect(modal).toHaveAttribute('open', '')
    expect(await popover.evaluate(element => element.isOpen())).toBe(false)

    await modal.locator('.modal-btn-cancel').click()
    await expect(modal).not.toHaveAttribute('open', '')
    expect(errors).toEqual([])
  })
})

test.describe('Media player settings', () => {
  test('its switches work from the keyboard, and are off limits while the player is off', async ({
    page,
  }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/preferences')
    const settings = page.locator('media-player-settings')
    const player = settings.getByRole('switch', { name: 'Enable Media Player' })
    const pads = settings.getByRole('switch', { name: 'Enable Pads' })
    await expect(player).toHaveAttribute('aria-checked', 'true')

    const padsWere = await pads.getAttribute('aria-checked')
    await pads.focus()
    await page.keyboard.press('Space')
    await expect(pads).not.toHaveAttribute('aria-checked', padsWere)

    await player.focus()
    await page.keyboard.press('Enter')
    await expect(player).toHaveAttribute('aria-checked', 'false')
    await expect(pads).toBeDisabled()
    await expect(settings.getByRole('switch', { name: 'Stereo Split (L/R)' })).toBeDisabled()
    expect(errors).toEqual([])
  })

  test('turning the media player off in preferences hides it on setlists', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'player-test-setlist' })

    await page.goto('/setlist/player-test-setlist')
    await expect(page.locator('media-player')).toBeVisible()

    await page.goto('/preferences')
    const masterToggle = page.locator('media-player-settings .toggle-switch.master')
    await masterToggle.click()
    await expect(masterToggle).not.toHaveClass(/active/)

    await page.goto('/setlist/player-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
    await expect(page.locator('media-player')).toBeHidden()
    expect(errors).toEqual([])
  })
})

test.describe('Storage page', () => {
  test('says when connecting to Google fails', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    // Without Google's sign-in script, connecting fails straight away
    await page.route('https://accounts.google.com/**', route => route.abort())
    await page.goto('/storage')

    await page
      .locator('storage-page')
      .getByRole('button', { name: /Connect with Google/ })
      .click()
    await expect(page.locator('storage-page').getByRole('alert')).toContainText(
      'Authorization failed'
    )
    expect(errors).toEqual([])
  })

  test('clearing local data asks first, then clears it', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page, { setlistId: 'clear-test-setlist' })
    await page.goto('/storage')

    const clearButton = page
      .locator('storage-page')
      .getByRole('button', { name: 'Clear Local Data' })
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
