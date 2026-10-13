// A user who can only read the organisation's Drive folder (sync found it so) is not offered
// anything that would change what syncs: setlists and songs can't be created, shared or imported,
// and a setlist's songs, keys and tempos can't be changed. What is kept on the device (the capo,
// the sections shown) can still be, and reading and playing work as before.
import { expect, openApp, seedSetlist, test } from './fixtures.ts'

const READ_ONLY_KEY = 'current-organisation-read-only'

test.describe('An organisation the user can only read', () => {
  test('offers no way to create, share or import, or to change the setlist itself', async ({
    page,
  }) => {
    const url = await seedSetlist(page)

    // With write access, the controls are there
    await openApp(page, '/')
    await expect(page.locator('#create-setlist-button')).toHaveCount(1)
    await page.goto(url)
    await expect(page.locator('#share-button')).toHaveCount(1)
    await expect(page.locator('#app-header .edit-toggle')).toHaveCount(1)

    // Found out while the page is open: what changes the setlist goes at once
    await page.evaluate(key => {
      localStorage.setItem(key, '1')
      window.dispatchEvent(new Event('organisation-read-only-change'))
    }, READ_ONLY_KEY)

    await page.goto('/')
    await expect(page.locator('home-view, setlist-group').first()).toBeVisible()
    await expect(page.locator('#create-setlist-button')).toHaveCount(0)

    // The overview: edit mode there changes the setlist (songs, keys), so it is not offered
    await page.goto(url)
    await expect(page.locator('setlist-overview')).toContainText('Alpha')
    await expect(page.locator('#app-header .edit-toggle')).toHaveCount(0)
    await expect(page.locator('#share-button')).toHaveCount(0)

    // A song: edit mode is there for the capo and the sections (kept on this device), but
    // not for the key or the tempo, which are in the setlist
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/\/song\/0$/)
    await expect(page.locator('#app-header .edit-toggle')).toHaveCount(1)
    await page.locator('#app-header .edit-toggle').click()
    await expect(page.locator('body')).toHaveClass(/edit-mode/)
    expect(await page.locator('#key-selector').evaluate(el => (el as any).editMode)).toBe(false)
    await expect
      .poll(() =>
        page
          .locator('song-settings-popover#song-settings-popover')
          .evaluate(el => (el as any).bpmLocked)
      )
      .toBe(true)
    await page.locator('#app-header .edit-toggle').click()

    // Back on the overview, the toggle goes again
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('#app-header .edit-toggle')).toHaveCount(0)

    await page.goto('/songs')
    await expect(page.locator('#library-app-header .edit-toggle')).toHaveCount(1)

    await page.goto('/import-song')
    await expect(page.locator('song-import')).toHaveCount(0)
    await expect(page.locator('import-song-view')).toContainText('view-only')
  })
})
