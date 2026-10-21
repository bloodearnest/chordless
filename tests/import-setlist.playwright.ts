// Making a setlist from a leader's email (/import-setlist): the email is made up, with a small
// PDF made by tests/make-pdf.ts, as real charts are copyrighted.

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

const instructions = page => page.getByText('Forward the email a worship leader sent')

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

  await page.getByRole('button', { name: 'Start over' }).click()
  await page.reload()
  await expect(instructions(page)).toBeVisible()
})

test('an email with no date asks for one, and a date that has a setlist is pointed out', async ({
  page,
}) => {
  await seedSetlist(page)
  await choose(page, email('Prayer day', ['1. Alpha Song in G']))
  await expect(page.getByRole('note')).toContainText('no date')
  await expect(page.locator('setlist-details-form input[name="date"]')).not.toHaveValue('')

  await page.getByRole('button', { name: 'Start over' }).click()
  await choose(page, email('Sunday 11th October', ['1. Alpha Song in G']))
  const group = page.getByRole('group', { name: 'A setlist for this date' })
  await expect(group).toContainText('You already have a setlist')
  await expect(group.getByRole('link')).toHaveAttribute('href', '/setlist/seeded-setlist')
  // Not the leader's: a new setlist is the choice until they say
  await expect(group.getByLabel('Make a new setlist')).toBeChecked()
})

test('a link that holds no songs, or is not a link, says so and shows how to import', async ({
  page,
}) => {
  await seedSetlist(page)
  await choose(page, email('Hello', []))
  await expect(page.getByRole('alert')).toContainText('That link holds no songs')
  await expect(instructions(page)).toBeVisible()
  await expect(page.getByRole('link', { name: 'import@chordless.app' })).toHaveAttribute(
    'href',
    'mailto:import@chordless.app'
  )
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

test('a link from the email Worker opens the review, and a reload keeps it', async ({ page }) => {
  await seedSetlist(page)
  await page.goto('/')
  const fragment = await page.evaluate(async () => {
    const { encodeImport } = await import('/js/email-link.ts')
    const song = (title: string, key: string) => ({
      title,
      titles: [title],
      author: null,
      key,
      tempo: null,
      time: null,
      ccli: null,
      chartFilename: null,
      listed: title,
      notes: '',
    })
    return encodeImport({
      name: 'Sunday 25th October',
      date: '2026-10-25',
      dateWarning: null,
      sentDate: '2026-10-11',
      orderFromList: true,
      leader: { name: 'Leader One', email: 'one@example.com' },
      songs: [song('Alpha Song', 'G'), song('Bravo Song', 'D')],
      unlisted: [],
    })
  })
  await page.goto(`/import-setlist#${fragment}`)
  await expect(songsList(page)).toHaveCount(2)
  await expect(createButton(page)).toBeEnabled()
  expect(new URL(page.url()).hash).toBe('')
  await page.reload()
  await expect(songsList(page)).toHaveCount(2)

  // The installed app is launched with the link: the fragment is handed over, even to an open page
  await page.getByRole('button', { name: 'Start over' }).click()
  await expect(instructions(page)).toBeVisible()
  await page.evaluate(async fragment => {
    const { offerLink } = await import('/js/incoming-link.ts')
    offerLink('/import-setlist', `#${fragment}`)
  }, fragment)
  await expect(songsList(page)).toHaveCount(2)

  await page.getByRole('button', { name: 'Start over' }).click()
  await page.goto('/import-setlist#not-a-link')
  await expect(page.getByRole('alert')).toContainText('Could not read that link')
  await expect(instructions(page)).toBeVisible()
})

test('a song only another database has is found there, and copied into the library when the setlist is made', async ({
  page,
}) => {
  await seedSetlist(page)
  await page.evaluate(async () => {
    const { ChordlessDB } = await import('/js/db.ts')
    const { addChart } = await import('/js/song-utils.ts')
    const { SHARED_DB_ID } = await import('/js/share-receiver.ts')
    const shared = new ChordlessDB(SHARED_DB_ID)
    await shared.init()
    await addChart(
      shared,
      '{title: Shared Only Song}\n{key: A}\n{ccli: 7654321}\n\n[A]Words here',
      {
        variantLabel: 'Shared',
        importSource: 'test',
        makeDefault: 'first',
      }
    )
    shared.db?.close()
  })
  await choose(
    page,
    email('Sunday 25th October', ['1. Alpha Song in G', '2. Shared Only Song in A'])
  )
  const row = songsList(page).nth(1)
  await expect(row).toContainText('In “Shared with me”')
  await expect(createButton(page)).toBeEnabled()

  await createButton(page).click()
  await expect(page).toHaveURL(/\/setlist\/[0-9a-f-]+$/)
  const result = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    const setlist = (await db.getAllSetlists()).find(have => have.name === 'Sunday 25th October')
    const songs = await Promise.all((setlist?.songs ?? []).map(e => db.getSong(e.songUuid)))
    return songs.map(song => song?.title)
  })
  // It is the library's own song now: the setlist does not depend on the other database
  expect(result).toEqual(['Alpha Song', 'Shared Only Song'])
})

