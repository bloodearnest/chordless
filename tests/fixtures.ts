// Shared Playwright set-up: import test and expect from here, not @playwright/test.
import { type BrowserContext, test as base, expect } from '@playwright/test'
import type { ChordProRecord, SongInput } from '../src/js/data-types.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'

const CANCELLED_IMPORT = /^TypeError: Importing a module script failed|^Context is stopped$/

// What Vite's client (the development server's, not the app's) throws in WebKit when the network
// goes: its check that the server is back fails
const OFFLINE_NOISE = /^TypeError: Load failed$|\/@vite\/client\.?$/

/** The contexts a test took offline */
const wentOffline = new WeakSet<BrowserContext>()

export const test = base.extend<{ pageErrors: string[]; firstUse: boolean }>({
  // The first-use setup modal blocks the page, so every test starts with it answered. Tests of
  // the first visit itself opt out with test.use({ firstUse: true })
  firstUse: [false, { option: true }],
  context: async ({ context, firstUse }, use) => {
    // The seeded setlists are dated October 2026, and the year is left out of a date in the
    // current year ("Sun, 11 Oct"). Pin the date so that stays true after the year ends; the
    // clock still runs.
    await context.clock.install({ time: new Date('2026-10-14T12:00:00') })
    const setOffline = context.setOffline.bind(context)
    context.setOffline = async offline => {
      if (offline) wentOffline.add(context)
      await setOffline(offline)
    }
    if (!firstUse) await context.addInitScript(() => localStorage.setItem('setup-done', '1'))
    await use(context)
  },
  // Every test fails if its page throws an uncaught error
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      // Leaving a page cancels the module imports still in flight, which WebKit reports as an
      // uncaught error on the page being left (the app reloads itself once, on the first visit,
      // when its service worker takes over): not a fault of the app, so not counted
      page.on('framenavigated', frame => {
        if (frame !== page.mainFrame()) return
        for (let i = errors.length - 1; i >= 0; i--) {
          if (CANCELLED_IMPORT.test(errors[i])) errors.splice(i, 1)
        }
      })
      await use(errors)
      const offline = wentOffline.has(page.context())
      expect(
        errors.filter(error => !(offline && OFFLINE_NOISE.test(error))),
        'uncaught errors in the page'
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/**
 * Open the app at path, ready to use: wait for the service worker to take
 * control (it routes the app's URLs). Where the worker cannot claim the page,
 * the app reloads itself once (public/boot.js), and this waits for that too,
 * so it cannot land mid-test.
 */
export async function openApp(page, path = '/') {
  await page.goto(path)
  await waitForServiceWorker(page)
}

/** Whether the page is the app, set up by openApp already: so seeding need not open it again */
const appIsOpen = page =>
  /^https?:/.test(page.url()) &&
  page
    .evaluate(
      () => navigator.serviceWorker.controller !== null && !sessionStorage.getItem('sw-first-load')
    )
    .catch(() => false)

/**
 * Wait for the first visit to settle: the service worker controls the page, and the page
 * has done its one reload (index.html sets sessionStorage 'sw-first-load' until then).
 */
export async function waitForServiceWorker(page) {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null && !sessionStorage.getItem('sw-first-load')
  )
}

/**
 * Open the app (unless it is open already), so it sets up its space and database, then add a
 * test song (Info Test Song, in G: [G]Amazing [C]grace), and optionally a setlist containing it.
 */
export async function seedSong(page, { setlistId = null }: { setlistId?: string | null } = {}) {
  if (!(await appIsOpen(page))) await openApp(page, '/songs')
  const chordpro = {
    id: 'chordpro-info-test',
    content: '{title: Info Test Song}\n{key: G}\n\n[G]Amazing [C]grace',
    contentHash: 'test',
    lastModified: Date.now(),
  }
  const song = makeSong({
    uuid: 'info-test-song',
    id: 'title-info-test-song',
    title: 'Info Test Song',
    titleNormalized: 'infotestsong',
    chordproFileId: chordpro.id,
  })
  const setlist = setlistId
    ? makeSetlist({
        id: setlistId,
        songs: [makeEntry({ songId: song.id, songUuid: song.uuid, key: 'A' })],
      })
    : null
  await page.evaluate(
    async ({ chordpro, song, setlist }) => {
      const { getCurrentDB } = await import('/js/db.ts')
      const db = await getCurrentDB()
      await db.saveChordPro(chordpro)
      await db.saveSong(song)
      if (setlist) await db.saveSetlist(setlist)
    },
    { chordpro, song, setlist }
  )
}

export /** Call a method of the app's database, e.g. fromDB(page, 'getSong', uuid) */
function fromDB(page, method, arg) {
  return page.evaluate(
    async ({ method, arg }) => {
      const { getCurrentDB } = await import('/js/db.ts')
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
 * Open the app (unless it is open already) and add the three SETLIST_SONGS, and a setlist of
 * them in that order, each in its own key. Returns the setlist's URL.
 */
export async function seedSetlist(page, { setlistId = 'seeded-setlist' } = {}) {
  if (!(await appIsOpen(page))) await openApp(page, '/songs')
  const chordpros: ChordProRecord[] = []
  const songs: SongInput[] = []
  SETLIST_SONGS.forEach((song, index) => {
    const slug = song.title.toLowerCase().replace(/\W+/g, '')
    // Alpha's verse runs on, so its page can scroll
    const verse = index === 0 ? Array(40).fill(song.verse).join('\n') : song.verse
    chordpros.push({
      id: `chordpro-${slug}`,
      content: `{title: ${song.title}}\n{key: ${song.key}}\n\n{comment: Verse 1}\n${verse}\n\n{comment: Chorus}\n${song.chorus}`,
      contentHash: slug,
      lastModified: Date.now(),
    })
    songs.push(
      makeSong({
        uuid: `song-${slug}`,
        id: `title-${slug}`,
        title: song.title,
        titleNormalized: slug,
        key: song.key,
        chordproFileId: `chordpro-${slug}`,
      })
    )
  })
  const setlist = makeSetlist({
    id: setlistId,
    songs: songs.map((song, order) =>
      makeEntry({ songId: song.id, songUuid: song.uuid, key: song.key, order })
    ),
  })
  await page.evaluate(
    async ({ chordpros, songs, setlist }) => {
      const { getCurrentDB } = await import('/js/db.ts')
      const db = await getCurrentDB()
      for (const chordpro of chordpros) await db.saveChordPro(chordpro)
      for (const song of songs) await db.saveSong(song)
      await db.saveSetlist(setlist)
    },
    { chordpros, songs, setlist }
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
