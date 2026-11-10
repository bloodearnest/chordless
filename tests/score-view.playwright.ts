// The melody sheet: a song with a melody can be shown as its sheet, in the real engraver and under the page's policy
import { enterEditMode, expect, seedSong, test } from './fixtures.ts'

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

test('in a dark theme the sheet has the whole page below the header, in its dimmed light colours', async ({
  page,
}) => {
  await seedSong(page, { setlistId: 'melody-setlist' })
  await page.evaluate(async xml => {
    localStorage.setItem('theme', 'dark')
    const { getCurrentDB } = await import('/js/db.ts')
    const { scoreRecord } = await import('/js/score-record.ts')
    await (await getCurrentDB()).saveScore(scoreRecord('info-test-song', xml, 'G'))
  }, MUSIC_XML)
  await page.goto('/setlist/melody-setlist/song/0?melody')
  await page.reload()
  await expect(page.locator('score-view .notehead')).toHaveCount(4)

  const background = (selector: string) =>
    page.locator(selector).evaluate(e => getComputedStyle(e).backgroundColor)
  const sheet = await background('score-view')
  const lyrics = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(sheet).not.toEqual(lyrics)
  // (the song's whole slide, its margins too, not a box on the dark page)
  expect(await background('#song-0')).toEqual(sheet)
  // (and the page's margins above and below it, on a tablet or a desktop)
  await expect.poll(() => background('#main-content')).toEqual(sheet)

  await page.getByRole('button', { name: 'Show the lyrics' }).click()
  await expect(page.locator('score-view')).toBeHidden()
  expect(await background('#song-0')).not.toEqual(sheet)
  await expect.poll(() => background('#main-content')).not.toEqual(sheet)
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

/** An intro of one bar of cue-size notes, then a verse of one bar sung (G major) */
const CUE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
<part id="P1">
<measure number="1">
<attributes><divisions>24</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<direction placement="above"><direction-type><rehearsal halign="left">INTRO</rehearsal></direction-type></direction>
${['G', 'A', 'B', 'D']
  .map(
    step =>
      `<note><cue/><pitch><step>${step}</step><octave>${step === 'D' ? 5 : 4}</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type></note>`
  )
  .join('\n')}
</measure>
<measure number="2">
<direction placement="above"><direction-type><rehearsal halign="left">VERSE 1</rehearsal></direction-type></direction>
${['G', 'A', 'B', 'D']
  .map(
    (step, i) =>
      `<note><pitch><step>${step}</step><octave>${step === 'D' ? 5 : 4}</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><lyric number="1"><syllabic>single</syllabic><text>la${i}</text></lyric></note>`
  )
  .join('\n')}
</measure></part></score-partwise>`

test('an instrumental part shows the notes of the lead sheet, and can be switched back to its chords', async ({
  page,
}) => {
  const consoleErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await seedSong(page, { setlistId: 'melody-setlist' })
  await page.evaluate(async xml => {
    const { getCurrentDB } = await import('/js/db.ts')
    const { scoreRecord } = await import('/js/score-record.ts')
    const db = await getCurrentDB()
    await db.saveChordPro({
      id: 'chordpro-info-test',
      content:
        '{title: Info Test Song}\n{key: G}\n\n{comment: Intro}\n[G] [C] [D] [G]\n\n{comment: Verse 1}\n[G]Amazing [C]grace',
      contentHash: 'test2',
      lastModified: Date.now(),
    })
    await db.saveScore(scoreRecord('info-test-song', xml, 'G'))
  }, CUE_XML)
  await page.goto('/setlist/melody-setlist/song/0')
  await page.reload()

  const intro = page.locator('song-section[data-label="Intro"]')
  // the part with no words shows the notes of the sheet, by default
  await expect(intro.locator('score-view .notehead')).toHaveCount(4)
  const sung = page.locator('song-section[data-label="Verse 1"]')
  await expect(sung.locator('score-view')).toHaveCount(0)

  // (the options are in edit mode) the sung part has no Melody option, the instrumental one has
  const header = page.locator('#app-header')
  await enterEditMode(page)
  await expect(intro.getByRole('button', { name: 'Show Melody in Intro' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(sung.getByRole('button', { name: 'Show Chords in Verse 1' })).toBeVisible()
  await expect(sung.getByRole('button', { name: /Show Melody/ })).toHaveCount(0)

  // back to the chords, and it stays so through a reload
  await intro.getByRole('button', { name: 'Show Chords in Intro' }).click()
  await expect(intro.locator('score-view')).toHaveCount(0)
  await expect(intro.locator('chord-display').first()).toBeVisible()
  await header.getByRole('button', { name: 'Toggle edit mode' }).click()
  await page.reload()
  await expect(intro.locator('chord-display').first()).toBeVisible()
  await expect(intro.locator('score-view')).toHaveCount(0)

  await enterEditMode(page)
  await intro.getByRole('button', { name: 'Show Melody in Intro' }).click()
  await expect(intro.locator('score-view .notehead')).toHaveCount(4)

  expect(consoleErrors.filter(text => /Content Security Policy|wasm/i.test(text))).toEqual([])
})
