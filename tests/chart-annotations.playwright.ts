// Annotations on a chart (docs/ANNOTATIONS.md): made in edit mode by pressing and holding a word, kept as the
// editor says (this setlist or the song, just the user or the team), and drawn when not editing.
// How they are laid out is in chart-annotations-display.test.ts; where they are kept in annotation-store.node.test.ts.

import type { Page } from '@playwright/test'
import { enterEditMode, expect, fromDB, seedSong, test } from './fixtures.ts'

const SETLIST = 'annotations-setlist'

async function openSong(page: Page) {
  await seedSong(page, { setlistId: SETLIST })
  await page.goto(`/setlist/${SETLIST}`)
  await page.locator('setlist-overview song-card').first().click()
  await expect(page.locator('#app-header')).toContainText('Info Test Song')
}

const word = (page: Page, text: string) =>
  page.locator('song-section .chord-segment', { hasText: text }).first()

/** Press and hold in the middle of an element, as a finger or a held mouse button would */
async function hold(page: Page, text: string, ms = 700) {
  const box = await word(page, text).boundingBox()
  if (!box) throw new Error(`No ${text}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

const editor = (page: Page) => page.locator('annotation-editor dialog')
const shownAnnotations = (page: Page) => page.locator('song-section .annotation')

async function writeAnnotation(page: Page, words: string) {
  await expect(editor(page)).toBeVisible()
  await editor(page).getByLabel('Annotation text').fill(words)
}

test.describe('Annotations on a chart', () => {
  test('a annotation is made by holding a word in edit mode, and is just the user’s, for this setlist', async ({
    page,
  }) => {
    await openSong(page)
    await enterEditMode(page)
    await hold(page, 'grace')
    await writeAnnotation(page, 'softly')
    await expect(editor(page).getByLabel('This setlist')).toBeChecked()
    await expect(editor(page).getByLabel('Just me')).toBeChecked()
    await editor(page).getByRole('button', { name: 'Done' }).click()
    await expect(editor(page)).toBeHidden()

    await expect(shownAnnotations(page)).toHaveText(['softly'])
    // Over the word it is on, and not in the setlist that is shared
    const wordBox = await word(page, 'grace').boundingBox()
    const annotationBox = await shownAnnotations(page).first().boundingBox()
    expect(annotationBox?.y).toBeLessThan(wordBox?.y ?? 0)
    expect(Math.abs((annotationBox?.x ?? 0) - (wordBox?.x ?? 0))).toBeLessThan(40)
    const setlist = await fromDB(page, 'getSetlist', SETLIST)
    expect(JSON.stringify(setlist)).not.toContain('softly')
    expect(await page.evaluate(id => localStorage.getItem(`state-${id}`), SETLIST)).toContain(
      'softly'
    )

    // It is there after leaving edit mode and after a reload
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await expect(page.locator('#app-header')).not.toHaveAttribute('edit-mode', '')
    await expect(shownAnnotations(page)).toHaveText(['softly'])
    await page.reload()
    await expect(shownAnnotations(page)).toHaveText(['softly'])
  })

  test('holding a word does nothing outside edit mode', async ({ page }) => {
    await openSong(page)
    await hold(page, 'grace')
    await expect(editor(page)).toBeHidden()
  })

  test('a annotation kept for the song is in every setlist that has it; one for the team is in the setlist', async ({
    page,
  }) => {
    await openSong(page)
    await enterEditMode(page)

    await hold(page, 'Amazing')
    await writeAnnotation(page, 'every time')
    await editor(page).getByText('Always, this song').click()
    // (what is only for this setlist cannot be for the team)
    await expect(editor(page).getByLabel('The team')).toBeDisabled()
    await editor(page).getByRole('button', { name: 'Done' }).click()
    expect(await fromDB(page, 'getSongAnnotations', 'title-info-test-song')).toHaveLength(1)

    await hold(page, 'grace')
    await writeAnnotation(page, 'band drops')
    await editor(page).getByText('The team').click()
    await editor(page).getByRole('button', { name: 'Done' }).click()
    const setlist = await fromDB(page, 'getSetlist', SETLIST)
    expect(setlist.songs[0].annotations).toHaveLength(1)
    expect(setlist.songs[0].annotations[0].body.text).toBe('band drops')
    await expect(shownAnnotations(page)).toHaveText(['every time', 'band drops'])
    // (the team's is drawn as shared)
    await expect(shownAnnotations(page).nth(1)).toHaveClass(/shared/)
    await expect(shownAnnotations(page).nth(0)).not.toHaveClass(/shared/)
  })

  test('a annotation is changed by tapping it, and deleting it can be undone', async ({ page }) => {
    await openSong(page)
    await enterEditMode(page)
    await hold(page, 'grace')
    await writeAnnotation(page, 'softly')
    await editor(page).getByRole('button', { name: 'Done' }).click()

    await shownAnnotations(page).first().click()
    await expect(editor(page).getByLabel('Annotation text')).toHaveValue('softly')
    await editor(page).getByLabel('Annotation text').fill('very softly')
    await editor(page).getByRole('button', { name: 'Done' }).click()
    await expect(shownAnnotations(page)).toHaveText(['very softly'])

    await shownAnnotations(page).first().click()
    await editor(page).getByRole('button', { name: 'Delete' }).click()
    await expect(shownAnnotations(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(shownAnnotations(page)).toHaveText(['very softly'])
  })

  test('the preferences can hide a kind of annotation without a reload', async ({ page }) => {
    await openSong(page)
    await enterEditMode(page)
    await hold(page, 'grace')
    await writeAnnotation(page, 'softly')
    await editor(page).getByRole('button', { name: 'Done' }).click()
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await expect(shownAnnotations(page)).toHaveText(['softly'])

    await page.evaluate(async () => {
      const { setAnnotationsPreference } = await import('/js/preferences.ts')
      setAnnotationsPreference('mine', false)
    })
    await expect(shownAnnotations(page)).toHaveCount(0)
    await page.evaluate(async () => {
      const { setAnnotationsPreference } = await import('/js/preferences.ts')
      setAnnotationsPreference('mine', true)
    })
    await expect(shownAnnotations(page)).toHaveText(['softly'])
  })
})
