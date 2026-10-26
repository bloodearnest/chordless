/**
 * Turning a forwarded email into a setlist to import: who leads it, the date, and the songs in
 * order, matched to the charts attached to the email.
 *
 * Pure: no DOM, no Node, so the email Worker, the import page and the tests all use it. It is
 * given text that is already out of the email and the PDFs (the adapters that read MIME and PDF
 * are separate), and returns what it found. Nothing here trusts the email: every field can be
 * missing, and the import page lets the user correct them.
 *
 * What a leader's email looks like varies, so the parts are tolerant:
 * - the leader is the From: of the innermost forwarded block, or the email's sender if there is
 *   none. Only their name and address are kept, never the To: lists of the forwards.
 * - the running order and keys are a numbered list in the body ("3. See his love in Gm"), if
 *   there is one; otherwise the attachments' order. Titles in the list are often not the charts'.
 * - the date is "Sunday 18th" or "18 October" in the subject or body, with the year worked out
 *   from when the email was sent.
 */

/** A person named in an email */
export interface EmailPerson {
  name: string
  email: string
}

/** What is read from a chart attached as a PDF (see parseChartText) */
export interface ChartInfo {
  filename: string
  title: string
  /** The title line of the PDF's own text, if that is not the title */
  textTitle?: string
  key: string | null
  tempo: number | null
  time: string | null
  ccli: string | null
}

/** An email, as text */
export interface EmailText {
  subject: string
  from: EmailPerson
  /** The Date: header, in any format Date.parse reads */
  date: string
  /** The plain text body */
  body: string
  /** The attached charts, in the order they were attached */
  charts: ChartInfo[]
}

/** A song in the setlist to import */
export interface ImportedSong {
  /** The title: the chart's if there is one, else as the email listed it */
  title: string
  /**
   * Every title it goes by (the chart's, the filename's, the email's, with and without brackets):
   * to search a library for the song when there is no CCLI number. `title` is first.
   */
  titles: string[]
  author: string | null
  key: string | null
  tempo: number | null
  time: string | null
  /** From the chart. Null when there is none, or it has no CCLI number */
  ccli: string | null
  /** The attached file it was matched with, if any */
  chartFilename: string | null
  /** The title as the email's list gave it (with any other title it had), if it was listed */
  listed: string | null
  /** What the email said about the song for the band ("drop out at the bridge"), without links */
  notes: string
  /**
   * Set when the chart was not matched by title but because it was the one left over, in the
   * same key as the one song left over: a leader may list a song by its chorus and attach it
   * under its title. The page says so, for the person to see.
   */
  pairedBy?: 'elimination'
}

export interface ImportedSetlist {
  /** The email's subject, without the Fwd:s */
  name: string
  /** YYYY-MM-DD, or '' if the email gave none */
  date: string
  /** Set when the date is doubtful (its weekday is wrong): for the page to say so */
  dateWarning: string | null
  /** YYYY-MM-DD the email was sent, or '': for the page to offer when there is no date */
  sentDate: string
  /** False when the email had no list, so the songs are in the attachments' order: a guess */
  orderFromList: boolean
  leader: EmailPerson
  /** In order */
  songs: ImportedSong[]
  /** Charts attached but not in the email's list (so the user can add them) */
  unlisted: ImportedSong[]
}

// ==================== People and forwards ====================

