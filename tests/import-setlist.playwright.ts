// Making a setlist from a leader's email (/import-setlist): the email is made up, with a small
// PDF made by tests/make-pdf.ts, as real charts are copyrighted.
//
// The whole way through, from an email to a saved setlist, and the page's layout. What the review
// does with each kind of email and decision is in setlist-email-import.test.ts, reading an email
// in email-setlist.node.test.ts, and the link in email-link.node.test.ts.

import { linkFor } from './email-link-for.ts'
import { expect, seedSetlist, test } from './fixtures.ts'
import { email } from './make-email.ts'

const LIST = [
  '1. Alpha Song in G',
  '2. Brand New Song in D',
  '3. Charlie Song Live in A',
  '4. Bravo Song in D',
]
const NEW_PDF = {
  name: 'Brand New Song-chords-D.pdf',
  lines: ['Brand New Song', 'Key - D | Tempo - 90 | Time - 4/4', 'CCLI Song # 1234567'],
}

async function choose(page, buffer: Buffer) {
  await page.goto(await linkFor(buffer))
}

/** The song arrives in the library, as the SongSelect bookmarklet would bring it */
async function importFromSongSelect(page, title: string, ccli: string) {
  await page.evaluate(
    async ({ title, ccli }) => {
      const { createSong } = await import('/js/song-utils.ts')
      await createSong(`{title: ${title}}\n{key: D}\n{ccli: ${ccli}}\n\n[D]Real chart`)
    },
    { title, ccli }
  )
}

const songsList = page =>
  page.getByRole('list', { name: 'Songs', exact: true }).getByRole('listitem')
const createButton = page => page.getByRole('button', { name: 'Create setlist' })

test('a song the library lacks must be imported from SongSelect first, then the setlist is made', async ({
  page,
}) => {
  await seedSetlist(page)
  await choose(page, email('Sunday 25th October', LIST, [NEW_PDF]))

  const songs = songsList(page)
  await expect(songs).toHaveCount(4)
  await expect(songs.nth(0)).toContainText('✓ In your library')
  await expect(songs.nth(1)).toContainText('Not in your library')
  // The PDF gave a CCLI number: a link to the song's own page, in a new window
  const link = songs.nth(1).getByRole('link', { name: 'Open it on SongSelect' })
  await expect(link).toHaveAttribute('href', 'https://songselect.ccli.com/songs/1234567')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(songs.nth(2)).toContainText('Is it one of these?')
  await expect(songs.nth(2).getByLabel('Charlie Song', { exact: true })).toBeChecked()
  await expect(songs.nth(3)).toContainText('✓ In your library')

  // It can't be made yet
  await expect(page.getByRole('status')).toContainText('1 song is not in your library yet')
  await expect(createButton(page)).toBeDisabled()
  await expect(page.locator('setlist-details-form input[name="date"]')).toHaveValue('2026-10-25')

  // The song is imported (in another window); coming back, the page looks again
  await importFromSongSelect(page, 'Brand New Song', '1234567')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(songs.nth(1)).toContainText('✓ In your library')
  await expect(createButton(page)).toBeEnabled()

  await createButton(page).click()
  await expect(page).toHaveURL(/\/setlist\/[0-9a-f-]+$/)

  const result = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    const setlist = (await db.getAllSetlists()).find(have => have.date === '2026-10-25')
    if (!setlist) return null
    const entries: { title?: string; key: string | null; tempo: number | null }[] = []
    for (const entry of setlist.songs) {
      const song = await db.getSong(entry.songUuid)
      entries.push({ title: song?.title, key: entry.key, tempo: entry.tempo })
    }
    return {
      date: setlist.date,
      name: setlist.name,
      owner: setlist.owner,
      ownerId: setlist.ownerId,
      type: setlist.type,
      entries,
      songCount: (await db.getAllSongs()).length,
    }
  })
  expect(result).toEqual({
    date: '2026-10-25',
    // (a subject that is only the date is no name, so the setlist is that Sunday's service)
    name: '',
    owner: 'Leader One',
    ownerId: 'one@example.com',
    type: 'Church Service',
    entries: [
      { title: 'Alpha Song', key: 'G', tempo: null },
      { title: 'Brand New Song', key: 'D', tempo: 90 },
      { title: 'Charlie Song', key: 'A', tempo: null },
      { title: 'Bravo Song', key: 'D', tempo: null },
    ],
    songCount: 4,
  })
})

test('the setlist’s details come first, then the songs, with Create below them', async ({
  page,
}) => {
  await seedSetlist(page)
  await choose(page, email('Sunday 25th October', LIST, [NEW_PDF]))
  await expect(songsList(page)).toHaveCount(4)
  const top = async locator => (await locator.boundingBox())?.y ?? Number.NaN
  const details = await top(page.locator('setlist-details-form'))
  const songs = await top(page.getByRole('list', { name: 'Songs', exact: true }))
  const create = await top(createButton(page))
  expect(details).toBeLessThan(songs)
  expect(songs).toBeLessThan(create)
  // Leaving a song out is a small button
  const leave = await songsList(page)
    .nth(1)
    .getByRole('button', { name: 'Leave it out' })
    .boundingBox()
  const made = await createButton(page).boundingBox()
  expect(leave?.height).toBeLessThan((made?.height ?? 0) * 0.7)
})
