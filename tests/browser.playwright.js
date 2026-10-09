// Playwright test runner for browser-based tests
import { expect, fromDB, openApp, seedSong, test } from './fixtures.js'

test.describe('Themes', () => {
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

  test('a status message is readable in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/songs')
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

test.describe('Song library', () => {
  test('changing the key transposes the chords, each time from the original', async ({ page }) => {
    await seedSong(page)
    await page.goto('/songs#info-test-song')
    await page.reload()
    await expect(page.locator('#library-app-header')).toContainText('Info Test Song')
    await page.locator('#library-app-header .edit-toggle').click()

    const keySelector = page.locator('#library-key-selector')
    const firstChord = page.locator('#library-song-content song-section chord-display').first()
    await expect(firstChord).toHaveText('G')
    for (const key of ['A', 'Bb']) {
      await keySelector.locator('.picker-button').click()
      await keySelector.getByRole('button', { name: new RegExp(`^${key}\\b`) }).click()
      await expect(keySelector.locator('.picker-button')).toHaveText(key)
      await expect(firstChord).toHaveText(key)
    }
  })
})

test.describe('Display preferences', () => {
  test('changing them updates the chords already showing', async ({ page }) => {
    await seedSong(page)
    await page.goto('/songs#info-test-song')
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
    await page.locator('#library-app-header .edit-toggle').click()
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

test.describe('Song info', () => {
  test('info button on the songs page opens the song info dialog', async ({ page }) => {
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
  })

  test('info button on a setlist song opens the song info dialog', async ({ page }) => {
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
  })

  test('info button on the setlist overview opens the setlist info dialog', async ({ page }) => {
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
  })

  test('a leader entered when creating a setlist appears in its info', async ({ page }) => {
    await openApp(page)

    await page.locator('#create-setlist-button').click()
    const form = page.locator('#create-setlist-form')
    await form.locator('#name').fill('Leader Test')
    await form.locator('#leader').selectOption('other')
    await form.locator('#leader-other').fill('  Ann  ')
    await form.locator('button[type="submit"]').click()
    await page.waitForURL(/\/setlist\//)

    // The info button does nothing until the new setlist has loaded
    const modal = page.locator('#setlist-info-dialog app-modal')
    await expect(async () => {
      await page.locator('#app-header .info-button').click()
      await expect(modal).toHaveAttribute('open', '', { timeout: 500 })
    }).toPass()
    await expect(page.locator('#setlist-info-dialog setlist-info')).toContainText('Ann')
  })

  test('setlist details can be edited from the info dialog', async ({ page }) => {
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
  /** A file for the import page's file picker */
  function chordproFile(name, content, mimeType = '') {
    return { name, mimeType, buffer: Buffer.from(content) }
  }

  test('imports several files into a new setlist, skipping ones that are not text', async ({
    page,
  }) => {
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
    await modal.locator('button[type="submit"]').click()
    await page.waitForURL(/\/setlist\//)

    const setlistId = new URL(page.url()).pathname.split('/').pop()
    const setlist = await fromDB(page, 'getSetlist', setlistId)
    expect(setlist.songs.map(s => s.songId)).toEqual(['title-firstsong', 'title-secondsong'])
  })

  test('imports pasted ChordPro into an existing setlist', async ({ page }) => {
    await seedSong(page, { setlistId: 'paste-test-setlist' })
    await page.goto('/import-song')
    const songImport = page.locator('song-import')
    await songImport.locator('textarea').fill('{title: Pasted Song}\n\n[E]Pasted')
    await songImport.locator('.paste .add').click()

    await expect(page.getByRole('heading', { name: /Pasted Song/ })).toBeVisible()
    await songImport.locator('.add-to-setlist .add').click()
    await page.waitForURL(/\/setlist\/paste-test-setlist/)

    const setlist = await fromDB(page, 'getSetlist', 'paste-test-setlist')
    expect(setlist.songs.map(s => s.songId)).toEqual(['title-info-test-song', 'title-pastedsong'])
    const song = await fromDB(page, 'getSong', setlist.songs[1].songUuid)
    expect(song.importSource).toBe('paste')
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
      await button.click()
      await expect(menu, path).toBeHidden()
    }
  })
})

test.describe('Modals', () => {
  test('Esc closes a modal on a setlist, leaving the page shortcuts alone', async ({ page }) => {
    await seedSong(page, { setlistId: 'esc-test-setlist' })
    await page.goto('/setlist/esc-test-setlist')
    await page.locator('setlist-overview song-card').first().click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header .edit-toggle').click()
    await expect(page.locator('body')).toHaveClass(/edit-mode/)

    await page.locator('#app-header .info-button').click()
    const modal = page.locator('app-modal[open]')
    await expect(modal).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    // The Esc was the modal's: edit mode is still on
    await expect(page.locator('body')).toHaveClass(/edit-mode/)
  })
})

test.describe('Song settings', () => {
  test("the setlist's BPM survives a reload, over the library song's own", async ({ page }) => {
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
  })

  test('choosing a capo in the song settings changes it, and keeps it', async ({ page }) => {
    await seedSong(page, { setlistId: 'capo-test-setlist' })
    await page.evaluate(() => localStorage.setItem('enable_capo', 'true'))
    await page.goto('/setlist/capo-test-setlist')
    await page.locator('setlist-overview song-card').first().click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header .edit-toggle').click()
    await page.locator('#musical-metadata').click()

    const capo = page.locator('#capo-selector')
    await capo.locator('.picker-button').click()
    await capo.getByRole('button', { name: /^2\b/ }).click()
    await expect(capo.locator('.picker-button')).toHaveText('2')
    await expect.poll(() => page.locator('#musical-metadata').evaluate(m => m.capoValue)).toBe(2)
  })

  test('asking to reset a song closes the settings popover, which would cover the question', async ({
    page,
  }) => {
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
  })
})

test.describe('Media player settings', () => {
  test("the player's settings open in a modal, which Esc closes", async ({ page }) => {
    await seedSong(page, { setlistId: 'player-modal-setlist' })
    await page.goto('/setlist/player-modal-setlist')
    const player = page.locator('media-player')
    await player.locator('.collapsed-button').click()
    await player.getByRole('button', { name: 'Settings' }).click()

    const modal = player.locator('app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await expect(modal.getByRole('switch', { name: 'Enable Pads' })).toBeVisible()
    // Esc still closes it after a click inside
    await modal.getByText('Background pad audio playback').click()
    await page.keyboard.press('Escape')
    await expect(modal).not.toHaveAttribute('open', '')
    await expect(modal.locator('media-player-settings')).toHaveCount(0)
  })

  test('its switches work from the keyboard, and are off limits while the player is off', async ({
    page,
  }) => {
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
  })

  test('turning the media player off in preferences hides it on setlists', async ({ page }) => {
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
    await modal.locator('.modal-btn-cancel').click()
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
    await modal.locator('.modal-btn-cancel').click()
    await expect(modal).not.toHaveAttribute('open', '')
    expect(await fromDB(page, 'getSetlist', 'clear-test-setlist')).toBeTruthy()

    // Confirming clears it and reloads
    await clearButton.click()
    await Promise.all([page.waitForEvent('load'), modal.locator('.modal-btn-confirm').click()])
    expect(await fromDB(page, 'getSetlist', 'clear-test-setlist')).toBeFalsy()
  })
})
