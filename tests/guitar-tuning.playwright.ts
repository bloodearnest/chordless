// A guitarist's tuning for a setlist: chosen on the overview in edit mode, and the chords move with it
import { enterEditMode, expect, openApp, seedSetlist, test } from './fixtures.ts'

test.use({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 })

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
  await expect(tuning).toHaveText('Standard')

  // (it is changed in edit mode, as the rest of the setlist's settings are)
  await expect(tuning).toHaveCSS('pointer-events', 'none')
  await enterEditMode(page)
  await tuning.click()
  await page.getByRole('option', { name: /Half step down/ }).click()
  await expect(tuning).toHaveText('Half step down')
  await page.screenshot({
    path: '/tmp/claude-1000/-home-wavy-chordless--claude-worktrees-bridge-cse-01QwBWsLid2LnPZnMtQFeh9a/7124098e-0d02-5bc2-b444-bb762e4fb666/scratchpad/shots/overview-tuning.png',
  })

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