test('an email for a date that has a setlist can update it, showing what changes first', async ({
  page,
}) => {
  await seedSetlist(page)
  // The seeded setlist is Alpha (G), Bravo (D), Charlie (A), for 11th October
  await choose(
    page,
    email('Sunday 11th October', [
      '1. Bravo Song in E',
      '2. Alpha Song in G',
      '3. Charlie Song in A',
    ])
  )
  const group = page.getByRole('group', { name: 'A setlist for this date' })
  await group.getByLabel(/Update/).check()
  await expect(page.locator('setlist-details-form')).toBeHidden()

  const changes = page.getByRole('region', { name: 'Changes to the setlist' })
  await expect(changes).toContainText('Bravo Song: key D → E')
  await expect(changes).toContainText('The songs are in the email’s order')
  await expect(changes).not.toContainText('Adds')

  await page.getByRole('button', { name: 'Update setlist' }).click()
  await expect(page).toHaveURL(/\/setlist\/seeded-setlist$/)
  const result = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    const setlist = await db.getSetlist('seeded-setlist')
    const all = await db.getAllSetlists()
    return {
      count: all.length,
      date: setlist?.date,
      entries: setlist?.songs.map(e => [e.songId, e.key, e.order]),
    }
  })
  expect(result).toEqual({
    count: 1,
    date: '2026-10-11',
    entries: [
      ['title-bravosong', 'E', 0],
      ['title-alphasong', 'G', 1],
      ['title-charliesong', 'A', 2],
    ],
  })
})

test('updating drops a song the email left out, unless it is kept', async ({ page }) => {
  await seedSetlist(page)
  await choose(page, email('Sunday 11th October', ['1. Alpha Song in G', '2. Bravo Song in D']))
  const group = page.getByRole('group', { name: 'A setlist for this date' })
  await group.getByLabel(/Update/).check()
  const changes = page.getByRole('region', { name: 'Changes to the setlist' })
  await expect(changes).toContainText('Keep Charlie Song')
  await changes.getByLabel(/Keep Charlie Song/).check()
  await page.getByRole('button', { name: 'Update setlist' }).click()
  await expect(page).toHaveURL(/\/setlist\/seeded-setlist$/)
  const ids = await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    return (await db.getSetlist('seeded-setlist'))?.songs.map(e => e.songId)
  })
  expect(ids).toEqual(['title-alphasong', 'title-bravosong', 'title-charliesong'])
})

test('the same leader’s setlist for that date is the one updated, until they say otherwise', async ({
  page,
}) => {
  await seedSetlist(page)
  await page.evaluate(async () => {
    const { getCurrentDB } = await import('/js/db.ts')
    const db = await getCurrentDB()
    const setlist = await db.getSetlist('seeded-setlist')
    if (setlist)
      await db.saveSetlist({ ...setlist, owner: 'Leader One', ownerId: 'one@example.com' })
  })
  await choose(page, email('Sunday 11th October', ['1. Alpha Song in G']))
  const group = page.getByRole('group', { name: 'A setlist for this date' })
  await expect(group.getByLabel(/Update/)).toBeChecked()
  await group.getByLabel('Make a new setlist').check()
  await expect(page.locator('setlist-details-form')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create setlist' })).toBeEnabled()
})
