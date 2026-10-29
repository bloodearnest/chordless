// The people who lead a space's setlists, from Account and Teams: the "Leaders" button on a
// space's card opens them in a modal, where two spellings of one person are merged.
import { expect, fromDB, seedSong, test } from './fixtures.ts'

test.describe('Leaders', () => {
  test('two spellings of one leader are merged from the Account and Teams page', {
    tag: '@logic',
  }, async ({ page }) => {
    // Ann leads one setlist; "Ann S." (with an address) leads another
    await seedSong(page, { setlistId: 'by-ann' })
    await page.evaluate(async () => {
      const { getCurrentDB } = await import('/js/db.ts')
      const db = await getCurrentDB()
      const now = new Date().toISOString()
      await db.savePeople([
        { id: 'ann-s', name: 'Ann S.', emails: ['ann@example.com'], modifiedDate: now },
      ])
      const first = await db.getSetlist('by-ann')
      if (!first) throw new Error('no setlist')
      await db.saveSetlist({ ...first, id: 'by-ann-s', date: '2026-10-18', leaderId: 'ann-s' })
    })

    await page.goto('/account')
    await page.getByRole('button', { name: 'Leaders' }).first().click()
    const leaders = page.locator('space-people')
    await expect(leaders.getByRole('textbox', { name: 'Name' })).toHaveCount(2)
    await expect(leaders).toContainText('ann@example.com')

    await leaders.getByLabel('Merge Ann S. into').selectOption({ label: 'Ann' })
    await page.getByRole('button', { name: 'Merge', exact: true }).click()

    // One person is left, who leads both and has the address
    await expect(leaders.getByRole('textbox', { name: 'Name' })).toHaveCount(1)
    await expect(leaders.getByRole('textbox', { name: 'Name' })).toHaveValue('Ann')
    await expect(leaders).toContainText('leads 2')
    await expect(leaders).toContainText('ann@example.com')
    const moved = await fromDB(page, 'getSetlist', 'by-ann-s')
    expect(moved.leaderId).toBe('ann-leader')
  })

  test('an address is added to a leader, and a leader who leads nothing is deleted', {
    tag: '@logic',
  }, async ({ page }) => {
    await seedSong(page, { setlistId: 'by-ann' })
    await page.evaluate(async () => {
      const { getCurrentDB } = await import('/js/db.ts')
      const db = await getCurrentDB()
      await db.savePeople([
        { id: 'vic', name: 'Visiting Vic', emails: [], modifiedDate: new Date().toISOString() },
      ])
    })

    await page.goto('/account')
    await page.getByRole('button', { name: 'Leaders' }).first().click()
    const leaders = page.locator('space-people')
    await leaders.getByLabel('Add an email address to Ann').fill('Ann@Example.com')
    await leaders.getByLabel('Add an email address to Ann').press('Enter')
    await expect(leaders).toContainText('ann@example.com')

    await leaders.getByLabel('Add an email address to Visiting Vic').fill('nonsense')
    await leaders.getByLabel('Add an email address to Visiting Vic').press('Enter')
    await expect(leaders).not.toContainText('nonsense')

    await leaders
      .locator('.person', { hasText: 'leads none' })
      .getByRole('button', { name: 'Delete' })
      .click()
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await expect(leaders.getByRole('textbox', { name: 'Name' })).toHaveCount(1)
    const people = await fromDB(page, 'getAllPeople', undefined)
    expect(people.find((each: { id: string }) => each.id === 'vic').deleted).toBe(true)
  })
})
