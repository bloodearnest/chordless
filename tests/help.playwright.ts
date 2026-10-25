// The Help page: the menu's Help item opens a modal that explains the page being shown
import { expect, seedSetlist, test } from './fixtures.ts'

const SHOTS = process.env.HELP_SHOTS

async function openHelp(page, name) {
  await page
    .locator('#app-header, #library-app-header')
    .first()
    .getByRole('button', { name: /Navigation menu/ })
    .click()
  await page.getByRole('button', { name: name }).click()
}

test.describe('Help', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the pictures are the ${scheme} ones in a ${scheme} theme, and load`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: scheme })
      const page = await context.newPage()
      await page.goto(await seedSetlist(page))
      await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
      await openHelp(page, 'Help: Setlist Overview')
      const pictures = page.locator('app-help img.picture')
      await expect(pictures.first()).toBeVisible()
      const sources = await pictures.evaluateAll(images =>
        images.map(image => image.getAttribute('src'))
      )
      expect(sources.length).toBeGreaterThan(5)
      for (const src of sources)
        expect(src?.endsWith('-dark.png'), src ?? '').toBe(scheme === 'dark')
      // Each one was found (a missing one is hidden): once they have all finished loading
      await expect
        .poll(() =>
          pictures.evaluateAll(
            images => images.filter(image => !(image as HTMLImageElement).complete).length
          )
        )
        .toBe(0)
      expect(
        await pictures.evaluateAll(
          images => images.filter(image => (image as HTMLImageElement).naturalWidth === 0).length
        )
      ).toBe(0)
      await context.close()
    })
  }

  test('the overview explains what it is for, getting around and edit mode', async ({ page }) => {
    await page.goto(await seedSetlist(page))
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
    await openHelp(page, 'Help: Setlist Overview')
    const help = page.locator('app-help')
    await expect(help).toContainText('the songs for the service')
    for (const heading of ['Getting around', 'While you are playing', 'Changing the setlist'])
      await expect(help.locator('h3', { hasText: heading })).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/help-overview.png` })
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()
  })

  test('a song has its own help', async ({ page }) => {
    await page.goto(await seedSetlist(page))
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
    await page.keyboard.press('ArrowRight')
    await openHelp(page, 'Help: Setlist Song')
    await expect(page.locator('app-help')).toContainText('one song from your setlist')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/help-song.png` })
  })

  test('the library explains finding a song and gesture', async ({ page }) => {
    await page.goto('/songs')
    await openHelp(page, 'Help: Song Library')
    const help = page.locator('app-help')
    await expect(help).toContainText('Search')
    await expect(help).toContainText('Swipe')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/help-library.png` })
  })

  test('a page with no help has no Help item', async ({ page }) => {
    await page.goto('/about')
    await page
      .getByRole('button', { name: /Navigation menu/ })
      .first()
      .click()
    await expect(page.getByRole('link', { name: 'About' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Help/ })).toHaveCount(0)
  })
})