/** "Jenny Nelson <j@example.com>", "<j@example.com>" or "j@example.com" as a person */
export function parsePerson(rawText: string): EmailPerson {
  // Outlook writes "Name <a@b.c<mailto:a@b.c>>"
  const text = rawText.replace(/<mailto:[^>]*>/gi, '')
  const bracketed = /^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>/.exec(text)
  const email = (bracketed?.[2] ?? /[^\s<>,;"]+@[^\s<>,;"]+/.exec(text)?.[0] ?? '').toLowerCase()
  const name = (bracketed?.[1] ?? '').replace(/^["'\s]+|["'\s]+$/g, '')
  return { name: name || email.split('@')[0] || '', email }
}

/** The headers of a forwarded message that are kept; the recipients' are never read */
interface ForwardedHeaders {
  from: string
  date: string
  subject: string
}

const HEADER = /^(From|Date|Sent|Subject|To|Cc):\s*(.*)$/i

/**
 * The innermost forwarded message in a plain text body: its From, Date and Subject, and the text
 * after its headers. Gmail ("---------- Forwarded message ---------"), Apple Mail and Outlook all
 * put the headers as lines, so a From: line followed soon by a Date:, Sent: or Subject: is one.
 * Null if the body forwards nothing.
 */
export function innermostForward(body: string): (ForwardedHeaders & { text: string }) | null {
  const lines = body.split(/\r?\n/).map(line => line.replace(/^(?:>\s?)+/, ''))
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (!/^From:\s*\S/i.test(lines[i])) continue
    const next = lines.slice(i + 1, i + 5)
    if (next.some(line => /^(Date|Sent|Subject):/i.test(line))) start = i
  }
  if (start < 0) return null

  const headers: Record<string, string> = {}
  let last = ''
  let end = start
  for (; end < lines.length; end++) {
    const line = lines[end]
    if (!line.trim()) break
    const header = HEADER.exec(line)
    if (header) {
      last = header[1].toLowerCase()
      headers[last] = header[2].trim()
    } else if (last) {
      headers[last] = `${headers[last]} ${line.trim()}`
    }
  }
  return {
    // (a block starts at its From: line)
    from: headers.from as string,
    date: headers.date ?? headers.sent ?? '',
    subject: headers.subject ?? '',
    text: lines.slice(end).join('\n'),
  }
}

/** A subject without its "Fwd:", "Re:" prefixes */
export function cleanSubject(subject: string): string {
  return subject
    .replace(/^(?:\s*(?:fwd?|re)\s*:)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ==================== Dates ====================

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const DATE_MENTION = new RegExp(
  `\\b(?:(${WEEKDAYS.join('|')})[a-z]*\\.?,?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?` +
    `(?:\\s+(?:of\\s+)?(${MONTHS.join('|')})[a-z]*\\.?)?(?:,?\\s+(\\d{4}))?\\b`,
  'gi'
)

/** When an email was sent, as a UTC day: its Date: header ("Fri, 9 Oct 2026, 18:11" is read) */
export function sentDay(date: string): Date | null {
  const spelled = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(date)
  if (spelled) {
    const month = MONTHS.indexOf(spelled[2].toLowerCase())
    if (month >= 0) return new Date(Date.UTC(+spelled[3], month, +spelled[1]))
  }
  const parsed = Date.parse(date)
  if (Number.isNaN(parsed)) return null
  const day = new Date(parsed)
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))
}

const isoDay = (day: Date) => day.toISOString().slice(0, 10)

/** A date a text mentions: as YYYY-MM-DD, and as the text wrote it */
interface DateMention {
  date: string
  stated: string
  /** 0 (Sunday) to 6, if the text gave a weekday */
  weekday: number
}

/**
 * The first date mentioned in the text. A mention needs a weekday or a month ("Sunday 18th",
 * "18 October"): a bare number is not a date. A missing year is the first one that makes the
 * date fall on or after the day before `sent` and, if given, on the weekday. Lines about practice
 * or rehearsal are skipped: those are not the service. With `strict` off the weekday is
 * ignored, and only mentions with a month count (for a date whose weekday the sender got wrong).
 */
function scanDates(text: string, sent: Date | null, strict: boolean): DateMention | null {
  for (const line of text.split(/\r?\n/)) {
    if (/practi[cs]e|rehears/i.test(line)) continue
    for (const mention of line.matchAll(DATE_MENTION)) {
      const [stated, weekdayText, dayText, monthText, yearText] = mention
      if (strict ? !weekdayText && !monthText : !monthText) continue
      const weekday = weekdayText ? WEEKDAYS.indexOf(weekdayText.toLowerCase()) : -1
      const date = resolveDate(+dayText, monthText, yearText, strict ? weekday : -1, sent)
      if (date) return { date, stated: stated.trim(), weekday }
    }
  }
  return null
}

/** The first date the text mentions, as YYYY-MM-DD, or '' (see scanDates) */
export function findDate(text: string, sent: Date | null): string {
  return scanDates(text, sent, true)?.date ?? ''
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "9 Nov 2025" */
const spoken = (day: Date) =>
  `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()][0].toUpperCase()}${MONTHS[day.getUTCMonth()].slice(1)} ${day.getUTCFullYear()}`

/**
 * A date whose weekday is wrong ("Sunday 8th Nov", when the 8th is a Saturday): the sender
 * more likely got the number wrong than the day, so this is the nearest date with that weekday
 * (within three days), with a sentence saying what was assumed. Null if there is no such mention.
 */
export function findDateWithWrongNumber(
  text: string,
  sent: Date | null
): { date: string; warning: string } | null {
  const found = scanDates(text, sent, false)
  if (!found || found.weekday < 0) return null
  const stated = new Date(`${found.date}T00:00:00Z`)
  let shift = (found.weekday - stated.getUTCDay() + 7) % 7
  if (shift > 3) shift -= 7
  const fixed = new Date(stated.getTime() + shift * 24 * 60 * 60 * 1000)
  return {
    date: isoDay(fixed),
    warning: `"${found.stated}" is a ${WEEKDAY_NAMES[stated.getUTCDay()]}, so the date was taken to be ${WEEKDAY_NAMES[found.weekday]} ${spoken(fixed)}`,
  }
}

/**
 * "Altogether 28th": only the day of the month, in a subject. It is taken as that day coming next
 * on or after the day before it was sent, if that is a Sunday (services are), with a sentence
 * saying so for the sender to confirm. Null if it is not a Sunday, or there is no such mention.
 */
export function findBareSunday(
  text: string,
  sent: Date | null
): { date: string; warning: string } | null {
  const mention = /\b(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text)
  if (!mention || !sent) return null
  const earliest = sent.getTime() - 24 * 60 * 60 * 1000
  for (let offset = 0; offset < 2; offset++) {
    const month = sent.getUTCMonth() + offset
    const day = new Date(Date.UTC(sent.getUTCFullYear(), month, +mention[1]))
    if (day.getUTCDate() !== +mention[1] || day.getTime() < earliest) continue
    if (day.getUTCDay() !== 0) return null
    return {
      date: isoDay(day),
      warning: `Only the day of the month was given ("${mention[0]}"): taken to be Sunday ${spoken(day)}`,
    }
  }
  return null
}

/** The nearest Sunday that is not past: today, if it is one. For a setlist with no date given */
export function nearestSunday(today: Date = new Date()): string {
  const day = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))
  day.setUTCDate(day.getUTCDate() + ((7 - day.getUTCDay()) % 7))
  return isoDay(day)
}

