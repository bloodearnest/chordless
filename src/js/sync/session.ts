/**
 * What the pull and the push of a Drive sync (pull.ts, push.ts) share. The DriveSyncManager
 * keeps this state for the length of a sync and passes itself to them.
 */
import type { Setlist } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import type { ChordProParser } from '../parser.ts'
import type { SpaceStorage, StoredFile } from '../storage/types.ts'

/** What a sync reports while it runs */
export interface SyncProgress {
  stage: 'starting' | 'scanning' | 'pulling' | 'pushing' | 'clearing' | 'complete' | 'error'
  message: string
  current?: number
  total?: number
}

export type ProgressCallback = (progress: SyncProgress) => void

/** How many files one call to the storage asks for at a time (and progress is reported for) */
export const BATCH_SIZE = 50

/**
 * Read the files of `items` BATCH_SIZE at a time (the storage decides how many it has in flight)
 * and do `work` on each with its text. `onGroup` hears how each batch went; an item whose file
 * could not be read is rejected, like one `work` failed on.
 */
export async function inBatches<T, R>(
  space: SpaceStorage,
  items: T[],
  refOf: (item: T) => string,
  work: (item: T, text: string) => Promise<R>,
  onGroup: (results: PromiseSettledResult<R>[]) => void
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    let texts: (string | null)[]
    try {
      texts = await space.readMany(batch.map(refOf))
    } catch (error) {
      console.error('[DriveSync] Reading a batch of files failed:', error)
      texts = batch.map(() => null)
    }
    const results: PromiseSettledResult<R>[] = []
    for (const [j, item] of batch.entries()) {
      const text = texts[j]
      results.push(
        text === null
          ? { status: 'rejected', reason: new Error(`Could not read ${refOf(item)}`) }
          : (await Promise.allSettled([work(item, text)]))[0]
      )
    }
    onGroup(results)
  }
}

/** A setlist a pull replaced: what this device had, and what it has now */
export interface ResetSetlist {
  before: Setlist
  after: Setlist
}

export interface SyncSession {
  readonly db: ChordlessDB
  readonly parser: ChordProParser
  readonly spaceId: string | null
  /** The space's files */
  readonly space: SpaceStorage

  /** The setlist files in Drive, as listed by the last pull */
  liveSetlistFiles: StoredFile[] | null
  /** Whether the user can only read the folder (null: not asked yet) */
  readOnly: boolean | null
  /** How many charts the pull left alone because they have local changes that can't go back */
  heldBack: number
  /** The setlists a pull replaced with Drive's although they had local changes (read-only) */
  resetSetlists: ResetSetlist[]
  /** Whether the last pull of setlists failed to read some file, so it may not know them all */
  pullIncomplete: boolean
  /** Whether a file the pull meant to download could not be (a setlist or a song) */
  downloadsFailed: boolean
  /** Files this device has deleted the records of and has not yet put in the trash: not to be pulled again */
  pendingDeletedRefs: Set<string>
  /** The ids of the songs that have a live file in Drive, as listed by the last pull (null: not listed) */
  liveSongUuids: Set<string> | null

  /** Whether a Drive file is in the folder (with no inventory, any file is assumed to be) */
  fileExistsInDrive(fileRef: string): boolean
  /** Whether a local record has no Drive file to be found: it never had one, or it is gone */
  isOrphaned(record: { fileRef?: string | null }): boolean
  /**
   * Whether the last pull saw a live Drive file for this setlist id. When this device's record
   * has no file of its own that is still there, that file is the setlist's: the pull should have
   * adopted it, and did not if its download failed. Uploading the record then would store the
   * setlist twice, so the push and the removal leave it until a pull succeeds.
   */
  hasLiveFileOfItsOwn(setlist: Setlist): boolean
}
