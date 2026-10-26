import { expect, seedSong, test } from './fixtures.ts'

test.describe('The header on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await seedSong(page, { setlistId: 'autohide-setlist' })
    await page.goto('/setlist/autohide-setlist')
    await page.locator('setlist-overview song-card').first().click()
    await expect(page.locator('#app-header')).toContainText('Info Test Song')
    // (a song long enough to scroll)
    await page.evaluate(() => {
      const tall = document.createElement('div')
      tall.style.height = '3000px'
      document.querySelector('#song-0')?.append(tall)
    })
  })

  const scrollTo = async (page, top: number) => {
    await page.evaluate(top => document.querySelector('#song-0')?.scrollTo({ top }), top)
    await page.waitForTimeout(500)
  }

  test('goes while a song is scrolled down, and comes back scrolling up', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 })
    const header = page.locator('#app-header')
    await scrollTo(page, 150)
    await scrollTo(page, 300)
    await expect(header).toHaveAttribute('tucked', '')
    await scrollTo(page, 250)
    await expect(header).not.toHaveAttribute('tucked')
    await expect(header).toBeVisible()
  })

  test('stays on a tablet', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await scrollTo(page, 150)
    await scrollTo(page, 300)
    await expect(page.locator('#app-header')).not.toHaveAttribute('tucked')
  })
})
