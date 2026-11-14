// A guitarist's tuning for a setlist: chosen on the overview in edit mode, and the chords move with it
import { enterEditMode, expect, openApp, seedSetlist, test } from './fixtures.ts'

test('a guitarist tunes down for a setlist, in edit mode, and the chords move up with it', async ({
  page,
}) => {
  await openApp(page, '/')
  await page.evaluate(() => {
    localStorage.setItem('musician_type', 'guitarist')
    localStorage.setItem('enable_capo', 'true')
  })
  const url = await seedSetlist(page)
  await page.goto(url)
  const tuning = page.locator('setlist-overview').getByRole('button', { name: /^Tuning/ })
  // (standard needs no saying, so there is no row until it is edited or not standard)
  await expect(tuning).toHaveCount(0)

  // (it is changed in edit mode, as the rest of the setlist's settings are, where it is always there)
  await enterEditMode(page)
  await expect(tuning).toHaveText('Standard')
  await tuning.click()
  await page.getByRole('option', { name: /Half step down/ }).click()
  await expect(tuning).toHaveText('Half step down')
  // (out of edit mode it is still shown, as it is not standard, and cannot be changed)
  await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
  await expect(tuning).toHaveText('Half step down')
  await expect(tuning).toHaveCSS('pointer-events', 'none')

  // Alpha is in G: the shapes are a half step up, in A flat
  await page.locator('song-card').first().click()
  await expect(page.locator('#musical-metadata')).toContainText('Tuning: Half step down')
  await expect(page.locator('#song-0 song-display').getByText('Ab').first()).toBeVisible()

  // (and it is kept on this device: reloaded, it is still there)
  await page.goto(url)
  await expect(
    page.locator('setlist-overview').getByRole('button', { name: /^Tuning/ })
  ).toHaveText('Half step down')
})
