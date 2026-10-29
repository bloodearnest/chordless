/**
 * The songs of a setlist as plain text to paste into a message, e.g. to the media team: the
 * setlist's date and leader, then one line per song, the title and its CCLI number
 * in brackets where it has one.
 */

import { isCcliNumber, songSelectLink } from '../songselect-link.ts'
import { parseLocalDate } from '../utils/date-utils.ts'

/** The setlist details that head the text */
export interface ListedSetlist {
  date?: string
  /** The leader's name */
  leader?: string | null
}

/** "Sunday 18th October" (UK style, in English whatever the device's language) */
export function ukDate(dateString: string): string {
  const date = parseLocalDate(dateString)
  if (Number.isNaN(date.getTime())) return dateString
  const day = date.getDate()
  const suffix =
    day >= 11 && day <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th')
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long' })
  const month = date.toLocaleDateString('en-GB', { month: 'long' })
  return `${weekday} ${day}${suffix} ${month}`
}

/** What a setlist song needs to be listed (a RuntimeSong has it) */
export interface ListedSong {
  title: string
  metadata?: Record<string, unknown> | null
  _canonicalSong?: { ccliNumber?: string | null } | null
}

/** The song's CCLI number: the library's, else the one in the chart ('' if there is none) */
export function ccliOf(song: ListedSong): string {
  const found =
    song._canonicalSong?.ccliNumber || song.metadata?.ccli || song.metadata?.ccliSongNumber
  return found ? String(found).trim() : ''
}

/** The heading lines: "Songs for <date>" and the leader */
export function setlistHeadingLines(setlist: ListedSetlist): string[] {
  const lines: string[] = []
  if (setlist.date) lines.push(`Songs for ${ukDate(setlist.date)}`)
  if (setlist.leader) lines.push(`Worship Leader: ${setlist.leader}`)
  return lines
}

export interface SongListOptions {
  /** Leave out the "Songs for <date>" line (an email has it as its subject) */
  title?: boolean
  /** Follow each song that has a CCLI number with its SongSelect link */
  links?: boolean
}

/** The song's SongSelect page, if it has a CCLI number */
function songPage(song: ListedSong): string {
  const ccli = ccliOf(song)
  return isCcliNumber(ccli) ? songSelectLink({ ccli, title: song.title }) : ''
}

export function songListText(
  songs: ListedSong[],
  setlist?: ListedSetlist,
  { title = true, links = false }: SongListOptions = {}
): string {
  const songLines = songs.map(song => {
    const ccli = ccliOf(song)
    const line = ccli ? `${song.title} (${ccli})` : song.title
    const page = links ? songPage(song) : ''
    return page ? `${line} ${page}` : line
  })
  const heading = setlist ? setlistHeadingLines(setlist) : []
  if (!title) heading.shift()
  return heading.length ? [...heading, '', ...songLines].join('\n') : songLines.join('\n')
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** The same list as rich text to paste into an email: each title with a CCLI number links to SongSelect */
export function songListHtml(songs: ListedSong[], setlist?: ListedSetlist): string {
  const heading = (setlist ? setlistHeadingLines(setlist) : []).map(line => escapeHtml(line))
  const items = songs.map(song => {
    const ccli = ccliOf(song)
    const page = songPage(song)
    const title = escapeHtml(song.title)
    const linked = page ? `<a href="${escapeHtml(page)}">${title}</a>` : title
    return ccli ? `${linked} (${escapeHtml(ccli)})` : linked
  })
  return [
    ...(heading.length ? [`<p>${heading.join('<br>')}</p>`] : []),
    `<p>${items.join('<br>')}</p>`,
  ].join('')
}
