// The first visit: the welcome card, and the sample setlist it adds
// (the setup modal is answered in first-use.playwright.ts)
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

  // The songs are in the library
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

test('the install step says why, in a popup', async ({ page }) => {
  await openApp(page, '/')
  const card = page.locator('welcome-card')
  // (A browser that offers no way to install shows no install step: give it one)
  await page.evaluate(() => {
    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      })
    )
  })
  await card.getByRole('button', { name: 'Why install?' }).click()
  const popup = card.getByRole('dialog', { name: 'Why install Chordless?' })
  await expect(popup).toBeVisible()
  await expect(card.locator('why-install .why')).toContainText('Your songs stay put')
  await expect(card.locator('why-install .why')).toContainText('The whole screen for the song')
  await expect(card.locator('why-install .why')).toContainText('Feels like any other app you use')
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
})
