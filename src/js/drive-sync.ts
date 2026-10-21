/**
 * Google Drive Sync Manager
 *
 * Handles bidirectional sync between the local IndexedDB and Google Drive: it finds the
 * space's folder, lists what is in it, and runs the pull and the push in turn.
 *
 * Sync Strategy:
 * - Track sync state in local database (lastSyncedAt, fileRef, fileModified)
 * - Pull (sync/pull.ts): download what Drive has that is new or changed
 * - Push (sync/push.ts): upload local changes that haven't been synced
 * - Conflict: If both changed, Drive wins
 * - Whether a record has changes that aren't in Drive: sync/changes.ts
 */

import type { Setlist, SpaceMember } from './data-types.ts'
import { type ChordlessDB, getCurrentDB } from './db.ts'
import { GOOGLE_CLIENT_ID } from './google-auth.ts'
import { ChordProParser } from './parser.ts'
import { syncShares } from './share-manager.ts'
import { getCurrentSpace, getSpaceById, setSpaceReadOnly } from './space.ts'
import { SpaceDB } from './space-db.ts'
import { driveStorage } from './storage/browser-drive.ts'
import { storageFor } from './storage/space-storage.ts'
import type { RootInfo, SpaceStorage, StorageBackend, StoredFile } from './storage/types.ts'
import {
  setlistHasLocalChanges,
  setlistIdOf,
  songHasLocalChanges,
  songUuidOf,
} from './sync/changes.ts'
import { pullSetlists, pullSongs } from './sync/pull.ts'
import { pushSetlists, pushSongs } from './sync/push.ts'

export type { ProgressCallback, SyncProgress } from './sync/session.ts'

import type { ProgressCallback, ResetSetlist, SyncSession } from './sync/session.ts'

/** A local setlist or song with changes that are not in Drive */
export interface UnsyncedChange {
  type: 'setlist' | 'song'
  id: string
  label: string
}

/** Where the link to the space's Drive folder is kept */
export interface FolderLink {
  get(): Promise<string | null>
  set(rootRef: string): Promise<void>
  /** Let go of the folder, so the next sync finds or makes one by name */
  clear(): Promise<void>
}

/** Where the space's members are cached for offline use */
export interface MemberCache {
  set(members: SpaceMember[]): Promise<void>
  /** Record whether the user can only read the folder (so the app stops offering edits) */
  setReadOnly?(readOnly: boolean): Promise<void>
}

export interface DriveSyncOptions {
  /** Database to sync. Defaults to the current space's. Tests pass one per device. */
  db?: ChordlessDB | null
  folderLink?: FolderLink | null
  memberCache?: MemberCache | null
  /** Where the space's files are kept. Defaults to Google Drive. Tests pass a fake. */
  storage?: StorageBackend | null
}

/**
 * Thrown by resetLocalFromDrive when local records have changes not in Drive.
 */
export class UnsyncedChangesError extends Error {
  unsynced: UnsyncedChange[]

  constructor(unsynced: UnsyncedChange[]) {
    const shown = unsynced.slice(0, 5).map(u => `${u.type} ${u.label || u.id}`)
    const more = unsynced.length > 5 ? ` and ${unsynced.length - 5} more` : ''
    super(
      `${unsynced.length} local change(s) aren't in Drive yet, so nothing was reset: ${shown.join(', ')}${more}`
    )
    this.name = 'UnsyncedChangesError'
    this.unsynced = unsynced
  }
}

/**
 * What to tell the user when the space's linked Drive folder is not there: `folder` is the folder
 * in the Drive trash, or null when Drive cannot find it. `otherApp` is known when the folder was
 * linked by another Google app, which cannot see it (the Drive scope covers only the files an app
 * made itself).
 */
export function folderGoneMessage(folder: { name?: string } | null, otherApp: boolean): string {
  const safe = 'Your songs and setlists are safe on this device.'
  if (folder) {
    return (
      `This space's Google Drive folder "${folder.name}" is in the Drive trash. ` +
      `${safe} Restore it from the trash, or start over in Drive to upload them to a new folder.`
    )
  }
  return otherApp
    ? `This space was synced by an earlier version of Chordless's Google app, which cannot see its Drive folder. ${safe} Start over in Drive to upload them again.`
    : `This space's Google Drive folder can't be found: it was deleted, or belongs to another Google account than the one you are signed in with. ${safe} Sign in with the right account, or start over in Drive to upload them again.`
}

