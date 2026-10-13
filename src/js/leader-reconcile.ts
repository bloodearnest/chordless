/**
 * One-off: setlists that were really led by someone else, but say the user leads them (they were
 * made, or claimed, as the user's: see claimSetlistsWithoutOwnerId in people.ts). Their emails
 * say who led them: this matches each setlist to the email for the same date, and proposes
 * that email's leader. The date is what says it is the same service: the songs are not compared
 * for that, as a setlist may have changed since (they only choose between emails for one date).
 *
 * Pure: it is given the setlists (with their songs' titles) and the emails already read by
 * importFromEmail, and returns proposals. The dev page src/dev/reconcile-leaders.html reads the
 * emails, shows the proposals and saves the ones chosen.
 */
import type { Person } from './data-types.ts'
import { type EmailPerson, type ImportedSetlist, titleScore } from './email-setlist.ts'

/** A song of a setlist, as far as matching goes */
export interface SetlistSongRef {
  title: string
  ccli: string | null
}

export interface SetlistToCheck {
  id: string
  date: string
  name: string
  owner: string
  ownerId?: string
  songs: SetlistSongRef[]
}

/** An email, read: where it came from, and what importFromEmail made of it */
export interface EmailSource {
  file: string
  setlist: ImportedSetlist
}

export interface LeaderProposal {
  setlistId: string
  date: string
  name: string
  /** Who the setlist says leads it */
  current: { owner: string; ownerId: string }
  leader: EmailPerson
  /** The email it was matched with */
  file: string
  /** Songs of the email that the setlist has, of the email's */
  matched: number
  of: number
  /**
   * `change`: an email for the setlist's date names another leader; `same`: it names the leader
   * already there; `weak`: emails for that date name different leaders, and none has a song
   * the setlist has, so which one led it is a guess; `likely`: no email is for its date, but
   * one sent or dated near it has several of its songs
   */
  status: 'change' | 'likely' | 'weak' | 'same'
  /** `name`: set by a name rule (the setlist's name, not an email) */
  by?: 'name'
}

const lower = (text: string | undefined) => (text ?? '').trim().toLowerCase()

/** Does this person lead the setlist, going by its id or, without one, its name? */
export function isLedBy(
  setlist: { owner: string; ownerId?: string },
  person: EmailPerson | Person
): boolean {
  const id = lower('email' in person ? person.email : person.id)
  if (setlist.ownerId) return id !== '' && lower(setlist.ownerId) === id
  return lower(setlist.owner) !== '' && lower(setlist.owner) === lower(person.name)
}

/** Do the emails name more than one leader? */
function leadersDiffer(emails: EmailSource[]): boolean {
  return (
    new Set(emails.map(({ setlist }) => lower(setlist.leader.email) || lower(setlist.leader.name)))
      .size > 1
  )
}

/** How many of the email's songs a setlist has */
function songsInCommon(email: ImportedSetlist, setlist: SetlistToCheck): number {
  return email.songs.filter(song =>
    setlist.songs.some(
      have =>
        (song.ccli !== null && song.ccli === have.ccli) ||
        song.titles.some(title => titleScore(title, have.title) >= 0.5)
    )
  ).length
}

// ==================== Rules by name ====================

/** Setlists whose name has any of these (in any case) are led by this person */
export interface NameRule {
  patterns: string[]
  /** A name or address to look for among the leaders in the emails: "pippa" */
  who: string
}

export interface ResolvedNameRule {
  patterns: string[]
  leader: EmailPerson
}

/** Rules as typed, one to a line: "devoted leaders, jubilee plus => pippa". Other lines are ignored */
export function parseNameRules(text: string): NameRule[] {
  const rules: NameRule[] = []
  for (const line of text.split(/\r?\n/)) {
    const [names, who] = line.split('=>')
    const patterns = (names ?? '')
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(Boolean)
    if (who?.trim() && patterns.length) rules.push({ patterns, who: who.trim().toLowerCase() })
  }
  return rules
}

/**
 * Who each rule's `who` is: of the leaders in the emails whose name or address has it, the
 * address used in the latest email. A rule nobody in the emails fits is `unresolved`.
 */
export function resolveNameRules(
  rules: NameRule[],
  emails: EmailSource[]
): { resolved: ResolvedNameRule[]; unresolved: NameRule[] } {
  const resolved: ResolvedNameRule[] = []
  const unresolved: NameRule[] = []
  for (const rule of rules) {
    const latest = emails
      .filter(({ setlist }) =>
        `${setlist.leader.name} ${setlist.leader.email}`.toLowerCase().includes(rule.who)
      )
      .sort((a, b) => b.setlist.sentDate.localeCompare(a.setlist.sentDate))[0]
    if (latest) resolved.push({ patterns: rule.patterns, leader: latest.setlist.leader })
    else unresolved.push(rule)
  }
  return { resolved, unresolved }
}

