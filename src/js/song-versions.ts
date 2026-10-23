/**
 * The versions of a song (docs/VARIANTS.md): its variants, which one is the default, what each is
 * called, folding one song into another as a variant of it, and deleting a variant. Each change
 * marks the songs it touches as changed, for the next sync to send.
 */

import type { Setlist, SetlistEntry, SongRecord } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { ChordProParser } from './parser.ts'
import { SONGSELECT, songSource } from './song-source.ts'
import {
  type ChartIdentity,
  moveToIdentity,
  overwriteSong,
  setDefaultVariant,
} from './song-utils.ts'

/** Songs to be replaced by one that is kept: the setlists that used them use it */
export interface Replacement {
  keep: SongRecord
  remove: SongRecord[]
}

/** The details of a song that its chart says, as directives, and another chart can be given */
export const DETAILS = ['artist', 'copyright', 'tempo', 'time'] as const
export type Details = Partial<Record<(typeof DETAILS)[number], string>>

/** The details a chart gives: who wrote it, its copyright, tempo and time signature */
export function detailsOf(chordpro: string): Details {
  const { metadata } = new ChordProParser().parse(chordpro)
  const found: Details = {}
  for (const name of DETAILS) {
    const value = String(
      (name === 'artist' ? metadata.artist || metadata.author : metadata[name]) ?? ''
    ).trim()
    if (value) found[name] = value
  }
  return found
}

/** Details as they are compared: the same whatever the spacing and case */
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The directive that says a detail (who wrote it may be said by `artist` or `author`) */
const directive = (name: (typeof DETAILS)[number]) =>
  new RegExp(`^\\s*\\{\\s*(?:${name === 'artist' ? 'artist|author' : name})\\s*:.*\\}\\s*$`, 'i')

/**
 * The chart with these details: one it has already is given the new value, one it lacks is added
 * as a directive under the title line (or at the top when there is none)
 */
export function withDetails(chordpro: string, details: Details): string {
  const lines = chordpro.split('\n')
  const added: string[] = []
  for (const name of DETAILS) {
    if (!details[name]) continue
    const line = `{${name}: ${details[name]}}`
    const at = lines.findIndex(each => directive(name).test(each))
    if (at >= 0) lines[at] = line
    else added.push(line)
  }
  const title = lines.findIndex(line => /^\s*\{\s*title\s*:/i.test(line))
  lines.splice(title + 1, 0, ...added)
  return lines.join('\n')
}

/** The details a song's chart gives (none if it has no chart) */
async function chartDetails(db: ChordlessDB, uuid: string): Promise<Details> {
  const song = await db.getSong(uuid)
  const chart = song && (await db.getChordPro(song.chordproFileId))
  return chart ? detailsOf(chart.content) : {}
}

/**
 * Give a chart the details it lacks from `from`; with `overwrite`, also replace the ones it has
 * that differ. Whether it was changed.
 */
async function giveDetails(
  db: ChordlessDB,
  uuid: string,
  from: Details,
  overwrite: boolean
): Promise<boolean> {
  const song = await db.getSong(uuid)
  const chart = song && (await db.getChordPro(song.chordproFileId))
  if (!song || !chart) return false
  const have = detailsOf(chart.content)
  const changes: Details = {}
  for (const name of DETAILS) {
    const given = from[name]
    if (!given) continue
    const there = have[name]
    if (!there || (overwrite && !same(there, given))) changes[name] = given
  }
  if (!Object.keys(changes).length) return false
  await overwriteSong(uuid, withDetails(chart.content, changes), db)
  return true
}

/** What an unnamed version is called */
const ORIGINAL = 'Original'

/** The variants of a song: the default first, then the oldest first */
export async function variantsOf(db: ChordlessDB, songId: string): Promise<SongRecord[]> {
  return (await db.getSongVariants(songId)).sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.importDate.localeCompare(b.importDate)
  )
}

/** Make one variant the song's default (the one the library and a new setlist entry use) */
export async function makeDefault(db: ChordlessDB, uuid: string): Promise<void> {
  await setDefaultVariant(uuid, db)
}

/** Change what a variant is called (empty is "Original") */
export async function renameVariant(
  db: ChordlessDB,
  uuid: string,
  label: string
): Promise<SongRecord> {
  const song = await db.getSong(uuid)
  if (!song) throw new Error(`Song not found: ${uuid}`)
  const now = new Date().toISOString()
  return db.saveSong({
    ...song,
    variantLabel: label.trim() || ORIGINAL,
    modifiedDate: now,
    metadataChangedAt: now,
  })
}

/**
 * Fold a song into another as variants of it, for the same song under two ids (a hand-made chart
 * with no CCLI number, and the one with it). Every variant of `fromSongId` takes the identity of
 * `intoSongId` (its id, CCLI number and title); the one that was its default becomes a variant of
 * the other's default, called `label`, else what it was called, else "Alternate". Setlists keep
 * using the same songs. With `fillGaps`, the two defaults share the details (artist, copyright,
 * tempo, time) their charts give: each fills what the other lacks, and one that is there is not
 * changed. But where one is from SongSelect, which is the authority on them, its chart is never
 * changed, and the other is given its details, replacing any that differ.
 */
