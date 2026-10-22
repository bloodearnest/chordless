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

import type { Setlist, SetlistEntry, SongRecord } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { songSource } from './song-source.ts'
import { convertChordToNashville } from './transpose.ts'

/** The source of a chart with SongSelect's material on it */
export const SONGSELECT = 'songselect'

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
  const key = keyOfChart(chordpro)
  const lines: string[] = []
  for (const raw of chordpro.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // (everything from the CCLI Song # line on is the trailer)
    if (/^CCLI Song #/i.test(line)) break
    const directive = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*(.*)$/i.exec(line)
    if (directive) {
      const name = directive[1].toLowerCase()
      if (ABOUT_THE_SONG.has(name)) continue
      lines.push(`{${name}:${plain(directive[2] ?? '')}} ${plain(directive[3])}`.trim())
      continue
    }
    lines.push(
      line
        .split(/(\[[^\]]*\])/)
        .map(part => {
          const chord = /^\[([^\]]*)\]$/.exec(part)
          return chord ? `[${convertChordToNashville(chord[1], key)}]` : plain(part)
        })
        .join('')
        .replace(/\s*(\[[^\]]*\])\s*/g, '$1')
        .trim()
    )
  }
  return lines.join('\n')
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

// ---- the library ----

/** What there is to do to a library */
export interface RepairPlan extends MergePlan {
  sources: SourceChange[]
  writtenBy: string
  /** How many songs and setlists there are, to say what the plan is of */
  songs: number
  setlists: number
}

/** Read a library and say what repairing it would do. Changes nothing. */
export async function planRepair(db: ChordlessDB, writtenBy: string): Promise<RepairPlan> {
  const records = await db.getAllSongs()
  const songs: SongWithText[] = []
  for (const song of records) {
    songs.push({ song, text: (await db.getChordPro(song.chordproFileId))?.content ?? '' })
  }
  const setlists = await db.getAllSetlists()
  return {
    ...planMerge(songs, usageOf(setlists)),
    sources: planSources(songs, writtenBy),
    writtenBy,
    songs: records.length,
    setlists: setlists.length,
  }
}

/** What applying a plan did */
export interface RepairReport {
  sourcesSet: number
  songsRemoved: number
  setlistsChanged: number
  entriesMoved: number
}

/** The key a song is shown in when nothing else says: its own, else the chart's */
const showsKey = (song: SongRecord): string | null => song.key || song.originalKey || null

/** The setlist's entries moved from the removed songs to the one kept, keeping what they showed */
function moveEntries(
  setlist: Setlist,
  merges: MergeGroup[]
): { setlist: Setlist; moved: number } | null {
  const removed = new Map<string, MergeGroup>()
  for (const group of merges) {
    for (const record of group.remove) removed.set(record.uuid, group)
  }
  let moved = 0
  const songs = setlist.songs.map((entry): SetlistEntry => {
    const group = removed.get(entry.songUuid)
    if (!group) return entry
    const gone = group.remove.find(record => record.uuid === entry.songUuid) as SongRecord
    moved++
    return {
      ...entry,
      songUuid: group.keep.uuid,
      songId: group.keep.id,
      // (an entry that used the removed song's own key or tempo keeps showing them)
      key: entry.key || (showsKey(gone) !== showsKey(group.keep) ? showsKey(gone) : null),
      tempo: entry.tempo ?? (gone.tempo !== group.keep.tempo ? gone.tempo : null),
    }
  })
  return moved > 0 ? { setlist: { ...setlist, songs }, moved } : null
}

/**
 * Apply a plan: set the sources, then merge. The merged songs are deleted (their Drive files go in
 * the trash at the next sync) and the setlists that used them are changed to use the one kept.
 */
export async function applyRepair(db: ChordlessDB, plan: RepairPlan): Promise<RepairReport> {
  const report: RepairReport = {
    sourcesSet: 0,
    songsRemoved: 0,
    setlistsChanged: 0,
    entriesMoved: 0,
  }
  const now = new Date().toISOString()

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
  return report
}
