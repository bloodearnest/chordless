import { hashText } from '../utils/hash.ts'

/**
 * Setlist content hashes, for sync to tell local changes from synced ones.
 * Pure functions, with no other imports, so the database can use them too.
 */

// Fields describing a setlist's sync state on this device rather than its
// content. Excluded from content hashes and from the copy uploaded to Drive.
// (_lastSyncHash is the pre-content-hash field, kept only for old records.)
export const SETLIST_SYNC_FIELDS = [
  'driveFileId',
  'driveModifiedTime',
  'driveChecksum',
  'lastSyncedAt',
  'syncedContentHash',
  '_lastSyncHash',
]

/** A setlist without this device's sync state: what gets stored in Drive */
export function setlistContent(setlist) {
  const content = { ...setlist }
  for (const field of SETLIST_SYNC_FIELDS) delete content[field]
  return content
}

/** JSON with object keys sorted, so equal content always hashes the same */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Hash of a setlist's content, ignoring sync state and key order. modifiedDate
 * is left out too: it records when it was saved, so a save that changes nothing
 * (or an edit that's undone) doesn't count as a change.
 */
export function setlistContentHash(setlist) {
  const { modifiedDate: _modifiedDate, ...content } = setlistContent(setlist)
  return hashText(stableStringify(content))
}
