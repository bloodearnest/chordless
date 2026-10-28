// The setlist page in use: moving between songs, scrolling, sections, and
// editing the setlist (order, deleting, keys)
import {
  enterEditMode,
  expect,
  fromDB,
  SETLIST_SONGS,
  seedSetlist,
  seedSong,
  test,
} from './fixtures.ts'
import { must } from './must.ts'

const [ALPHA, BRAVO, CHARLIE] = SETLIST_SONGS.map(song => song.title)

/** The setlist's song titles, in order, as stored */
async function storedOrder(page, setlistId = 'seeded-setlist') {
  const setlist = await fromDB(page, 'getSetlist', setlistId)
  return setlist.songs.map(entry => entry.songUuid)
}

/**
 * Seed the setlist, and open its first song from the overview with the right
 * arrow. (Loading a song's URL directly briefly reports the overview as
 * showing, so a key or click straight away goes to the overview: in the TODO.)
 */
async function openFirstSong(page) {
  await page.goto(await seedSetlist(page))
  await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#app-header')).toContainText(ALPHA)
}

const uuid = title => `song-${title.toLowerCase().replace(/\W+/g, '')}`

test.describe('Moving through a setlist', () => {
  test('the left and right arrows go through the overview and the songs in order', async ({
    page,
  }) => {
    await page.goto(await seedSetlist(page))
    const header = page.locator('#app-header')
    await expect(header).toContainText(/Sun,? 11 Oct/)

    for (const [index, title] of [ALPHA, BRAVO, CHARLIE].entries()) {
      await page.keyboard.press('ArrowRight')
      await expect(page).toHaveURL(new RegExp(`/song/${index}$`))
      await expect(header).toContainText(title)
    }
    // The last song is the end
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/\/song\/2$/)

    await page.keyboard.press('ArrowLeft')
    await expect(header).toContainText(BRAVO)
    await page.keyboard.press('ArrowLeft')
    await expect(header).toContainText(ALPHA)
    await page.keyboard.press('ArrowLeft')
    await expect(page).toHaveURL(/\/setlist\/[^/]+$/)
    await expect(header).toContainText(/Sun,? 11 Oct/)
  })

  test('the up and down arrows scroll the song', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 500 })
    await openFirstSong(page)
    const scrolled = () => page.locator('#song-0').evaluate(song => song.scrollTop)
    expect(await scrolled()).toBe(0)

    await page.keyboard.press('ArrowDown')
    await expect.poll(scrolled).toBeGreaterThan(0)
    const down = await scrolled()
    await page.keyboard.press('ArrowUp')
    await expect.poll(scrolled).toBeLessThan(down)
  })
})

test.describe('Sections', () => {
  test('showing a section as none or lyrics only applies in the setlist, and after a reload', {
    tag: '@logic',
  }, async ({ page }) => {
    await openFirstSong(page)
    const header = page.locator('#app-header')
    const song = page.locator('#song-0')
    const verse = song.locator('song-section[data-label="Verse 1"]')
    const chorus = song.locator('song-section[data-label="Chorus"]')

    await enterEditMode(page)
    await chorus.getByRole('button', { name: 'Show None in Chorus' }).click()
    await verse.getByRole('button', { name: 'Show Lyrics in Verse 1' }).click()
    await header.getByRole('button', { name: 'Toggle edit mode' }).click()

    const check = async when => {
      await expect(chorus, `chorus hidden ${when}`).toBeHidden()
      await expect(verse.getByText('Alpha').first(), `verse lyrics ${when}`).toBeVisible()
      await expect(verse.locator('chord-display').first(), `verse chords ${when}`).toBeHidden()
    }
    await check('before reloading')
    // The states are saved asynchronously: reload once the chorus's is stored
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            // (kept by song: the first song's sections are the only ones)
            Object.values(
              JSON.parse(localStorage.getItem('state-seeded-setlist') as string)?.sections ?? {}
            )[0]?.[1]?.hideMode
        )
      )
      .toBe('hide')
    await page.reload()
    await expect(header).toContainText(ALPHA)
    await check('after reloading')
  })
})

