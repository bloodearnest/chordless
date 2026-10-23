/**
 * Cleaning up a library (docs/ACCOUNT.md): merging songs that are the same song twice, and giving
 * every song the source it should have. Not something an end user is meant to need, so it is run
 * from the dev page (`/dev/library-repair.html`) or the console, never from the app.
 *
 * **Duplicates.** Two records of one song (the same CCLI number, or the same title when there is
 * none) whose charts are the same once the key and the things that are not the chart are set aside
 * are one song twice: a change of key is not a variant. They are merged into the one the setlists
 * use, the setlist entries are moved to it (keeping the key and tempo they showed), and the other
 * is deleted, the deletion reaching Drive at the next sync. Charts that differ in their words or
 * their chords are different arrangements and are left alone, and reported.
 *
 * **Sources.** A song whose source is not known gets one from its chart: it has the CCLI material
 * SongSelect puts on a chart, so it came from SongSelect; if not, the person who owns the library
 * wrote it.
 *
 * Planning reads and does not change anything (and the planning functions here take records, not a
 * database, so they can be checked on an export). Applying does.
 */

import type { Setlist, SongRecord } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { lyricsOf } from './import-plan.ts'
import { SONGSELECT, songSource } from './song-source.ts'
import { linkSong, moveEntries } from './song-versions.ts'
import { convertChordToNashville } from './transpose.ts'

/** A song with the text of its chart, which is all the planning needs to know */
export interface SongWithText {
  song: SongRecord
  text: string
}

// ---- the chart ----

/**
 * Whether a chart carries the CCLI material SongSelect puts on its charts (the license and
 * Song # lines, the footer with the terms of use), which a chart written by hand does not have
 */
export function hasCcliBumph(chordpro: string): boolean {
  return /CCLI Song #|SongSelect|CCLI Licen[cs]e|\{\s*ccli_license/i.test(chordpro)
}

/** The key a chart says it is in, if it says */
export function keyOfChart(chordpro: string): string | null {
  return /^\s*\{\s*key\s*:\s*([^}\s]+)\s*\}/im.exec(chordpro)?.[1] ?? null
}

/** Directives about the song, not the chart: set aside when comparing two charts */
const ABOUT_THE_SONG = new Set([
  'title',
  'subtitle',
  'sorttitle',
  'artist',
  'author',
  'composer',
  'lyricist',
  'copyright',
  'ccli',
  'ccli_license',
  'footer',
  'key',
  'tempo',
  'time',
  'capo',
  'year',
  'album',
  'duration',
])

/**
 * The chart reduced to what makes it this arrangement: its words and where the chords fall, with
 * the chords as numbers from the key (so the same chart in another key is the same), and none of
 * what is about the song rather than the chart (title, key, tempo, copyright, the CCLI material).
 * Two charts with the same fingerprint are the same chart.
 */
export function chartFingerprint(chordpro: string): string {
  return chartLines(chordpro)
    .map(line => line.chords)
    .join('\n')
}

/** One line of a chart that is part of the chart: as written, and as it is compared */
interface ChartLine {
  /** As written (trimmed) */
  text: string
  /** The words alone, with no chords */
  words: string
  /** The words and the chords as numbers from the key */
  chords: string
}

/** The lines of a chart that are the chart: not blank, not about the song, not the CCLI trailer */
function chartLines(chordpro: string): ChartLine[] {
  const key = keyOfChart(chordpro)
  const lines: ChartLine[] = []
  for (const raw of chordpro.split(/\r?\n/)) {
    const text = raw.trim()
    if (!text) continue
    // (everything from the CCLI Song # line on is the trailer)
    if (/^CCLI Song #/i.test(text)) break
    const directive = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*(.*)$/i.exec(text)
    if (directive) {
      const name = directive[1].toLowerCase()
      if (ABOUT_THE_SONG.has(name)) continue
      const same = `{${name}:${plain(directive[2] ?? '')}} ${plain(directive[3])}`.trim()
      lines.push({ text, words: same, chords: same })
      continue
    }
    const parts = text.split(/(\[[^\]]*\])/)
    lines.push({
      text,
      words: plain(parts.filter(part => !/^\[[^\]]*\]$/.test(part)).join('')),
      chords: parts
        .map(part => {
          const chord = /^\[([^\]]*)\]$/.exec(part)
          return chord ? `[${convertChordToNashville(chord[1], key)}]` : plain(part)
        })
        .join('')
        .replace(/\s*(\[[^\]]*\])\s*/g, '$1')
        .trim(),
    })
  }
  return lines
}

