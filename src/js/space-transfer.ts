/**
 * Copying and moving songs and setlists from one space's database to another's (docs/SPACES.md,
 * "Copy and move between spaces"). It works on the local copies only, so it needs no access to
 * either Drive: sync takes what arrives to the destination's Drive like any other change.
 *
 * Re-runnable: what the destination already has is skipped, so running it again brings across
 * only what is new.
 */

import type { Person, Setlist, SetlistEntry, SongRecord } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { findPerson, idFromKey, normalizeEmail, resolvePerson } from './leaders.ts'
import { addChart } from './song-utils.ts'

/**
 * - copy: new setlist ids
 * - move: the ids are kept, and the source's setlist is deleted once it is in the destination
 * - import: the ids are kept and the source is left alone (an export is read from a file)
 */
export type TransferMode = 'copy' | 'move' | 'import'

/** What a transfer reads from: a space's database, or an export file read into memory */
export interface TransferSource {
  getAllSongs(): Promise<SongRecord[]>
  getChordPro(id: string): Promise<{ content: string } | undefined>
  getAllSetlists(): Promise<Setlist[]>
  /** The people who lead the setlists */
  getAllPeople(): Promise<Person[]>
  /** Only a move deletes from the source */
  deleteUnsyncedSetlist?(id: string): Promise<void>
}

/** What a transfer did, for the user to be told */
export interface TransferReport {
  songsAdded: number
  /** Charts the destination already had */
  songsSkipped: number
  setlistsAdded: number
  /** Setlists the destination already had (the same id for a move, the same content for a copy) */
  setlistsSkipped: number
  /** Setlist entries whose song is not in the source, so they point at nothing in the destination */
  entriesWithoutSong: number
  /**
   * A move removes the setlist from the source, but a setlist that is in Drive can't be deleted
   * yet (docs/SYNC_ARCHITECTURE.md, "Deleting setlists"): those stay in the source, counted here
   */
  setlistsLeftInSource: number
}

export function emptyReport(): TransferReport {
  return {
    songsAdded: 0,
    songsSkipped: 0,
    setlistsAdded: 0,
    setlistsSkipped: 0,
    entriesWithoutSong: 0,
    setlistsLeftInSource: 0,
  }
}

/** A song's uuid in the source, and the uuid of the same chart in the destination */
type SongMap = Map<string, string>

