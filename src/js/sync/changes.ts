/**
 * Whether a record has changes that are not in Drive, and what a record keeps of its Drive
 * file. No state: the sync's pull, push and reset all ask.
 */
import type { ChordProRecord, Setlist, SongRecord } from '../data-types.ts'
import type { StoredFile } from '../storage/types.ts'
import { hashText } from '../utils/hash.ts'
import { setlistContentHash } from './setlist-hash.ts'

/** The id of the setlist a Drive file holds: from its properties, or its name (`<id>.json`) */
export function setlistIdOf(file: Pick<StoredFile, 'props' | 'name'>): string {
  return file.props.setlistId || file.name.replace('.json', '')
}

/** The id a song's Drive file is known by */
export function songUuidOf(song: Pick<SongRecord, 'uuid' | 'id'>): string {
  return song.uuid || song.id
}

/** What a record keeps of its Drive file: when it was modified, and its checksum */
export function driveMarkers(file: Pick<StoredFile, 'modified' | 'rev'> | null | undefined) {
  return { fileModified: file?.modified ?? null, fileRev: file?.rev ?? null }
}

/** What makes two setlist records the same setlist, whatever their ids */
export const setlistKey = (setlist: Setlist) =>
  [setlist.date, setlist.time, setlist.owner, setlist.type, setlist.name].join('|')

/**
 * Whether a setlist has local changes that aren't in Drive: never uploaded,
 * or edited since its last sync. Ignores whether its Drive file still exists.
 */
export function setlistHasLocalChanges(setlist: Setlist): boolean {
  if (!setlist.fileRef) {
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
  if (!song.fileRef) {
    return true
  }
  // Something besides the chart changed (its source, say), and has not been sent since
  if (
    song.metadataChangedAt &&
    (!song.lastSyncedAt || song.metadataChangedAt > song.lastSyncedAt)
  ) {
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
  return song.fileProps?.contentHash !== chordproFile.contentHash
}