// ---- comparing two charts ----

/** How two charts of a song differ, from least to most */
export type ChartVerdict =
  | 'identical' // the same text
  | 'same-chart' // the same words and chords, other details (title, copyright, ...)
  | 'other-key' // the same chart in another key
  | 'different-chords' // the same words, other chords
  | 'different-words' // another version or arrangement

/** How one stanza of a chart stands against the other chart's */
export type StanzaStatus = 'same' | 'chords' | 'words' | 'only'

/** A stanza (a verse, the chorus: what a section heading begins) of one chart */
export interface Stanza {
  /** The section heading ("Verse 1"), empty for lines before the first */
  heading: string
  /** The lines under the heading, as written */
  lines: string[]
  /**
   * 'same' (the same words and chords, apart from the key); 'chords' (the same words, other
   * chords); 'words' (its closest stanza in the other chart has other words); 'only' (the other
   * chart has nothing like it)
   */
  status: StanzaStatus
  /** The heading of the other chart's stanza it was matched with, if any */
  matched: string | null
  /** How alike the words of the two stanzas are, 0 to 1 */
  similarity: number
}

export interface ChartComparison {
  verdict: ChartVerdict
  /** The key each chart says it is in */
  keys: [string | null, string | null]
  /** How alike the words of the whole charts are, 0 to 1 */
  wordSimilarity: number
  /** The stanzas of each chart, marked against the other's */
  stanzas: [Stanza[], Stanza[]]
}

/** The words count as the same when this much of them is: it forgives a typo or a different hyphenation */
const SAME_WORDS = 0.9
/** Stanzas are matched when their words are at least this alike */
const SAME_STANZA = 0.5

/** Whether two words are the same, or (in a longer word) one typo apart */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (a[i] === b[i]) i++
  // After the first difference, one letter changed, or one added or dropped
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a]
  return shorter.slice(i) === longer.slice(i + 1)
}

/** How alike two lists of words are, 0 to 1 (the longest run they share, in order, a typo allowed) */
function wordListSimilarity(x: string[], y: string[]): number {
  if (!x.length && !y.length) return 1
  let previous = new Array<number>(y.length + 1).fill(0)
  for (let i = 1; i <= x.length; i++) {
    const row = new Array<number>(y.length + 1).fill(0)
    for (let j = 1; j <= y.length; j++) {
      row[j] = sameWord(x[i - 1], y[j - 1])
        ? previous[j - 1] + 1
        : Math.max(previous[j], row[j - 1])
    }
    previous = row
  }
  return (2 * previous[y.length]) / (x.length + y.length)
}

/** The words of a chart (or of lines of one), without the CCLI trailer and the other material around it */
const wordsOf = (chordpro: string): string[] =>
  lyricsOf(
    chartLines(chordpro)
      .map(line => line.text)
      .join('\n')
  )
    .split(' ')
    .filter(Boolean)

/** How alike the words of two charts are, 0 to 1, whatever their line breaks, case or punctuation */
export function wordSimilarity(a: string, b: string): number {
  return wordListSimilarity(wordsOf(a), wordsOf(b))
}

/** The chords of a chart (or of lines of one) in order, as numbers from its key */
function chordSequence(lines: ChartLine[]): string {
  return lines.flatMap(line => line.chords.match(/\[[^\]]*\]/g) ?? []).join('')
}

/** A directive that begins a section: a comment, as SongSelect writes "Verse 1", or a start of one */
const SECTION =
  /^\{\s*(?:c|comment|ci|comment_italic|cb|comment_box|start_of_[a-z]+|so[a-z])\s*(?::\s*(.*?))?\s*\}/i

/** A directive that ends a section (end_of_verse, eov): it has no words, and begins nothing */
const SECTION_END = /^\{\s*(?:end_of_[a-z]+|eo[a-z])\s*\}/i

/** The stanzas of a chart: each section heading and the lines under it */
function stanzasOf(chordpro: string): { heading: string; lines: ChartLine[] }[] {
  const stanzas: { heading: string; lines: ChartLine[] }[] = []
  for (const line of chartLines(chordpro)) {
    const section = SECTION.exec(line.text)
    if (section) {
      stanzas.push({ heading: (section[1] ?? '').trim() || line.text, lines: [] })
      continue
    }
    if (SECTION_END.test(line.text)) continue
    if (!stanzas.length) stanzas.push({ heading: '', lines: [] })
    stanzas[stanzas.length - 1].lines.push(line)
  }
  return stanzas
}

