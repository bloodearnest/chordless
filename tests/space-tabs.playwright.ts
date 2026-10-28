import { expect, openApp, seedSetlist, test } from './fixtures.ts'

test('a tab switches space without reloading the page, and shows only that space', {
  tag: '@logic',
}, async ({ page }) => {
  // Personal has the seeded setlist; a team has one of its own
  await seedSetlist(page, { setlistId: 'personal-setlist' })
  await page.evaluate(async () => {
    const { createSpace, updateSpace } = await import('/js/space.ts')
    const { openSpace, createSetlist } = await import('/js/db.ts')
    const team = await createSpace('Gateway Church')
    await updateSpace(team.id, { team: { id: 'space-tabtest1', role: 'writer' } })
    const db = await openSpace(team.id)
    await db.saveSetlist(
      createSetlist({ date: '2031-03-02', time: '10:30', type: 'sunday-am', name: 'Team set' })
    )
    db.db?.close()
  })

  await openApp(page, '/')
  const tabs = page.getByRole('tablist', { name: 'Where songs and setlists are kept' })
  await expect(tabs.getByRole('tab')).toHaveCount(2)
  // (Teams come before Personal)
  await expect(tabs.getByRole('tab').first()).toContainText('Gateway Church')
  await expect(tabs.getByRole('tab', { selected: true })).toContainText('Personal')
  await expect(page.locator('setlist-group')).toHaveCount(1)

  // Mark this page: a reload would lose it
  await page.evaluate(() => {
    ;(window as unknown as { marker: string }).marker = 'same page'
  })
  await tabs.getByRole('tab').first().click()
  await expect(tabs.getByRole('tab', { selected: true })).toContainText('Gateway Church')
  await expect(page.locator('home-view')).toContainText('2031')
  expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe(
    'same page'
  )

  // ...and back
  await tabs.getByRole('tab', { name: /Personal/ }).click()
  await expect(tabs.getByRole('tab', { selected: true })).toContainText('Personal')
  await expect(page.locator('home-view')).not.toContainText('2031')
})
