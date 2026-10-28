// The share button in a setlist's header: on the overview only, lit while the setlist is shared,
// and it opens the share dialog.
import { expect, fromDB, openApp, seedSetlist, test } from './fixtures.ts'

const SHARE = {
  fileId: 'abcdefghijklmnop1234',
  key: 'feZnM60P-JUQOekfs4dlSiiem2FvxVwyXUHXC5xNb2o',
  created: '2026-10-05',
  expires: '2026-10-25',
  bundleHash: 'h',
}

test.describe('The share button', () => {
  test('is on the overview, not on a song, and opens the share dialog', async ({ page }) => {
    await openApp(page, '/')
    await seedSetlist(page)
    await page.goto('/setlist/seeded-setlist')
    const button = page.locator('#share-button')
    await expect(button).toBeVisible()
    await expect(button).not.toHaveClass(/shared/)

    await button.click()
    await expect(page.locator('setlist-share')).toContainText('Sign in with Google')
    await page.keyboard.press('Escape')

    await page.keyboard.press('ArrowRight')
    await expect(button).toBeHidden()
    await page.keyboard.press('ArrowLeft')
    await expect(button).toBeVisible()
  })

  test('is lit when the setlist is shared, and the dialog has its link', { tag: '@logic' }, async ({
    page,
  }) => {
    await openApp(page, '/')
    await seedSetlist(page)
    const setlist = await fromDB(page, 'getSetlist', 'seeded-setlist')
    await fromDB(page, 'saveSetlist', { ...setlist, share: SHARE })
    await page.goto('/setlist/seeded-setlist')
    const button = page.locator('#share-button')
    await expect(button).toHaveClass(/shared/)
    await button.click()
    await expect(page.locator('setlist-share input')).toHaveValue(
      new RegExp(`/s/${SHARE.fileId}#${SHARE.key}$`)
    )
  })
})
