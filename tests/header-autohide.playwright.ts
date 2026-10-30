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

  test('keeps its height as the window changes size, so the song under it is never behind', async ({
    page,
  }) => {
    // (the header's own controls once animated their size, 200 ms of it, for the song to follow a frame late)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.setViewportSize({ width: 390, height: 600 })
    const heights = await page.evaluate(
      () =>
        new Promise<number[]>(resolve => {
          const seen: number[] = []
          const sample = () => {
            seen.push(document.querySelector('#app-header')?.getBoundingClientRect().height ?? 0)
            if (seen.length < 40) requestAnimationFrame(sample)
            else resolve(seen)
          }
          requestAnimationFrame(sample)
        })
    )
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.01)
  })

  test('floats over the page, with the song starting just under it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 })
    const box = (selector: string) =>
      page.evaluate(selector => {
        const rect = document.querySelector(selector)?.getBoundingClientRect()
        const { top, bottom } = rect ?? { top: Number.NaN, bottom: Number.NaN }
        return { top, bottom }
      }, selector)
    expect((await box('#app-header')).top).toBe(0)
    // (the song's offset follows the header's height after a layout pass, which a busy machine
    // can be late with: wait for it, not for a fixed time)
    await expect
      .poll(
        async () => (await box('#song-0 .song-content')).top - (await box('#app-header')).bottom
      )
      .toBeGreaterThanOrEqual(-1)
    // Scrolled until the header is away, the text is at the top of the screen
    await scrollTo(page, 150)
    await scrollTo(page, 400)
    expect((await box('#app-header')).bottom).toBeLessThanOrEqual(0)
    await expect(page.locator('#app-header')).toHaveAttribute('tucked', '')
  })

  test('stays on a tablet', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await scrollTo(page, 150)
    await scrollTo(page, 300)
    await expect(page.locator('#app-header')).not.toHaveAttribute('tucked')
  })
})