function resolveDate(
  dayOfMonth: number,
  monthText: string | undefined,
  yearText: string | undefined,
  weekday: number,
  sent: Date | null
): string {
  const month = monthText ? MONTHS.indexOf(monthText.toLowerCase().slice(0, 3)) : -1
  const fits = (day: Date, year: number, monthIndex: number) =>
    day.getUTCFullYear() === year &&
    day.getUTCMonth() === monthIndex &&
    day.getUTCDate() === dayOfMonth &&
    (weekday < 0 || day.getUTCDay() === weekday)

  if (yearText && month >= 0) {
    const day = new Date(Date.UTC(+yearText, month, dayOfMonth))
    return fits(day, +yearText, month) ? isoDay(day) : ''
  }
  if (!sent) return ''
  const earliest = sent.getTime() - 24 * 60 * 60 * 1000
  const firstMonth = sent.getUTCFullYear() * 12 + sent.getUTCMonth()
  // A service is mentioned weeks ahead: a date more than a few months away is not one
  for (let offset = 0; offset < 5; offset++) {
    const year = Math.floor((firstMonth + offset) / 12)
    const monthIndex = (firstMonth + offset) % 12
    if (month >= 0 && monthIndex !== month) continue
    const day = new Date(Date.UTC(year, monthIndex, dayOfMonth))
    if (fits(day, year, monthIndex) && day.getTime() >= earliest) return isoDay(day)
  }
  return ''
}

