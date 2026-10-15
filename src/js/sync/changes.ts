/**
 * Whether a record has changes that are not in Drive, and what a record keeps of its Drive
 * file. No state: the sync's pull, push and reset all ask.
 */
import type { ChordProRecord, DriveFile, Setlist, SongRecord } from '../data-types.ts'
import { hashText } from '../utils/hash.ts'
import { md5Hex } from '../utils/md5.ts'
import { setlistContentHash } from './setlist-hash.ts'

/** The id of the setlist a Drive file holds: from its properties, or its name (`<id>.json`) */
export function setlistIdOf(file: DriveFile): string {
  return file.appProperties?.setlistId || (file.name ?? '').replace('.json', '')
}

/** The id a song's Drive file is known by */
export function songUuidOf(song: Pick<SongRecord, 'uuid' | 'id'>): string {
  return song.uuid || song.id
}

/** What a record keeps of its Drive file: when it was modified, and its checksum */
export function driveMarkers(file: DriveFile | null | undefined) {
  return { driveModifiedTime: file?.modifiedTime ?? null, driveChecksum: file?.md5Checksum ?? null }
}

/** What makes two setlist records the same setlist, whatever their ids */
export const setlistKey = (setlist: Setlist) =>
  [setlist.date, setlist.time, setlist.owner, setlist.type, setlist.name].join('|')

/**
 * Whether a setlist has local changes that aren't in Drive: never uploaded,
 * or edited since its last sync. Ignores whether its Drive file still exists.
 */
export function setlistHasLocalChanges(setlist: Setlist): boolean {
  if (!setlist.driveFileId) {
    return true
  }
  if (setlist.syncedContentHash) {
    return setlistContentHash(setlist) !== setlist.syncedContentHash
  }
  // Synced before content hashes were recorded: fall back to timestamps,
  // both from this device's clock
  const lastSynced = setlist.lastSyncedAt ? new Date(setlist.lastSyncedAt) : new Date(0)
  return new Date(setlist.modifiedDate) > lastSynced
}

/**
 * Whether a song has local changes that aren't in Drive: never uploaded, or
 * its chart edited since its last sync. Ignores whether its Drive file exists.
 */
export function songHasLocalChanges(song: SongRecord, chordproFile: ChordProRecord): boolean {
  if (!song.driveFileId) {
    return true
  }
  if (song.syncedContentHash) {
    // Hash the chart itself rather than trusting a stored contentHash
    return hashText(chordproFile.content) !== song.syncedContentHash
  }

  // Synced before content hashes were recorded: fall back to the old check
  const lastSynced = song.lastSyncedAt ? new Date(song.lastSyncedAt) : new Date(0)
  const localModified = chordproFile.lastModified
    ? new Date(chordproFile.lastModified)
    : new Date(song.modifiedDate || 0)
  if (localModified <= lastSynced) {
    return false
  }
  return song.driveProperties?.contentHash !== chordproFile.contentHash
}

/**
 * Whether Drive stored exactly the bytes we sent: the md5Checksum it reports for the upload
 * is the MD5 of the content. If not, the record is kept as changed here (its synced markers
 * are not set), so the next push uploads it again, over the same file.
 */
export function driveHolds(
  driveFile: DriveFile | null | undefined,
  content: string,
  what: string
): boolean {
  if (!driveFile?.md5Checksum || md5Hex(content) === driveFile.md5Checksum) return true
  console.error(
    `[DriveSync] Drive stored other content for ${what} than was sent: uploading it again next sync`
  )
  return false
}
