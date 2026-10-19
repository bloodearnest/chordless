/**
 * What the pull and the push of a Drive sync (pull.ts, push.ts) share. The DriveSyncManager
 * keeps this state for the length of a sync and passes itself to them.
 */
import type { DriveFile, Setlist } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import type { ChordProParser } from '../parser.ts'

/** What a sync reports while it runs */
export interface SyncProgress {
  stage: 'starting' | 'scanning' | 'pulling' | 'pushing' | 'clearing' | 'complete' | 'error'
  message: string
  current?: number
  total?: number
}

export type ProgressCallback = (progress: SyncProgress) => void

/** How many files are transferred at a time */
export const CONCURRENT_LIMIT = 10

/** Do `work` for each item, CONCURRENT_LIMIT at a time; `onGroup` hears how each group went */
export async function inGroups<T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
  onGroup: (results: PromiseSettledResult<R>[]) => void
): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENT_LIMIT) {
    onGroup(await Promise.allSettled(items.slice(i, i + CONCURRENT_LIMIT).map(work)))
  }
}

export interface SyncSession {
  readonly db: ChordlessDB
  readonly parser: ChordProParser
  readonly organisationId: string | null
  /** The organisation's Drive folder */
  readonly folderId: string
  songsFolder(): Promise<string>
  setlistsFolder(): Promise<string>

  /** The setlist files in Drive, as listed by the last pull */
  liveSetlistFiles: DriveFile[] | null
  /** Whether the user can only read the folder (null: not asked yet) */
  readOnly: boolean | null
  /** How many charts the pull left alone because they have local changes that can't go back */
  heldBack: number
  /** The setlists a pull replaced with Drive's although they had local changes (read-only) */
  resetSetlists: string[]
  /** Whether the last pull of setlists failed to read some file, so it may not know them all */
  pullIncomplete: boolean

  /** Whether a Drive file is in the folder (with no inventory, any file is assumed to be) */
  fileExistsInDrive(driveFileId: string): boolean
  /** Whether a local record has no Drive file to be found: it never had one, or it is gone */
  isOrphaned(record: { driveFileId?: string | null }): boolean
  /**
   * Whether the last pull saw a live Drive file for this setlist id. When this device's record
   * has no file of its own that is still there, that file is the setlist's: the pull should have
   * adopted it, and did not if its download failed. Uploading the record then would store the
   * setlist twice, so the push and the removal leave it until a pull succeeds.
   */
  hasLiveFileOfItsOwn(setlist: Setlist): boolean
}
