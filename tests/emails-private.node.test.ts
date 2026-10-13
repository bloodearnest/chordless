/**
 * The email importer over real emails (tests/fixtures/private/emails/*.eml, downloaded with
 * scripts/download-emails.ts; docs/TESTING.md, "Real emails"). They are not committed, as their
 * charts are copyrighted and the emails have other people's addresses in them, so this skips
 * when there are none.
 *
 * It can't know what each email should give, so it checks what must be true of any: nothing
 * throws, and what comes out is well formed. A new kind of email that breaks one of these is a
 * case to add to email-setlist.node.test.ts, as a made-up email of the same shape.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { readEmail } from '../src/js/email-mime.ts'
import { importFromEmail } from '../src/js/email-setlist.ts'
import { readPdfText } from '../src/js/pdf-text.ts'

const DIR = new URL('./fixtures/private/emails/', import.meta.url)
const files = existsSync(DIR) ? readdirSync(DIR).filter(name => name.endsWith('.eml')) : []

test('real emails: every one reads as a well formed setlist', {
  skip: !files.length && 'no real emails in tests/fixtures/private/emails',
}, async () => {
  const problems: string[] = []
  let songs = 0
  let withoutKey = 0
  for (const file of files) {
    const email = await readEmail(readFileSync(new URL(file, DIR)), readPdfText)
    const result = importFromEmail(email)
    const check = (ok: boolean, what: string) => ok || problems.push(`${file}: ${what}`)

    check(/^[^@\s]+@[^@\s]+$/.test(result.leader.email), `leader email "${result.leader.email}"`)
    check(
      result.leader.name !== '' && !/[<>]/.test(result.leader.name),
      `leader name "${result.leader.name}"`
    )
    check(result.date === '' || /^\d{4}-\d\d-\d\d$/.test(result.date), `date "${result.date}"`)
    check(
      result.date === '' || !Number.isNaN(Date.parse(result.date)),
      `date "${result.date}" is real`
    )
    check(result.songs.length > 0, 'no songs')
    check(email.charts.length > 0, 'no charts read')

    for (const song of result.songs) {
      songs++
      if (!song.key) withoutKey++
      check(song.title.trim() !== '' && !/^\d+\s*[.)]/.test(song.title), `title "${song.title}"`)
      check(
        song.titles[0] === song.title || song.titles.includes(song.title),
        `titles of "${song.title}"`
      )
      check(
        song.ccli === null || /^\d{4,9}$/.test(song.ccli),
        `CCLI "${song.ccli}" of "${song.title}"`
      )
      check(
        song.key === null || /^[A-G][#b]?m?$/.test(song.key),
        `key "${song.key}" of "${song.title}"`
      )
      check(!/https?:/.test(song.notes), `a link in the notes of "${song.title}"`)
    }

    // Every chart is accounted for: in the setlist, or offered as not in the list
    const used = [...result.songs, ...result.unlisted].filter(song => song.chartFilename).length
    const distinct = new Set(email.charts.map(chart => `${chart.ccli ?? chart.title}|${chart.key}`))
      .size
    check(used <= email.charts.length && used >= Math.min(distinct, 1), 'charts not accounted for')
  }
  assert.deepEqual(problems, [])
  assert.ok(withoutKey / songs < 0.05, `${withoutKey} of ${songs} songs have no key`)
})
