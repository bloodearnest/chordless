/**
 * What the pull and the push of a sync (pull.ts, push.ts) share: the run they are part of
 * (`SyncRun`), its progress, and reading files in batches.
 */
import type { Person, Setlist } from '../data-types.ts'
import type { ChordlessDB } from '../db.ts'
import type { ChordProParser } from '../parser.ts'
import type { SpaceStorage, StoredFile } from '../storage/types.ts'
import { setlistIdOf } from './changes.ts'

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

/** What a sync reports once it has ended */
export interface SyncReport {
  /** How many charts the pull left alone because they have local changes that can't go back */
  heldBack: number
  /** The setlists a pull replaced with Drive's although they had local changes (read-only) */
  resetSetlists: ResetSetlist[]
  /** Whether the user can only read the folder (null: it was not asked) */
  readOnly: boolean | null
  /** Whether a file the pull meant to download could not be */
  downloadsFailed: boolean
}

/**
 * One sync (or pull, push or reset), and what it finds out as it goes: what is in the space, which
 * files are live, whether the user can only read. Made afresh for each by the SyncManager and
 * passed to the pull and the push (pull.ts, push.ts), so nothing one finds out is carried into the
 * next; what it reports is its `report()`.
 */
export class SyncRun {
  readonly db: ChordlessDB
  readonly parser: ChordProParser
  readonly spaceId: string | null
  /** The space's files */
  readonly space: SpaceStorage
  /**
   * A sync from the feed of changes: the refs the feed said are gone. It lists nothing, so this is
   * all it knows of what is no longer there (null: a sync that lists the space)
   */
  readonly goneRefs: Set<string> | null

  /** The refs of the files in the space, once listed (null: not listed, or the listing failed) */
  inventory: Set<string> | null = null
  /** The space's people, as the push read them: the leaders' names go in the setlist files' names */
  people: Person[] = []
  /** The ids of the people that have a live file, as listed by the pull (null: not listed) */
  livePeopleIds: Set<string> | null = null
  /** The setlist files in Drive, as listed by the pull */
  liveSetlistFiles: StoredFile[] | null = null
  /** Whether the user can only read the folder (null: not asked yet) */
  readOnly: boolean | null = null
  /** How many charts the pull left alone because they have local changes that can't go back */
  heldBack = 0
  /** The setlists a pull replaced with Drive's although they had local changes (read-only) */
  resetSetlists: ResetSetlist[] = []
  /** Whether the pull of people failed to read some file, so it may not know them all */
  peoplePullIncomplete = false
  /** Whether the pull of setlists failed to read some file, so it may not know them all */
  pullIncomplete = false
  /** Whether a file the pull meant to download could not be (a setlist or a song) */
  downloadsFailed = false
  /** Files this device has deleted the records of and has not yet put in the trash: not to be pulled again */
  pendingDeletedRefs = new Set<string>()
  /** The ids of the songs that have a live file in Drive, as listed by the pull (null: not listed) */
  liveSongUuids: Set<string> | null = null

  constructor(options: {
    db: ChordlessDB
    parser: ChordProParser
    spaceId: string | null
    space: SpaceStorage
    goneRefs?: Set<string> | null
  }) {
    this.db = options.db
    this.parser = options.parser
    this.spaceId = options.spaceId
    this.space = options.space
    this.goneRefs = options.goneRefs ?? null
  }

  /** Whether it knows which files are gone: from a listing, or from the feed */
  get knowsWhatIsGone(): boolean {
    return this.inventory !== null || this.goneRefs !== null
  }

  /** Whether a Drive file is in the folder (with no inventory, any file is assumed to be) */
  fileExistsInDrive(fileRef: string): boolean {
    // (a sync from the feed has no inventory, only the files the feed said are gone)
    if (this.goneRefs) return !this.goneRefs.has(fileRef)
    // (not listed: assume it is there, which is the safe way round)
    return this.inventory?.has(fileRef) ?? true
  }

  /** Whether a local record has no Drive file to be found: it never had one, or it is gone */
  isOrphaned(record: { fileRef?: string | null }): boolean {
    return !record.fileRef || !this.fileExistsInDrive(record.fileRef)
  }

  /**
   * Whether the pull saw a live Drive file for this setlist id. When this device's record has no
   * file of its own that is still there, that file is the setlist's: the pull should have adopted
   * it, and did not if its download failed. Uploading the record then would store the setlist
   * twice, so the push and the removal leave it until a pull succeeds.
   */
  hasLiveFileOfItsOwn(setlist: Setlist): boolean {
    return (this.liveSetlistFiles ?? []).some(file => setlistIdOf(file) === setlist.id)
  }

  report(): SyncReport {
    return {
      heldBack: this.heldBack,
      resetSetlists: this.resetSetlists,
      readOnly: this.readOnly,
      downloadsFailed: this.downloadsFailed,
    }
  }
}
