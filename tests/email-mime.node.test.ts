/**
 * Reading a raw email (src/js/email-mime.ts): made-up emails, built here. The "PDFs" are small
 * text, as a PDF reader is passed in and these tests give one that returns the text as it is.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readEmail, textOfHtml } from '../src/js/email-mime.ts'
import { importFromEmail } from '../src/js/email-setlist.ts'

const base64 = (text: string) => Buffer.from(text).toString('base64')
const readText = async (pdf: ArrayBuffer) => new TextDecoder().decode(pdf)

const chartPart = (boundary: string, filename: string, text: string) =>
  [
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64(text),
  ].join('\r\n')

const headers = (extra: string[]) =>
  [
    'From: Jenny Nelson <Jen@Example.com>',
    'To: Simon <me@example.com>',
    'Subject: Fwd: Sunday 18th October',
    'Date: Tue, 13 Oct 2026 10:51:59 +0100',
    'MIME-Version: 1.0',
    ...extra,
  ].join('\r\n')

const forwarded = [
  '---------- Forwarded message ---------',
  'From: Leader One <one@example.com>',
  'Date: Fri, 9 Oct 2026, 18:11',
  'Subject: Sunday 18th October',
  'To: <x@example.com>',
  '',
  '1. Made Up Song in D',
  '2. Another Song in G',
].join('\r\n')

test('an email is read into its text, sender and charts', async () => {
  const raw = [
    headers(['Content-Type: multipart/mixed; boundary="B"']),
    '',
    '--B',
    'Content-Type: text/plain; charset=utf-8',
    '',
    forwarded,
    chartPart(
      'B',
      'Made Up Song-chords-D.pdf',
      'Made Up Song\nKey - D | Tempo - 90\nCCLI Song # 1111111'
    ),
    chartPart('B', 'Another Song-chords-G.pdf', 'Another Song\nKey - G\nCCLI Song # 2222222'),
    '--B--',
    '',
  ].join('\r\n')

  const email = await readEmail(raw, readText)
  assert.deepEqual(email.from, { name: 'Jenny Nelson', email: 'jen@example.com' })
  assert.equal(email.subject, 'Fwd: Sunday 18th October')
  assert.equal(email.date, 'Tue, 13 Oct 2026 10:51:59 +0100', 'the header as written')
  assert.deepEqual(
    email.charts.map(c => [c.title, c.key, c.ccli]),
    [
      ['Made Up Song', 'D', '1111111'],
      ['Another Song', 'G', '2222222'],
    ]
  )

  const setlist = importFromEmail(email)
  assert.equal(setlist.leader.email, 'one@example.com')
  assert.equal(setlist.date, '2026-10-18')
  assert.deepEqual(
    setlist.songs.map(s => [s.title, s.ccli]),
    [
      ['Made Up Song', '1111111'],
      ['Another Song', '2222222'],
    ]
  )
})

test('a message forwarded as an attachment is read as the message that was forwarded', async () => {
  const inner = [
    'From: Leader One <one@example.com>',
    'Subject: Sunday 25th October',
    'Date: Fri, 16 Oct 2026 18:11:00 +0100',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="I"',
    '',
    '--I',
    'Content-Type: text/plain',
    '',
    '1. Made Up Song in D',
    chartPart('I', 'Made Up Song-chords-D.pdf', 'Made Up Song\nKey - D\nCCLI Song # 1111111'),
    '--I--',
  ].join('\r\n')
  const raw = [
    headers(['Content-Type: multipart/mixed; boundary="O"']),
    '',
    '--O',
    'Content-Type: text/plain',
    '',
    'See attached',
    '--O',
    'Content-Type: message/rfc822',
    'Content-Disposition: attachment; filename="Sunday.eml"',
    '',
    inner,
    '--O--',
    '',
  ].join('\r\n')

  const setlist = importFromEmail(await readEmail(raw, readText))
  assert.equal(setlist.leader.email, 'one@example.com')
  assert.equal(setlist.name, 'Sunday 25th October')
  assert.equal(setlist.date, '2026-10-25')
  assert.deepEqual(
    setlist.songs.map(s => s.ccli),
    ['1111111']
  )
})

test('an email with only an HTML body is read as text', async () => {
  const raw = [
    headers(['Content-Type: text/html; charset=utf-8']),
    '',
    '<html><style>p{}</style><body><p>Hi&nbsp;all</p>1. Made Up Song in D<br>2. Other &amp; Song in G</body></html>',
  ].join('\r\n')
  const email = await readEmail(raw)
  assert.match(email.body, /1\. Made Up Song in D\n2\. Other & Song in G/)
  assert.equal(textOfHtml('<p>a</p><p>b</p>'), 'a\nb')
})

test('a PDF with no file name is a chart called chart.pdf', async () => {
  const raw = [
    headers(['Content-Type: multipart/mixed; boundary="B"']),
    '',
    '--B',
    'Content-Type: text/plain',
    '',
    '1. Made Up Song in D',
    '--B',
    'Content-Type: application/pdf',
    'Content-Transfer-Encoding: base64',
    '',
    base64('Made Up Song\nKey - D\nCCLI Song # 1111111'),
    '--B--',
  ].join('\r\n')

  const email = await readEmail(raw, readText)
  assert.equal(email.charts.length, 1)
  assert.equal(email.charts[0].filename, 'chart.pdf')
  assert.equal(email.charts[0].ccli, '1111111')
})
