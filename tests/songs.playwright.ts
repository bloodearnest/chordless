// Songs: the library, song info, importing, and the bookmarklet page
import { expect, fromDB, openApp, seedSong, test } from './fixtures.ts'
import { must } from './must.ts'

test.describe('Song library', () => {
  test('changing the key transposes the chords, each time from the original', async ({ page }) => {
    await seedSong(page)
    await page.goto('/songs/info-test-song')
    await page.reload()
    await expect(page.locator('#library-app-header')).toContainText('Info Test Song')
    await page
      .locator('#library-app-header')
      .getByRole('button', { name: 'Toggle edit mode' })
      .click()

    const keySelector = page.locator('#library-key-selector')
    const firstChord = page.locator('#library-song-content song-section chord-display').first()
    await expect(firstChord).toHaveText('G')
    for (const key of ['A', 'Bb']) {
      await keySelector.getByRole('button', { name: /^Key/ }).click()
      await keySelector.getByRole('option', { name: new RegExp(`^${key}\\s`) }).click()
      await expect(keySelector.getByRole('button', { name: /^Key/ })).toHaveText(key)
      await expect(firstChord).toHaveText(key)
    }
  })
})

test.describe('Song library navigation', () => {
  test('choosing a song opens it at its own URL, and back returns to the list', async ({
    page,
  }) => {
    await seedSong(page)
    await openApp(page, '/songs')
    await page.evaluate(() => {
      window.sameDocument = true
    })
    const heading = page.locator('#library-app-header')
    await expect(heading).toContainText('Song Library')

    await page.locator('song-list').getByText('Info Test Song').first().click()
    await expect(page).toHaveURL(/\/songs\/info-test-song$/)
    await expect(heading).toContainText('Info Test Song')
    await expect(page.locator('#library-song-content song-section').first()).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/\/songs$/)
    await expect(heading).toContainText('Song Library')
    await expect(page.locator('#library-key-selector')).toBeHidden()
    expect(await page.evaluate(() => window.sameDocument)).toBe(true)

    await page.goForward()
    await expect(heading).toContainText('Info Test Song')
  })

  test('a song that does not exist sends you back to the list', async ({ page }) => {
    await seedSong(page)
    await page.goto('/songs/no-such-song')
    await expect(page).toHaveURL(/\/songs$/)
    await expect(page.locator('#library-app-header')).toContainText('Song Library')
  })

  test('leaving the library while in edit mode leaves edit mode', async ({ page }) => {
    await seedSong(page)
    await page.goto('/songs/info-test-song')
    await page
      .locator('#library-app-header')
      .getByRole('button', { name: 'Toggle edit mode' })
      .click()
    await expect(page.locator('body')).toHaveClass(/edit-mode/)

    await page.getByRole('button', { name: 'Navigation menu' }).click()
    await page.locator('nav-menu').getByRole('link', { name: 'Storage' }).click()
    await expect(page.locator('storage-view')).toBeVisible()
    await expect(page.locator('body')).not.toHaveClass(/edit-mode/)
  })

  test('searching narrows the list', async ({ page }) => {
    await seedSong(page)
    await openApp(page, '/songs')
    await expect(page.locator('song-list')).toContainText('Info Test Song')
    await page.locator('#song-search').fill('zzz-nothing')
    await expect(page.locator('song-list')).toContainText('No songs match your search')
    await page.locator('#song-search').fill('info test')
    await expect(page.locator('song-list')).toContainText('Info Test Song')
  })
})

