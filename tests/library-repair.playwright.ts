// The library repair dev page (src/dev/library-repair.html): preview, then apply, on a space whose
// library has the same song twice.
import { expect, test } from './fixtures.ts'

const CHART = (key: string, c1: string, c2: string, bumph = '') =>
  `{title: Amazing}\n{key: ${key}}\n{comment: Verse 1}\n[${c1}]Amazing [${c2}]grace\n${bumph}`
const BUMPH = '{ccli_license: 1}\n{footer: For use solely with the SongSelect Terms of Use}'

test('previews, then applies, a repair of a library with a song twice', { tag: '@logic' }, async ({
  page,
}) => {
  await page.goto('/dev/library-repair.html')
  const spaceId = await page.evaluate(
    async ([inG, inA]) => {
      const { createSpace } = await import('/js/space.ts')
      const { ChordlessDB } = await import('/js/db.ts')
      const { hashText } = await import('/js/song-utils.ts')
      const space = await createSpace('Repair me')
      const db = new ChordlessDB(space.id)
      await db.init()
      const add = async (uuid: string, text: string, key: string) => {
        await db.saveChordPro({
          id: `chordpro-${uuid}`,
          content: text,
          contentHash: hashText(text),
          lastModified: 1,
        })
        await db.saveSong({
          uuid,
          id: 'ccli-1',
          variantOf: null,
          isDefault: true,
          variantLabel: 'Original',
          chordproFileId: `chordpro-${uuid}`,
          ccliNumber: '1',
          title: 'Amazing',
          titleNormalized: 'amazing',
          author: null,
          copyright: null,
          key,
          originalKey: key,
          tempo: null,
          originalTempo: null,
          time: null,
          importDate: '2026-05-04T00:00:00Z',
          importUser: null,
          importSource: 'drive',
          sourceUrl: null,
          modifiedDate: '2026-05-04T00:00:00Z',
          fileRef: null,
          fileModified: null,
          lastSyncedAt: null,
          contentHash: hashText(text),
        })
      }
      await add('may', inG, 'G')
      await add('june', inA, 'A')
      await db.saveSetlist({
        id: 'sunday',
        date: '2026-10-11',
        time: '10:30',
        type: 'Church Service',
        name: '',
        owner: 'Ann',
        createdDate: '2026-10-11T10:00:00.000Z',
        modifiedDate: '2026-10-11T10:00:00.000Z',
        songs: [
          { order: 0, songId: 'ccli-1', songUuid: 'may', key: null, tempo: null, notes: '' },
          { order: 1, songId: 'ccli-1', songUuid: 'june', key: null, tempo: null, notes: '' },
          { order: 2, songId: 'ccli-1', songUuid: 'june', key: null, tempo: null, notes: '' },
        ],
      })
      db.db?.close()
      return space.id
    },
    [CHART('G', 'G', 'C'), CHART('A', 'A', 'D', BUMPH)]
  )

  await page.reload()
  await page.locator('#space').selectOption(spaceId)
  await page.locator('#written-by').fill('Simon Davy')
  await page.locator('#backup').uncheck()
  await page.getByRole('button', { name: 'Preview' }).click()
  await expect(page.locator('#output')).toContainText('1 songs are repeated')
  await expect(page.locator('#output')).toContainText('1 extra records would be removed')
  await expect(page.locator('#output')).toContainText('1 SongSelect, 1 “Simon Davy”')

  // The first click only asks; the second applies
  const apply = page.getByRole('button', { name: 'Apply' })
  await apply.click()
  await expect(page.getByRole('button', { name: 'Click again to apply' })).toBeVisible()
  await page.getByRole('button', { name: 'Click again to apply' }).click()
  await expect(page.locator('#output')).toContainText('1 songs removed, 2 sources set')

  const left = await page.evaluate(async id => {
    const { ChordlessDB } = await import('/js/db.ts')
    const db = new ChordlessDB(id)
    await db.init()
    const songs = (await db.getAllSongs()).map(song => [song.uuid, song.importSource])
    const entries = (await db.getSetlist('sunday'))?.songs.map(entry => [entry.songUuid, entry.key])
    db.db?.close()
    return { songs, entries }
  }, spaceId)
  expect(left.songs).toEqual([['june', 'songselect']])
  expect(left.entries).toEqual([
    ['june', 'G'],
    ['june', null],
    ['june', null],
  ])
})

test('lets a Team’s member repair its library, without merging, and its admin merge, and shows the console handle', {
  tag: '@logic',
}, async ({ page }) => {
  await page.goto('/dev/library-repair.html')
  await page.evaluate(async () => {
    const { createSpace, updateSpace } = await import('/js/space.ts')
    const member = await createSpace('As member')
    await updateSpace(member.id, { team: { id: 't-member', role: 'writer' } })
    const admin = await createSpace('As admin')
    await updateSpace(admin.id, { team: { id: 't-admin', role: 'admin' } })
  })
  await page.reload()
  const member = page.locator('#space option', { hasText: 'As member' })
  await expect(member).toBeEnabled()
  await expect(member).toContainText('no merging')
  await expect(page.locator('#space option', { hasText: 'As admin' })).not.toContainText(
    'no merging'
  )
  expect(
    await page.evaluate(() => typeof (globalThis as { libraryRepair?: unknown }).libraryRepair)
  ).toBe('object')
})
