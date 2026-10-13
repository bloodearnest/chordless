// Making a setlist from a leader's email (/import-setlist): the email is made up, with a small
// PDF made by tests/make-pdf.ts, as real charts are copyrighted.
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
  await page.goto('/import-setlist')
  await page.locator('#email-file').setInputFiles({
    name: 'sunday.eml',
    mimeType: 'message/rfc822',
    buffer,
  })
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
    const setlist = (await db.getAllSetlists()).find(have => have.name === 'Sunday 25th October')
    if (!setlist) return null
    const entries: { title?: string; key: string | null; tempo: number | null }[] = []
    for (const entry of setlist.songs) {
      const song = await db.getSong(entry.songUuid)
      entries.push({ title: song?.title, key: entry.key, tempo: entry.tempo })
    }
    return {
      date: setlist.date,
      owner: setlist.owner,
      ownerId: setlist.ownerId,
      type: setlist.type,
      entries,
      songCount: (await db.getAllSongs()).length,
    }
  })
  expect(result).toEqual({
    date: '2026-10-25',
    owner: 'Leader One',
    ownerId: 'one@example.com',
    type: 'Event',
    entries: [
      { title: 'Alpha Song', key: 'G', tempo: null },
      { title: 'Brand New Song', key: 'D', tempo: 90 },
      { title: 'Charlie Song', key: 'A', tempo: null },
      { title: 'Bravo Song', key: 'D', tempo: null },
    ],
    songCount: 4,
  })
})

test('with no clear CCLI number, the link searches SongSelect for the title', async ({ page }) => {
  await seedSetlist(page)
  await choose(page, email('Sunday 25th October', ['1. Brand New Song (Other Name) in D']))
  const link = songsList(page).nth(0).getByRole('link', { name: 'Search SongSelect for it' })
  await expect(link).toHaveAttribute(
    'href',
    'https://songselect.ccli.com/search/results?search=Brand%20New%20Song'
  )
  await expect(link).toHaveAttribute('target', '_blank')
})

test('a song can be left out, and a possible match turned down', async ({ page }) => {
  await seedSetlist(page)
  await choose(page, email('Sunday 25th October', LIST, [NEW_PDF]))
  const songs = songsList(page)
  await expect(songs).toHaveCount(4)
  await expect(createButton(page)).toBeDisabled()

  await songs.nth(1).getByRole('button', { name: 'Leave it out' }).click()
  await expect(createButton(page)).toBeEnabled()

  // Turning down the possible match makes it a missing song again: search for it, or leave it out
  await songs.nth(2).getByLabel('None of these').check()
  await expect(createButton(page)).toBeDisabled()
  await expect(
    songs.nth(2).getByRole('link', { name: 'Search SongSelect for it' })
  ).toHaveAttribute('href', /search\/results\?search=Charlie%20Song%20Live/)
  await songs.nth(2).getByRole('button', { name: 'Leave it out' }).click()
  await songs.nth(0).getByRole('checkbox', { name: 'Include Alpha Song' }).uncheck()
  await expect(createButton(page)).toBeEnabled()

  await createButton(page).click()
  await expect(page).toHaveURL(/\/setlist\//)
  const titles = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    const setlist = (await db.getAllSetlists()).find(have => have.name === 'Sunday 25th October')
    const songs = await Promise.all((setlist?.songs ?? []).map(e => db.getSong(e.songUuid)))
    return songs.map(song => song?.title)
  })
  expect(titles).toEqual(['Bravo Song'])
})

test('the review survives a reload, with the changes made to it', async ({ page }) => {
  await seedSetlist(page)
  await choose(page, email('Sunday 25th October', LIST, [NEW_PDF]))
  await expect(songsList(page)).toHaveCount(4)
  await songsList(page).nth(1).getByRole('button', { name: 'Leave it out' }).click()
  await songsList(page).nth(3).getByLabel('Key').fill('E')

  await page.reload()
  await expect(songsList(page)).toHaveCount(4)
  await expect(songsList(page).nth(1).getByRole('checkbox')).not.toBeChecked()
  await expect(songsList(page).nth(3).getByLabel('Key')).toHaveValue('E')

  await page.getByRole('button', { name: 'Choose a different email' }).click()
  await page.reload()
  await expect(page.locator('#email-file')).toBeVisible()
})

test('an email with no date asks for one, and a date that has a setlist is pointed out', async ({
  page,
}) => {
  await seedSetlist(page)
  await choose(page, email('Prayer day', ['1. Alpha Song in G']))
  await expect(page.getByRole('note')).toContainText('no date')
  await expect(page.locator('setlist-details-form input[name="date"]')).not.toHaveValue('')

  await page.getByRole('button', { name: 'Choose a different email' }).click()
  await choose(page, email('Sunday 11th October', ['1. Alpha Song in G']))
  await expect(page.getByRole('note')).toContainText('You already have a setlist')
  await expect(page.getByRole('note').getByRole('link')).toHaveAttribute(
    'href',
    '/setlist/seeded-setlist'
  )
})

test('something that is not an email, or has no songs, says so and stays on the page', async ({
  page,
}) => {
  await seedSetlist(page)
  await choose(page, Buffer.from('just some text, not an email'))
  await expect(page.getByRole('alert')).toContainText('Could not read that email')
  await expect(page.locator('#email-file')).toBeVisible()
})

test('a title that is a line of another song’s words finds it, for the person to confirm', async ({
  page,
}) => {
  await seedSetlist(page)
  await page.evaluate(async () => {
    const { createSong } = await import('/js/song-utils.ts')
    await createSong(
      '{title: This Is Our God}\n{key: E}\n\n[E]Made up words, your grace is [A]enough\n[E]Made up chorus'
    )
  })
  await choose(page, email('Sunday 25th October', ['1. Your Grace Is Enough in E']))
  const row = songsList(page).nth(0)
  await expect(row).toContainText('its words are in these')
  // Nothing is picked for them: it counts as missing until they say
  await expect(row.getByLabel('None of these')).toBeChecked()
  await expect(createButton(page)).toBeDisabled()

  await row.getByLabel('This Is Our God').check()
  await expect(createButton(page)).toBeEnabled()
  await createButton(page).click()
  await expect(page).toHaveURL(/\/setlist\//)
  const title = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    const setlist = (await db.getAllSetlists()).find(have => have.name === 'Sunday 25th October')
    return (await db.getSong(setlist?.songs[0].songUuid ?? ''))?.title
  })
  expect(title).toBe('This Is Our God')
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

test('a song listed under a chorus line but attached under its title is found, and said to be a guess', async ({
  page,
}) => {
  await seedSetlist(page)
  await importFromSongSelect(page, 'This Is Our God', '5060834')
  await choose(
    page,
    email(
      'Sunday 25th October',
      ['1. Your Grace Is Enough in E'],
      [
        {
          name: 'This Is Our God-chords-E.pdf',
          lines: ['This Is Our God', 'Key - E', 'CCLI Song # 5060834'],
        },
      ]
    )
  )
  const row = songsList(page).nth(0)
  await expect(row).toContainText('✓ In your library')
  await expect(row).toContainText('listed as “Your Grace Is Enough”')
  await expect(row).toContainText('taken to be this one')
  await expect(createButton(page)).toBeEnabled()
  // The one attached chart is not offered again as unlisted
  await expect(page.getByText('Charts attached but not in the list')).toHaveCount(0)
})