/** Songs with each song's default variant before its other variants, so the default stays so */
function defaultsFirst(songs: SongRecord[]): SongRecord[] {
  return [...songs].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

/**
 * Copy songs (all of the source's, or only these uuids) into the destination: the same chart is
 * never added twice (by content hash), and a chart of a song the destination has in another
 * form arrives as a variant of it. Nothing is changed in the source.
 * @returns the destination's uuid for each source uuid copied or already there
 */
export async function copySongs(
  source: TransferSource,
  destination: ChordlessDB,
  uuids: string[] | null,
  report: TransferReport = emptyReport()
): Promise<SongMap> {
  const wanted = uuids && new Set(uuids)
  const songs = defaultsFirst(
    (await source.getAllSongs()).filter(song => !wanted || wanted.has(song.uuid))
  )
  const known = new Set((await destination.getAllSongs()).map(song => song.contentHash))
  const map: SongMap = new Map()
  for (const song of songs) {
    const chordpro = await source.getChordPro(song.chordproFileId)
    if (!chordpro) continue
    const isNew = !known.has(song.contentHash)
    const added = await addChart(destination, chordpro.content, {
      variantLabel: song.variantLabel || 'Copied',
      // (a copy keeps where the song came from, and when: not that it was copied)
      importSource: song.importSource,
      importDate: song.importDate,
      importUser: song.importUser,
      sourceUrl: song.sourceUrl,
      makeDefault: 'first',
      title: song.title,
    })
    map.set(song.uuid, added.uuid)
    if (!isNew) {
      report.songsSkipped++
      continue
    }
    known.add(added.contentHash)
    report.songsAdded++
    // The library's own key and tempo for the song, saved on it apart from the chart
    if (added.key !== song.key || added.tempo !== song.tempo) {
      await destination.saveSong({ ...added, key: song.key, tempo: song.tempo })
    }
  }
  return map
}

/** The setlist as the destination gets it: its content, with nothing of the source's Drive */
function forDestination(
  setlist: Setlist,
  id: string,
  songs: SongMap,
  leaderId: string | null
): Setlist {
  const entries: SetlistEntry[] = setlist.songs.map(entry => ({
    ...entry,
    songUuid: songs.get(entry.songUuid) ?? entry.songUuid,
  }))
  const {
    fileRef: _driveFileId,
    fileModified: _driveModifiedTime,
    fileRev: _driveChecksum,
    lastSyncedAt: _lastSyncedAt,
    syncedContentHash: _syncedContentHash,
    _lastSyncHash,
    share: _share,
    received: _received,
    leaderId: _leaderId,
    ...content
  } = setlist
  return { ...content, id, songs: entries, ...(leaderId ? { leaderId } : {}) }
}

/**
 * Who leads in the destination: the person there for a leader of the source, by email, else by
 * name, else made (people are the space's own, so an id is never carried across: docs/IDENTITIES.md).
 * `save()` stores the people made so far.
 */
async function leaderMapper(source: TransferSource, destination: ChordlessDB) {
  const sourcePeople = await source.getAllPeople()
  const destinationPeople = await destination.getAllPeople()
  const made: Person[] = []
  const mapped = new Map<string, string>()
  const map = (leaderId: string | null | undefined): string | null => {
    const person = resolvePerson(sourcePeople, leaderId)
    if (!person) return null
    const cached = mapped.get(person.id)
    if (cached) return cached
    const there =
      person.emails
        .map(email => findPerson([...destinationPeople, ...made], { email }))
        .find(Boolean) ?? findPerson([...destinationPeople, ...made], { name: person.name })
    let id = there?.id
    if (!id) {
      const email = normalizeEmail(person.emails[0])
      const created: Person = {
        id: idFromKey(email ? `email:${email}` : `name:${person.name.toLowerCase()}`),
        name: person.name,
        emails: person.emails,
        modifiedDate: new Date().toISOString(),
      }
      made.push(created)
      id = created.id
    }
    mapped.set(person.id, id)
    return id
  }
  map.save = async () => {
    await destination.addPeople(made)
  }
  return map
}

/** Whether two setlists are the same event with the same songs, whatever their ids */
function sameSetlist(a: Setlist, b: Setlist): boolean {
  const key = (setlist: Setlist) =>
    JSON.stringify([
      setlist.date,
      setlist.time,
      setlist.type,
      setlist.name,
      setlist.songs.map(entry => [entry.songUuid, entry.key]),
    ])
  return key(a) === key(b)
}

/**
 * Copy or move setlists (all of the source's, or only these ids), with the songs they use.
 * - copy: new ids, and a setlist the destination has already (same event, same songs) is skipped
 * - move: the ids are kept, a setlist whose id the destination has is skipped, and the source's
 *   copy (with this device's state for it) is deleted once it is in the destination. One that
 *   is in Drive can't be deleted yet, so it stays (see the report).
 */
export async function transferSetlists(
  source: TransferSource,
  destination: ChordlessDB,
  ids: string[] | null,
  mode: TransferMode,
  report: TransferReport = emptyReport()
): Promise<TransferReport> {
  const wanted = ids && new Set(ids)
  const setlists = (await source.getAllSetlists()).filter(
    setlist => !setlist.deletedAt && (!wanted || wanted.has(setlist.id)) && !setlist.received
  )
  const uuids = new Set(setlists.flatMap(setlist => setlist.songs.map(entry => entry.songUuid)))
  const songs = await copySongs(source, destination, [...uuids], report)
  const sourceSongs = new Set((await source.getAllSongs()).map(song => song.uuid))

  const existing = await destination.getAllSetlists()
  const leaders = await leaderMapper(source, destination)
  for (const setlist of setlists) {
    for (const entry of setlist.songs) {
      if (!sourceSongs.has(entry.songUuid)) report.entriesWithoutSong++
    }
    const made = forDestination(
      setlist,
      mode === 'copy' ? crypto.randomUUID() : setlist.id,
      songs,
      leaders(setlist.leaderId)
    )
    const alreadyThere =
      mode !== 'copy'
        ? existing.some(other => other.id === made.id)
        : existing.some(other => sameSetlist(other, made))
    if (alreadyThere) {
      report.setlistsSkipped++
      continue
    }
    await leaders.save()
    await destination.saveSetlist(made)
    existing.push(made)
    report.setlistsAdded++
    if (mode === 'move') {
      if (setlist.fileRef || !source.deleteUnsyncedSetlist) report.setlistsLeftInSource++
      else await source.deleteUnsyncedSetlist(setlist.id)
    }
  }
  return report
}

/**
 * A whole space into another: its setlists and every song of it, including the songs no
 * setlist uses. Copy or move (a move moves the setlists; songs are always copied, as a song
 * deleted from a synced library would come back, see docs/SYNC_ARCHITECTURE.md).
 */
export async function transferSpace(
  source: TransferSource,
  destination: ChordlessDB,
  mode: TransferMode
): Promise<TransferReport> {
  const report = emptyReport()
  await copySongs(source, destination, null, report)
  // The songs are in; the setlists find them as already there
  const songsBefore = { added: report.songsAdded, skipped: report.songsSkipped }
  await transferSetlists(source, destination, null, mode, report)
  // transferSetlists counts its songs again, all as skipped now: keep the first count
  report.songsAdded = songsBefore.added
  report.songsSkipped = songsBefore.skipped
  return report
}

/** How much of something a space holds: its count, and about how many bytes it is */
export interface Amount {
  count: number
  bytes: number
}

/** What a space holds that can be brought into another */
export interface Contents {
  songs: Amount
  setlists: Amount
}

/** The setlists that are the space's own to bring: not deleted, not received by a share link */
const bringable = (setlist: Setlist): boolean => !setlist.deletedAt && !setlist.received

/** What there is to bring from a space, and how big it is (the charts' text, the setlists' JSON) */
export async function contentsOf(source: TransferSource): Promise<Contents> {
  const songs: Amount = { count: 0, bytes: 0 }
  for (const song of await source.getAllSongs()) {
    const chordpro = await source.getChordPro(song.chordproFileId)
    if (!chordpro) continue
    songs.count++
    songs.bytes += new Blob([chordpro.content]).size
  }
  const setlists: Amount = { count: 0, bytes: 0 }
  for (const setlist of (await source.getAllSetlists()).filter(bringable)) {
    setlists.count++
    setlists.bytes += new Blob([JSON.stringify(setlist)]).size
  }
  return { songs, setlists }
}

/**
 * What bringing a space's contents into another would add: songs the destination has no chart of
 * (by content hash) and setlists it has no setlist with the id of. Counts only, nothing is changed.
 */
export async function whatWouldBeAdded(
  source: TransferSource,
  destination: TransferSource
): Promise<{ songs: number; setlists: number }> {
  const known = new Set((await destination.getAllSongs()).map(song => song.contentHash))
  let songs = 0
  for (const song of await source.getAllSongs()) {
    if (known.has(song.contentHash)) continue
    // (a chart with no text is not brought, so is not counted)
    if (await source.getChordPro(song.chordproFileId)) songs++
  }
  const have = new Set((await destination.getAllSetlists()).map(setlist => setlist.id))
  const setlists = (await source.getAllSetlists()).filter(
    setlist => bringable(setlist) && !have.has(setlist.id)
  ).length
  return { songs, setlists }
}

/** What to bring into a new space (the wizard's step, docs/SPACES.md "Creating a team space") */
export interface Bring {
  songs: boolean
  setlists: boolean
  /**
   * What happens to the setlists. Songs are always copied: a song deleted from a synced library
   * would come back (docs/SYNC_ARCHITECTURE.md), so there is no moving them yet.
   */
  mode: 'copy' | 'move'
}

/**
 * Bring a space's songs and/or setlists into another. The setlists come with the songs they use,
 * whether or not all the songs were asked for. Re-runnable: what is there is skipped.
 */
export function bringAcross(
  source: TransferSource,
  destination: ChordlessDB,
  { songs, setlists, mode }: Bring
): Promise<TransferReport> {
  if (songs && setlists) return transferSpace(source, destination, mode)
  if (setlists) return transferSetlists(source, destination, null, mode, emptyReport())
  if (songs) {
    const report = emptyReport()
    return copySongs(source, destination, null, report).then(() => report)
  }
  return Promise.resolve(emptyReport())
}
