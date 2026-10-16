/**
 * Takes the pictures the Help pages show: each is a crop of a real control, in the real app, so
 * they cannot drift from it by being drawn by hand.
 *
 * `just test` runs it first, so the pictures follow the app: commit what changes. It is not one of
 * the Playwright tests (the name does not end .playwright.ts), which are run by `npx playwright
 * test`, as it writes files. The same page gives the same pixels, so a run that changes nothing
 * leaves nothing to commit. tests/help-images.node.test.ts checks that every picture the help
 * names is there, and tests/help.playwright.ts that the help shows the one for the theme.
 */
import { mkdirSync } from 'node:fs'
import { enterEditMode, expect, seedSetlist, test } from './fixtures.ts'

const OUT = 'public/help'

test.describe.configure({ mode: 'serial' })

test('the pictures of the setlist pages and the library', async ({ page }, testInfo) => {
  mkdirSync(OUT, { recursive: true })
  const suffix = testInfo.project.name === 'dark' ? '-dark' : ''
  // A crop of the control with a little of what is around it, so it is seen in its place
  // (`pad` is less for one with something distracting close by; `also` is a second thing to
  // show with the first, for the context it gives)
  const shot = async (locator, name, { pad = 10, also = undefined } = {}) => {
    await expect(locator, name).toBeVisible()
    await locator.scrollIntoViewIfNeeded()
    const boxes = [await locator.boundingBox()]
    if (also) boxes.push(await also.boundingBox())
    if (boxes.some(box => !box)) throw new Error(`${name} has no box`)
    const view = page.viewportSize()
    const left = Math.max(0, Math.min(...boxes.map(box => box.x)) - pad)
    const top = Math.max(0, Math.min(...boxes.map(box => box.y)) - pad)
    const right = Math.min(view.width, Math.max(...boxes.map(box => box.x + box.width)) + pad)
    const bottom = Math.min(view.height, Math.max(...boxes.map(box => box.y + box.height)) + pad)
    await page.screenshot({
      path: `${OUT}/${name}${suffix}.png`,
      animations: 'disabled',
      clip: { x: left, y: top, width: right - left, height: bottom - top },
    })
  }

  // ---- The setlist overview
  await page.goto(await seedSetlist(page))
  const header = page.locator('#app-header')
  await expect(header).toContainText(/Sun,? 11 Oct/)
  await page.evaluate(() => localStorage.setItem('enable_capo', 'true'))
  await shot(header.locator('.nav-menu-button'), 'header-menu')
  await shot(page.locator('#live-button'), 'header-live')
  await shot(page.locator('#share-button'), 'header-share')
  await shot(header.locator('.edit-toggle'), 'header-edit')
  await shot(header.locator('.info-button'), 'header-info')
  // The cards and the long buttons stretch to the page: at the width of a phone they are the size
  // they are shown at
  await page.setViewportSize({ width: 440, height: 900 })
  await shot(page.locator('song-card').first(), 'overview-card')
  await shot(page.locator('.add-song-button'), 'overview-add-song')

  // (the header's buttons are behind a toggle at that width)
  await page.setViewportSize({ width: 900, height: 1000 })
  await enterEditMode(page)
  await page.setViewportSize({ width: 440, height: 900 })
  const card = page.locator('song-card').first()
  await shot(card, 'overview-card-edit')
  await shot(card.locator('.drag-handle'), 'overview-reorder')
  await shot(card.locator('.key-edit-wrapper'), 'overview-key')
  await shot(card.locator('.delete-button'), 'overview-remove')
  await page.setViewportSize({ width: 900, height: 1000 })

  // ---- A song: one with a tempo and a time signature, and a capo, so the header shows them all
  await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    const chordpro = await db.getChordPro('chordpro-alphasong')
    if (!chordpro) throw new Error('no chordpro')
    chordpro.content = chordpro.content.replace('{key: G}', '{key: G}\n{tempo: 120}\n{time: 4/4}')
    await db.saveChordPro(chordpro)
  })
  await page.reload()
  await expect(header).toContainText(/Sun,? 11 Oct/)
  await page.keyboard.press('ArrowRight')
  await expect(header).toContainText('Alpha Song')
  await enterEditMode(page)
  await page.locator('musical-metadata-display').click()
  const capo = page.locator('#capo-selector')
  await capo.getByRole('button', { name: /^Capo/ }).click()
  await capo.getByRole('option', { name: /^2\b/ }).click()
  await page.keyboard.press('Escape')
  await header.getByRole('button', { name: 'Toggle edit mode' }).click()
  await expect(header).not.toHaveAttribute('edit-mode', '')
  await shot(page.locator('musical-metadata-display'), 'song-key')
  await shot(page.locator('media-player'), 'song-player')

  await enterEditMode(page)
  const verse = page.locator('#song-0 song-section[data-label="Verse 1"]')
  await shot(verse.locator('.section-controls'), 'song-show')
  await shot(verse.locator('.section-collapse-toggle'), 'song-collapse', { pad: 3 })
  await page.locator('musical-metadata-display').click()
  const settings = page.locator('#song-settings-popover dialog.settings-popover')
  await expect(settings).toBeVisible()
  await shot(settings, 'song-settings', { also: header })
  await page.keyboard.press('Escape')

  // ---- The library
  await page.goto('/songs')
  await page.setViewportSize({ width: 440, height: 900 })
  await shot(page.locator('.song-search-input'), 'library-search')
  await page.setViewportSize({ width: 900, height: 1000 })
  await page.goto('/songs/song-alphasong')
  const libraryHeader = page.locator('#library-app-header')
  await expect(libraryHeader).toContainText('Alpha Song')
  await expect(async () => {
    if (!(await libraryHeader.evaluate(el => el.hasAttribute('edit-mode')))) {
      await libraryHeader.getByRole('button', { name: 'Toggle edit mode' }).click()
    }
    await expect(libraryHeader).toHaveAttribute('edit-mode', '', { timeout: 1000 })
  }).toPass()
  await shot(page.locator('#library-key-selector button').first(), 'library-key')
})
