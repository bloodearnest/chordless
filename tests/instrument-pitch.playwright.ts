// A horn player's instrument pitch: the device's default, a setlist's own in edit mode, and the chords move with it
import { enterEditMode, expect, openApp, seedSetlist, test } from './fixtures.ts'

test('a horn player reads a setlist in B♭ by default, and in E♭ when the setlist says so', async ({
  page,
}) => {
  await openApp(page, '/')
  await page.evaluate(() => {
    localStorage.setItem('musician_type', 'transposing')
    localStorage.setItem('enable_pitch', 'true')
    localStorage.setItem('pitch', 'bb')
  })
  const url = await seedSetlist(page)
  await page.goto(url)

  // (not concert pitch, so it is said on the overview even out of edit mode, and cannot be changed there)
  const pitch = page.locator('setlist-overview').getByRole('button', { name: /^Instrument/ })
  await expect(pitch).toHaveText('B♭')
  await expect(pitch).toHaveCSS('pointer-events', 'none')

  // Alpha is in G: a B♭ instrument reads up a whole step, in A
  await page.locator('song-card').first().click()
  await expect(page.locator('#musical-metadata')).toContainText('Instrument: B♭')
  await expect(
    page.locator('#song-0 song-display').getByText('A', { exact: true }).first()
  ).toBeVisible()

  // (the setlist's own, chosen in edit mode: an E♭ instrument reads up a sixth, in E)
  await page.goto(url)
  await enterEditMode(page)
  await pitch.click()
  await page.getByRole('option', { name: /^E♭/ }).click()
  await expect(pitch).toHaveText('E♭')
  await page.locator('song-card').first().click()
  await expect(page.locator('#musical-metadata')).toContainText('Instrument: E♭')
  await expect(
    page.locator('#song-0 song-display').getByText('E', { exact: true }).first()
  ).toBeVisible()

  // (and it is kept on this device)
  await page.goto(url)
  await expect(
    page.locator('setlist-overview').getByRole('button', { name: /^Instrument/ })
  ).toHaveText('E♭')
})