test.describe('Song info', () => {
  test('info button on the songs page opens the song info dialog', async ({ page }) => {
    await seedSong(page)

    await page.goto('/songs/info-test-song')
    await page.reload()
    // The header shows the song once it has loaded; info refers to it from then on
    await expect(page.locator('#library-app-header')).toContainText('Info Test Song')
    await page.locator('#library-app-header').getByRole('button', { name: 'Information' }).click()

    const modal = page.locator('#library-song-info-dialog app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await expect(modal).toHaveAttribute('heading', 'Info Test Song')
    await expect(page.locator('#library-song-info-dialog song-info')).toContainText('Key')
  })

  test('info button on a setlist song opens the song info dialog', async ({ page }) => {
    await seedSong(page, { setlistId: 'info-test-setlist' })

    await page.goto('/setlist/info-test-setlist/song/0')
    // The header shows the song once it has loaded; info refers to it from then on
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    await page.locator('#app-header').getByRole('button', { name: 'Information' }).click()

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
    await page.locator('#app-header').getByRole('button', { name: 'Information' }).click()

    const modal = page.locator('#setlist-info-dialog app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await expect(modal).toHaveAttribute('heading', 'Sunday, 11 October 2026')
    const info = page.locator('#setlist-info-dialog setlist-info')
    await expect(info).toContainText('Ann')
    await expect(info).toContainText('1 song')
  })

  test('a leader entered when creating a setlist appears in its info', async ({ page }) => {
    await openApp(page)

    await page.getByRole('button', { name: 'Create new setlist' }).click()
    const form = page.locator('#create-setlist-form')
    await form.getByLabel('Name (optional)').fill('Leader Test')
    await form.getByLabel('Leader (optional)').selectOption('other')
    await form.getByLabel("Leader's name").fill('  Ann  ')
    await form.getByRole('button', { name: 'Create Setlist' }).click()
    await page.waitForURL(/\/setlist\//)

    // The info button does nothing until the new setlist has loaded
    const modal = page.locator('#setlist-info-dialog app-modal')
    await expect(async () => {
      await page.locator('#app-header').getByRole('button', { name: 'Information' }).click()
      await expect(modal).toHaveAttribute('open', '', { timeout: 500 })
    }).toPass()
    await expect(page.locator('#setlist-info-dialog setlist-info')).toContainText('Ann')
  })

  test('setlist details can be edited from the info dialog', async ({ page }) => {
    await seedSong(page, { setlistId: 'edit-test-setlist' })
    await page.goto('/setlist/edit-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)

    await page.locator('#app-header').getByRole('button', { name: 'Information' }).click()
    const dialog = page.locator('#setlist-info-dialog')
    await dialog.getByRole('button', { name: 'Edit setlist details' }).click()
    const form = dialog.locator('setlist-details-form')
    // The setlist's current leader is selected
    await expect(form.locator('#leader option:checked')).toHaveText('Ann')
    // Type with real key presses: page shortcuts (space starts the song, arrows
    // change song) must leave text fields alone
    await form.getByLabel('Leader (optional)').selectOption('other')
    const leader = form.getByLabel("Leader's name")
    await leader.pressSequentially('Ben Smith')
    await leader.press('ArrowLeft')
    await leader.press('ArrowLeft')
    await leader.pressSequentially('-')
    await expect(leader).toHaveValue('Ben Smi-th')
    await form.getByLabel('Date').fill('2026-10-18')
    await form.getByLabel('Name (optional)').fill('Harvest')
    await form.getByRole('button', { name: 'Save' }).click()

    // Back to read-only, showing the saved details
    const modal = dialog.locator('app-modal')
    await expect(modal).toHaveAttribute('heading', 'Sunday, 18 October 2026 - Harvest')
    await expect(dialog.locator('setlist-info')).toContainText('Ben Smi-th')
    // The page header uses the short format (with the year once 2026 is past)
    await expect(page.locator('#app-header')).toContainText(/Sun,? 18 Oct( 2026)? - Harvest/)

    // Saved: still there after a reload
    await page.reload()
    const saved = await page.evaluate(async () => {
      const { getCurrentDB } = await import('/js/db.ts')
      return (await getCurrentDB()).getSetlist('edit-test-setlist')
    })
    expect(saved).toMatchObject({
      owner: 'Ben Smi-th',
      ownerId: '',
      date: '2026-10-18',
      name: 'Harvest',
    })
  })

  test('a setlist that is not in Drive can be deleted from its info dialog', async ({ page }) => {
    await seedSong(page, { setlistId: 'delete-test-setlist' })
    await page.goto('/setlist/delete-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)

    // Behind the pencil, not on the read-only view
    await page.locator('#app-header').getByRole('button', { name: 'Information' }).click()
    const dialog = page.locator('#setlist-info-dialog')
    await expect(dialog.getByRole('button', { name: 'Delete setlist' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Edit setlist details' }).click()

    // Asked first: cancelling keeps it
    await dialog.getByRole('button', { name: 'Delete setlist' }).click()
    const confirm = page.locator('#delete-setlist-modal')
    await expect(confirm).toHaveAttribute('open', '')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(/\/setlist\/delete-test-setlist$/)

    await dialog.getByRole('button', { name: 'Delete setlist' }).click()
    await confirm.getByRole('button', { name: 'Delete' }).click()

    await expect(page).toHaveURL(/\/$/)
    const left = await fromDB(page, 'getSetlist', 'delete-test-setlist')
    expect(left).toBeUndefined()
  })

  test('a setlist that is in Drive cannot be deleted', async ({ page }) => {
    await seedSong(page, { setlistId: 'drive-test-setlist' })
    await page.evaluate(async () => {
      const { getCurrentDB } = await import('/js/db.ts')
      const db = await getCurrentDB()
      const setlist = await db.getSetlist('drive-test-setlist')
      if (setlist) await db.saveSetlist({ ...setlist, driveFileId: 'drive-file-1' })
    })
    await page.goto('/setlist/drive-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)

    await page.locator('#app-header').getByRole('button', { name: 'Information' }).click()
    const dialog = page.locator('#setlist-info-dialog')
    await dialog.getByRole('button', { name: 'Edit setlist details' }).click()
    await expect(dialog).toContainText("in Google Drive, so it can't be deleted here")
    await expect(dialog.getByRole('button', { name: 'Delete setlist' })).toHaveCount(0)
  })

  test('cancelling a setlist details edit changes nothing', async ({ page }) => {
    await seedSong(page, { setlistId: 'cancel-test-setlist' })
    await page.goto('/setlist/cancel-test-setlist')
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)

    await page.locator('#app-header').getByRole('button', { name: 'Information' }).click()
    const dialog = page.locator('#setlist-info-dialog')
    await dialog.getByRole('button', { name: 'Edit setlist details' }).click()
    await dialog.locator('setlist-details-form #leader').selectOption('other')
    await dialog.locator('setlist-details-form #leader-other').fill('Not saved')
    await dialog.locator('setlist-details-form').getByRole('button', { name: 'Cancel' }).click()

    await expect(dialog.locator('setlist-info')).toContainText('Ann')
    const saved = must(
      await page.evaluate(async () => {
        const { getCurrentDB } = await import('/js/db.ts')
        return (await getCurrentDB()).getSetlist('cancel-test-setlist')
      })
    )
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

    await songImport.getByRole('button', { name: /Create New Setlist/ }).click()
    const modal = songImport.locator('app-modal')
    await expect(modal).toHaveAttribute('open', '')
    await modal.getByLabel('Name (optional)').fill('Files Test')
    await modal.getByRole('button', { name: /Create & Add Song/ }).click()
    await page.waitForURL(/\/setlist\//)

    const setlistId = new URL(page.url()).pathname.split('/').pop()
    const setlist = await fromDB(page, 'getSetlist', setlistId)
    expect(setlist.songs.map(s => s.songId)).toEqual(['title-firstsong', 'title-secondsong'])
  })

  test('imports pasted ChordPro into an existing setlist', async ({ page }) => {
    await seedSong(page, { setlistId: 'paste-test-setlist' })
    await page.goto('/import-song')
    const songImport = page.locator('song-import')
    await songImport.getByLabel('Paste ChordPro').fill('{title: Pasted Song}\n\n[E]Pasted')
    await songImport.getByRole('button', { name: 'Import', exact: true }).click()

    await expect(page.getByRole('heading', { name: /Pasted Song/ })).toBeVisible()
    await songImport.getByRole('button', { name: 'Add', exact: true }).click()
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