// ==================== Charts ====================

/** A key as the song's chart writes it: "Bb", "F#m". Null if it isn't one */
export function normaliseKey(text: string): string | null {
  const match = /^([A-G])([#b♯♭]?)\s*(m|min|minor|maj|major)?$/i.exec(text.trim())
  if (!match) return null
  const accidental = match[2] === '♯' ? '#' : match[2] === '♭' ? 'b' : match[2]
  const minor = match[3] && /^m(in|inor)?$/i.test(match[3]) && match[3] !== 'M'
  return `${match[1].toUpperCase()}${accidental}${minor ? 'm' : ''}`
}

const FILENAME_SUFFIX = /[\s_-]*chord(?:s|pro)?[\s_-]*([A-G][#b]?m?)?(?:\s*\(\d+\))?$/i

/**
 * A chart's title, key and place as its filename gives them: "Living Hope-chords-Bb.pdf", or
 * "3. Living Hope.pdf" from a leader who numbers the files in the order of the set
 */
export function chartFilenameParts(filename: string): {
  title: string
  key: string | null
  order: number | null
} {
  let base = filename.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/\s*\(\d+\)$/, '')
  const numbered = /^(\d{1,2})\s*[.)_-]\s*(\S.*)$/.exec(base)
  if (numbered) base = numbered[2]
  const suffix = FILENAME_SUFFIX.exec(base)
  const title = (suffix ? base.slice(0, suffix.index) : base)
    .replace(/[_]+/g, ' ')
    // a second copy of a file: "Title (Other Name) 2"
    .replace(/(\))\s+\d$/, '$1')
    .trim()
  return {
    title,
    key: suffix?.[1] ? normaliseKey(suffix[1]) : null,
    order: numbered ? Number(numbered[1]) : null,
  }
}

/**
 * What a chart's text says, from a PDF of a song (the text of its pages, in reading order).
 * SongSelect's PDFs start with the title, then "Key - A | Tempo - 124 | Time - 4/4", and end with
 * "CCLI Song # 1234567". OnSong's have "Key of E" (on the title's line or its own), may wrap a long
 * title over two lines, and may have a "CCLI 1234567" or none. The filename is the title the
 * sender's app gave the song, so it wins when it is the longer form of the title in the text.
 */
export function parseChartText(text: string, filename: string): ChartInfo {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const head = lines.slice(0, 15)
  // Not the title: a browser's print header ("5/11/26, 3:45 PM  Set A Fire Lyrics by …"), a URL,
  // or a line that is only the key
  const first = lines.find(
    line =>
      !/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s/.test(line) &&
      !/^https?:/.test(line) &&
      !/^Key\s+of\s+\S+$/i.test(line)
  )
  const textTitle = first?.replace(/\s+Key\s+of\s+\S+$/i, '').trim() ?? ''
  const fromName = chartFilenameParts(filename)
  // The filename is the title the sender's app gave the song, and the text's can wrap or be
  // garbled by the PDF's layout: so it wins unless it says nothing ("scan 0012", "x")
  const generic =
    !/\p{L}{3,}/u.test(fromName.title) ||
    /^(scan|img|image|document|untitled)\b/i.test(fromName.title)
  const title = generic ? textTitle || fromName.title : fromName.title
  const find = (pattern: RegExp) => head.map(line => pattern.exec(line)?.[1]).find(Boolean)
  const key = find(/\bKey\s*(?:[-:–]|of)\s*([^\s|]+)/i)
  const tempo = find(/\bTempo\s*[-:–]\s*(\d+)/i)
  const time = find(/\bTime\s*[-:–]\s*(\d+\/\d+)/i)
  return {
    filename,
    title,
    ...(textTitle && textTitle !== title ? { textTitle } : {}),
    key: (key && normaliseKey(key)) || fromName.key,
    tempo: tempo ? Number(tempo) : null,
    time: time ?? null,
    // "CCLI Song # 123", or "CCLI 123". Not "CCLI® License #471102": that is the church's
    ccli: /CCLI\s+(?:Song\s*)?#?\s*(\d{4,9})\b/i.exec(text)?.[1] ?? null,
  }
}

// ==================== The list in the body ====================

/** One song of the list in the email's body */
export interface ListedSong {
  /** Without any brackets */
  title: string
  /** Other titles the line gave, in brackets: "Thank you for the Cross (Worthy is the Lamb)" */
  alternates: string[]
  /** The title as written, brackets and all */
  full: string
  author: string | null
  key: string | null
  tempo: number | null
  time: string | null
  /** What else the line said (a note for the band), without links */
  notes: string
  /** The list was numbered; else it was bullets (more likely to be something else) */
  numbered: boolean
}

const KEY = '[A-G][#b♯♭]?\\s*(?:m|min|minor|maj|major)?'
const KEY_AT_END = [
  new RegExp(`\\s+in\\s+(${KEY})\\s*$`),
  new RegExp(`\\s+[-–—]\\s+(${KEY})\\s*$`),
  new RegExp(`\\s*\\(\\s*(${KEY})\\s*\\)\\s*$`),
]
// "Behold him Bb": a key as the last word, with no "in". Last, as it is the least sure ("Here I Am"
// ends in what could be A minor)
const BARE_KEY_AT_END = /\s+([A-G][#b♯♭]?(?:m|min|minor)?)\s*$/
// OnSong's: "Title by Authors in Em at 118 BPM in 4/4" and then, perhaps, a link and a note
const ONSONG_LINE = new RegExp(
  `^(.+) by (.+?) in (${KEY})(?=[\\s.,;:(]|$)(?:\\s+at\\s+(\\d+)\\s*BPM)?(?:\\s+in\\s+(\\d+/\\d+))?(.*)$`
)
const LIST_MARKER = /^\s*(?:(\d{1,2})\s*[.)]|[•*·-])\s+(\S.*)$/

/** How deep in brackets each character of the text is */
const bracketDepth = (text: string, index: number) =>
  [...text.slice(0, index)].reduce((n, c) => n + (c === '(' ? 1 : c === ')' ? -1 : 0), 0)

/** A note, tidied: no links, and not in brackets all round */
function tidyNote(text: string): string {
  const note = text
    .replace(/https?:\/\/[^\s)]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const plain = note.replace(/^[\s.,;:\-–—]+/, '')
  return /^\([^()]*\)$/.test(plain) ? plain.slice(1, -1).trim() : plain
}

/**
 * The songs listed in a body: numbered ("1. None like Jehovah in Bb") or bulleted, as OnSong
 * writes them ("• Living Hope by Phil Wickham in Bb at 72 BPM in 4/4"). A line may go on over the
 * next ones while a bracket is open.
 */
export function parseSongList(body: string): ListedSong[] {
  const songs: ListedSong[] = []
  let open: ListedSong | null = null
  for (const line of body.split(/\r?\n/)) {
    const item = LIST_MARKER.exec(line)
    if (!item) {
      // A note that goes on to another line: only while its bracket is open
      if (open && line.trim() && bracketDepth(open.notes, open.notes.length) > 0) {
        open.notes = `${open.notes} ${line.trim()}`
      } else {
        open = null
      }
      continue
    }
    const numbered = Boolean(item[1])
    let rest = item[2].trim()
    let author: string | null = null
    let key: string | null = null
    let tempo: number | null = null
    let time: string | null = null
    let notes = ''
    const onsong = ONSONG_LINE.exec(rest)
    if (onsong && normaliseKey(onsong[3])) {
      rest = onsong[1].trim()
      author = onsong[2].trim()
      key = normaliseKey(onsong[3])
      tempo = onsong[4] ? Number(onsong[4]) : null
      time = onsong[5] ?? null
      notes = onsong[6]
    } else {
      // "Title in Gm": the first " in <key>" outside brackets, with a note after it (or the key at the end)
      const inKey = new RegExp(`\\s+in\\s+(${KEY})(?=[\\s.,;:(]|$)`, 'g')
      for (const found of rest.matchAll(inKey)) {
        if (bracketDepth(rest, found.index) > 0 || !normaliseKey(found[1])) continue
        key = normaliseKey(found[1])
        notes = rest.slice(found.index + found[0].length)
        rest = rest.slice(0, found.index).trim()
        // "in Gm at 72 BPM in 4/4", as OnSong has it
        // (all of it is optional, so it always matches)
        const details = /^\s*(?:at\s+(\d+)\s*BPM)?(?:\s+in\s+(\d+\/\d+))?/i.exec(
          notes
        ) as RegExpExecArray
        tempo = details[1] ? Number(details[1]) : null
        time = details[2] ?? null
        notes = notes.slice(details[0].length)
        break
      }
      if (!key) {
        for (const pattern of KEY_AT_END) {
          const found = pattern.exec(rest)
          const parsed = found && normaliseKey(found[1])
          if (parsed) {
            key = parsed
            rest = rest.slice(0, found.index).trim()
            break
          }
        }
      }
      if (!key) {
        const found = BARE_KEY_AT_END.exec(rest)
        const parsed = found && normaliseKey(found[1])
        const word = rest.slice(0, found?.index).split(/\s+/).pop() ?? ''
        if (
          parsed &&
          !(found?.[1] === 'Am' && /^i$/i.test(word)) &&
          rest.slice(0, found.index).trim()
        ) {
          key = parsed
          rest = rest.slice(0, found.index).trim()
        }
      }
    }
    rest = rest.replace(/[\s\-–—:,]+$/, '')
    const alternates = [...rest.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim())
    // "Majesty, Here I am": either part may be the title a chart has
    const plain = rest
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const parts = plain.split(',').map(part => part.trim())
    if (parts.length > 1) alternates.push(...parts.filter(Boolean))
    const title = rest
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const song: ListedSong = {
      title: title || rest,
      alternates,
      full: rest.replace(/\s+/g, ' ').trim(),
      author,
      key,
      tempo,
      time,
      notes,
      numbered,
    }
    songs.push(song)
    open = song
  }
  for (const song of songs) song.notes = tidyNote(song.notes)
  return songs
}

// ==================== Matching the list to the charts ====================

/** A title for comparing: lower case, no accents or punctuation */
export function normaliseTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** How well two titles match, 0 to 1. A title inside the other counts if it is two words or more */
export function titleScore(a: string, b: string): number {
  const x = normaliseTitle(a).split(' ').filter(Boolean)
  const y = normaliseTitle(b).split(' ').filter(Boolean)
  if (!x.length || !y.length) return 0
  if (x.join(' ') === y.join(' ')) return 1
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 2) {
    const text = ` ${long.join(' ')} `
    if (text.includes(` ${short.join(' ')} `)) return 0.5 + 0.4 * (short.length / long.length)
  }
  const shared = x.filter(word => y.includes(word)).length
  const jaccard = shared / (x.length + y.length - shared)
  return jaccard >= 0.7 ? jaccard * 0.8 : 0
}

/** The titles a chart goes by: the text's, the filename's, and the chart's brackets taken off */
function chartTitles(chart: ChartInfo): string[] {
  const titles = [chart.title, chartFilenameParts(chart.filename).title, chart.textTitle ?? '']
  return titles.flatMap(t => [t, t.replace(/\([^)]*\)/g, ' ')])
}

