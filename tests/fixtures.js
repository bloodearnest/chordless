// Shared Playwright set-up: import test and expect from here, not @playwright/test.
import { test as base, expect } from '@playwright/test'

/**
 * Page errors that aren't failures: leaving a page while its view transition
 * is still running (e.g. a save that goes straight to another page) aborts it
 */
const EXPECTED_ERRORS = [/^Transition was aborted because of invalid state/]

export const test = base.extend({
  // Every test fails if its page throws an uncaught error
  pageErrors: [
    async ({ page }, use) => {
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await use(errors)
      const unexpected = errors.filter(message => !EXPECTED_ERRORS.some(re => re.test(message)))
      expect(unexpected, 'uncaught errors in the page').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/**
 * Open the app at path, ready to use: wait for the service worker to take
 * control (it routes the app's URLs), and reload, because the app reloads
 * itself when that first happens, which could otherwise land mid-test.
 */
export async function openApp(page, path = '/') {
  await page.goto(path)
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await page.reload()
}

/**
 * Open the app, so it sets up its organisation and database, then add a test
 * song (Info Test Song, in G: [G]Amazing [C]grace), and optionally a setlist
 * containing it.
 */
export async function seedSong(page, { setlistId = null } = {}) {
  await openApp(page, '/songs')
  await page.evaluate(async setlistId => {
    const { getCurrentDB } = await import('/js/db.js')
    const db = await getCurrentDB()
    const content = '{title: Info Test Song}\n{key: G}\n\n[G]Amazing [C]grace'
    await db.saveChordPro({
      id: 'chordpro-info-test',
      content,
      contentHash: 'test',
      lastModified: Date.now(),
    })
    await db.saveSong({
      uuid: 'info-test-song',
      id: 'title-info-test-song',
      title: 'Info Test Song',
      titleNormalized: 'infotestsong',
      isDefault: true,
      chordproFileId: 'chordpro-info-test',
      modifiedDate: new Date().toISOString(),
    })
    if (setlistId) {
      await db.saveSetlist({
        id: setlistId,
        date: '2026-10-11',
        time: '10:30',
        type: 'Church Service',
        name: '',
        owner: 'Ann',
        songs: [{ songId: 'title-info-test-song', key: 'A' }],
        createdDate: new Date().toISOString(),
        modifiedDate: new Date().toISOString(),
      })
    }
  }, setlistId)
}

export /** Call a method of the app's database, e.g. fromDB(page, 'getSong', uuid) */
function fromDB(page, method, arg) {
  return page.evaluate(
    async ({ method, arg }) => {
      const { getCurrentDB } = await import('/js/db.js')
      return (await getCurrentDB())[method](arg)
    },
    { method, arg }
  )
}

/** The songs seedSetlist adds: each has a Verse 1 and a Chorus; Alpha's verse is long */
export const SETLIST_SONGS = [
  { title: 'Alpha Song', key: 'G', verse: '[G]Alpha [C]verse', chorus: '[D]Alpha [G]chorus' },
  { title: 'Bravo Song', key: 'D', verse: '[D]Bravo [G]verse', chorus: '[A]Bravo [D]chorus' },
  { title: 'Charlie Song', key: 'A', verse: '[A]Charlie [D]verse', chorus: '[E]Charlie [A]chorus' },
]

/**
 * Open the app and add the three SETLIST_SONGS, and a setlist of them in that
 * order, each in its own key. Returns the setlist's URL.
 */
export async function seedSetlist(page, { setlistId = 'seeded-setlist' } = {}) {
  await openApp(page, '/songs')
  await page.evaluate(
    async ({ setlistId, songs }) => {
      const { getCurrentDB } = await import('/js/db.js')
      const db = await getCurrentDB()
      const now = new Date().toISOString()
      const entries = []
      for (const [index, song] of songs.entries()) {
        const slug = song.title.toLowerCase().replace(/\W+/g, '')
        // Alpha's verse runs on, so its page can scroll
        const verse = index === 0 ? Array(40).fill(song.verse).join('\n') : song.verse
        const content = `{title: ${song.title}}\n{key: ${song.key}}\n\n{comment: Verse 1}\n${verse}\n\n{comment: Chorus}\n${song.chorus}`
        await db.saveChordPro({
          id: `chordpro-${slug}`,
          content,
          contentHash: slug,
          lastModified: Date.now(),
        })
        await db.saveSong({
          uuid: `song-${slug}`,
          id: `title-${slug}`,
          title: song.title,
          titleNormalized: slug,
          key: song.key,
          isDefault: true,
          chordproFileId: `chordpro-${slug}`,
          modifiedDate: now,
        })
        entries.push({ songId: `title-${slug}`, songUuid: `song-${slug}`, key: song.key })
      }
      await db.saveSetlist({
        id: setlistId,
        date: '2026-10-11',
        time: '10:30',
        type: 'Church Service',
        name: '',
        owner: 'Ann',
        songs: entries,
        createdDate: now,
        modifiedDate: now,
      })
    },
    { setlistId, songs: SETLIST_SONGS }
  )
  return `/setlist/${setlistId}`
}

/**
 * Turn on edit mode with the header's toggle. A click that lands before the
 * app is listening does nothing, so click again until it takes.
 */
export async function enterEditMode(page) {
  const header = page.locator('#app-header')
  await expect(async () => {
    if (!(await header.evaluate(el => el.hasAttribute('edit-mode')))) {
      await header.getByRole('button', { name: 'Toggle edit mode' }).click()
    }
    await expect(header).toHaveAttribute('edit-mode', '', { timeout: 1000 })
  }).toPass()
}
