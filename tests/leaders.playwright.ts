// The people who lead a space's setlists, from Account and Teams: the "Manage Users" button on a
// space's card opens its page, where each person is a row to edit, and two spellings of one person
// are merged.
import { expect, fromDB, seedSong, test } from './fixtures.ts'

test.describe('Leaders', () => {
  test('two spellings of one leader are merged from the space’s page', {
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
    await page.getByRole('button', { name: 'Manage Users' }).first().click()
    const people = page.locator('people-list')
    await expect(people.locator('tbody tr')).toHaveCount(2)
    await expect(people).toContainText('ann@example.com')

    await people.getByRole('button', { name: 'Edit Ann S.' }).click()
    const editor = people.locator('space-people')
    await editor.getByLabel('Merge Ann S. into').selectOption({ label: 'Ann' })
    await page.getByRole('button', { name: 'Merge', exact: true }).click()

    // One person is left, who leads both and has the address
    await expect(people.locator('tbody tr')).toHaveCount(1)
    await expect(people.locator('tbody tr')).toContainText('Ann')
    await expect(people.locator('tbody tr')).not.toContainText('leads')
    await expect(people.locator('tbody tr')).toContainText('ann@example.com')
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
    await page.getByRole('button', { name: 'Manage Users' }).first().click()
    const people = page.locator('people-list')
    const editor = people.locator('space-people')

    await people.getByRole('button', { name: 'Edit Ann' }).click()
    await editor.getByLabel('Add an email address to Ann').fill('Ann@Example.com')
    await editor.getByLabel('Add an email address to Ann').press('Enter')
    await expect(editor).toContainText('ann@example.com')
    await page.keyboard.press('Escape')

    await people.getByRole('button', { name: 'Edit Visiting Vic' }).click()
    await editor.getByLabel('Add an email address to Visiting Vic').fill('nonsense')
    await editor.getByLabel('Add an email address to Visiting Vic').press('Enter')
    await expect(editor).not.toContainText('nonsense')

    await editor.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
    await expect(people.locator('tbody tr')).toHaveCount(1)
    const all = await fromDB(page, 'getAllPeople', undefined)
    expect(all.find((each: { id: string }) => each.id === 'vic').deleted).toBe(true)
  })
})
