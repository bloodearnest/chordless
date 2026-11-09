// The melody sheet: a song with a melody can be shown as its sheet, in the real engraver and under the page's policy
import { expect, seedSong, test } from './fixtures.ts'

/** One bar of four quarter notes in C, with a word on each */
const MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
<work><work-title>Info Test Song</work-title></work>
<identification><rights>© Public domain</rights></identification>
<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
<part id="P1"><measure number="1">
<attributes><divisions>24</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
${['G', 'A', 'B', 'D']
  .map(
    (step, i) =>
      `<note><pitch><step>${step}</step><octave>${step === 'D' ? 5 : 4}</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><lyric number="1"><syllabic>single</syllabic><text>la${i}</text></lyric></note>`
  )
  .join('\n')}
</measure></part></score-partwise>`

test('a song with a melody can be shown as its sheet, and back to its lyrics', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await seedSong(page, { setlistId: 'melody-setlist' })
  await page.evaluate(async xml => {
    const { getCurrentDB } = await import('/js/db.ts')
    const { scoreRecord } = await import('/js/score-record.ts')
    await (await getCurrentDB()).saveScore(scoreRecord('info-test-song', xml, 'G'))
  }, MUSIC_XML)
  await page.goto('/setlist/melody-setlist/song/0')
  await page.reload()

  const toggle = page.getByRole('button', { name: 'Show the lead sheet' })
  await expect(toggle).toBeVisible()
  await toggle.click()

  // the sheet is engraved by Verovio in its worker, in the key the song is in in this setlist (A)
  const sheet = page.locator('score-view')
  await expect(sheet.locator('.notehead')).toHaveCount(4)
  await expect(sheet).toContainText('© Public domain')
  await expect(page).toHaveURL(/\/setlist\/melody-setlist\/song\/0\?melody$/)
  await expect(page.getByRole('button', { name: 'Show the lyrics' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  // a reload stays on the sheet
  await page.reload()
  await expect(page.locator('score-view .notehead')).toHaveCount(4)

  await page.getByRole('button', { name: 'Show the lyrics' }).click()
  await expect(page.locator('song-display')).toBeVisible()
  await expect(page.locator('score-view')).toBeHidden()
  await expect(page).toHaveURL(/\/song\/0$/)

  expect(consoleErrors.filter(text => /Content Security Policy|wasm/i.test(text))).toEqual([])
})

test('the library shows a song as its sheet too, in its own key', async ({ page }) => {
  await seedSong(page)
  await page.evaluate(async xml => {
    const { getCurrentDB } = await import('/js/db.ts')
    const { scoreRecord } = await import('/js/score-record.ts')
    await (await getCurrentDB()).saveScore(scoreRecord('info-test-song', xml, 'G'))
  }, MUSIC_XML)
  await page.goto('/songs/info-test-song')
  await page.reload()
  await page.getByRole('button', { name: 'Show the lead sheet' }).click()
  await expect(page.locator('score-view .notehead')).toHaveCount(4)
  await expect(page).toHaveURL(/\/songs\/info-test-song\?melody$/)
  await page.reload()
  await expect(page.locator('score-view .notehead')).toHaveCount(4)
  await page.getByRole('button', { name: 'Show the lyrics' }).click()
  await expect(page.locator('score-view')).toBeHidden()
  await expect(page.locator('#library-song-content song-display')).toBeVisible()
})
