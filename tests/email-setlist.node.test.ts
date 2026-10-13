/**
 * Reading a forwarded email as a setlist (src/js/email-setlist.ts). The emails here are made up,
 * in the shapes real ones come in: the songs are invented, as charts are copyrighted and must
 * not be committed. (A real email can be tried in tests/fixtures/private/, which is ignored.)
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type ChartInfo,
  chartFilenameParts,
  cleanSubject,
  findDate,
  findDateWithWrongNumber,
  importFromEmail,
  innermostForward,
  nearestSunday,
  normaliseKey,
  parseChartText,
  parsePerson,
  parseSongList,
  sentDay,
} from '../src/js/email-setlist.ts'

const chart = (title: string, key: string, ccli: string | null): ChartInfo => ({
  filename: `${title}-chords-${key}.pdf`,
  title,
  key,
  tempo: null,
  time: null,
  ccli,
})

const day = (text: string) => sentDay(text)

test('a person is read from a header, and is lower case', () => {
  assert.deepEqual(parsePerson('Jenny Nelson <Jen.N@Example.com>'), {
    name: 'Jenny Nelson',
    email: 'jen.n@example.com',
  })
  assert.deepEqual(parsePerson('"Nelson, Jenny" <jen@example.com>'), {
    name: 'Nelson, Jenny',
    email: 'jen@example.com',
  })
  assert.deepEqual(parsePerson('<jen@example.com>'), { name: 'jen', email: 'jen@example.com' })
  assert.deepEqual(parsePerson('jen@example.com'), { name: 'jen', email: 'jen@example.com' })
})

test('subjects lose their Fwd: and Re: prefixes', () => {
  assert.equal(cleanSubject('Fwd: Fwd: Sunday 18th October'), 'Sunday 18th October')
  assert.equal(cleanSubject('RE: Fw:  Sunday'), 'Sunday')
})

test('keys are normalised', () => {
  assert.equal(normaliseKey('bb'), 'Bb')
  assert.equal(normaliseKey('F♯ minor'), 'F#m')
  assert.equal(normaliseKey('gm'), 'Gm')
  assert.equal(normaliseKey('E major'), 'E')
  assert.equal(normaliseKey('Hello'), null)
})

test('a chart filename gives a title and key', () => {
  assert.deepEqual(chartFilenameParts('Living Hope-chords-Bb.pdf'), {
    title: 'Living Hope',
    key: 'Bb',
    order: null,
  })
  assert.deepEqual(chartFilenameParts('Worthy Is The Lamb-chords-A (1).pdf'), {
    title: 'Worthy Is The Lamb',
    key: 'A',
    order: null,
  })
  assert.deepEqual(chartFilenameParts('My Own Song.pdf'), {
    title: 'My Own Song',
    key: null,
    order: null,
  })
})

test('numbered filenames give the order, and the number is not in the title', () => {
  assert.deepEqual(chartFilenameParts('3. Made Up Song-chords-E.pdf'), {
    title: 'Made Up Song',
    key: 'E',
    order: 3,
  })
  assert.equal(chartFilenameParts('4. Song (Other Name) 2.pdf').title, 'Song (Other Name)')
  assert.equal(chartFilenameParts('Psalm 23.pdf').title, 'Psalm 23', 'a number in a title stays')
  assert.equal(chartFilenameParts('10,000 Reasons.pdf').title, '10,000 Reasons')
  const result = importFromEmail({
    subject: 'Sunday',
    from: jenny,
    date: 'Mon, 19 Oct 2026',
    body: 'Charts are numbered.',
    charts: [
      { ...chart('B Song', 'D', null), filename: '2. B Song.pdf' },
      { ...chart('A Song', 'G', null), filename: '1. A Song.pdf' },
    ],
  })
  assert.deepEqual(
    result.songs.map(s => s.title),
    ['A Song', 'B Song']
  )
  assert.equal(result.orderFromList, true)
})

test('a SongSelect PDF gives title, key, tempo, time and CCLI number', () => {
  const text = [
    'Made Up Song',
    'A Writer | Another Writer',
    'Key - Bb | Tempo - 72 | Time - 6/8',
    '',
    'VERSE 1',
    'Bb        F',
    'Words go here',
    '',
    'CCLI Song # 1234567',
  ].join('\n')
  assert.deepEqual(parseChartText(text, 'Made Up Song-chords-Bb.pdf'), {
    filename: 'Made Up Song-chords-Bb.pdf',
    title: 'Made Up Song',
    key: 'Bb',
    tempo: 72,
    time: '6/8',
    ccli: '1234567',
  })
})

test("a chart with no header or CCLI number (another app's) falls back to its filename", () => {
  const info = parseChartText('Verse\nSome words\n', 'Some Song-chords-Gm.pdf')
  assert.equal(info.key, 'Gm')
  assert.equal(info.ccli, null)
  assert.equal(info.tempo, null)
})

test('a browser print header is not the title', () => {
  const info = parseChartText(
    '5/11/26, 3:45 PM  Made Up Lyrics by Someone\nMade Up\nVerse',
    'x.pdf'
  )
  assert.equal(info.title, 'Made Up')
})

test('the numbered list gives titles, other titles and keys', () => {
  const list = parseSongList(
    [
      'Hi all',
      '1. First Song in Bb',
      '2) Second Song (Alt Title) in F#m',
      '3. Third Song - G',
      '4. Fourth Song (E)',
      '5. Fifth Song',
      'Thanks',
    ].join('\n')
  )
  assert.deepEqual(
    list.map(s => [s.title, s.alternates, s.key]),
    [
      ['First Song', [], 'Bb'],
      ['Second Song', ['Alt Title'], 'F#m'],
      ['Third Song', [], 'G'],
      ['Fourth Song', [], 'E'],
      ['Fifth Song', [], null],
    ]
  )
})

test('a forward is found in Gmail, Apple Mail and Outlook styles; the innermost wins', () => {
  const gmail = [
    'Look at this',
    '',
    '---------- Forwarded message ---------',
    'From: Jenny Nelson <jen@example.com>',
    'Date: Fri, 9 Oct 2026, 18:11',
    'Subject: Sunday 18th October',
    'To: <a@example.com>, Someone Else <b@example.com>, Pippa',
    'Lloyd <c@example.com>',
    '',
    'The message',
  ].join('\n')
  const found = innermostForward(gmail)
  assert.equal(found?.from, 'Jenny Nelson <jen@example.com>')
  assert.equal(found?.date, 'Fri, 9 Oct 2026, 18:11')
  assert.equal(found?.subject, 'Sunday 18th October')
  assert.equal(found?.text.trim(), 'The message')
  assert.ok(!found?.text.includes('example.com'), 'the recipients are not in the text kept')

  const outlook = [
    'FYI',
    '________________________________',
    'From: Jenny Nelson <jen@example.com>',
    'Sent: 09 October 2026 18:11',
    'To: Someone <a@example.com>',
    'Subject: Sunday',
    '',
    'The message',
  ].join('\n')
  assert.equal(innermostForward(outlook)?.date, '09 October 2026 18:11')

  const nested = `Fwd of a fwd\n\n${[
    'From: Simon <me@example.com>',
    'Date: Tue, 13 Oct 2026',
    'Subject: Fwd: Sunday',
    '',
  ].join('\n')}\n${gmail}`
  assert.equal(innermostForward(nested)?.from, 'Jenny Nelson <jen@example.com>')

  assert.equal(innermostForward('Just a note.\nNo forward here.'), null)
})

test('dates: a weekday and ordinal, with the year from when the email was sent', () => {
  const sent = day('Fri, 9 Oct 2026, 18:11')
  assert.equal(findDate('Sunday 18th October', sent), '2026-10-18')
  assert.equal(findDate('Thanks for playing on Sunday 18th.', sent), '2026-10-18')
  assert.equal(findDate('18 Oct', sent), '2026-10-18')
  assert.equal(findDate('Sun 3rd Jan', sent), '2027-01-03')
  assert.equal(findDate('Sunday 19th October 2025', sent), '2025-10-19')
})

test('dates: nothing that is not a date, and not the practice', () => {
  const sent = day('Fri, 9 Oct 2026')
  assert.equal(findDate('6 songs, 7.45pm', sent), '')
  assert.equal(findDate('A Monday 12th October practice at 7.45', sent), '')
  assert.equal(
    findDate('Practice is on Monday 12th October\nService on Sunday 18th', sent),
    '2026-10-18'
  )
  assert.equal(findDate('Sunday 19th', sent), '', 'there is no Sunday 19th soon')
})

// ---- whole emails ----

const jenny = { name: 'Jenny Nelson', email: 'jen@example.com' }
const me = { name: 'Me', email: 'me@example.com' }

const body = (list: string[]) =>
  [
    '---------- Forwarded message ---------',
    'From: Jenny Nelson <jen@example.com>',
    'Date: Fri, 9 Oct 2026, 18:11',
    'Subject: Sunday 18th October',
    'To: <a@example.com>, Pippa',
    'Lloyd <b@example.com>',
    '',
    'Hi guys',
    '',
    'Practice is on Monday 12th October at 7.45pm',
    '',
    ...list,
  ].join('\n')

test('an email with a numbered list: its order and keys, the charts matched by title', () => {
  const charts = [
    chart('What A Friend', 'C', '1001'),
    chart('Worthy Is The Lamb', 'A', '1002'),
    chart('Living Hope', 'Bb', '1003'),
    chart('Extra Song', 'E', '1004'),
  ]
  const result = importFromEmail({
    subject: 'Fwd: Sunday 18th October',
    from: me,
    date: 'Tue, 13 Oct 2026 10:51:59 +0100',
    body: body([
      '1. Living hope in Bb',
      "2. What a Friend I've found in C",
      '3. Thank you for the Cross (Worthy is the Lamb) in G',
      '4. Not Attached in D',
    ]),
    charts,
  })
  assert.equal(result.name, 'Sunday 18th October')
  assert.equal(result.date, '2026-10-18')
  assert.deepEqual(result.leader, jenny)
  assert.deepEqual(
    result.songs.map(s => [s.title, s.key, s.ccli, s.chartFilename]),
    [
      ['Living Hope', 'Bb', '1003', 'Living Hope-chords-Bb.pdf'],
      ['What A Friend', 'C', '1001', 'What A Friend-chords-C.pdf'],
      ['Worthy Is The Lamb', 'G', '1002', 'Worthy Is The Lamb-chords-A.pdf'],
      ['Not Attached', 'D', null, null],
    ],
    'the list decides the order and the key; a song with no chart is kept'
  )
  assert.deepEqual(
    result.unlisted.map(s => s.title),
    ['Extra Song']
  )
  assert.equal(result.songs[2].listed, 'Thank you for the Cross (Worthy is the Lamb)')
})

test('one chart is not given to two songs, and a short title is not found inside a long one', () => {
  const result = importFromEmail({
    subject: 'Sunday',
    from: me,
    date: 'Tue, 13 Oct 2026',
    body: body(['1. Holy in A', '2. Holy Spirit in E']),
    charts: [chart('Holy Spirit', 'E', '2001')],
  })
  assert.deepEqual(
    result.songs.map(s => [s.title, s.chartFilename]),
    [
      ['Holy', null],
      ['Holy Spirit', 'Holy Spirit-chords-E.pdf'],
    ]
  )
})

test('an email with no list: the attachments in order, and the sender as the leader', () => {
  const result = importFromEmail({
    subject: 'Re: Songs for Sunday 25th',
    from: jenny,
    date: 'Tue, 13 Oct 2026',
    body: 'Here are the songs.',
    charts: [chart('B Song', 'D', null), chart('A Song', 'G', '3001')],
  })
  assert.deepEqual(result.leader, jenny)
  assert.equal(result.name, 'Songs for Sunday 25th')
  assert.equal(result.date, '2026-10-25')
  assert.deepEqual(
    result.songs.map(s => s.title),
    ['B Song', 'A Song']
  )
  assert.deepEqual(result.unlisted, [])
})

test('an email with nothing readable still gives a setlist to correct', () => {
  const result = importFromEmail({
    subject: '',
    from: me,
    date: 'not a date',
    body: '',
    charts: [],
  })
  assert.equal(result.date, '')
  assert.deepEqual(result.leader, me)
  assert.deepEqual(result.songs, [])
})

// ---- emails from OnSong, and awkward ones ----

test("a bulleted list as OnSong writes it: authors, key, tempo, time, and the sender's notes", () => {
  const list = parseSongList(
    [
      'Songs attached.',
      '• First Song by A Writer and Another in D at 118 BPM in 4/4',
      '• Second Song (Other Name) by Someone in Em https://youtu.be/abc?x=1 Start quietly. Build up',
      '• Third Song by Someone in G (Try the new',
      'intro here https://example.com/watch?v=1)',
      '• Fourth Song by Someone | Else in F#m in 6/8',
      '',
      'Sent from my iPad',
    ].join('\n')
  )
  assert.deepEqual(
    list.map(s => [s.title, s.author, s.key, s.tempo, s.time, s.notes]),
    [
      ['First Song', 'A Writer and Another', 'D', 118, '4/4', ''],
      ['Second Song', 'Someone', 'Em', null, null, 'Start quietly. Build up'],
      ['Third Song', 'Someone', 'G', null, null, 'Try the new intro here'],
      ['Fourth Song', 'Someone | Else', 'F#m', null, '6/8', ''],
    ]
  )
  assert.deepEqual(list[1].alternates, ['Other Name'])
  assert.ok(list.every(s => !s.numbered))
})

test('a key is only taken from outside brackets, and "in" inside a title is not one', () => {
  const [song] = parseSongList('1. Hope in Christ (Live in A Storm) in E (see the video in D)')
  assert.equal(song.key, 'E')
  assert.equal(song.title, 'Hope in Christ')
})

test('charts from OnSong: "Key of", a wrapped title, the church licence is not a song number', () => {
  const info = parseChartText(
    [
      'A Long Song Title (With Its Other',
      'Name)                 Key of F#m',
      'Some Writer',
      'CCLI 6143839',
      'CCLI® License #471102',
    ].join('\n'),
    'A Long Song Title (With Its Other Name).pdf'
  )
  assert.equal(info.title, 'A Long Song Title (With Its Other Name)', 'the filename is the title')
  assert.equal(info.key, 'F#m')
  assert.equal(info.ccli, '6143839')
  assert.equal(
    parseChartText('Song\nCCLI® License #471102\nCCLI Licence # 471102', 's.pdf').ccli,
    null
  )
  assert.equal(parseChartText('Key of E\nWords here', 'Plain Song.pdf').key, 'E')
})

test('a filename that says nothing does not name the song', () => {
  assert.equal(parseChartText('Real Title\nKey - G', 'scan 0012.pdf').title, 'Real Title')
  assert.equal(parseChartText('Real Title\nKey - G', 'x.pdf').title, 'Real Title')
})

test('the same chart attached twice is one song; another key of it is a note, not a song', () => {
  const result = importFromEmail({
    subject: 'Here’s your set: Sunday 25th October',
    from: jenny,
    date: 'Mon, 19 Oct 2026',
    body: 'No list here.',
    charts: [
      chart('Some Song', 'D', '7001'),
      { ...chart('Some Song', 'D', '7001'), filename: 'Some Song-chords-D (1).pdf' },
      chart('Some Song', 'E', '7001'),
      chart('Some Song', 'F', '7001'),
      chart('Other Song', 'G', '7002'),
    ],
  })
  assert.equal(result.name, 'Sunday 25th October', 'the app’s subject wording is taken off')
  assert.deepEqual(
    result.songs.map(s => [s.title, s.key, s.notes]),
    [
      ['Some Song', 'D', 'May also be in E or F'],
      ['Other Song', 'G', ''],
    ],
    'the first key is offered'
  )
  assert.equal(result.orderFromList, false)
})

test('a listed key settles it: no note about the chart’s other keys', () => {
  const result = importFromEmail({
    subject: 'Sunday',
    from: jenny,
    date: 'Mon, 19 Oct 2026',
    body: '1. Some Song in E\n2. Other Song',
    charts: [
      chart('Some Song', 'D', '7001'),
      chart('Some Song', 'E', '7001'),
      chart('Other Song', 'A', '7002'),
      chart('Other Song', 'B', '7002'),
    ],
  })
  assert.deepEqual(
    result.songs.map(s => [s.key, s.notes]),
    [
      ['E', ''],
      ['A', 'May also be in B'],
    ]
  )
})

test('bullets that are not songs are not made into songs', () => {
  const result = importFromEmail({
    subject: 'Sunday',
    from: jenny,
    date: 'Mon, 19 Oct 2026',
    body: '- bring a capo\n- be there for 9\n• Real Song by Someone in D',
    charts: [],
  })
  assert.deepEqual(
    result.songs.map(s => s.title),
    ['Real Song']
  )
})

test('a song in the list with no chart keeps every title it goes by, to search a library', () => {
  const result = importFromEmail({
    subject: 'Sunday',
    from: jenny,
    date: 'Mon, 19 Oct 2026',
    body: '1. Your Grace Is Enough (This Is Our God) in E at 70 BPM',
    charts: [],
  })
  const [song] = result.songs
  assert.equal(song.title, 'Your Grace Is Enough (This Is Our God)')
  assert.deepEqual(song.titles, [
    'Your Grace Is Enough (This Is Our God)',
    'Your Grace Is Enough',
    'This Is Our God',
  ])
  assert.equal(song.ccli, null)
  assert.equal(song.tempo, 70)
})

test('a note on a listed song is kept with the song', () => {
  const result = importFromEmail({
    subject: 'Sunday',
    from: jenny,
    date: 'Mon, 19 Oct 2026',
    body: '• Some Song by A Writer in D https://youtu.be/x ideally less 80s!',
    charts: [chart('Some Song', 'E', '7001')],
  })
  assert.equal(result.songs[0].notes, 'ideally less 80s!')
  assert.equal(result.songs[0].key, 'D', 'the leader’s key, not the chart’s')
})

test('a date whose weekday is wrong: the number is assumed wrong, and the sender is asked', () => {
  const result = importFromEmail({
    subject: 'Sunday 8th Nov',
    from: jenny,
    date: 'Fri, 31 Oct 2025 16:19:34 +0000',
    body: 'Hi',
    charts: [],
  })
  assert.equal(result.date, '2025-11-09', 'the Sunday next to the 8th')
  assert.match(result.dateWarning ?? '', /Saturday.*Sunday 9 Nov 2025/)
  assert.equal(result.sentDate, '2025-10-31')
})

test('the nearest day with the weekday is taken, back or forward', () => {
  const sent = day('Mon, 6 Jul 2026')
  // 10 July 2026 is a Friday: the nearest Sunday is the 12th; 14 July is a Tuesday: the 12th
  assert.equal(findDateWithWrongNumber('Sunday 10th July', sent)?.date, '2026-07-12')
  assert.equal(findDateWithWrongNumber('Sunday 14 July', sent)?.date, '2026-07-12')
  assert.equal(findDateWithWrongNumber('Sunday 12th July', sent)?.date, '2026-07-12')
  assert.equal(
    findDateWithWrongNumber('Sunday 12th', sent),
    null,
    'without a month it is not tried'
  )
  assert.equal(findDateWithWrongNumber('No dates here', sent), null)
})

test('the nearest Sunday is today if it is one', () => {
  assert.equal(nearestSunday(new Date(2026, 9, 18)), '2026-10-18')
  assert.equal(nearestSunday(new Date(2026, 9, 13)), '2026-10-18')
  assert.equal(nearestSunday(new Date(2026, 9, 19)), '2026-10-25')
  assert.equal(nearestSunday(new Date(2026, 11, 30)), '2027-01-03')
})

test('no date: a weekday alone is not guessed at, and the day it was sent is given', () => {
  const result = importFromEmail({
    subject: 'Prayer day',
    from: jenny,
    date: 'Sat, 03 Oct 2026 09:42:42 +0100',
    body: 'Here’s the set list for Wednesday. Thanks for playing on Sunday.',
    charts: [],
  })
  assert.equal(result.date, '')
  assert.equal(result.dateWarning, null)
  assert.equal(result.sentDate, '2026-10-03')
})

// ---- a listed song and a chart left over ----

const leftoverEmail = (list: string, charts: ChartInfo[]) =>
  importFromEmail({
    subject: 'Sunday',
    from: jenny,
    date: 'Mon, 19 Oct 2026',
    body: list,
    charts,
  })

test('a listed song with no chart and a chart no song has, in the same key, are one song', () => {
  const result = leftoverEmail('1. Your Grace Is Enough in E\n2. Other Song in G', [
    chart('Other Song', 'G', '7001'),
    chart('This Is Our God', 'E', '5060834'),
  ])
  assert.deepEqual(
    result.songs.map(s => [s.title, s.ccli, s.key, s.pairedBy, s.listed]),
    [
      ['This Is Our God', '5060834', 'E', 'elimination', 'Your Grace Is Enough'],
      ['Other Song', '7001', 'G', undefined, 'Other Song'],
    ]
  )
  assert.deepEqual(result.unlisted, [])
})

test('the key picks the right chart of several left over, if it is the only one with that key', () => {
  const result = leftoverEmail("1. Grace you've shown me grace G", [
    chart('Who You Say I Am', 'Ab', '7102401'),
    chart('You Have Won Me', 'G', '6143839'),
  ])
  assert.deepEqual(
    result.songs.map(s => [s.title, s.pairedBy]),
    [['You Have Won Me', 'elimination']]
  )
  assert.deepEqual(
    result.unlisted.map(s => s.title),
    ['Who You Say I Am']
  )
})

test('no pairing when the keys differ, or more than one has the key', () => {
  const differ = leftoverEmail('1. Unknown Song in E', [chart('Some Chart', 'G', null)])
  assert.equal(differ.songs[0].chartFilename, null)
  assert.equal(differ.unlisted.length, 1)

  const twoSongs = leftoverEmail('1. First Unknown in E\n2. Second Unknown in E', [
    chart('Chart One', 'E', null),
  ])
  assert.deepEqual(
    twoSongs.songs.map(s => s.chartFilename),
    [null, null],
    'which of the two it is cannot be told'
  )
  const twoCharts = leftoverEmail('1. First Unknown in E', [
    chart('Chart One', 'E', null),
    chart('Chart Two', 'E', null),
  ])
  assert.equal(twoCharts.songs[0].chartFilename, null)
})

test('one song and one chart left over, with no key to disagree, are paired', () => {
  const result = leftoverEmail('1. Mystery Song', [
    { ...chart('Real Title', 'D', '8001'), key: null },
  ])
  assert.deepEqual(
    result.songs.map(s => [s.title, s.pairedBy]),
    [['Real Title', 'elimination']]
  )
})

test('a song matched by title is not a guess', () => {
  const result = leftoverEmail('1. Living Hope in Bb', [chart('Living Hope', 'Bb', '7106807')])
  assert.equal(result.songs[0].pairedBy, undefined)
})