function matchScore(song: ListedSong, chart: ChartInfo): number {
  const listed = [song.full, song.title, ...song.alternates]
  const charted = chartTitles(chart)
  let best = 0
  for (const a of listed) for (const b of charted) best = Math.max(best, titleScore(a, b))
  return best
}

/**
 * For each listed song, the attached chart it is, or null. Each chart goes to one song, the best
 * matches first.
 */
function matchCharts(list: ListedSong[], charts: ChartInfo[]): (ChartInfo | null)[] {
  const pairs: { song: number; chart: number; score: number }[] = []
  for (const [s, song] of list.entries()) {
    for (const [c, chart] of charts.entries()) {
      const score = matchScore(song, chart)
      if (score > 0) pairs.push({ song: s, chart: c, score })
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.song - b.song)
  const matched: (ChartInfo | null)[] = list.map(() => null)
  const used = new Set<number>()
  for (const { song, chart } of pairs) {
    if (matched[song] || used.has(chart)) continue
    matched[song] = charts[chart]
    used.add(chart)
  }
  return matched
}

/** Every title for a song, without repeats: what to search a library for when it has no CCLI number */
function titlesOf(...titles: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const title of titles) {
    const key = normaliseTitle(title ?? '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push((title as string).trim())
  }
  return out
}

// ==================== Putting it together ====================

/** The song a lone chart is, to look for in a library (a PDF shared to the app) */
export function songOfChart(chart: ChartInfo): ImportedSong {
  return fromChart(chart)
}

function fromChart(
  chart: ChartInfo,
  listed: ListedSong | null = null,
  otherKeys: string[] = []
): ImportedSong {
  const key = listed?.key ?? chart.key
  const also = otherKeys.filter(other => other !== key)
  return {
    title: chart.title,
    titles: titlesOf(
      chart.title,
      ...chartTitles(chart),
      listed?.full,
      listed?.title,
      ...(listed?.alternates ?? [])
    ),
    author: listed?.author ?? null,
    key,
    tempo: chart.tempo ?? listed?.tempo ?? null,
    time: chart.time ?? listed?.time ?? null,
    ccli: chart.ccli,
    chartFilename: chart.filename,
    listed: listed ? listed.full : null,
    notes: [listed?.notes, also.length ? `May also be in ${also.join(' or ')}` : '']
      .filter(Boolean)
      .join('. '),
  }
}

function fromListed(song: ListedSong): ImportedSong {
  return {
    title: song.full,
    titles: titlesOf(song.full, song.title, ...song.alternates),
    author: song.author,
    key: song.key,
    tempo: song.tempo,
    time: song.time,
    ccli: null,
    chartFilename: null,
    listed: song.full,
    notes: song.notes,
  }
}

/**
 * One chart for each song. The same song attached twice is one chart; the same song in another
 * key is also one (the first), remembering the other keys, as the leader may use either.
 */
function oneChartPerSong(charts: ChartInfo[]): {
  charts: ChartInfo[]
  otherKeys: Map<ChartInfo, string[]>
} {
  const first = new Map<string, ChartInfo>()
  const otherKeys = new Map<ChartInfo, string[]>()
  for (const chart of charts) {
    const id = chart.ccli ?? normaliseTitle(chart.title)
    const kept = first.get(id)
    if (!kept) {
      first.set(id, chart)
    } else if (chart.key && chart.key !== kept.key) {
      const keys = otherKeys.get(kept) ?? []
      if (!keys.includes(chart.key)) otherKeys.set(kept, [...keys, chart.key])
    }
  }
  return { charts: [...first.values()], otherKeys }
}

/**
 * A subject as the setlist's name: without the date, which the setlist has of its own ("Sunday
 * 18th October" is no name, and "Sunday 18th October - Harvest" is "Harvest"), and without the
 * words that led to it ("Songs for"). Nothing is left of a subject that is only a date
 */
function nameWithoutDate(subject: string, sent: Date | null): string {
  const mention = scanDates(subject, sent, true) ?? scanDates(subject, sent, false)
  if (!mention) return subject
  return subject
    .replace(mention.stated, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:,|·]+|[\s\-–—:,|·]+$/g, '')
    .replace(/(?:^|\s)(?:for|on|the|of|at)$/i, '')
    .trim()
}

