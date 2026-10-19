/**
 * Copying and moving songs and setlists from one space's database to another's (docs/SPACES.md,
 * "Copy and move between spaces"). It works on the local copies only, so it needs no access to
 * either Drive: sync takes what arrives to the destination's Drive like any other change.
 *
 * Re-runnable: what the destination already has is skipped, so running it again brings across
 * only what is new.
 */

import type { Setlist, SetlistEntry, SongRecord } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
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
  report: TransferReport = emptyReport(),
  importSource = 'copy'
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
      importSource,
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
function forDestination(setlist: Setlist, id: string, songs: SongMap): Setlist {
  const entries: SetlistEntry[] = setlist.songs.map(entry => ({
    ...entry,
    songUuid: songs.get(entry.songUuid) ?? entry.songUuid,
  }))
  const {
    driveFileId: _driveFileId,
    driveModifiedTime: _driveModifiedTime,
    driveChecksum: _driveChecksum,
    lastSyncedAt: _lastSyncedAt,
    syncedContentHash: _syncedContentHash,
    _lastSyncHash,
    share: _share,
    received: _received,
    ...content
  } = setlist
  return { ...content, id, songs: entries }
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
  report: TransferReport = emptyReport(),
  importSource = 'copy'
): Promise<TransferReport> {
  const wanted = ids && new Set(ids)
  const setlists = (await source.getAllSetlists()).filter(
    setlist => !setlist.deletedAt && (!wanted || wanted.has(setlist.id)) && !setlist.received
  )
  const uuids = new Set(setlists.flatMap(setlist => setlist.songs.map(entry => entry.songUuid)))
  const songs = await copySongs(source, destination, [...uuids], report, importSource)
  const sourceSongs = new Set((await source.getAllSongs()).map(song => song.uuid))

  const existing = await destination.getAllSetlists()
  for (const setlist of setlists) {
    for (const entry of setlist.songs) {
      if (!sourceSongs.has(entry.songUuid)) report.entriesWithoutSong++
    }
    const made = forDestination(setlist, mode === 'copy' ? crypto.randomUUID() : setlist.id, songs)
    const alreadyThere =
      mode !== 'copy'
        ? existing.some(other => other.id === made.id)
        : existing.some(other => sameSetlist(other, made))
    if (alreadyThere) {
      report.setlistsSkipped++
      continue
    }
    await destination.saveSetlist(made)
    existing.push(made)
    report.setlistsAdded++
    if (mode === 'move') {
      if (setlist.driveFileId || !source.deleteUnsyncedSetlist) report.setlistsLeftInSource++
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
  mode: TransferMode,
  importSource = 'copy'
): Promise<TransferReport> {
  const report = emptyReport()
  await copySongs(source, destination, null, report, importSource)
  // The songs are in; the setlists find them as already there
  const songsBefore = { added: report.songsAdded, skipped: report.songsSkipped }
  await transferSetlists(source, destination, null, mode, report, importSource)
  // transferSetlists counts its songs again, all as skipped now: keep the first count
  report.songsAdded = songsBefore.added
  report.songsSkipped = songsBefore.skipped
  return report
}
