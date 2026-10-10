// App-wide: themes, loading, display preferences, the menu, modals and the
// storage page
import { expect, fromDB, openApp, seedSetlist, seedSong, test } from './fixtures.js'

test.describe('Themes', () => {
  test('every page follows the system dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    const background = async url => {
      await page.goto(url)
      await page.waitForFunction(() => document.documentElement.style.length > 0)
      return page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    }
    await openApp(page, '/songs')
    const dark = await background('/songs')
    for (const url of ['/import-song', '/bookmarklet', '/storage']) {
      expect(await background(url), url).toBe(dark)
    }
  })

  test('a status message is readable in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await openApp(page, '/songs')
    await page.waitForFunction(() => customElements.get('status-message'))
    const color = await page.evaluate(() => {
      const message = document.createElement('status-message')
      document.body.append(message)
      return getComputedStyle(message).color
    })
    const lightness = color
      .match(/\d+/g)
      .slice(0, 3)
      .reduce((sum, n) => sum + Number(n), 0)
    expect(lightness).toBeGreaterThan(600)
  })

  test('settings panels follow the theme, with matching text', async ({ page }) => {
    const lightness = rgb =>
      rgb
        .match(/\d+/g)
        .slice(0, 3)
        .reduce((sum, n) => sum + Number(n), 0)
    await openApp(page, '/storage')
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
  // No service worker: its first install reloads the page, mid-test
  test.use({ serviceWorkers: 'block' })

  test('modal content is not in the page until app-modal is defined', async ({ page }) => {
    // Hold app-modal.js, so the element stays undefined
    let releaseModal
    const modalHeld = new Promise(resolve => {
      releaseModal = resolve
    })
    await page.route(/\/components\/app-modal\.js$/, async route => {
      await modalHeld
      await route.continue()
    })

    await page.goto('/', { waitUntil: 'commit' })
    await page.waitForFunction(() => document.querySelector('nav-menu'))
    await page.waitForTimeout(500) // time for the home view to have shown, if it were going to
    expect(await page.evaluate(() => customElements.get('app-modal'))).toBeUndefined()
    // The home view waits for app-modal, so its modal's content can't show unstyled
    await expect(page.locator('#create-setlist-modal')).toHaveCount(0)
    await expect(page.locator('#create-setlist-modal setlist-details-form')).toHaveCount(0)

    releaseModal()
    await page.waitForFunction(() => customElements.get('app-modal'))
    const input = page.locator('#create-setlist-modal setlist-details-form')
    await input.waitFor({ state: 'attached' })
    await expect(input).toBeHidden()
  })
})

test.describe('Display preferences', () => {
  test('changing them updates the chords already showing', async ({ page }) => {
    await seedSong(page)
    await page.goto('/songs/info-test-song')
    await page.reload()
    await expect(page.locator('#library-app-header')).toContainText('Info Test Song')
    // Info Test Song is in G: [G]Amazing [C]grace
    const chords = page.locator('#library-song-content song-section chord-display')
    await expect(chords.nth(1)).toHaveText('C')

    const set = (name, value) =>
      page.evaluate(async ({ name, value }) => (await import('/js/preferences.js'))[name](value), {
        name,
        value,
      })
    await set('setUseNashvilleNumbers', true)
    await expect(chords.nth(0)).toHaveText('1')
    await expect(chords.nth(1)).toHaveText('4')
    await set('setUseNashvilleNumbers', false)
    await expect(chords.nth(1)).toHaveText('C')

    // Bb in another key shows as B♭ with unicode accidentals
    await page
      .locator('#library-app-header')
      .getByRole('button', { name: 'Toggle edit mode' })
      .click()
    const keySelector = page.locator('#library-key-selector')
    await keySelector.locator('.picker-button').click()
    await keySelector
      .locator('.picker-option', { has: page.locator('.option-label', { hasText: /^F$/ }) })
      .click()
    await expect(chords.nth(1)).toHaveText('Bb')
    await set('setUseUnicodeAccidentals', true)
    await expect(chords.nth(1)).toHaveText('B♭')
  })
})

