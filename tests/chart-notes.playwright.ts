// Notes on a chart (docs/NOTES.md): made in edit mode by pressing and holding a word, kept as the
// editor says (this setlist or the song, just the user or the team), and drawn when not editing.
// How they are laid out is in chart-notes-display.test.ts; where they are kept in note-store.node.test.ts.

import type { Page } from '@playwright/test'
import { enterEditMode, expect, fromDB, seedSong, test } from './fixtures.ts'

const SETLIST = 'notes-setlist'

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

const editor = (page: Page) => page.locator('note-editor dialog')
const shownNotes = (page: Page) => page.locator('song-section .note')

async function writeNote(page: Page, words: string) {
  await expect(editor(page)).toBeVisible()
  await editor(page).getByLabel('Note text').fill(words)
}

test.describe('Notes on a chart', () => {
  test('a note is made by holding a word in edit mode, and is just the user’s, for this setlist', async ({
    page,
  }) => {
    await openSong(page)
    await enterEditMode(page)
    await hold(page, 'grace')
    await writeNote(page, 'softly')
    await expect(editor(page).getByLabel('This setlist')).toBeChecked()
    await expect(editor(page).getByLabel('Just me')).toBeChecked()
    await editor(page).getByRole('button', { name: 'Done' }).click()
    await expect(editor(page)).toBeHidden()

    await expect(shownNotes(page)).toHaveText(['softly'])
    // Over the word it is on, and not in the setlist that is shared
    const wordBox = await word(page, 'grace').boundingBox()
    const noteBox = await shownNotes(page).first().boundingBox()
    expect(noteBox?.y).toBeLessThan(wordBox?.y ?? 0)
    expect(Math.abs((noteBox?.x ?? 0) - (wordBox?.x ?? 0))).toBeLessThan(40)
    const setlist = await fromDB(page, 'getSetlist', SETLIST)
    expect(JSON.stringify(setlist)).not.toContain('softly')
    expect(await page.evaluate(id => localStorage.getItem(`state-${id}`), SETLIST)).toContain(
      'softly'
    )

    // It is there after leaving edit mode and after a reload
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await expect(page.locator('#app-header')).not.toHaveAttribute('edit-mode', '')
    await expect(shownNotes(page)).toHaveText(['softly'])
    await page.reload()
    await expect(shownNotes(page)).toHaveText(['softly'])
  })

  test('holding a word does nothing outside edit mode', async ({ page }) => {
    await openSong(page)
    await hold(page, 'grace')
    await expect(editor(page)).toBeHidden()
  })

  test('a note kept for the song is in every setlist that has it; one for the team is in the setlist', async ({
    page,
  }) => {
    await openSong(page)
    await enterEditMode(page)

    await hold(page, 'Amazing')
    await writeNote(page, 'every time')
    await editor(page).getByText('Always, this song').click()
    // (what is only for this setlist cannot be for the team)
    await expect(editor(page).getByLabel('The team')).toBeDisabled()
    await editor(page).getByRole('button', { name: 'Done' }).click()
    expect(await fromDB(page, 'getSongNotes', 'title-info-test-song')).toHaveLength(1)

    await hold(page, 'grace')
    await writeNote(page, 'band drops')
    await editor(page).getByText('The team').click()
    await editor(page).getByRole('button', { name: 'Done' }).click()
    const setlist = await fromDB(page, 'getSetlist', SETLIST)
    expect(setlist.songs[0].annotations).toHaveLength(1)
    expect(setlist.songs[0].annotations[0].body.text).toBe('band drops')
    await expect(shownNotes(page)).toHaveText(['every time', 'band drops'])
    // (the team's is drawn as shared)
    await expect(shownNotes(page).nth(1)).toHaveClass(/shared/)
    await expect(shownNotes(page).nth(0)).not.toHaveClass(/shared/)
  })

  test('a note is changed by tapping it, and deleting it can be undone', async ({ page }) => {
    await openSong(page)
    await enterEditMode(page)
    await hold(page, 'grace')
    await writeNote(page, 'softly')
    await editor(page).getByRole('button', { name: 'Done' }).click()

    await shownNotes(page).first().click()
    await expect(editor(page).getByLabel('Note text')).toHaveValue('softly')
    await editor(page).getByLabel('Note text').fill('very softly')
    await editor(page).getByRole('button', { name: 'Done' }).click()
    await expect(shownNotes(page)).toHaveText(['very softly'])

    await shownNotes(page).first().click()
    await editor(page).getByRole('button', { name: 'Delete' }).click()
    await expect(shownNotes(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(shownNotes(page)).toHaveText(['very softly'])
  })

  test('the preferences can hide a kind of note without a reload', async ({ page }) => {
    await openSong(page)
    await enterEditMode(page)
    await hold(page, 'grace')
    await writeNote(page, 'softly')
    await editor(page).getByRole('button', { name: 'Done' }).click()
    await page.locator('#app-header').getByRole('button', { name: 'Toggle edit mode' }).click()
    await expect(shownNotes(page)).toHaveText(['softly'])

    await page.evaluate(async () => {
      const { setNotesPreference } = await import('/js/preferences.ts')
      setNotesPreference('mine', false)
    })
    await expect(shownNotes(page)).toHaveCount(0)
    await page.evaluate(async () => {
      const { setNotesPreference } = await import('/js/preferences.ts')
      setNotesPreference('mine', true)
    })
    await expect(shownNotes(page)).toHaveText(['softly'])
  })
})