export async function linkSong(
  db: ChordlessDB,
  fromSongId: string,
  intoSongId: string,
  label = '',
  { fillGaps = true }: { fillGaps?: boolean } = {}
): Promise<void> {
  if (fromSongId === intoSongId) throw new Error('A song cannot be folded into itself')
  const into = await variantsOf(db, intoSongId)
  const from = await variantsOf(db, fromSongId)
  if (!into.length || !from.length) throw new Error('Song not found')
  const target = into[0]
  const now = new Date().toISOString()
  const identity: ChartIdentity = {
    id: target.id,
    ccliNumber: target.ccliNumber,
    title: target.title,
    titleNormalized: target.titleNormalized,
  }
  await moveToIdentity(db, fromSongId, identity, now)
  const wasDefault = from[0]
  const called =
    label.trim() || (wasDefault.variantLabel !== ORIGINAL && wasDefault.variantLabel) || 'Alternate'
  await db.saveSong({
    ...((await db.getSong(wasDefault.uuid)) as SongRecord),
    isDefault: false,
    variantOf: target.uuid,
    variantLabel: called,
    modifiedDate: now,
    metadataChangedAt: now,
  })
  if (fillGaps) {
    const fromDetails = await chartDetails(db, wasDefault.uuid)
    const intoDetails = await chartDetails(db, target.uuid)
    const fromOfficial = songSource(wasDefault.importSource) === SONGSELECT
    const intoOfficial = songSource(target.importSource) === SONGSELECT
    if (fromOfficial !== intoOfficial) {
      // SongSelect is the authority: its chart is left as it is, and the other is given its details,
      // replacing any that differ
      await giveDetails(
        db,
        fromOfficial ? target.uuid : wasDefault.uuid,
        fromOfficial ? fromDetails : intoDetails,
        true
      )
    } else {
      await giveDetails(db, wasDefault.uuid, intoDetails, false)
      await giveDetails(db, target.uuid, fromDetails, false)
    }
  }
  // (a variant that was set apart from the song's default stays so; only the default hangs on it)
  for (const variant of from.slice(1)) {
    await db.saveSong({
      ...((await db.getSong(variant.uuid)) as SongRecord),
      isDefault: false,
      metadataChangedAt: now,
    })
  }
}

/**
 * Delete a variant. The setlists that use it use the song's default instead (keeping the key and
 * tempo they showed); if it was the default, the oldest other variant becomes it. A song's only
 * version is not deleted here. Its Drive file goes in the trash at the next sync.
 * @returns the variant the song falls back to
 */
export async function deleteVariant(db: ChordlessDB, uuid: string): Promise<SongRecord> {
  const song = await db.getSong(uuid)
  if (!song) throw new Error(`Song not found: ${uuid}`)
  const others = (await variantsOf(db, song.id)).filter(variant => variant.uuid !== uuid)
  if (!others.length) throw new Error('A song needs at least one version')
  const keep = others[0]
  const now = new Date().toISOString()
  for (const setlist of await db.getAllSetlists()) {
    const moved = moveEntries(setlist, [{ keep, remove: [song] }])
    if (moved) await db.saveSetlist({ ...moved.setlist, modifiedDate: now })
  }
  await db.deleteSong(uuid)
  for (const variant of others) {
    const fresh = (await db.getSong(variant.uuid)) as SongRecord
    const wasDefault = variant.uuid === keep.uuid && song.isDefault
    const reparent = fresh.variantOf === uuid
    if (!wasDefault && !reparent) continue
    await db.saveSong({
      ...fresh,
      ...(wasDefault ? { isDefault: true, variantOf: null } : {}),
      ...(reparent && !wasDefault ? { variantOf: keep.uuid } : {}),
      metadataChangedAt: now,
    })
  }
  return (await db.getSong(keep.uuid)) as SongRecord
}

/** The key a song is shown in when nothing else says: its own, else the chart's */
const showsKey = (song: SongRecord): string | null => song.key || song.originalKey || null

/** The setlist's entries moved from the removed songs to the one kept, keeping what they showed */
export function moveEntries(
  setlist: Setlist,
  replacements: Replacement[]
): { setlist: Setlist; moved: number } | null {
  const removed = new Map<string, Replacement>()
  for (const group of replacements) {
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

/** How many setlists a song (one of its versions) is in */
export async function setlistsUsing(db: ChordlessDB, uuid: string): Promise<number> {
  return (await db.getAllSetlists()).filter(setlist =>
    setlist.songs.some(entry => entry.songUuid === uuid)
  ).length
}

/**
 * Delete a song's only version, which is the song: it is taken out of the setlists that have it
 * (the entries after it close up), and its Drive file goes in the trash at the next sync. A
 * version with others is deleted with deleteVariant, which keeps the song.
 * @returns how many setlists it was taken out of
 */
export async function deleteOnlyVersion(db: ChordlessDB, uuid: string): Promise<number> {
  const song = await db.getSong(uuid)
  if (!song) throw new Error(`Song not found: ${uuid}`)
  if ((await db.getSongVariants(song.id)).length > 1) {
    throw new Error('The song has other versions: delete this one as a version')
  }
  const now = new Date().toISOString()
  let changed = 0
  for (const setlist of await db.getAllSetlists()) {
    const songs = setlist.songs.filter(entry => entry.songUuid !== uuid)
    if (songs.length === setlist.songs.length) continue
    await db.saveSetlist({
      ...setlist,
      songs: songs.map((entry, order) => ({ ...entry, order })),
      modifiedDate: now,
    })
    changed++
  }
  await db.deleteSong(uuid)
  return changed
}