/** The stanzas of two charts, each matched with its closest in the other and marked */
function compareStanzas(a: string, b: string): [Stanza[], Stanza[]] {
  const make = (chordpro: string) =>
    stanzasOf(chordpro).map(stanza => ({
      heading: stanza.heading,
      raw: stanza.lines.map(line => line.text),
      words: wordsOf(stanza.lines.map(line => line.text).join('\n')),
      chords: chordSequence(stanza.lines),
    }))
  const left = make(a)
  const right = make(b)
  // Every pair, the most alike first, taken where neither is taken
  const pairs: { i: number; j: number; score: number }[] = []
  for (let i = 0; i < left.length; i++) {
    for (let j = 0; j < right.length; j++) {
      const score =
        left[i].words.length || right[j].words.length
          ? wordListSimilarity(left[i].words, right[j].words)
          : // (chords alone: the same chords, or the same heading, are the same stanza)
            left[i].chords === right[j].chords
            ? 1
            : left[i].heading === right[j].heading
              ? SAME_WORDS
              : 0
      if (score >= SAME_STANZA) pairs.push({ i, j, score })
    }
  }
  // (a tie goes to the stanzas in the same place)
  pairs.sort((p, q) => q.score - p.score || Math.abs(p.i - p.j) - Math.abs(q.i - q.j))
  const matchA = new Map<number, { j: number; score: number }>()
  const matchB = new Map<number, { i: number; score: number }>()
  for (const { i, j, score } of pairs) {
    if (matchA.has(i) || matchB.has(j)) continue
    matchA.set(i, { j, score })
    matchB.set(j, { i, score })
  }
  const mark = (
    mine: typeof left,
    theirs: typeof left,
    match: Map<number, { j?: number; i?: number; score: number }>
  ): Stanza[] =>
    mine.map((stanza, n) => {
      const found = match.get(n)
      if (!found) {
        return {
          heading: stanza.heading,
          lines: stanza.raw,
          status: 'only',
          matched: null,
          similarity: 0,
        }
      }
      const other = theirs[(found.j ?? found.i) as number]
      const status: StanzaStatus =
        found.score < SAME_WORDS ? 'words' : stanza.chords === other.chords ? 'same' : 'chords'
      return {
        heading: stanza.heading,
        lines: stanza.raw,
        status,
        matched: other.heading,
        similarity: found.score,
      }
    })
  return [mark(left, right, matchA), mark(right, left, matchB)]
}

/**
 * Say how two charts of a song differ, stanza by stanza. The words are compared as a whole (the
 * same words broken into other lines, hyphenated differently or with a typo are the same words),
 * the chords in order as numbers from the key, so a change of key marks nothing.
 */
export function compareCharts(a: string, b: string): ChartComparison {
  const keys: [string | null, string | null] = [keyOfChart(a), keyOfChart(b)]
  const similarity = wordSimilarity(a, b)
  const sameChords = chordSequence(chartLines(a)) === chordSequence(chartLines(b))
  let verdict: ChartVerdict
  if (a.trim() === b.trim()) verdict = 'identical'
  else if (similarity < SAME_WORDS) verdict = 'different-words'
  else if (!sameChords) verdict = 'different-chords'
  else verdict = keys[0] === keys[1] ? 'same-chart' : 'other-key'
  return { verdict, keys, wordSimilarity: similarity, stanzas: compareStanzas(a, b) }
}

/** Words as they are compared: no case, no punctuation, one space between */
function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:!?'"’‘“”()\-–—]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---- the plan ----

/** The same song more than once with the same chart: keep one, remove the rest */
export interface MergeGroup {
  /** The CCLI number, or the title when there is none */
  identity: string
  title: string
  keep: SongRecord
  remove: SongRecord[]
}

/** A song with more than one arrangement, which are different charts and so are all kept */
export interface DistinctArrangements {
  identity: string
  title: string
  /** The number of different charts, each of which may itself be merged */
  arrangements: number
}

export interface MergePlan {
  merges: MergeGroup[]
  distinct: DistinctArrangements[]
}

/** A song's setlist entries use it this many times in all */
export function usageOf(setlists: Setlist[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const setlist of setlists) {
    for (const entry of setlist.songs) {
      if (entry.songUuid) counts.set(entry.songUuid, (counts.get(entry.songUuid) ?? 0) + 1)
    }
  }
  return counts
}