/** Subject lines that are the sender's app's, not a name for the set */
function setName(subject: string): string {
  return cleanSubject(subject).replace(/^here['’]?s your set\s*[:\-–]?\s*/i, '')
}

/**
 * A listed song with no chart, and an attached chart that no song has, are likely the same song
 * under different names (a leader lists "Your Grace Is Enough" and attaches "This Is Our God"):
 * when they are the only ones left with that key. Or when each is the only one left, and one of
 * them has no key to disagree. Pairs them, as a guess the page shows.
 */
function pairLeftovers(
  items: { song: ListedSong; chart: ChartInfo | null; guessed?: boolean }[],
  charts: ChartInfo[]
): void {
  const free = () => charts.filter(chart => !items.some(item => item.chart === chart))
  const lacking = () => items.filter(item => !item.chart)
  for (const item of lacking()) {
    const keyed = item.song.key
    const alone = lacking().length === 1 && free().length === 1
    const sameKey = free().filter(chart => keyed && chart.key === keyed)
    const sharing = lacking().filter(other => keyed && other.song.key === keyed)
    if (keyed && sameKey.length === 1 && sharing.length === 1) {
      item.chart = sameKey[0]
      item.guessed = true
    } else if (alone && (!keyed || !free()[0].key)) {
      item.chart = free()[0]
      item.guessed = true
    }
  }
}

/** The setlist an email describes. See the top of this file for where each part comes from */
export function importFromEmail(email: EmailText): ImportedSetlist {
  const forward = innermostForward(email.body)
  const text = forward ? forward.text : email.body
  const leader = forward?.from ? parsePerson(forward.from) : email.from
  const subject = setName(forward?.subject || email.subject)
  const sent = sentDay(forward?.date || email.date) ?? sentDay(email.date)
  const name = nameWithoutDate(subject, sent)
  let date = findDate(subject, sent) || findDate(text, sent)
  let dateWarning: string | null = null
  if (!date) {
    const wrong = findDateWithWrongNumber(subject, sent) ?? findDateWithWrongNumber(text, sent)
    if (wrong) {
      date = wrong.date
      dateWarning = wrong.warning
    }
  }
  if (!date) {
    const bare = findBareSunday(subject, sent)
    if (bare) {
      date = bare.date
      dateWarning = bare.warning
    }
  }
  const sentDate = sent ? isoDay(sent) : ''
  const { charts, otherKeys } = oneChartPerSong(email.charts)

  const list = parseSongList(text)
  const matched = matchCharts(list, charts)
  // Bullets are only a list of songs if they look like it: a key given, or a chart they match
  const items: { song: ListedSong; chart: ChartInfo | null; guessed?: boolean }[] = list
    .map((song, i) => ({ song, chart: matched[i] }))
    .filter(({ song, chart }) => song.numbered || song.key || chart)
  if (!items.length) {
    // No list: the attachments' order, unless the leader numbered the files
    const orders = charts.map(chart => chartFilenameParts(chart.filename).order)
    const numbered = charts.length > 1 && orders.every(order => order !== null)
    const ordered = numbered
      ? charts
          .map((chart, i) => ({ chart, order: orders[i] as number }))
          .sort((a, b) => a.order - b.order)
          .map(item => item.chart)
      : charts
    return {
      name,
      date,
      dateWarning,
      sentDate,
      leader,
      orderFromList: numbered,
      songs: ordered.map(c => fromChart(c, null, otherKeys.get(c))),
      unlisted: [],
    }
  }

  pairLeftovers(items, charts)
  const songs = items.map(({ song, chart, guessed }) =>
    chart
      ? {
          ...fromChart(chart, song, otherKeys.get(chart)),
          ...(guessed ? { pairedBy: 'elimination' as const } : {}),
        }
      : fromListed(song)
  )
  const used = new Set(items.map(item => item.chart))
  return {
    name,
    date,
    dateWarning,
    sentDate,
    leader,
    orderFromList: true,
    songs,
    unlisted: charts
      .filter(chart => !used.has(chart))
      .map(c => fromChart(c, null, otherKeys.get(c))),
  }
}