test.describe('Navigation menu', () => {
  test("choosing a song in a setlist's menu opens it", async ({ page }) => {
    await seedSong(page, { setlistId: 'menu-song-setlist' })
    await page.goto('/setlist/menu-song-setlist')
    await page.locator('setlist-overview song-card').first().waitFor()
    await page.locator('#app-header').getByRole('button', { name: 'Navigation menu' }).click()
    await page.locator('nav-menu').getByRole('button', { name: 'Info Test Song' }).click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
  })

  test('every page has the app header, whose menu button opens and closes the menu', async ({
    page,
  }) => {
    await seedSong(page, { setlistId: 'menu-test-setlist' })
    await page.setViewportSize({ width: 390, height: 700 })
    const pages = [
      { path: '/', controls: false },
      { path: '/songs', controls: true },
      { path: '/setlist/menu-test-setlist', controls: true },
      { path: '/preferences', controls: false },
      { path: '/storage', controls: false },
      { path: '/bookmarklet', controls: false },
      { path: '/import-song', controls: false },
    ]
    for (const { path, controls } of pages) {
      await page.goto(path)
      const header = page.locator('app-header')
      await expect(header, path).toHaveCount(1)
      // On a phone, the toggle for the second row only shows when there are controls
      await expect(header.locator('.expand-toggle'), path).toHaveCount(controls ? 1 : 0)

      const button = header.getByRole('button', { name: 'Navigation menu' })
      const menu = page.locator('nav-menu .nav-menu-popover')
      // The menu listens once its script has run, so retry the first click
      await expect(async () => {
        await button.click()
        await expect(menu).toBeVisible({ timeout: 500 })
      }, path).toPass()
      await expect(menu.getByText('Song Library'), path).toBeVisible()
      // The page behind the menu is inert, so tapping the button again lands on the
      // backdrop over it, which closes the menu
      const box = await button.boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect(menu, path).toBeHidden()
    }
  })

  test.describe('the menu is a modal popup', () => {
    let menu
    let openMenu

    test.beforeEach(async ({ page }) => {
      await seedSetlist(page)
      await page.goto('/setlist/seeded-setlist')
      await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
      menu = page.locator('nav-menu .nav-menu-popover')
      openMenu = async () => {
        await expect(async () => {
          await page.getByRole('button', { name: 'Navigation menu' }).click()
          await expect(menu).toBeVisible({ timeout: 500 })
        }).toPass()
      }
    })

    test('Esc closes it', async ({ page }) => {
      await openMenu()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    })

    test('a tap outside only closes it, without pressing what is under it', async ({ page }) => {
      await openMenu()
      const card = await page.locator('setlist-overview song-card').first().boundingBox()
      await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2)
      await expect(menu).toBeHidden()
      // The song under the tap did not open
      await expect(page).toHaveURL(/\/setlist\/seeded-setlist$/)
    })

    test('the setlist shortcuts wait while it is open', async ({ page }) => {
      await openMenu()
      await page.keyboard.press('ArrowRight')
      await expect(page).toHaveURL(/\/setlist\/seeded-setlist$/)
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
      await page.keyboard.press('ArrowRight')
      await expect(page).toHaveURL(/\/song\/0$/)
    })
  })
})

test.describe('Modals', () => {
  test('Esc closes a modal on a setlist, leaving the page shortcuts alone', async ({ page }) => {
    await seedSong(page, { setlistId: 'esc-test-setlist' })
    await page.goto('/setlist/esc-test-setlist')
    await page.locator('setlist-overview song-card').first().click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await expect(page.locator('body')).toHaveClass(/edit-mode/)

    await page.locator('#app-header').getByRole('button', { name: 'Information' }).click()
    const modal = page.locator('app-modal[open]')
    await expect(modal).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    // The Esc was the modal's: edit mode is still on
    await expect(page.locator('body')).toHaveClass(/edit-mode/)
  })
})

test.describe('Storage page', () => {
  test('the local data summary shows how many setlists and songs are stored', async ({ page }) => {
    await seedSong(page, { setlistId: 'summary-setlist' })
    await page.goto('/storage')
    const summary = page.locator('storage-summary')
    await expect(summary.locator('.stat-row', { hasText: 'Setlists' })).toContainText('1')
    await expect(summary.locator('.stat-row', { hasText: 'Songs' })).toContainText('1')
  })

  test('organisations: a duplicate name is refused in the form, and switching asks first', async ({
    page,
  }) => {
    const dialogs = []
    page.on('dialog', dialog => {
      dialogs.push(dialog.message())
      dialog.dismiss()
    })
    await seedSong(page) // opening the app creates the default organisation
    await page.goto('/storage')
    const organisations = page.locator('select-organisation')
    const current = await organisations
      .locator('.organisation-item.current .organisation-name')
      .innerText()

    await organisations.getByRole('button', { name: 'Create New Organisation' }).click()
    await organisations.getByPlaceholder('New organisation name...').fill(current)
    await organisations.getByRole('button', { name: 'Create Organisation' }).click()
    await expect(organisations.getByRole('alert')).toContainText('already exists')

    await organisations.getByPlaceholder('New organisation name...').fill('Second Org')
    await organisations.getByRole('button', { name: 'Create Organisation' }).click()
    await expect(organisations.locator('.organisation-item')).toHaveCount(2)

    await organisations.getByRole('button', { name: 'Switch' }).click()
    const modal = organisations.locator('#switch-modal')
    await expect(modal).toHaveAttribute('open', '')
    await expect(modal).toContainText('Switch to "Second Org"?')
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toHaveAttribute('open', '')
    await expect(organisations.locator('.organisation-item.current')).toContainText(current)
    // No native alert() or confirm() along the way
    expect(dialogs).toEqual([])
  })

  test('says when connecting to Google fails', async ({ page }) => {
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
  })

  test('clearing local data asks first, then clears it', async ({ page }) => {
    await seedSong(page, { setlistId: 'clear-test-setlist' })
    await page.goto('/storage')

    const clearButton = page
      .locator('storage-page')
      .getByRole('button', { name: 'Clear Local Data' })
    const modal = page.locator('storage-page #clear-data-modal')

    // Cancelling keeps everything
    await clearButton.click()
    await expect(modal).toHaveAttribute('open', '')
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toHaveAttribute('open', '')
    expect(await fromDB(page, 'getSetlist', 'clear-test-setlist')).toBeTruthy()

    // Confirming clears it and reloads
    await clearButton.click()
    await Promise.all([
      page.waitForEvent('load'),
      modal.getByRole('button', { name: 'Clear Local Data' }).click(),
    ])
    expect(await fromDB(page, 'getSetlist', 'clear-test-setlist')).toBeFalsy()
  })
})