const identityOf = (song: SongRecord): string =>
  song.ccliNumber ? `ccli ${song.ccliNumber}` : `title ${song.titleNormalized}`

/**
 * The one of several records of a chart to keep: the one the setlists use most, else the song's
 * default rather than a variant, else the oldest
 */
function chooseToKeep(records: SongRecord[], usage: Map<string, number>): SongRecord {
  return [...records].sort(
    (a, b) =>
      (usage.get(b.uuid) ?? 0) - (usage.get(a.uuid) ?? 0) ||
      Number(b.isDefault) - Number(a.isDefault) ||
      a.importDate.localeCompare(b.importDate) ||
      a.uuid.localeCompare(b.uuid)
  )[0]
}

/** Which songs are the same chart twice, and which one of each to keep */
export function planMerge(songs: SongWithText[], usage: Map<string, number>): MergePlan {
  const byIdentity = new Map<string, SongWithText[]>()
  for (const entry of songs) {
    const identity = identityOf(entry.song)
    byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), entry])
  }

  const merges: MergeGroup[] = []
  const distinct: DistinctArrangements[] = []
  for (const [identity, members] of byIdentity) {
    if (members.length < 2) continue
    const byChart = new Map<string, SongRecord[]>()
    for (const { song, text } of members) {
      const fingerprint = chartFingerprint(text)
      byChart.set(fingerprint, [...(byChart.get(fingerprint) ?? []), song])
    }
    if (byChart.size > 1) {
      distinct.push({ identity, title: members[0].song.title, arrangements: byChart.size })
    }
    for (const records of byChart.values()) {
      if (records.length < 2) continue
      const keep = chooseToKeep(records, usage)
      merges.push({
        identity,
        title: keep.title,
        keep,
        remove: records.filter(record => record.uuid !== keep.uuid),
      })
    }
  }
  merges.sort((a, b) => a.title.localeCompare(b.title))
  distinct.sort((a, b) => a.title.localeCompare(b.title))
  return { merges, distinct }
}

/** A song whose source is to be set */
export interface SourceChange {
  uuid: string
  title: string
  to: string
  /** Whether the chart has the CCLI material (SongSelect), or does not (written by hand) */
  becauseCcli: boolean
}

/**
 * The sources to set: for each song with none known, SongSelect where its chart has the CCLI
 * material, else the person who wrote it (`writtenBy`). A song with a source is left alone.
 */
export function planSources(songs: SongWithText[], writtenBy: string): SourceChange[] {
  const changes: SourceChange[] = []
  for (const { song, text } of songs) {
    if (songSource(song.importSource)) continue
    const becauseCcli = hasCcliBumph(text)
    changes.push({
      uuid: song.uuid,
      title: song.title,
      to: becauseCcli ? SONGSELECT : writtenBy,
      becauseCcli,
    })
  }
  return changes
}

/** A song whose importer (the person who imported or made it) is to be set */
export interface ImporterChange {
  uuid: string
  title: string
}

/** What an import recorded as its importer before it recorded the real one */
const NO_AUTHOR = new Set(['', 'default-user'])

/**
 * The songs with no importer: imported before the signed-in person was recorded. They are
 * given `writtenBy`, the owner of the library, who imported them. A song with an importer is left alone.
 */
export function planImporters(songs: SongWithText[]): ImporterChange[] {
  return songs
    .filter(({ song }) => NO_AUTHOR.has(song.importUser ?? ''))
    .map(({ song }) => ({ uuid: song.uuid, title: song.title }))
}

/** A song with no CCLI number that is the same song as one that has: folded into it as a variant */
export interface Link {
  fromId: string
  intoId: string
  title: string
}

/**
 * The songs to fold into another: a song with no CCLI number (a hand-made chart) whose title is
 * the title of exactly one song that has one. Two CCLI songs with a title (several songs called
 * "Holy") leave it alone: it is not known which it is.
 */
export function planLinks(songs: SongWithText[]): Link[] {
  const withCcli = new Map<string, Set<string>>()
  const without = new Map<string, SongRecord>()
  for (const { song } of songs) {
    if (song.ccliNumber) {
      withCcli.set(
        song.titleNormalized,
        (withCcli.get(song.titleNormalized) ?? new Set()).add(song.id)
      )
    } else if (!without.has(song.id)) {
      without.set(song.id, song)
    }
  }
  const links: Link[] = []
  for (const song of without.values()) {
    const same = withCcli.get(song.titleNormalized)
    if (same?.size === 1) {
      links.push({ fromId: song.id, intoId: [...same][0], title: song.title })
    }
  }
  return links.sort((a, b) => a.title.localeCompare(b.title))
}