/**
 * For each setlist (of `me`'s, unless `includeAll`), the leader its email names. A setlist with
 * no email for its date gets no proposal. Where several emails are for its date (a set sent again),
 * the one with most of the setlist's songs, then the latest sent.
 */
export function proposeLeaders(
  setlists: SetlistToCheck[],
  emails: EmailSource[],
  options: { me: Person | null; includeAll?: boolean; nameRules?: ResolvedNameRule[] }
): LeaderProposal[] {
  const proposals: LeaderProposal[] = []
  // Setlists named by a rule are that leader's, whoever the setlist says leads them now, and
  // whatever the emails say
  const named = new Set<string>()
  for (const setlist of setlists) {
    const rule = (options.nameRules ?? []).find(({ patterns }) =>
      patterns.some(pattern => setlist.name.toLowerCase().includes(pattern))
    )
    if (!rule) continue
    named.add(setlist.id)
    proposals.push({
      setlistId: setlist.id,
      date: setlist.date,
      name: setlist.name,
      current: { owner: setlist.owner, ownerId: setlist.ownerId ?? '' },
      leader: rule.leader,
      file: '',
      matched: 0,
      of: 0,
      status: isLedBy(setlist, rule.leader) ? 'same' : 'change',
      by: 'name',
    })
  }
  const mine = (setlist: SetlistToCheck) =>
    options.includeAll || Boolean(options.me && isLedBy(setlist, options.me))
  // Dates that have a setlist (anyone's): an email for one of them belongs to it, not to a
  // neighbour
  const setlistDates = new Set(setlists.map(setlist => setlist.date))

  for (const setlist of setlists.filter(mine).filter(have => !named.has(have.id))) {
    const sameDay = emails.filter(
      email => email.setlist.date && email.setlist.date === setlist.date
    )
    const best = sameDay
      .map(email => ({ email, common: songsInCommon(email.setlist, setlist) }))
      .sort(byBest)[0]
    if (!best) continue
    proposals.push(
      proposal(
        setlist,
        best,
        isLedBy(setlist, best.email.setlist.leader)
          ? 'same'
          : leadersDiffer(sameDay) && best.common === 0
            ? 'weak'
            : 'change'
      )
    )
  }

  // A setlist with no email for its date: one near it that has several of its songs
  const done = new Set(proposals.map(p => p.setlistId))
  for (const setlist of setlists.filter(mine)) {
    if (done.has(setlist.id)) continue
    const best = emails
      .filter(email => !email.setlist.date || !setlistDates.has(email.setlist.date))
      .filter(email => isNear(setlist.date, email))
      .map(email => ({ email, common: songsInCommon(email.setlist, setlist) }))
      .filter(({ common }) => common >= MIN_SONGS)
      .sort(
        (a, b) =>
          b.common - a.common ||
          leadRank(setlist.date, a.email) - leadRank(setlist.date, b.email) ||
          byBest(a, b)
      )[0]
    if (!best) continue
    proposals.push(
      proposal(setlist, best, isLedBy(setlist, best.email.setlist.leader) ? 'same' : 'likely')
    )
  }
  return proposals
}

/** Songs in common for an email with no email for the setlist's date to count as likely */
const MIN_SONGS = 2
/** A setlist can be this many days after the day the email was sent, and not before it */
const WINDOW_DAYS = 28

const DAY = 24 * 60 * 60 * 1000

/** The day an email was sent: its Date header's, or the date a downloaded file's name starts with */
function sentOn(email: EmailSource): string {
  return email.setlist.sentDate || /^\d{4}-\d\d-\d\d/.exec(email.file)?.[0] || ''
}

/** Days from when the email was sent to a date, or infinity if either is unknown */
function daysAfterSent(date: string, email: EmailSource): number {
  const sent = sentOn(email)
  if (!date || !sent) return Number.POSITIVE_INFINITY
  return (Date.parse(date) - Date.parse(sent)) / DAY
}

/**
 * Song lists go out two weeks or more ahead, so of the setlists or emails that fit equally, the
 * likely one is the nearest at least two weeks after the email was sent; then the ones nearer
 * to it, closest to the two weeks first. Smaller is likelier.
 */
const USUAL_LEAD_DAYS = 14

function leadRank(date: string, email: EmailSource): number {
  const days = daysAfterSent(date, email)
  return days >= USUAL_LEAD_DAYS ? days - USUAL_LEAD_DAYS : 1000 + (USUAL_LEAD_DAYS - days)
}