/**
 * Thrown when the Drive folder this space was linked to is gone (deleted, or not visible to this
 * Google account or app) or in the trash. Nothing was changed; startOver() is the way on.
 */
export class DriveFolderGoneError extends Error {
  reason: 'missing' | 'trashed'

  constructor(folder: Pick<RootInfo, 'name'> | null) {
    super(folderGoneMessage(folder, false))
    this.name = 'DriveFolderGoneError'
    this.reason = folder ? 'trashed' : 'missing'
  }
}

/**
 * Thrown when local records belong to a different Drive folder than the one this
 * space now syncs with (e.g. it was renamed before folders were linked).
 * Syncing would re-upload them all as duplicates, so sync stops instead.
 */
export class SpaceFolderMismatchError extends Error {
  count: number

  constructor(count: number, folderName: string) {
    super(
      `${count} setlist(s)/song(s) on this device are stored in a different Google Drive ` +
        `folder than "${folderName}", the one this space now syncs with. ` +
        `Nothing was synced, to avoid uploading them again as duplicates.`
    )
    this.name = 'SpaceFolderMismatchError'
    this.count = count
  }
}

/**
 * Where a space's link to its Drive folder is stored: its record in the
 * spaces database. Tests pass their own { get, set }.
 */
function spaceFolderLink(spaceId: string): FolderLink {
  let db: SpaceDB | null = null
  const getDb = async (): Promise<SpaceDB> => {
    if (!db) {
      db = new SpaceDB()
      await db.init()
    }
    return db
  }
  return {
    async get() {
      const space = await (await getDb()).getSpace(spaceId)
      return space?.rootRef ?? null
    },
    async set(rootRef: string) {
      try {
        await (await getDb()).updateSpace(spaceId, {
          rootRef,
          driveClientId: GOOGLE_CLIENT_ID,
        })
      } catch (error) {
        console.warn('[DriveSync] Could not record Drive folder link:', error)
      }
    },
    async clear() {
      await (await getDb()).updateSpace(spaceId, {
        rootRef: null,
        driveClientId: null,
      })
    },
  }
}

/**
 * Where the space's members (people its Drive folder is shared with) are
 * cached for offline use: its record in the spaces database, as
 * `members`. Tests pass their own { set }.
 */
function spaceMemberCache(spaceId: string): MemberCache {
  return {
    async set(members: SpaceMember[]) {
      const db = new SpaceDB()
      await db.init()
      await db.updateSpace(spaceId, { members })
    },
    setReadOnly: readOnly => setSpaceReadOnly(spaceId, readOnly),
  }
}

/**
 * Sync Manager for a specific space
 */
export class DriveSyncManager implements SyncSession {
  spaceName: string
  spaceId: string | null
  spaceDb: ChordlessDB | null
  folderLink: FolderLink | null
  memberCache: MemberCache | null
  rootRef: string | null
  parser: ChordProParser
  /** The storage backend (Google Drive unless a test says otherwise) */
  storage: StorageBackend
  /** The space's files, opened once the folder is known and dropped when a sync ends */
  #space: SpaceStorage | null = null
  /** The ids of the files in the space's Drive folder, once listed */
  _driveFileIds: Set<string> | null
  /** The setlist files in Drive, as listed by the last pull */
  liveSetlistFiles: StoredFile[] | null
  /** Whether the last pull of setlists failed to read some file, so it may not know them all */
  pullIncomplete: boolean
  /** Whether the user can only read the folder, as the last check found (null: not asked) */
  readOnly: boolean | null
  /** How many records the last pull left alone, for a user who can only read (sync/pull.ts) */
  heldBack = 0
  /** The setlists the last pull replaced with Drive's, for a user who can only read */
  resetSetlists: ResetSetlist[] = []

  /**
   * @param options.db - Database to sync. Defaults to the current space's database.
   *   Tests pass one per simulated device.
   * @param options.folderLink - Where the link to the space's Drive folder is stored.
   *   Defaults to its record in the spaces database.
   * @param options.memberCache - Where the folder's members are cached. Defaults to the
   *   space's record.
   */
  constructor(
    spaceName: string,
    spaceId: string | null,
    { db = null, folderLink = null, memberCache = null, storage = null }: DriveSyncOptions = {}
  ) {
    this.spaceName = spaceName
    this.spaceId = spaceId
    this.spaceDb = db
    this.folderLink = folderLink
    this.memberCache = memberCache
    this.storage = storage ?? driveStorage
    this.rootRef = null
    this.parser = new ChordProParser()

    // Drive file inventory (for existence checks)
    this._driveFileIds = null // Set of file IDs that exist in Drive
    this.liveSetlistFiles = null
    this.pullIncomplete = false
    this.readOnly = null
  }