// ---- the library ----

/** What there is to do to a library */
export interface RepairPlan extends MergePlan {
  /** Whether repeated songs are merged (which deletes some); not for a Team's non-admin */
  merging: boolean
  links: Link[]
  importers: ImporterChange[]
  sources: SourceChange[]
  writtenBy: string
  /** How many songs and setlists there are, to say what the plan is of */
  songs: number
  setlists: number
}

/** Read a library and say what repairing it would do. Changes nothing. */
export async function planRepair(
  db: ChordlessDB,
  writtenBy: string,
  { merge = true }: { merge?: boolean } = {}
): Promise<RepairPlan> {
  // (the name goes on every song with no importer or source: blank would leave them as they are)
  if (!writtenBy.trim()) throw new Error('Fill in the name to give the songs: it is blank')
  const records = await db.getAllSongs()
  const songs: SongWithText[] = []
  for (const song of records) {
    songs.push({ song, text: (await db.getChordPro(song.chordproFileId))?.content ?? '' })
  }
  const setlists = await db.getAllSetlists()
  const merging = planMerge(songs, usageOf(setlists))
  return {
    ...merging,
    // (merging deletes songs: where that is not allowed, what would be merged is only reported)
    merges: merge ? merging.merges : [],
    merging: merge,
    links: planLinks(songs),
    importers: planImporters(songs),
    sources: planSources(songs, writtenBy),
    writtenBy,
    songs: records.length,
    setlists: setlists.length,
  }
}

/** What applying a plan did */
export interface RepairReport {
  songsLinked: number
  importersSet: number
  sourcesSet: number
  songsRemoved: number
  setlistsChanged: number
  entriesMoved: number
}

/**
 * Apply a plan: set the sources, then merge. The merged songs are deleted (their Drive files go in
 * the trash at the next sync) and the setlists that used them are changed to use the one kept.
 */
export async function applyRepair(db: ChordlessDB, plan: RepairPlan): Promise<RepairReport> {
  const report: RepairReport = {
    songsLinked: 0,
    importersSet: 0,
    sourcesSet: 0,
    songsRemoved: 0,
    setlistsChanged: 0,
    entriesMoved: 0,
  }
  const now = new Date().toISOString()

  for (const change of plan.importers) {
    const song = await db.getSong(change.uuid)
    if (!song) continue
    await db.saveSong({ ...song, importUser: plan.writtenBy, metadataChangedAt: now })
    report.importersSet++
  }

  for (const change of plan.sources) {
    const song = await db.getSong(change.uuid)
    if (!song) continue
    await db.saveSong({ ...song, importSource: change.to, metadataChangedAt: now })
    report.sourcesSet++
  }

  // The setlists first: nothing should ever point at a song that is not there
  for (const setlist of await db.getAllSetlists()) {
    const moved = moveEntries(setlist, plan.merges)
    if (!moved) continue
    await db.saveSetlist({ ...moved.setlist, modifiedDate: now })
    report.setlistsChanged++
    report.entriesMoved += moved.moved
  }

  for (const group of plan.merges) {
    const gone = new Set(group.remove.map(record => record.uuid))
    for (const record of group.remove) {
      await db.deleteSong(record.uuid)
      report.songsRemoved++
    }
    // What was a variant of a removed record is a variant of the one kept; and if the song has no
    // default left, the one kept is it
    const left = (await db.getAllSongs()).filter(song => song.id === group.keep.id)
    for (const song of left) {
      if (song.variantOf && gone.has(song.variantOf)) {
        await db.saveSong({
          ...song,
          variantOf: song.uuid === group.keep.uuid ? null : group.keep.uuid,
        })
      }
    }
    const kept = await db.getSong(group.keep.uuid)
    const stillDefault = (await db.getAllSongs()).some(
      song => song.id === group.keep.id && song.isDefault
    )
    if (kept && !stillDefault) {
      await db.saveSong({ ...kept, isDefault: true, variantOf: null })
    }
  }
  // Last, so that a song folded into another is not also merged: the records, as they are now
  for (const link of plan.links) {
    if ((await db.getSongVariants(link.fromId)).length === 0) continue
    await linkSong(db, link.fromId, link.intoId)
    report.songsLinked++
  }
  return report
}
