// A user who can only read the organisation's Drive folder (sync found it so) is never blocked
// from changing what they see: a last-minute key change, a late song, a new setlist all work,
// and stay on this device. Only what needs Drive is not offered: sharing by link.
import { expect, openApp, seedSetlist, test } from './fixtures.ts'

const READ_ONLY_KEY = 'current-organisation-read-only'

test.describe('An organisation the user can only read', () => {
  test('still creates, imports and edits, and offers no share link', async ({ page }) => {
    const url = await seedSetlist(page)
    await openApp(page, '/')
    await page.evaluate(key => localStorage.setItem(key, '1'), READ_ONLY_KEY)

    await page.goto('/')
    await expect(page.locator('home-view, setlist-group').first()).toBeVisible()
    await expect(page.locator('#create-setlist-button')).toHaveCount(1)

    // The overview has its edit mode (songs, keys)
    await page.goto(url)
    await expect(page.locator('setlist-overview')).toContainText('Alpha')
    await expect(page.locator('#app-header .edit-toggle')).toHaveCount(1)
    // Sharing by link needs Drive, but the song list to paste is still there
    await page.locator('#share-button').click()
    await expect(page.locator('setlist-share #copy-song-list')).toBeVisible()
    await expect(page.locator('setlist-share #mode-link')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // A song: the key and the tempo can be changed
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/\/song\/0$/)
    await page.locator('#app-header .edit-toggle').click()
    await expect(page.locator('body')).toHaveClass(/edit-mode/)
    expect(await page.locator('#key-selector').evaluate(el => (el as any).editMode)).toBe(true)
    await page.locator('#app-header .edit-toggle').click()

    await page.goto('/import-song')
    await expect(page.locator('song-import')).toHaveCount(1)
  })
})