  /** The database, once init() has set it */
  get db(): ChordlessDB {
    if (!this.spaceDb) throw new Error('DriveSyncManager is not initialised: call init()')
    return this.spaceDb
  }

  get #folderLink(): FolderLink {
    if (!this.folderLink) throw new Error('DriveSyncManager is not initialised: call init()')
    return this.folderLink
  }

  get #memberCache(): MemberCache {
    if (!this.memberCache) throw new Error('DriveSyncManager is not initialised: call init()')
    return this.memberCache
  }

  /** The space's files, once its folder is known (opened afresh for each sync) */
  get space(): SpaceStorage {
    this.#space ??= this.storage.space(this.folderId)
    return this.#space
  }

  /** The space's Drive folder, once found */
  get folderId(): string {
    if (!this.rootRef) throw new Error('The Drive folder is not known yet: call init()')
    return this.rootRef
  }

  async init(): Promise<boolean> {
    await this.open()
    const isNew = await this.resolveDriveFolder()
    return isNew
  }

  /** Get the database and the stored link and member cache, without asking Drive anything */
  async open(): Promise<void> {
    // Initialize database
    if (this.spaceDb) {
      this.spaceId ??= this.spaceDb.spaceId
    } else {
      // Reuse the same DB instance the UI uses
      this.spaceDb = await getCurrentDB()
      // Ensure we keep the actual space ID from the DB (in case caller passed null)
      this.spaceId = this.spaceDb.spaceId
    }

    // (the id is known by now: given, or the database's)
    const spaceId = this.spaceId as string
    this.folderLink ??= spaceFolderLink(spaceId)
    this.memberCache ??= spaceMemberCache(spaceId)
  }

  /**
   * Let go of this space's Drive folder and every link to a file in it, keeping all the
   * content on this device, so the next sync finds or makes a folder by name and uploads it all
   * again. For when the folder is gone (DriveFolderGoneError): deleted, in the trash, or made
   * by another Google app, which cannot see what the first one made. Nothing in Drive is
   * touched: an old folder that can still be seen is left for the user to delete.
   */
  async startOver(): Promise<void> {
    await this.open()
    await this.db.clearFileLinks()
    await this.#folderLink.clear()
    this.rootRef = null
  }

  /**
   * Find this space's Drive folder. Once linked (stored after the first
   * sync) it's used by ID, so renaming the space can't point sync at a
   * different folder. The first sync finds or creates it by name and links it.
   * @returns whether the folder was newly created
   */
  async resolveDriveFolder(): Promise<boolean> {
    const linkedId = await this.#folderLink.get()

    if (linkedId) {
      const folder = await this.storage.inspectRoot(linkedId)
      if (!folder || folder.trashed) {
        throw new DriveFolderGoneError(folder)
      }
      this.rootRef = folder.ref
      if (folder.name !== this.spaceName) {
        await this.followRename(folder)
      }
      return false
    }

    const result = await this.storage.ensureRoot(this.spaceName, this.spaceId as string)
    this.rootRef = result.ref
    await this.#folderLink.set(result.ref)
    return result.isNew
  }

  /**
   * The space was renamed since it was linked to `folder`. If another
   * space folder already has the new name (e.g. another device created
   * it) and this device has nothing synced yet, join that folder. Otherwise
   * rename the linked folder to match, unless that name is taken.
   */
  async followRename(folder: RootInfo): Promise<void> {
    const existing = await this.storage.findRootByName(this.spaceName)

    if (existing && existing.ref !== folder.ref) {
      if (!(await this.hasSyncedRecords())) {
        this.rootRef = existing.ref
        await this.#folderLink.set(existing.ref)
        return
      }
      console.warn(
        `[DriveSync] Not renaming Drive folder "${folder.name}" to "${this.spaceName}": ` +
          'another folder already has that name. Syncing continues with the linked folder.'
      )
      return
    }

    await this.storage.renameRoot(folder.ref, this.spaceName)
  }

  /** Whether any local setlist or song has been synced to Drive */
  async hasSyncedRecords(): Promise<boolean> {
    const records = [...(await this.db.getAllSetlists()), ...(await this.db.getAllSongs())]
    return records.some(record => record.fileRef)
  }

  /**
   * Full sync: pull from Drive, then push local changes
   */
  async sync(progressCallback: ProgressCallback | null = null): Promise<{ success: true }> {
    progressCallback?.({ stage: 'starting', message: 'Starting sync...' })

    try {
      // Who the space's folder is shared with, for choosing leaders
      await this.refreshMembers()
      await this.refreshAccess()
      this.heldBack = 0
      this.resetSetlists = []

      // Before changing anything, check local records belong to this folder
      progressCallback?.({ stage: 'scanning', message: 'Checking Drive files...' })
      await this.buildDriveInventory()
      await this.assertRecordsInThisFolder()

      // First, pull changes from Drive
      progressCallback?.({ stage: 'pulling', message: 'Downloading from Drive...' })
      await this.pullFromDrive(progressCallback)

      // The pull has adopted the live files it could. A setlist whose file is still gone and
      // that wasn't edited here was removed from Drive: remove it here too
      const removed = await this.removeSetlistsDeletedInDrive()
      if (removed > 0 && progressCallback) {
        progressCallback({
          stage: 'pulling',
          message: `Removed ${removed} setlists that were deleted in Drive`,
        })
      }

      // Share links: update the live ones and end the finished ones, which changes setlists,
      // so before they are pushed
      // Then, push local changes (a user who can only read has none to push). If the access
      // check could not be made, a refusal to upload is how a reader is found out
      try {
        if (!this.readOnly) await this.syncShares()
        if (!this.readOnly) {
          progressCallback?.({ stage: 'pushing', message: 'Uploading to Drive...' })
          await this.pushToDrive(progressCallback)
        }
      } catch (error) {
        if (!(await this.foundToBeReadOnly())) throw error
      }

      progressCallback?.({
        stage: 'complete',
        message: this.readOnly
          ? `Sync complete (view-only: your changes stay on this device${this.heldBack ? `, ${this.heldBack} differ from Drive` : ''})`
          : 'Sync complete!',
      })
    } catch (error) {
      console.error('[DriveSync] Sync failed:', error)
      progressCallback?.({
        stage: 'error',
        message: `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
      })
      throw error
    } finally {
      // Clear caches after sync
      this.#space = null
      this._driveFileIds = null
      this.liveSetlistFiles = null
      this.pullIncomplete = false
      this.readOnly = null
    }
    return { success: true }
  }

  /** Update and clean up this space's share links (see share-manager.ts) */
  async syncShares(): Promise<number> {
    try {
      return await syncShares({
        db: this.db,
        spaceId: this.spaceId,
        space: this.space,
      })
    } catch (error) {
      // Shares must never stop setlists and songs syncing
      console.error('[DriveSync] Share sync failed:', error)
      return 0
    }
  }

  /**
   * Build inventory of all file IDs that exist in Drive
   * This is called at the start of sync to detect missing files
   */
  async buildDriveInventory(): Promise<void> {
    try {
      this._driveFileIds = await this.space.inventory()
    } catch (error) {
      // Without a complete inventory we can't tell which files are missing, so
      // skip the check (fileExistsInDrive assumes they exist). An incomplete set
      // would make every unlisted file look deleted and get re-uploaded.
      console.error('[DriveSync] Failed to build Drive inventory, skipping check:', error)
      this._driveFileIds = null
    }
  }

  /**
   * Fetch and cache the people the space's Drive folder is shared with.
   * Not essential to syncing, so failures are only logged.
   */
  async refreshMembers(): Promise<SpaceMember[] | null> {
    try {
      const members = await this.space.members()
      await this.#memberCache.set(members)
      return members
    } catch (error) {
      console.warn('[DriveSync] Could not refresh space members:', error)
      return null
    }
  }

  /**
   * Ask Drive whether the user can add files to the space's folder, and remember it
   * (on the space, so the app can stop offering edits that could never sync). If Drive
   * can't be asked, the user is taken to have write access, as before: nothing changes.
   * @returns whether the user can only read the folder
   */
  async refreshAccess(): Promise<boolean> {
    let canAdd: boolean | null | undefined
    try {
      canAdd = (await this.storage.inspectRoot(this.folderId))?.canWrite
    } catch (error) {
      console.warn('[DriveSync] Could not check access to the space folder:', error)
    }
    this.readOnly = canAdd === false
    if (canAdd !== undefined && canAdd !== null) {
      try {
        await this.#memberCache.setReadOnly?.(this.readOnly)
      } catch (error) {
        console.warn('[DriveSync] Could not record the access to the space folder:', error)
      }
    }
    return this.readOnly
  }

  /**
   * After a write failed: ask again whether the user can only read the folder, and say so.
   * A reader whose first check couldn't be made is found out by their refused upload. (Any
   * failure asks, but only an answer from Drive that says read-only counts.)
   */
  async foundToBeReadOnly(): Promise<boolean> {
    return this.refreshAccess()
  }

  /**
   * Throw SpaceFolderMismatchError if local records point to Drive files
   * that exist outside this space's folder. Sync treats records missing
   * from the folder as deleted and re-uploads them; for files that actually live
   * in another folder that would duplicate them, so stop instead. Needs the
   * inventory; skipped if it couldn't be built.
   */
  async assertRecordsInThisFolder(): Promise<void> {
    if (!this._driveFileIds) return

    const missing = [...(await this.db.getAllSetlists()), ...(await this.db.getAllSongs())].filter(
      record => record.fileRef && !this.fileExistsInDrive(record.fileRef)
    )

    let elsewhere = 0
    for (const record of missing) {
      const file = await this.space.status(record.fileRef as string)
      if (file && !file.trashed) elsewhere++
    }
    if (elsewhere > 0) {
      throw new SpaceFolderMismatchError(elsewhere, this.spaceName)
    }
  }

  /**
   * Remove the setlists whose Drive file is gone and that haven't been edited since they were
   * synced: their content is what Drive had, so Drive's removal wins (as in a reset). One
   * edited here is kept, and the push uploads it again, so no edit is lost. This device's
   * state for a removed setlist is kept, so a file restored from the Drive trash comes back
   * as it was. Needs the inventory; skipped if it couldn't be built.
   * @returns how many setlists were removed
   */
  async removeSetlistsDeletedInDrive(): Promise<number> {
    if (!this._driveFileIds) return 0

    let removed = 0
    for (const setlist of await this.db.getAllSetlists()) {
      if (!setlist.fileRef || this.fileExistsInDrive(setlist.fileRef)) continue
      if (this.hasLiveFileOfItsOwn(setlist)) continue
      if (setlistHasLocalChanges(setlist)) continue
      await this.db.deleteSetlist(setlist.id)
      removed++
    }
    return removed
  }

  /**
   * Check if a Drive file ID actually exists in Drive
   */
  fileExistsInDrive(fileRef: string): boolean {
    if (!this._driveFileIds) {
      // Inventory not built, assume file exists (conservative)
      return true
    }
    return this._driveFileIds.has(fileRef)
  }

  /**
   * Whether a local record has no Drive file to be found: it never had one, or the one it
   * had is no longer in the folder. (With no inventory, any file is assumed to be there.)
   */
  isOrphaned(record: { fileRef?: string | null }): boolean {
    return !record.fileRef || !this.fileExistsInDrive(record.fileRef)
  }

  /**
   * Whether the last pull saw a live Drive file for this setlist id. When this device's record
   * has no file of its own that is still there, that file is the setlist's: the pull should have
   * adopted it, and did not if its download failed. Uploading the record then would store the
   * setlist twice, so the push and the removal leave it until a pull succeeds.
   */
  hasLiveFileOfItsOwn(setlist: Setlist): boolean {
    return (this.liveSetlistFiles ?? []).some(file => setlistIdOf(file) === setlist.id)
  }

  /**
   * Replace this device's setlists, songs and charts with what's in Drive.
   *
   * Unlike a normal sync, local records whose Drive file is gone are dropped
   * rather than re-uploaded, so files removed from Drive stay removed. To avoid
   * losing work it changes nothing if Drive can't be listed, or if any local
   * record has changes that aren't in Drive (throws UnsyncedChangesError).
   * Per-setlist device preferences (setlist_local) are kept.
   */
  async resetLocalFromDrive(progressCallback: ProgressCallback | null = null): Promise<void> {
    try {
      progressCallback?.({ stage: 'scanning', message: 'Checking Drive files...' })
      await this.buildDriveInventory()
      if (!this._driveFileIds) {
        throw new Error("Couldn't list your Drive files, so nothing was changed. Try again.")
      }

      progressCallback?.({ stage: 'scanning', message: 'Checking for unsynced changes...' })
      const unsynced = await this.findUnsyncedChanges()
      if (unsynced.length > 0) {
        throw new UnsyncedChangesError(unsynced)
      }

      progressCallback?.({ stage: 'clearing', message: 'Clearing local copy...' })
      await this.db.clearSyncedData()

      await this.pullFromDrive(progressCallback)
      progressCallback?.({ stage: 'complete', message: 'Reset complete' })
    } finally {
      this.#space = null
      this._driveFileIds = null
    }
  }

  /**
   * Local setlists and songs with changes that aren't in Drive.
   */
  async findUnsyncedChanges(): Promise<UnsyncedChange[]> {
    const unsynced: UnsyncedChange[] = []
    for (const setlist of await this.db.getAllSetlists()) {
      if (setlistHasLocalChanges(setlist)) {
        const label = [setlist.date, setlist.name].filter(Boolean).join(' ')
        unsynced.push({ type: 'setlist', id: setlist.id, label })
      }
    }
    for (const song of await this.db.getAllSongs()) {
      if (!song.chordproFileId) continue
      const chordproFile = await this.db.getChordPro(song.chordproFileId)
      if (chordproFile && songHasLocalChanges(song, chordproFile)) {
        unsynced.push({ type: 'song', id: songUuidOf(song), label: song.title || '' })
      }
    }
    return unsynced
  }

  /**
   * Pull changes from Drive to local
   */
  async pullFromDrive(progressCallback: ProgressCallback | null = null): Promise<void> {
    // Pull setlists
    progressCallback?.({ stage: 'pulling', message: 'Checking setlists...', current: 0, total: 1 })
    await pullSetlists(this, progressCallback)

    // Pull songs (chordpro files)
    progressCallback?.({ stage: 'pulling', message: 'Checking songs...', current: 0, total: 1 })
    await pullSongs(this, progressCallback)
  }

  /**
   * Push local changes to Drive
   */
  async pushToDrive(progressCallback: ProgressCallback | null = null): Promise<void> {
    if (this.readOnly ?? (await this.refreshAccess())) {
      return
    }
    const refusals = this.storage.writeRefusals()
    try {
      await this.#pushAll(progressCallback)
    } catch (error) {
      if (!(await this.foundToBeReadOnly())) throw error
      return
    }
    // Writes that failed were tried again and left for the next sync: were they refused?
    if (this.storage.writeRefusals() > refusals) await this.foundToBeReadOnly()
  }

  async #pushAll(progressCallback: ProgressCallback | null): Promise<void> {
    // Build inventory of existing Drive files
    progressCallback?.({ stage: 'scanning', message: 'Checking Drive files...' })
    await this.buildDriveInventory()

    // Push setlists
    progressCallback?.({
      stage: 'pushing',
      message: 'Scanning setlists...',
      current: 0,
      total: 1,
    })
    await pushSetlists(this, progressCallback)

    // Push songs (chordpro files)
    progressCallback?.({
      stage: 'pushing',
      message: 'Scanning songs...',
      current: 0,
      total: 1,
    })
    await pushSongs(this, progressCallback)
  }
}

/**
 * Helper functions
 */

/**
 * Check if Drive sync is available (user is authenticated)
 */
export async function isSyncAvailable(): Promise<boolean> {
  return (await currentSpaceStorage()).available()
}

/** The backend for the current space: Drive, or the Worker for a member of a team space */
async function currentSpaceStorage(): Promise<StorageBackend> {
  return storageFor(await getSpaceById(getCurrentSpace().id))
}

/**
 * Create a sync manager for a space
 */
export async function createSyncManager(
  spaceName: string,
  spaceId: string | null
): Promise<DriveSyncManager> {
  // (no id means the current space, as the manager itself takes it)
  const space = await getSpaceById(spaceId ?? getCurrentSpace().id)
  const manager = new DriveSyncManager(spaceName, spaceId, { storage: storageFor(space) })
  await manager.init()
  return manager
}
