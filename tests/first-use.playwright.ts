// The first-use setup modal: asked once, on whatever page the user arrives at
import { expect, openApp, seedSong, test } from './fixtures.ts'

test.use({ firstUse: true })

const stored = page =>
  page.evaluate(() => ({
    type: localStorage.getItem('musician_type'),
    defaults: localStorage.getItem('section_defaults'),
    capo: localStorage.getItem('enable_capo'),
    done: localStorage.getItem('setup-done'),
  }))

test('a new user is asked how they read, and the answers are saved as they are made', async ({
  page,
}) => {
  await openApp(page, '/')
  const modal = page.getByRole('dialog', { name: 'Welcome to Chordless' })
  await expect(modal).toBeVisible()
  // The choices are slotted into the dialog: they are not inside it as far as locators go
  const setup = page.locator('first-use-setup')

  // Chords and lyrics, and no capo, until they say otherwise
  await expect(setup.getByRole('radio', { name: /^Chords and lyrics/ })).toBeChecked()
  await expect(setup.getByRole('checkbox', { name: /guitar/ })).not.toBeChecked()

  await setup.getByRole('radio', { name: /^Lyrics only/ }).check()
  await setup.getByRole('checkbox', { name: /guitar/ }).check()
  expect(await stored(page)).toMatchObject({
    type: 'singer',
    defaults: JSON.stringify({ all: 'lyrics' }),
    capo: 'true',
  })

  await setup.getByRole('button', { name: 'Continue' }).click()
  await expect(modal).toBeHidden()
  expect((await stored(page)).done).toBe('1')

  await page.reload()
  await expect(page.locator('welcome-card')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('skipping keeps the defaults and the question does not come back', async ({ page }) => {
  await openApp(page, '/')
  await page.getByRole('button', { name: 'Skip' }).click()
  expect(await stored(page)).toMatchObject({ type: null, capo: null, done: '1' })

  await page.reload()
  await expect(page.locator('welcome-card')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Escape closes it, as a skip', async ({ page }) => {
  await openApp(page, '/')
  await expect(page.getByRole('dialog', { name: 'Welcome to Chordless' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await stored(page)).done).toBe('1')
})

test('a user who already has songs is not asked', { tag: '@logic' }, async ({ page }) => {
  await seedSong(page)
  await page.reload()
  await expect.poll(async () => (await stored(page)).done).toBe('1')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a user who already chose a musician type is not asked', { tag: '@logic' }, async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('musician_type', 'singer'))
  await openApp(page, '/')
  await expect.poll(async () => (await stored(page)).done).toBe('1')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