/** Is the setlist's date from the day the email was sent up to four weeks after? */
function isNear(date: string, email: EmailSource): boolean {
  const days = daysAfterSent(date, email)
  return days >= 0 && days <= WINDOW_DAYS
}

interface Candidate {
  email: EmailSource
  common: number
}

/** The email with most songs in common, then the latest sent, then by name */
function byBest(a: Candidate, b: Candidate): number {
  return (
    b.common - a.common ||
    b.email.setlist.sentDate.localeCompare(a.email.setlist.sentDate) ||
    a.email.file.localeCompare(b.email.file)
  )
}

function proposal(
  setlist: SetlistToCheck,
  { email, common }: Candidate,
  status: LeaderProposal['status']
): LeaderProposal {
  return {
    setlistId: setlist.id,
    date: setlist.date,
    name: setlist.name,
    current: { owner: setlist.owner, ownerId: setlist.ownerId ?? '' },
    leader: email.setlist.leader,
    file: email.file,
    matched: common,
    of: email.setlist.songs.length,
    status,
  }
}

/** The setlist's leader, changed to the proposal's. The name is the email's, or its address if it had none */
export function withProposedLeader<T extends { owner: string; ownerId?: string }>(
  setlist: T,
  proposal: LeaderProposal
): T {
  return {
    ...setlist,
    owner: proposal.leader.name || proposal.leader.email,
    ownerId: proposal.leader.email,
  }
}

/** Why an email has no proposal */
export interface UnmatchedEmail {
  file: string
  /** The email's date: '' if it gave none */
  date: string
  name: string
  leader: EmailPerson
  /**
   * `no-setlist`: no setlist on its date, or in the four weeks from when it was sent;
   * `few-songs`: setlists in those four weeks, but the closest has fewer songs in common than
   * it takes; `not-mine`: the setlist it fits is led by someone else, so it was skipped;
   * `taken`: it fits a setlist, but another email was matched to that one (a set sent again)
   * (`other` says which setlist, and what came of it)
   */
  reason: 'no-setlist' | 'few-songs' | 'not-mine' | 'taken'
  other: string
}

/** For each email with no proposal, the reason: for the page to show */
export function explainUnmatched(
  setlists: SetlistToCheck[],
  emails: EmailSource[],
  proposals: LeaderProposal[],
  options: { me: Person | null; includeAll?: boolean }
): UnmatchedEmail[] {
  const proposedDates = new Set(
    proposals.filter(p => p.status !== 'likely' && p.by !== 'name').map(p => p.date)
  )
  const proposedFiles = new Set(proposals.map(p => p.file).filter(Boolean))
  const isMine = (setlist: SetlistToCheck) =>
    options.includeAll || Boolean(options.me && isLedBy(setlist, options.me))
  const unmatched: UnmatchedEmail[] = []
  for (const email of emails) {
    const { file, setlist } = email
    if (proposedFiles.has(file) || (setlist.date && proposedDates.has(setlist.date))) continue
    const base = { file, date: setlist.date, name: setlist.name, leader: setlist.leader }
    const same = setlist.date ? setlists.find(have => have.date === setlist.date) : undefined
    if (same) {
      unmatched.push({
        ...base,
        reason: 'not-mine',
        other: `${same.owner || '(no leader)'} on ${same.date}`,
      })
      continue
    }
    const takenBy = new Map(proposals.map(p => [p.setlistId, p]))
    const nearby = setlists
      .filter(have => isNear(have.date, email))
      .map(have => ({ have, common: songsInCommon(setlist, have) }))
      .sort(
        (a, b) => b.common - a.common || leadRank(a.have.date, email) - leadRank(b.have.date, email)
      )
    const closest = nearby[0]
    const taken = closest && takenBy.get(closest.have.id)
    if (!closest) {
      unmatched.push({ ...base, reason: 'no-setlist', other: '' })
    } else if (taken && closest.common >= MIN_SONGS) {
      unmatched.push({
        ...base,
        reason: 'taken',
        other: `${closest.have.date} (${closest.common} songs in common) went with ${taken.by === 'name' ? 'a name rule' : taken.file}`,
      })
    } else if (!isMine(closest.have)) {
      unmatched.push({
        ...base,
        reason: 'not-mine',
        other: `${closest.have.owner || '(no leader)'} on ${closest.have.date}`,
      })
    } else {
      unmatched.push({
        ...base,
        reason: 'few-songs',
        other: `${closest.have.date}, ${closest.common} in common`,
      })
    }
  }
  return unmatched
}
