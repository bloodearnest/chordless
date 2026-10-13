/**
 * Making a setlist from a reviewed email: the songs the person confirmed, all of them in the
 * library, and the setlist with its details. The page that reviews the email is
 * components/setlist-email-import.ts; what it decides is passed in here.
 */
import type { Setlist, SongRecord, SongWithContent } from './data-types.ts'
import { type ChordlessDB, createSetlist } from './db.ts'
import type { ImportedSong } from './email-setlist.ts'
import { type LibrarySong, lyricsOf } from './import-plan.ts'
import { addToLibrary } from './other-songs.ts'

/** The words of charts already read, by chart and its content: a chart is read once */
export type LyricsCache = Map<string, string>

/**
 * The library's songs for matching: one for each song, its default variant if it has several,
 * with the words of its chart (for finding a song by a line of it). Then the songs of the other
 * databases the library does not have (a song it has is its own, whatever the others hold): they
 * are matched like the rest, and copied into the library when the setlist is made.
 */
export async function libraryForMatching(
  db: ChordlessDB,
  cache: LyricsCache = new Map(),
  elsewhere: SongWithContent[] = []
): Promise<LibrarySong[]> {
  const byId = new Map<string, SongRecord>()
  for (const record of await db.getAllSongs()) {
    if (record.isDefault || !byId.has(record.id)) byId.set(record.id, record)
  }
  const library: LibrarySong[] = []
  for (const record of byId.values()) {
    const key = `${record.chordproFileId}:${record.contentHash}`
    let lyrics = cache.get(key)
    if (lyrics === undefined) {
      lyrics = lyricsOf((await db.getChordPro(record.chordproFileId))?.content ?? '')
      cache.set(key, lyrics)
    }
    library.push({
      uuid: record.uuid,
      id: record.id,
      title: record.title,
      ccli: record.ccliNumber,
      lyrics,
    })
  }
  for (const song of elsewhere) {
    if (byId.has(song.id)) continue
    library.push({
      uuid: song.uuid,
      id: song.id,
      title: song.title,
      ccli: song.ccliNumber,
      lyrics: lyricsOf(song.chordpro),
      ...(song.source ? { source: song.source } : {}),
    })
  }
  return library
}

/**
 * Songs of the library for a reviewed list: a song that is another database's is copied into the
 * library first (as adding it from the library's search does), and the setlist uses the copy
 */
export async function copyFromElsewhere(
  db: ChordlessDB,
  reviewed: ReviewedSong[],
  elsewhere: SongWithContent[]
): Promise<ReviewedSong[]> {
  const copies = new Map<string, LibrarySong>()
  const result: ReviewedSong[] = []
  for (const each of reviewed) {
    const { library } = each
    if (!library.source) {
      result.push(each)
      continue
    }
    let copy = copies.get(library.uuid)
    if (!copy) {
      const original = elsewhere.find(song => song.uuid === library.uuid)
      if (!original) throw new Error(`${library.title} is no longer in ${library.source.label}`)
      const added = await addToLibrary(original, db)
      copy = { uuid: added.uuid, id: added.id, title: added.title, ccli: added.ccliNumber }
      copies.set(library.uuid, copy)
    }
    result.push({ ...each, library: copy })
  }
  return result
}

/** A song the person has settled on: a song of the library, with the key and note for this setlist */
export interface ReviewedSong {
  song: ImportedSong
  /** The key to play it in */
  key: string | null
  notes: string
  /** The library's song it is */
  library: LibrarySong
}

/** Save the setlist, with these songs in this order */
export async function createImportedSetlist(
  db: ChordlessDB,
  details: Parameters<typeof createSetlist>[0],
  reviewed: ReviewedSong[]
): Promise<Setlist> {
  const setlist = createSetlist(details)
  setlist.songs = reviewed.map(({ song, key, notes, library }, order) => ({
    order,
    songId: library.id,
    songUuid: library.uuid,
    key,
    tempo: song.tempo,
    notes,
  }))
  await db.saveSetlist(setlist)
  return setlist
}

// ==================== Updating a setlist that is there already ====================

/** What the email would change in a setlist that has its date already */
export interface SetlistChanges {
  /** Titles of songs the setlist does not have */
  added: string[]
  /** Songs the setlist has and the email does not: left out of the update unless kept */
  removed: { songId: string; title: string }[]
  /** Songs in both whose key the email changes */
  keys: { title: string; from: string | null; to: string }[]
  /** The songs in both are in another order */
  reordered: boolean
}

/** The setlist's own songs, as the reviewed ones relate to them */
export function changesTo(
  existing: Setlist,
  reviewed: ReviewedSong[],
  titleOf: (songId: string) => string
): SetlistChanges {
  const had = new Map(existing.songs.map(entry => [entry.songId, entry]))
  const now = new Set(reviewed.map(each => each.library.id))
  const common = (ids: string[], other: Set<string> | Map<string, unknown>) =>
    ids.filter(id => other.has(id))
  const ordered = [...existing.songs].sort((a, b) => a.order - b.order).map(entry => entry.songId)
  return {
    added: reviewed.filter(each => !had.has(each.library.id)).map(each => each.library.title),
    removed: ordered.filter(id => !now.has(id)).map(songId => ({ songId, title: titleOf(songId) })),
    keys: reviewed.flatMap(each => {
      const entry = had.get(each.library.id)
      return entry && each.key && each.key !== entry.key
        ? [{ title: each.library.title, from: entry.key, to: each.key }]
        : []
    }),
    reordered:
      common(ordered, now).join() !==
      common(
        reviewed.map(each => each.library.id),
        had
      ).join(),
  }
}

/** Does the update change anything? */
export const hasChanges = (changes: SetlistChanges): boolean =>
  Boolean(
    changes.added.length || changes.removed.length || changes.keys.length || changes.reordered
  )

/**
 * Change a setlist to the reviewed songs, in the email's order. A song it already had keeps what
 * the setlist knows of it (its edits to the chart, its tempo) and takes the email's key and note
 * where the email gives one. Songs only the setlist had are dropped, unless their ids are in
 * `keep`: those go at the end. Its date, name, time and leader are left as they are.
 */
export async function updateImportedSetlist(
  db: ChordlessDB,
  existing: Setlist,
  reviewed: ReviewedSong[],
  keep: ReadonlySet<string> = new Set()
): Promise<Setlist> {
  const had = new Map(existing.songs.map(entry => [entry.songId, entry]))
  const now = new Set(reviewed.map(each => each.library.id))
  const songs = reviewed.map(({ song, key, notes, library }) => {
    const entry = had.get(library.id)
    return {
      ...entry,
      songId: library.id,
      songUuid: entry?.songUuid ?? library.uuid,
      key: key ?? entry?.key ?? null,
      tempo: song.tempo ?? entry?.tempo ?? null,
      notes: notes || entry?.notes || '',
    }
  })
  const kept = [...existing.songs]
    .sort((a, b) => a.order - b.order)
    .filter(entry => !now.has(entry.songId) && keep.has(entry.songId))
  const updated: Setlist = {
    ...existing,
    songs: [...songs, ...kept].map((entry, order) => ({ ...entry, order })),
    modifiedDate: new Date().toISOString(),
  }
  await db.saveSetlist(updated)
  return updated
}
