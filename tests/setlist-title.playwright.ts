// The title of a setlist's page (the window's, in an installed app): its date, and its name
import { expect, fromDB, seedSetlist, test } from './fixtures.ts'

test("a setlist's title is its date, and its name when it has one", { tag: '@logic' }, async ({
  page,
}) => {
  await seedSetlist(page)
  await page.goto('/setlist/seeded-setlist')
  await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
  // (A browser tab, which has no app name in front, keeps "- Chordless")
  await expect(page).toHaveTitle(/^Sun,? 11 Oct - Chordless$/)

  // It does not change as the user moves between the setlist's songs
  await page.locator('setlist-overview song-card').first().click()
  await expect(page).toHaveURL(/\/song\/0$/)
  await expect(page).toHaveTitle(/^Sun,? 11 Oct - Chordless$/)

  // With a name, it follows the date
  await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    const setlist = await db.getSetlist('seeded-setlist')
    if (setlist) await db.saveSetlist({ ...setlist, name: 'Easter Sunday' })
  })
  await page.reload()
  await expect(page).toHaveTitle(/^Sun,? 11 Oct - Easter Sunday - Chordless$/)
  expect((await fromDB(page, 'getSetlist', 'seeded-setlist')).name).toBe('Easter Sunday')
})

test('other pages have their own titles, and leaving a setlist drops its title', {
  tag: '@logic',
}, async ({ page }) => {
  await seedSetlist(page)
  await page.goto('/setlist/seeded-setlist')
  await expect(page).toHaveTitle(/^Sun,? 11 Oct - Chordless$/)

  await page.getByRole('button', { name: 'Navigation menu' }).click()
  await page.locator('nav-menu').getByRole('link', { name: 'Song Library' }).click()
  await expect(page).toHaveTitle('Song Library - Chordless')
})
