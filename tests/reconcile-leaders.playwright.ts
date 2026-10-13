// The one-off page that sets setlists' leaders from the emails that sent them
// (src/dev/reconcile-leaders.html), with a made-up email.
import { expect, seedSetlist, test } from './fixtures.ts'

const EMAIL = [
  'From: Leader One <One@Example.com>',
  'To: Ann <ann@example.com>',
  'Subject: Sunday 11th October',
  'Date: Fri, 2 Oct 2026 18:11:00 +0100',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hi all',
  '1. Alpha Song in G',
  '2. Bravo Song in D',
  '3. Charlie Song in A',
  '',
].join('\r\n')

test('a setlist of mine gets the leader of the email for its date and songs', async ({ page }) => {
  await seedSetlist(page)
  await page.goto('/dev/reconcile-leaders.html')
  await page.locator('#me-name').fill('Ann')
  await page.locator('#files').setInputFiles({
    name: 'sunday.eml',
    mimeType: 'message/rfc822',
    buffer: Buffer.from(EMAIL),
  })
  await page.locator('#run').click()

  const row = page.locator('#output tr.change')
  await expect(row).toContainText('Ann')
  const link = row.getByRole('link')
  await expect(link).toHaveAttribute('href', '/setlist/seeded-setlist')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(row).toContainText('Leader One one@example.com')
  await expect(row).toContainText('3 of 3')

  await page.locator('#apply').click()
  await expect(page.locator('#status')).toContainText('1 setlists changed')

  const setlist = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    return (await getCurrentDB()).getSetlist('seeded-setlist')
  })
  expect(setlist?.owner).toBe('Leader One')
  expect(setlist?.ownerId).toBe('one@example.com')
})

test('nothing is changed without Apply, and setlists led by others are left alone', async ({
  page,
}) => {
  await seedSetlist(page)
  await page.goto('/dev/reconcile-leaders.html')
  await page.locator('#me-name').fill('Somebody Else')
  await page.locator('#files').setInputFiles({
    name: 'sunday.eml',
    mimeType: 'message/rfc822',
    buffer: Buffer.from(EMAIL),
  })
  await page.locator('#run').click()
  await expect(page.locator('#output')).toContainText('Nothing to change')

  const owner = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    return (await (await getCurrentDB()).getSetlist('seeded-setlist'))?.owner
  })
  expect(owner).toBe('Ann')
})

test('a setlist named by a rule gets that leader, found among the emails’ leaders', async ({
  page,
}) => {
  await seedSetlist(page)
  await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    const setlist = await db.getSetlist('seeded-setlist')
    if (setlist) await db.saveSetlist({ ...setlist, name: 'Jubilee Plus evening' })
  })
  await page.goto('/dev/reconcile-leaders.html')
  await page.locator('#me-name').fill('Ann')
  await page.locator('#files').setInputFiles({
    name: 'other.eml',
    mimeType: 'message/rfc822',
    buffer: Buffer.from(
      [
        'From: Pippa Lloyd <Pippa@Example.com>',
        'Subject: Sunday 3rd January',
        'Date: Fri, 1 Jan 2027 18:11:00 +0000',
        'Content-Type: text/plain',
        '',
        '1. Some Song in D',
        '',
      ].join('\r\n')
    ),
  })
  await page.locator('#run').click()
  const row = page.locator('#output tr.change')
  await expect(row).toContainText('by its name')
  await expect(row).toContainText('Pippa Lloyd pippa@example.com')
  await page.locator('#apply').click()
  await expect(page.locator('#status')).toContainText('1 setlists changed')
  const owner = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    return (await (await getCurrentDB()).getSetlist('seeded-setlist'))?.ownerId
  })
  expect(owner).toBe('pippa@example.com')
})
