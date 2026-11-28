// A setlist draws only the songs near the one in view (docs/LAZY_SONGS.md), in the real page with its
// real stylesheet: a place in the row for every song, the chart of the ones near the one in view.
import { expect, openApp, seedSetlist, test } from './fixtures.ts'

test.describe('a setlist draws the songs near the one in view', () => {
  test('draws the first two from the overview, and a song that is tapped, at once', {
    tag: '@logic',
  }, async ({ page }) => {
    await openApp(page, '/songs')
    const url = await seedSetlist(page)
    await page.goto(url)

    // A place for each of the three, and the chart of the first two
    await expect(page.locator('.section[id^="song-"]')).toHaveCount(3)
    await expect(page.locator('#song-0 song-display')).toBeAttached()
    await expect(page.locator('#song-1 song-display')).toBeAttached()
    await expect(page.locator('#song-2 song-display')).toHaveCount(0)

    // Tapping the third draws it, and shows it
    await page.locator('setlist-overview song-card').nth(2).click()
    await expect(page.locator('#app-header')).toContainText('Charlie Song')
    await expect(page.locator('#song-2 song-display')).toBeAttached()
    await expect(page.locator('#song-2')).toContainText('Charlie')
    await expect(page.locator('#song-2')).toBeInViewport()
  })

  test('has every song in its place, so that a song can be opened from its address', {
    tag: '@logic',
  }, async ({ page }) => {
    await openApp(page, '/songs')
    const url = await seedSetlist(page)
    await page.goto(`${url}/song/2`)
    await expect(page.locator('#app-header')).toContainText('Charlie Song')
    await expect(page.locator('#song-2')).toContainText('Charlie')
    await expect(page.locator('#song-2')).toBeInViewport()
    // (a setlist of three is all within the window of any of its songs)
    await expect(page.locator('#song-0 song-display')).toBeAttached()
  })

  test('keeps a song that is off the screen from being laid out, where the browser can', async ({
    page,
  }) => {
    await openApp(page, '/songs')
    const url = await seedSetlist(page)
    await page.goto(url)
    await expect(page.locator('#song-1 song-display')).toBeAttached()
    const supported = await page.evaluate(() => CSS.supports('content-visibility', 'auto'))
    test.skip(!supported, 'this browser has no content-visibility')
    await expect(page.locator('#song-1')).toHaveCSS('content-visibility', 'auto')
    // (the overview is the one in view, and is not one of the songs' places)
    await expect(page.locator('#overview')).not.toHaveCSS('content-visibility', 'auto')
  })
})
