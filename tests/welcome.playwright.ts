// The first visit: the welcome card, and the sample setlist it adds
import { expect, openApp, test } from './fixtures.ts'

test('a new user sees the welcome card, not an empty list', async ({ page }) => {
  await openApp(page, '/')
  const card = page.locator('welcome-card')
  await expect(card).toBeVisible()
  await expect(card.getByRole('heading', { name: 'Welcome to Chordless' })).toBeVisible()
  await expect(page.getByText('No setlists found')).toHaveCount(0)
})

test('the sample setlist has the four hymns, and the card goes once there is a setlist', async ({
  page,
}) => {
  await openApp(page, '/')
  await page.locator('welcome-card').getByRole('button', { name: 'Add a sample setlist' }).click()

  await expect(page).toHaveURL(/\/setlist\//)
  const cards = page.locator('setlist-overview song-card')
  await expect(cards).toHaveCount(4)
  await expect(cards.first()).toContainText('Holy, Holy, Holy')
  await expect(cards.nth(3)).toContainText('It Is Well With My Soul')

  // The songs are in the library, credited to the chart's author, and not from CCLI
  await page.goto('/')
  await expect(page.locator('welcome-card')).toHaveCount(0)
  await expect(page.locator('setlist-group')).toBeVisible()
})

test('adding the sample twice does not copy its songs', async ({ page }) => {
  await openApp(page, '/')
  await page.locator('welcome-card').getByRole('button', { name: 'Add a sample setlist' }).click()
  await expect(page.locator('setlist-overview song-card')).toHaveCount(4)

  // Back to an empty home (the setlist deleted), and add the sample again
  await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    for (const setlist of await db.getAllSetlists()) await db.deleteSetlist(setlist.id)
  })
  await page.goto('/')
  await page.locator('welcome-card').getByRole('button', { name: 'Add a sample setlist' }).click()
  await expect(page.locator('setlist-overview song-card')).toHaveCount(4)

  const titles = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    return (await db.getAllSongs()).map(song => song.title)
  })
  expect(titles.filter(title => title === 'Amazing Grace')).toHaveLength(1)
})
