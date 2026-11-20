import type { Setlist, SetlistEntry } from '../data-types.ts'
import { hashText } from '../utils/hash.ts'

/**
 * Setlist content hashes, for sync to tell local changes from synced ones.
 * Pure functions, with no other imports, so the database can use them too.
 */

// Fields describing a setlist's sync state on this device rather than its
// content. Excluded from content hashes and from the copy uploaded to Drive.
// (_lastSyncHash is the pre-content-hash field, kept only for old records.)
const SETLIST_SYNC_FIELDS = [
  'fileRef',
  'fileModified',
  'fileRev',
  'lastSyncedAt',
  'syncedContentHash',
  '_lastSyncHash',
  'version',
  'spaceDataBody',
] as const

type SyncField = (typeof SETLIST_SYNC_FIELDS)[number]

// What those were called before 2026-10-20: a record not migrated yet, or a copy in Drive that
// someone's older version wrote, may still carry them
const LEGACY_SYNC_FIELDS = ['driveFileId', 'driveModifiedTime', 'driveChecksum']

/**
 * A setlist without this device's sync state, and without the songs added for this device alone
 * (`SetlistEntry.local`): what gets stored in Drive. The songs left are numbered from 0 again only
 * if some were taken out, so a setlist with none of its own hashes as it always did.
 */
export function setlistContent(setlist: Setlist): Omit<Setlist, SyncField> {
  const content: Partial<Setlist> = { ...setlist }
  for (const field of SETLIST_SYNC_FIELDS) delete content[field]
  for (const field of LEGACY_SYNC_FIELDS) delete (content as Record<string, unknown>)[field]
  if (setlist.songs?.some(entry => entry.local)) {
    content.songs = setlist.songs
      .filter(entry => !entry.local)
      .map((entry, order) => ({ ...entry, order }))
  }
  if (content.songs?.some(entry => entry.spaceDataExtra !== undefined)) {
    content.songs = content.songs.map(({ spaceDataExtra: _extra, ...entry }) => entry)
  }
  return content as Omit<Setlist, SyncField>
}

/**
 * Drive's songs with the ones added for this device alone put back, each after the song it followed
 * here, or last when that song is not there; one the setlist now has itself (the leader added it
 * too) is left out. Numbered from 0.
 */
export function withLocalSongs(
  remote: SetlistEntry[],
  local: SetlistEntry[] | undefined
): SetlistEntry[] {
  const mine = (local ?? []).filter(entry => entry.local)
  if (mine.length === 0) return remote
  const merged = [...remote]
  local?.forEach((entry, index) => {
    if (!entry.local || merged.some(each => !each.local && each.songId === entry.songId)) return
    const before = local[index - 1]
    const at = before ? merged.findIndex(each => each.songId === before.songId) : -1
    if (at >= 0) merged.splice(at + 1, 0, entry)
    else merged.push(entry)
  })
  return merged.map((entry, order) => ({ ...entry, order }))
}

/** JSON with object keys sorted, so equal content always hashes the same */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Hash of a setlist's content, ignoring sync state and key order. modifiedDate
 * is left out too: it records when it was saved, so a save that changes nothing
 * (or an edit that's undone) doesn't count as a change.
 */
export function setlistContentHash(setlist: Setlist): string {
  const { modifiedDate: _modifiedDate, ...content } = setlistContent(setlist)
  return hashText(stableStringify(content))
}