test.describe('Saved section states', () => {
  test('older saves, in the flat format, still apply', { tag: '@logic' }, async ({ page }) => {
    const url = await seedSetlist(page)
    // Song 0's Chorus (section 1) hidden, as saved before the song models
    await page.evaluate(() =>
      localStorage.setItem(
        'state-seeded-setlist',
        JSON.stringify({ 0: { 1: { hideMode: 'hide', isHidden: true, isCollapsed: false } } })
      )
    )
    await page.goto(url)
    await expect(page.locator('#app-header')).toContainText(/Sun,? 11 Oct/)
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('#app-header')).toContainText(ALPHA)
    await expect(page.locator('#song-0 song-section[data-label="Chorus"]')).toBeHidden()
    await expect(page.locator('#song-0 song-section[data-label="Verse 1"]')).toBeVisible()
  })
})

test.describe('Editing a setlist', () => {
  test('dragging a song in edit mode reorders the setlist, and saves it', async ({ page }) => {
    await page.goto(await seedSetlist(page))
    const cards = page.locator('setlist-overview song-card')
    await expect(cards).toHaveCount(3)
    await enterEditMode(page)

    // Drag Alpha by its handle to below Charlie
    const handle = cards.nth(0).locator('.drag-handle')
    const from = must(await handle.boundingBox())
    const to = must(await cards.nth(2).boundingBox())
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, to.y + to.height - 2, { steps: 20 })
    await page.mouse.up()

    await expect(cards.nth(2)).toContainText(ALPHA)
    await expect.poll(() => storedOrder(page)).toEqual([BRAVO, CHARLIE, ALPHA].map(uuid))
    await page.reload()
    await expect(cards.nth(0)).toContainText(BRAVO)
    await expect(cards.nth(2)).toContainText(ALPHA)
  })

  test('adding a song from the library puts it at the end of the setlist, and saves it', async ({
    page,
  }) => {
    await seedSong(page)
    await page.goto(await seedSetlist(page))
    const cards = page.locator('setlist-overview song-card')
    await expect(cards).toHaveCount(3)
    // Adding a song is not an edit: it is there outside edit mode, for a late change
    await expect(page.getByRole('button', { name: 'Add Song' })).toBeVisible()
    await enterEditMode(page)

    await page.getByRole('button', { name: 'Add Song' }).click()
    const modal = page.locator('#add-song-modal')
    await expect(modal).toHaveAttribute('open', '')
    await page.locator('#add-song-search-input').fill('info test')
    await modal.locator('song-list').getByText('Info Test Song').click()

    await expect(modal).not.toHaveAttribute('open', '')
    await expect(cards).toHaveCount(4)
    await expect(cards.nth(3)).toContainText('Info Test Song')
    await expect
      .poll(async () => (await fromDB(page, 'getSetlist', 'seeded-setlist')).songs.length)
      .toBe(4)
    await page.reload()
    await expect(cards).toHaveCount(4)
  })

  test('deleting a song asks first, then removes it from the setlist', async ({ page }) => {
    await page.goto(await seedSetlist(page))
    const cards = page.locator('setlist-overview song-card')
    await expect(cards).toHaveCount(3)
    await enterEditMode(page)
    const modal = page.locator('app-modal[open]')

    await cards.nth(1).getByRole('button', { name: 'Remove song' }).click()
    await expect(modal).toContainText(BRAVO)
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(cards).toHaveCount(3)

    await cards.nth(1).getByRole('button', { name: 'Remove song' }).click()
    await modal.getByRole('button', { name: 'Remove' }).click()
    await expect(cards).toHaveCount(2)
    await expect.poll(() => storedOrder(page)).toEqual([ALPHA, CHARLIE].map(uuid))
  })

  test("changing a song's key in the overview transposes it, and keeps it", {
    tag: '@logic',
  }, async ({ page }) => {
    const url = await seedSetlist(page)
    await page.goto(url)
    const cards = page.locator('setlist-overview song-card')
    await enterEditMode(page)

    // Alpha is in G; choose A
    const keySelector = cards.nth(0).locator('key-selector')
    await keySelector.getByRole('button', { name: /^Key/ }).click()
    await keySelector.getByRole('option', { name: /^A\s/ }).click()
    await expect(keySelector.getByRole('button', { name: /^Key/ })).toHaveText('A')
    await expect
      .poll(async () => (await fromDB(page, 'getSetlist', 'seeded-setlist')).songs[0].key)
      .toBe('A')

    // Its chords are a tone up: [G]Alpha [C]verse becomes [A]Alpha [D]verse
    await page.goto(`${url}/song/0`)
    const chords = page.locator('#song-0 song-section[data-label="Verse 1"] chord-display')
    await expect(chords.nth(0)).toHaveText('A')
    await expect(chords.nth(1)).toHaveText('D')
  })
})
