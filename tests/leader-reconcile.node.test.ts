/**
 * Matching setlists to the emails that say who led them (src/js/leader-reconcile.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ImportedSetlist, ImportedSong } from '../src/js/email-setlist.ts'
import {
  type EmailSource,
  explainUnmatched,
  isLedBy,
  parseNameRules,
  proposeLeaders,
  resolveNameRules,
  type SetlistToCheck,
  withProposedLeader,
} from '../src/js/leader-reconcile.ts'

const me = { id: 'me@example.com', name: 'Me Myself' }

const song = (title: string, ccli: string | null = null): ImportedSong => ({
  title,
  titles: [title],
  author: null,
  key: null,
  tempo: null,
  time: null,
  ccli,
  chartFilename: null,
  listed: null,
  notes: '',
})

const email = (
  file: string,
  date: string,
  leader: string,
  titles: string[],
  sentDate = '2026-10-01'
): EmailSource => ({
  file,
  setlist: {
    name: 'Sunday',
    date,
    dateWarning: null,
    sentDate,
    orderFromList: true,
    leader: { name: leader, email: `${leader.toLowerCase().replace(/ /g, '.')}@example.com` },
    songs: titles.map(t => song(t)),
    unlisted: [],
  } satisfies ImportedSetlist,
})

const setlist = (
  id: string,
  date: string,
  titles: string[],
  owner = me.name,
  ownerId = me.id
): SetlistToCheck => ({
  id,
  date,
  name: 'Sunday',
  owner,
  ownerId,
  songs: titles.map(title => ({ title, ccli: null })),
})

test('a setlist of mine gets the leader of the email for its date and songs', () => {
  const proposals = proposeLeaders(
    [setlist('s1', '2026-10-18', ['Living Hope', 'Behold Him', 'Worthy Is The Lamb'])],
    [
      email('a.eml', '2026-10-18', 'Jenny Nelson', ['Living Hope', 'Behold Him', 'Something Else']),
      email('b.eml', '2026-10-25', 'Pippa Lloyd', ['Living Hope']),
    ],
    { me }
  )
  assert.equal(proposals.length, 1)
  assert.deepEqual(
    [
      proposals[0].setlistId,
      proposals[0].leader.name,
      proposals[0].status,
      proposals[0].matched,
      proposals[0].of,
    ],
    ['s1', 'Jenny Nelson', 'change', 2, 3]
  )
})

test('songs are matched by CCLI number as well as by title', () => {
  const from = email('a.eml', '2026-10-18', 'Jenny Nelson', ['Totally Different Name'])
  from.setlist.songs[0].ccli = '7106807'
  const mine = setlist('s1', '2026-10-18', [])
  mine.songs = [{ title: 'Living Hope', ccli: '7106807' }]
  assert.equal(proposeLeaders([mine], [from], { me })[0].matched, 1)
})

test('the same date is enough: the songs may have changed since', () => {
  const [proposal] = proposeLeaders(
    [setlist('s1', '2026-10-18', ['Living Hope'])],
    [email('a.eml', '2026-10-18', 'Jenny Nelson', ['Other One', 'Other Two'])],
    { me }
  )
  assert.equal(proposal.status, 'change')
  assert.equal(proposal.leader.name, 'Jenny Nelson')
  assert.equal(proposal.matched, 0)
})

test('emails for one date with different leaders and no song in common are weak', () => {
  const emails = [
    email('a.eml', '2026-10-18', 'Jenny Nelson', ['Other One']),
    email('b.eml', '2026-10-18', 'Pippa Lloyd', ['Other Two']),
  ]
  const [none] = proposeLeaders([setlist('s1', '2026-10-18', ['Living Hope'])], emails, { me })
  assert.equal(none.status, 'weak')
  const [some] = proposeLeaders([setlist('s1', '2026-10-18', ['Other Two'])], emails, { me })
  assert.deepEqual(
    [some.status, some.leader.name],
    ['change', 'Pippa Lloyd'],
    'a shared song decides'
  )
})

test('setlists led by someone else, and with no email for their date, are left alone', () => {
  const proposals = proposeLeaders(
    [
      setlist('s1', '2026-10-18', ['Living Hope'], 'Pippa Lloyd', 'pippa@example.com'),
      setlist('s2', '2026-11-01', ['Living Hope']),
    ],
    [email('a.eml', '2026-10-18', 'Jenny Nelson', ['Living Hope'])],
    { me }
  )
  assert.deepEqual(proposals, [])
  const all = proposeLeaders(
    [setlist('s1', '2026-10-18', ['Living Hope'], 'Pippa Lloyd', 'pippa@example.com')],
    [email('a.eml', '2026-10-18', 'Jenny Nelson', ['Living Hope'])],
    { me, includeAll: true }
  )
  assert.equal(all.length, 1)
})

test('when the email’s leader already leads it, there is nothing to change', () => {
  const [proposal] = proposeLeaders(
    [setlist('s1', '2026-10-18', ['Living Hope'], 'Jenny Nelson', 'jenny.nelson@example.com')],
    [email('a.eml', '2026-10-18', 'Jenny Nelson', ['Living Hope'])],
    { me, includeAll: true }
  )
  assert.equal(proposal.status, 'same')
})

test('a set sent twice: the email with more of the songs, then the later one', () => {
  const mine = setlist('s1', '2026-09-20', ['A Song', 'B Song', 'C Song'])
  const first = email('first.eml', '2026-09-20', 'Pippa Lloyd', ['A Song', 'B Song'], '2026-09-11')
  const second = email(
    'second.eml',
    '2026-09-20',
    'Pippa Lloyd',
    ['A Song', 'B Song', 'C Song'],
    '2026-09-13'
  )
  assert.equal(proposeLeaders([mine], [first, second], { me })[0].file, 'second.eml')
  const equal = email('equal.eml', '2026-09-20', 'Pippa Lloyd', ['A Song', 'B Song'], '2026-09-15')
  assert.equal(
    proposeLeaders([mine], [first, equal], { me })[0].file,
    'equal.eml',
    'the later of equals'
  )
})

test('a setlist with no leader id is mine if its leader’s name is mine', () => {
  assert.equal(isLedBy({ owner: 'me myself' }, me), true)
  assert.equal(isLedBy({ owner: 'Someone' }, me), false)
  assert.equal(isLedBy({ owner: '' }, me), false)
  assert.equal(isLedBy({ owner: 'Me Myself', ownerId: 'other@example.com' }, me), false)
  assert.equal(isLedBy({ owner: 'x', ownerId: 'ME@example.com' }, me), true)
})

test('the new leader is the email’s name and address', () => {
  const [proposal] = proposeLeaders(
    [setlist('s1', '2026-10-18', ['Living Hope'])],
    [email('a.eml', '2026-10-18', 'Jenny Nelson', ['Living Hope'])],
    { me }
  )
  assert.deepEqual(withProposedLeader(setlist('s1', '2026-10-18', []), proposal), {
    ...setlist('s1', '2026-10-18', []),
    owner: 'Jenny Nelson',
    ownerId: 'jenny.nelson@example.com',
  })
})

test('emails with no proposal say why', () => {
  const setlists = [
    setlist('mine', '2026-10-18', ['A']),
    setlist('theirs', '2026-10-25', ['A'], 'Pippa Lloyd', 'pippa@example.com'),
    setlist('later', '2026-11-20', ['A']),
  ]
  const emails = [
    email('matched.eml', '2026-10-18', 'Jenny Nelson', ['A']),
    email('notmine.eml', '2026-10-25', 'Jenny Nelson', ['A']),
    // sent in October, for a date a month on with no setlist: the setlist 20 Nov is out of reach
    email('far.eml', '2026-12-25', 'Jenny Nelson', ['A'], '2026-10-01'),
    // sent 8 Nov: 20 Nov is in reach, but it has one song of the email's two
    email('few.eml', '', 'Jenny Nelson', ['A', 'B'], '2026-11-08'),
    // sent in December: nothing after it
    email('late.eml', '', 'Jenny Nelson', ['A', 'B'], '2026-12-30'),
  ]
  const proposals = proposeLeaders(setlists, emails, { me })
  assert.deepEqual(
    explainUnmatched(setlists, emails, proposals, { me }).map(u => [u.file, u.reason, u.other]),
    [
      ['notmine.eml', 'not-mine', 'Pippa Lloyd on 2026-10-25'],
      ['far.eml', 'few-songs', '2026-10-18, 1 in common'],
      ['few.eml', 'few-songs', '2026-11-20, 1 in common'],
      ['late.eml', 'no-setlist', ''],
    ]
  )
})

// ---- no email for the setlist's date: by songs, near it ----

const A = ['Alpha Song', 'Bravo Song', 'Charlie Song', 'Delta Song']

test('with no email for its date, an email sent shortly before it with two or more songs is likely', () => {
  const mine = setlist('s1', '2026-10-18', A)
  const near = email('near.eml', '2026-10-21', 'Jenny Nelson', [
    'Alpha Song',
    'Bravo Song',
    'Other',
  ])
  const [found] = proposeLeaders([mine], [near], { me })
  assert.deepEqual([found.status, found.leader.name, found.matched], ['likely', 'Jenny Nelson', 2])

  const one = email('one.eml', '2026-10-21', 'Jenny Nelson', ['Alpha Song', 'Other', 'Another'])
  assert.deepEqual(proposeLeaders([mine], [one], { me }), [], 'one song is not enough')
})

test('the setlist is from the day the email was sent to four weeks after, not before', () => {
  const songs = ['Alpha Song', 'Bravo Song']
  const sentOnTheFirst = () => email('a.eml', '', 'Jenny Nelson', songs, '2026-10-01')
  const on = (date: string) => proposeLeaders([setlist('s1', date, A)], [sentOnTheFirst()], { me })
  assert.equal(on('2026-10-01').length, 1, 'the day it was sent')
  assert.equal(on('2026-10-29').length, 1, 'four weeks later')
  assert.equal(on('2026-10-30').length, 0, 'a day too late')
  assert.equal(on('2026-09-30').length, 0, 'the day before it was sent')
})

test('the day it was sent can come from the file’s name', () => {
  const noSent = email('2026-10-01-abc.eml', '', 'Jenny Nelson', ['Alpha Song', 'Bravo Song'], '')
  assert.equal(proposeLeaders([setlist('s1', '2026-10-08', A)], [noSent], { me }).length, 1)
  assert.equal(proposeLeaders([setlist('s1', '2026-09-20', A)], [noSent], { me }).length, 0)
  const nowhere = email('a.eml', '', 'Jenny Nelson', ['Alpha Song', 'Bravo Song'], '')
  assert.equal(proposeLeaders([setlist('s1', '2026-10-08', A)], [nowhere], { me }).length, 0)
})

test('an email for a date that has a setlist belongs to that one, not its neighbour', () => {
  const neighbour = setlist('next', '2026-10-25', A)
  const exact = setlist('exact', '2026-10-18', ['Unrelated'], 'Pippa Lloyd', 'pippa@example.com')
  const found = proposeLeaders(
    [neighbour, exact],
    [email('a.eml', '2026-10-18', 'Jenny Nelson', A)],
    {
      me,
    }
  )
  assert.deepEqual(found, [])
})

test('of several setlists near an email, the one with most songs, then the closest', () => {
  const sent = email('a.eml', '', 'Jenny Nelson', ['Alpha Song', 'Bravo Song'], '2026-10-18')
  const better = setlist('better', '2026-10-22', ['Alpha Song', 'Bravo Song'])
  const worse = setlist('worse', '2026-10-19', ['Alpha Song', 'Other'])
  assert.deepEqual(
    proposeLeaders([better, worse], [sent], { me }).map(p => p.setlistId),
    ['better']
  )
  const same2 = setlist('closer', '2026-10-19', ['Alpha Song', 'Bravo Song'])
  assert.deepEqual(
    proposeLeaders([better, same2], [sent], { me }).map(p => p.setlistId),
    ['better', 'closer'],
    'each setlist is looked at for itself'
  )
})

test('an exact-date match is not replaced by a song match', () => {
  const mine = setlist('s1', '2026-10-18', ['Unrelated'])
  const found = proposeLeaders(
    [mine],
    [
      email('exact.eml', '2026-10-18', 'Jenny Nelson', ['Other']),
      email('songs.eml', '2026-10-20', 'Pippa Lloyd', ['Unrelated', 'Alpha']),
    ],
    { me }
  )
  assert.deepEqual(
    found.map(p => [p.status, p.leader.name]),
    [['change', 'Jenny Nelson']]
  )
})

// ---- rules by name ----

test('name rules are read from lines, and others are ignored', () => {
  assert.deepEqual(
    parseNameRules('Devoted Leaders, Jubilee Plus => Pippa\nnot a rule\n => nobody\n'),
    [{ patterns: ['devoted leaders', 'jubilee plus'], who: 'pippa' }]
  )
})

test('a rule’s person is the latest address among the emails’ leaders that fits', () => {
  const emails = [
    email('old.eml', '2019-01-01', 'Pippa Lloyd', ['A'], '2019-01-01'),
    email('new.eml', '2026-01-01', 'Pippa Lloyd', ['A'], '2026-01-01'),
    email('other.eml', '2026-01-01', 'Jenny Nelson', ['A'], '2026-02-01'),
  ]
  emails[0].setlist.leader.email = 'pippaskippa@hotmail.example'
  const rules = parseNameRules('x => pippa\ny => nobody')
  const { resolved, unresolved } = resolveNameRules(rules, emails)
  assert.equal(resolved[0].leader.email, 'pippa.lloyd@example.com', 'the newest address')
  assert.deepEqual(
    unresolved.map(r => r.who),
    ['nobody']
  )
})

test('a setlist whose name has a rule’s words is that leader’s, whoever leads it now', () => {
  const pippa = { name: 'Pippa Lloyd', email: 'pippa@example.com' }
  const nameRules = [{ patterns: ['devoted leaders', 'jubilee plus'], leader: pippa }]
  const named = (id: string, name: string, owner = me.name, ownerId = me.id) => ({
    ...setlist(id, '2026-10-18', ['A Song']),
    name,
    owner,
    ownerId,
  })
  const found = proposeLeaders(
    [
      named('a', 'Devoted Leaders night'),
      named('b', 'JUBILEE PLUS'),
      named('c', 'Sunday'),
      named('d', 'Jubilee Plus', 'Jenny Nelson', 'jenny@example.com'),
      named('e', 'Devoted Leaders', 'Pippa Lloyd', 'pippa@example.com'),
    ],
    [email('jenny.eml', '2026-10-18', 'Jenny Nelson', ['A Song'])],
    { me, nameRules }
  )
  assert.deepEqual(
    found.map(p => [p.setlistId, p.status, p.by, p.leader.name]),
    [
      ['a', 'change', 'name', 'Pippa Lloyd'],
      ['b', 'change', 'name', 'Pippa Lloyd'],
      ['d', 'change', 'name', 'Pippa Lloyd'],
      ['e', 'same', 'name', 'Pippa Lloyd'],
      ['c', 'change', undefined, 'Jenny Nelson'],
    ],
    'named setlists take the rule’s leader, not the email’s; others go by the emails'
  )
})

test('lists go out two weeks or more ahead: of equal fits, the nearest at least that far after', () => {
  const songs = ['Alpha Song', 'Bravo Song']
  const sent = email('a.eml', '', 'Jenny Nelson', songs, '2026-10-01')
  // 5 days after, 16 days after and 24 days after it was sent: the same songs in all three
  const soon = setlist('soon', '2026-10-06', songs)
  const usual = setlist('usual', '2026-10-17', songs)
  const late = setlist('late', '2026-10-25', songs)
  const [found] = proposeLeaders([soon, usual, late], [sent], { me }).filter(
    p => p.setlistId === 'usual'
  )
  assert.equal(found.leader.name, 'Jenny Nelson')

  // Two emails fit one setlist equally: the one sent about two weeks before it
  const early = email('early.eml', '', 'Pippa Lloyd', songs, '2026-09-20')
  const recent = email('recent.eml', '', 'Jenny Nelson', songs, '2026-10-12')
  const [one] = proposeLeaders([usual], [early, recent], { me })
  assert.equal(one.file, 'early.eml', '27 days ahead beats 5 days ahead')
  const [two] = proposeLeaders([usual], [email('x.eml', '', 'A B', songs, '2026-10-01'), recent], {
    me,
  })
  assert.equal(two.file, 'x.eml', '16 days ahead beats 5 days ahead')
})

test('a name rule does not depend on when an email was sent: events can be months ahead', () => {
  const pippa = { name: 'Pippa Lloyd', email: 'pippa@example.com' }
  const event = { ...setlist('event', '2027-03-14', ['Alpha Song']), name: 'Devoted Leaders' }
  const early = email('devoted.eml', '', 'Pippa Lloyd', ['Alpha Song', 'Bravo Song'], '2026-09-01')
  const without = proposeLeaders([event], [early], { me })
  assert.deepEqual(without, [], 'by the emails alone it is far outside the four weeks')
  const [found] = proposeLeaders([event], [], {
    me,
    nameRules: [{ patterns: ['devoted leaders'], leader: pippa }],
  })
  assert.deepEqual(
    [found.status, found.by, found.leader.email],
    ['change', 'name', 'pippa@example.com']
  )
})

test('an email whose setlist went with another email (a set sent again) says so', () => {
  const songs = ['Alpha Song', 'Bravo Song', 'Charlie Song']
  const mine = setlist('s1', '2026-10-20', songs)
  const first = email('first.eml', '', 'Pippa Lloyd', songs, '2026-10-01')
  const again = email('again.eml', '', 'Pippa Lloyd', ['Alpha Song', 'Bravo Song'], '2026-10-05')
  const emails = [first, again]
  const proposals = proposeLeaders([mine], emails, { me })
  assert.equal(proposals[0].file, 'first.eml')
  const [why] = explainUnmatched([mine], emails, proposals, { me })
  assert.deepEqual([why.file, why.reason], ['again.eml', 'taken'])
  assert.match(why.other, /2026-10-20 \(2 songs in common\) went with first\.eml/)
})
