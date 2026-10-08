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
      titleNormalized: 'info test song',
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

test.describe('Song info', () => {
  test('info button on the songs page opens the song info dialog', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await seedSong(page)

    await page.goto('/songs#info-test-song')
    await page.reload()
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
    await form.locator('#leader').fill('  Ann  ')
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
    await expect(form.locator('#leader')).toHaveValue('Ann')
    // Type with real key presses: page shortcuts (space starts the song, arrows
    // change song) must leave text fields alone
    const leader = form.locator('#leader')
    await leader.fill('')
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
    expect(saved).toMatchObject({ owner: 'Ben Smi-th', date: '2026-10-18', name: 'Harvest' })
    expect(errors).toEqual([])
  })

  test('cancelling a setlist details edit changes nothing', async ({ page }) => {
    await seedSong(page, { setlistId: 'cancel-test-setlist' })
    await page.goto('/setlist/cancel-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)

    await page.locator('#app-header .info-button').click()
    const dialog = page.locator('#setlist-info-dialog')
    await dialog.locator('.edit-button').click()
    await dialog.locator('setlist-details-form #leader').fill('Not saved')
    await dialog.locator('setlist-details-form .cancel').click()

    await expect(dialog.locator('setlist-info')).toContainText('Ann')
    const saved = await page.evaluate(async () => {
      const { getCurrentDB } = await import('/js/db.js')
      return (await getCurrentDB()).getSetlist('cancel-test-setlist')
    })
    expect(saved.owner).toBe('Ann')
  })
})
