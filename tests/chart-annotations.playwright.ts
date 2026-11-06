// Annotations on a chart (docs/ANNOTATIONS.md): made in edit mode by pressing and holding a word, kept as the
// editor says (this setlist or the song, just the user or the team), and drawn when not editing.
// How they are laid out is in chart-annotations-display.test.ts; where they are kept in annotation-store.node.test.ts.

import type { Page } from '@playwright/test'
import { enterEditMode, expect, fromDB, seedSong, test } from './fixtures.ts'
import { must } from './must.ts'

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
  test('an annotation is made by holding a word in edit mode, and is just the user’s, for this setlist', async ({
    page,
  }) => {
    await openSong(page)
    await enterEditMode(page)
    await hold(page, 'grace')
    await writeAnnotation(page, 'softly')
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

  test('an annotation for everyone is in the setlist, and one just for the user is not', async ({
    page,
  }) => {
    await openSong(page)
    await enterEditMode(page)

    await hold(page, 'Amazing')
    await writeAnnotation(page, 'every time')
    await editor(page).getByRole('button', { name: 'Done' }).click()
    let setlist = await fromDB(page, 'getSetlist', SETLIST)
    expect(setlist.songs[0].annotations).toBe(undefined)

    await hold(page, 'grace')
    await writeAnnotation(page, 'band drops')
    await editor(page).getByText('Everyone', { exact: true }).click()
    await editor(page).getByRole('button', { name: 'Done' }).click()
    setlist = await fromDB(page, 'getSetlist', SETLIST)
    expect(setlist.songs[0].annotations).toHaveLength(1)
    expect(setlist.songs[0].annotations[0].body.text).toBe('band drops')
    await expect(shownAnnotations(page)).toHaveText(['every time', 'band drops'])
    // (the one for everyone is drawn as shared)
    await expect(shownAnnotations(page).nth(1)).toHaveClass(/shared/)
    await expect(shownAnnotations(page).nth(0)).not.toHaveClass(/shared/)
  })

  test('an annotation is changed by tapping it, and deleting it can be undone', async ({
    page,
  }) => {
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

  for (const width of [320, 360, 390]) {
    test(`the editor fits a ${width}px wide phone, with Delete showing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 })
      await openSong(page)
      await enterEditMode(page)
      await hold(page, 'grace')
      await writeAnnotation(page, 'softly')
      await editor(page).getByRole('button', { name: 'Done' }).click()
      await shownAnnotations(page).first().click()
      const dialog = editor(page)
      await expect(dialog.getByRole('button', { name: 'Delete' })).toBeVisible()

      const box = must(await dialog.boundingBox())
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      for (const name of ['Delete', 'Cancel', 'Done']) {
        const at = must(await dialog.getByRole('button', { name }).boundingBox())
        expect(at.x, name).toBeGreaterThanOrEqual(box.x)
        expect(at.x + at.width, name).toBeLessThanOrEqual(box.x + box.width)
        expect(at.y + at.height, name).toBeLessThanOrEqual(box.y + box.height)
      }
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    })
  }
})
