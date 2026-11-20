import { expect, openApp, seedSetlist, test } from './fixtures.ts'

test('the home page shows the setlists of every space at once, and opens one of another space', {
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
  // Both spaces' setlists at once, with no tab to switch (the space is named on each row)
  await expect(page.locator('home-view')).toContainText('2031')
  await expect(page.locator('home-view')).toContainText('Gateway Church')
  await expect(page.locator('home-view')).toContainText('Personal')
  await expect(
    page.getByRole('tablist', { name: 'Where songs and setlists are kept' })
  ).toHaveCount(0)

  // A setlist of the team opens from its id alone, in its own space.
  const group = page.locator('setlist-group').filter({ hasText: 'Gateway Church' })
  if ((await group.getAttribute('expanded')) === null) await group.getByRole('button').click()
  await group.getByRole('link', { name: /Gateway Church/ }).click()
  await expect(page).toHaveURL(/\/setlist\//)
  await expect(page.locator('body')).toContainText('Team set')
})
