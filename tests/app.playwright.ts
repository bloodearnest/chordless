// App-wide: themes, loading, display preferences, the menu, modals and the
// Account and Teams page
import { readFileSync } from 'node:fs'
import { expect, openApp, seedSetlist, seedSong, test } from './fixtures.ts'
import { must } from './must.ts'

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
    const lightness = must(color.match(/\d+/g))
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
    await openApp(page, '/account')
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      for (const [url, host] of [
        ['/account', 'account-page'],
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
    await seedSong(page)
    await page.goto('/account')
    await page.locator('space-card').getByRole('button', { name: 'Data' }).click()
    const card = page.locator('account-page > app-modal').locator('.modal-content').first()
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
    await page.route(/\/components\/app-modal\.ts$/, async route => {
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
      page.evaluate(async ({ name, value }) => (await import('/js/preferences.ts'))[name](value), {
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
    await keySelector.getByRole('button', { name: /^Key/ }).click()
    await keySelector.getByRole('option', { name: /^F\s/ }).click()
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
      '/',
      '/songs',
      '/setlist/menu-test-setlist',
      '/preferences',
      '/storage',
      '/bookmarklet',
      '/import-song',
    ]
    for (const path of pages) {
      await page.goto(path)
      const header = page.locator('app-header')
      await expect(header, path).toHaveCount(1)
      // There is no toggle for a second row on a phone
      await expect(header.locator('.expand-toggle'), path).toHaveCount(0)

      const button = header.getByRole('button', { name: 'Navigation menu' })
      const menu = page.locator('nav-menu .nav-menu-popover')
      // The menu listens once its script has run, so retry the first click
      await expect(async () => {
        await button.click()
        await expect(menu).toBeVisible({ timeout: 500 })
      }, path).toPass()
      await expect(menu.getByText('Song Library', { exact: true }), path).toBeVisible()
      // The page behind the menu is inert, so tapping the button again lands on the
      // backdrop over it, which closes the menu
      const box = must(await button.boundingBox())
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
      // A point on the first song's card, clear of the menu, which is under the header's menu
      // button (and on a wide screen the card's middle is under the menu)
      const card = must(await page.locator('setlist-overview song-card').first().boundingBox())
      const popover = must(await menu.boundingBox())
      const x = Math.max(card.x + card.width / 2, popover.x + popover.width + 10)
      expect(x).toBeLessThan(card.x + card.width)
      await page.mouse.click(x, card.y + card.height / 2)
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

test.describe('Account and Teams page', () => {
  test('each space shows how many songs and setlists it holds', { tag: '@logic' }, async ({
    page,
  }) => {
    await seedSong(page, { setlistId: 'summary-setlist' })
    await page.goto('/account')
    const card = page.locator('space-card').filter({ hasText: 'Current' })
    await expect(card).toContainText('1 song')
    await expect(card).toContainText('1 setlist')
    await expect(card).toContainText('about')
  })

  test('switching asks first, and no Team is made from the cards', { tag: '@logic' }, async ({
    page,
  }) => {
    const dialogs: string[] = []
    page.on('dialog', dialog => {
      dialogs.push(dialog.message())
      dialog.dismiss()
    })
    await seedSong(page) // opening the app creates the default space
    await page.evaluate(async () => {
      const { createSpace } = await import('/js/space.ts')
      await createSpace('Second Org')
    })
    await page.goto('/account')
    const cards = page.locator('space-card')
    await expect(cards).toHaveCount(2)
    // The Team is made on its own page, from a link under the cards
    await expect(page.getByRole('link', { name: 'Create a new Team' })).toHaveAttribute(
      'href',
      '/account/new'
    )

    const other = cards.filter({ hasText: 'Second Org' })
    await expect(other).toContainText('Personal') // what kind it is is a label beside its name
    await other.getByRole('button', { name: 'Switch' }).click()
    const modal = other.locator('app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await expect(modal).toContainText('Switch to "Second Org"?')
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toHaveAttribute('open', '')
    await expect(cards.filter({ hasText: 'Current' })).not.toContainText('Second Org')
    // No native alert() or confirm() along the way
    expect(dialogs).toEqual([])
  })

  test.describe('with no sign-in script', () => {
    // (no service worker: WebKit does not route a request that one saw and passed on, and the
    // app's reload when it takes over could land after the click)
    test.use({ serviceWorkers: 'block' })

    test('says when signing in to Google fails', { tag: '@logic' }, async ({ page }) => {
      // Without Google's sign-in script, signing in fails straight away
      await page.route('https://accounts.google.com/**', route => route.abort())
      await page.goto('/account')

      await page
        .locator('account-card')
        .getByRole('button', { name: 'Sign in with Google' })
        .click()
      await expect(page.locator('account-card').getByRole('alert')).toContainText(
        'Signing in failed'
      )
    })
  })

  test('works signed out: a space is managed in a modal, and deleting one asks first', {
    tag: '@logic',
  }, async ({ page }) => {
    await seedSong(page, { setlistId: 'delete-test-setlist' })
    await page.evaluate(async () => {
      const { createSpace } = await import('/js/space.ts')
      await createSpace('Second Org')
    })
    await page.goto('/account')
    await page
      .locator('space-card')
      .filter({ hasText: 'Second Org' })
      .getByRole('button', { name: 'Data' })
      .click()
    const manage = page.locator('account-page > app-modal').first()
    await expect(manage).toHaveAttribute('open', '')
    await expect(manage).toContainText('Second Org')
    await expect(page).toHaveURL(/\/account$/) // a modal, not a page: nothing to go back from
    const confirm = manage.locator('app-modal[heading="Delete from this device?"]')

    // Cancelling keeps it
    await manage.getByRole('button', { name: 'Delete…' }).click()
    await expect(confirm).toHaveAttribute('open', '')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).not.toHaveAttribute('open', '')
    await expect(manage).toHaveAttribute('open', '')

    // Confirming deletes it, closes the modal, and the list no longer has it
    await manage.getByRole('button', { name: 'Delete…' }).click()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(manage).not.toHaveAttribute('open', '')
    await expect(page.locator('space-card')).toHaveCount(1)
    await expect(page.locator('space-card')).toContainText('Current')
  })
})

test('the development server is for the development Google project, not production', {
  tag: '@logic',
}, async ({ page }) => {
  const ids = (file: string) => readFileSync(file, 'utf8')
  const dev = ids('.env.development')
  const prod = ids('.env.production')
  const clientOf = (env: string) => env.match(/VITE_GOOGLE_CLIENT_ID=(\S+)/)?.[1] as string
  const source = await (await page.request.get('/js/google-auth.ts')).text()
  expect(source).toContain(clientOf(dev))
  expect(source).not.toContain(clientOf(prod))
  const driveClient = await (await page.request.get('/js/drive-client.ts')).text()
  expect(driveClient).toContain('"VITE_DRIVE_ROOT_FOLDER": "Chordless-dev"')
})
