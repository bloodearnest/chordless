/**
 * Google Drive Sync Manager
 *
 * Handles bidirectional sync between the local IndexedDB and Google Drive: it finds the
 * organisation's folder, lists what is in it, and runs the pull and the push in turn.
 *
 * Sync Strategy:
 * - Track sync state in local database (lastSyncedAt, driveFileId, driveModifiedTime)
 * - Pull (sync/pull.ts): download what Drive has that is new or changed
 * - Push (sync/push.ts): upload local changes that haven't been synced
 * - Conflict: If both changed, Drive wins
 * - Whether a record has changes that aren't in Drive: sync/changes.ts
 */

import type { DriveFile, OrganisationMember, Setlist } from './data-types.ts'
import { type ChordlessDB, getCurrentDB } from './db.ts'
import * as DriveAPI from './drive-api.ts'
import { driveRequest, getSetlistsFolder, getSongsFolder } from './drive-api.ts'
import { setOrganisationReadOnly } from './organisation.ts'
import { OrganisationDB } from './organisation-db.ts'
import { ChordProParser } from './parser.ts'
import { syncShares } from './share-manager.ts'
import {
  setlistHasLocalChanges,
  setlistIdOf,
  songHasLocalChanges,
  songUuidOf,
} from './sync/changes.ts'
import { pullSetlists, pullSongs } from './sync/pull.ts'
import { pushSetlists, pushSongs } from './sync/push.ts'

export type { ProgressCallback, SyncProgress } from './sync/session.ts'

import type { ProgressCallback, SyncSession } from './sync/session.ts'

/** A local setlist or song with changes that are not in Drive */
export interface UnsyncedChange {
  type: 'setlist' | 'song'
  id: string
  label: string
}

/** Where the link to the organisation's Drive folder is kept */
export interface FolderLink {
  get(): Promise<string | null>
  set(driveFolderId: string): Promise<void>
}

/** Where the organisation's members are cached for offline use */
export interface MemberCache {
  set(members: OrganisationMember[]): Promise<void>
  /** Record whether the user can only read the folder (so the app stops offering edits) */
  setReadOnly?(readOnly: boolean): Promise<void>
}

export interface DriveSyncOptions {
  /** Database to sync. Defaults to the current organisation's. Tests pass one per device. */
  db?: ChordlessDB | null
  folderLink?: FolderLink | null
  memberCache?: MemberCache | null
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
 * Thrown when local records belong to a different Drive folder than the one this
 * organisation now syncs with (e.g. it was renamed before folders were linked).
 * Syncing would re-upload them all as duplicates, so sync stops instead.
 */
export class OrganisationFolderMismatchError extends Error {
  count: number

  constructor(count: number, folderName: string) {
    super(
      `${count} setlist(s)/song(s) on this device are stored in a different Google Drive ` +
        `folder than "${folderName}", the one this organisation now syncs with. ` +
        `Nothing was synced, to avoid uploading them again as duplicates.`
    )
    this.name = 'OrganisationFolderMismatchError'
    this.count = count
  }
}

/**
 * Where an organisation's link to its Drive folder is stored: its record in the
 * organisations database. Tests pass their own { get, set }.
 */
function organisationFolderLink(organisationId: string): FolderLink {
  let db: OrganisationDB | null = null
  const getDb = async (): Promise<OrganisationDB> => {
    if (!db) {
      db = new OrganisationDB()
      await db.init()
    }
    return db
  }
  return {
    async get() {
      const org = await (await getDb()).getOrganisation(organisationId)
      return org?.driveFolderId ?? null
    },
    async set(driveFolderId: string) {
      try {
        await (await getDb()).updateOrganisation(organisationId, { driveFolderId })
      } catch (error) {
        console.warn('[DriveSync] Could not record Drive folder link:', error)
      }
    },
  }
}

/**
 * Where the organisation's members (people its Drive folder is shared with) are
 * cached for offline use: its record in the organisations database, as
 * `members`. Tests pass their own { set }.
 */
function organisationMemberCache(organisationId: string): MemberCache {
  return {
    async set(members: OrganisationMember[]) {
      const db = new OrganisationDB()
      await db.init()
      await db.updateOrganisation(organisationId, { members })
    },
    setReadOnly: readOnly => setOrganisationReadOnly(organisationId, readOnly),
  }
}

/**
 * Sync Manager for a specific organisation
 */
export class DriveSyncManager implements SyncSession {
  organisationName: string
  organisationId: string | null
  organisationDb: ChordlessDB | null
  folderLink: FolderLink | null
  memberCache: MemberCache | null
  driveFolderId: string | null
  parser: ChordProParser
  _folderCache: Map<string, string>
  /** The ids of the files in the organisation's Drive folder, once listed */
  _driveFileIds: Set<string> | null
  /** The setlist files in Drive, as listed by the last pull */
  liveSetlistFiles: DriveFile[] | null
  /** Whether the last pull of setlists failed to read some file, so it may not know them all */
  pullIncomplete: boolean
  /** Whether the user can only read the folder, as the last check found (null: not asked) */
  readOnly: boolean | null
  /** How many records the last pull left alone, for a user who can only read (sync/pull.ts) */
  heldBack = 0

  /**
   * @param options.db - Database to sync. Defaults to the current organisation's database.
   *   Tests pass one per simulated device.
   * @param options.folderLink - Where the link to the organisation's Drive folder is stored.
   *   Defaults to its record in the organisations database.
   * @param options.memberCache - Where the folder's members are cached. Defaults to the
   *   organisation's record.
   */
  constructor(
    organisationName: string,
    organisationId: string | null,
    { db = null, folderLink = null, memberCache = null }: DriveSyncOptions = {}
  ) {
    this.organisationName = organisationName
    this.organisationId = organisationId
    this.organisationDb = db
    this.folderLink = folderLink
    this.memberCache = memberCache
    this.driveFolderId = null
    this.parser = new ChordProParser()

    // Performance optimizations
    this._folderCache = new Map<string, string>() // Cache folder IDs during sync

    // Drive file inventory (for existence checks)
    this._driveFileIds = null // Set of file IDs that exist in Drive
    this.liveSetlistFiles = null
    this.pullIncomplete = false
    this.readOnly = null
  }

  /** The database, once init() has set it */
  get db(): ChordlessDB {
    if (!this.organisationDb) throw new Error('DriveSyncManager is not initialised: call init()')
    return this.organisationDb
  }

  get #folderLink(): FolderLink {
    if (!this.folderLink) throw new Error('DriveSyncManager is not initialised: call init()')
    return this.folderLink
  }

  get #memberCache(): MemberCache {
    if (!this.memberCache) throw new Error('DriveSyncManager is not initialised: call init()')
    return this.memberCache
  }

  /** The organisation's Drive folder, once found */
  get folderId(): string {
    if (!this.driveFolderId) throw new Error('The Drive folder is not known yet: call init()')
    return this.driveFolderId
  }

  async init(): Promise<boolean> {
    // Initialize database
    if (this.organisationDb) {
      this.organisationId ??= this.organisationDb.organisationId
    } else {
      // Reuse the same DB instance the UI uses
      this.organisationDb = await getCurrentDB()
      // Ensure we keep the actual organisation ID from the DB (in case caller passed null)
      this.organisationId = this.organisationDb.organisationId
    }

    // (the id is known by now: given, or the database's)
    const organisationId = this.organisationId as string
    this.folderLink ??= organisationFolderLink(organisationId)
    this.memberCache ??= organisationMemberCache(organisationId)
    const isNew = await this.resolveDriveFolder()
    return isNew
  }

  /**
   * Find this organisation's Drive folder. Once linked (stored after the first
   * sync) it's used by ID, so renaming the organisation can't point sync at a
   * different folder. The first sync finds or creates it by name and links it.
   * @returns whether the folder was newly created
   */
  async resolveDriveFolder(): Promise<boolean> {
    const linkedId = await this.#folderLink.get()

    if (linkedId) {
      const folder = await DriveAPI.getFile(linkedId, 'id,name,trashed')
      if (!folder || folder.trashed) {
        throw new Error(
          `This organisation's Google Drive folder ${folder ? `"${folder.name}" is in the Drive trash` : 'no longer exists'}. ` +
            'Restore it from the Drive trash, or reset this organisation, before syncing.'
        )
      }
      this.driveFolderId = folder.id
      if (folder.name !== this.organisationName) {
        await this.followRename(folder)
      }
      return false
    }

    const result = await DriveAPI.findOrCreateOrganisationFolder(
      this.organisationName,
      this.organisationId as string
    )
    this.driveFolderId = result.folderId
    await this.#folderLink.set(result.folderId)
    return result.isNew
  }

  /**
   * The organisation was renamed since it was linked to `folder`. If another
   * organisation folder already has the new name (e.g. another device created
   * it) and this device has nothing synced yet, join that folder. Otherwise
   * rename the linked folder to match, unless that name is taken.
   */
  async followRename(folder: DriveFile): Promise<void> {
    const existing = await DriveAPI.findOrganisationFolderByName(this.organisationName)

    if (existing && existing.id !== folder.id) {
      if (!(await this.hasSyncedRecords())) {
        this.driveFolderId = existing.id
        await this.#folderLink.set(existing.id)
        return
      }
      console.warn(
        `[DriveSync] Not renaming Drive folder "${folder.name}" to "${this.organisationName}": ` +
          'another folder already has that name. Syncing continues with the linked folder.'
      )
      return
    }

    await DriveAPI.renameFile(folder.id, this.organisationName)
  }

  /** Whether any local setlist or song has been synced to Drive */
  async hasSyncedRecords(): Promise<boolean> {
    const records = [...(await this.db.getAllSetlists()), ...(await this.db.getAllSongs())]
    return records.some(record => record.driveFileId)
  }

  /** The organisation's songs folder in Drive (looked up once per sync) */
  async songsFolder(): Promise<string> {
    let folderId = this._folderCache.get('songs')
    if (folderId === undefined) {
      folderId = await getSongsFolder(this.folderId)
      this._folderCache.set('songs', folderId)
    }
    return folderId
  }

  /** The organisation's setlists folder in Drive (looked up once per sync) */
  async setlistsFolder(): Promise<string> {
    let folderId = this._folderCache.get('setlists')
    if (folderId === undefined) {
      folderId = await getSetlistsFolder(this.folderId)
      this._folderCache.set('setlists', folderId)
    }
    return folderId
  }

  /**
   * Full sync: pull from Drive, then push local changes
   */
  async sync(progressCallback: ProgressCallback | null = null): Promise<{ success: true }> {
    progressCallback?.({ stage: 'starting', message: 'Starting sync...' })

    try {
      // Who the organisation's folder is shared with, for choosing leaders
      await this.refreshMembers()
      await this.refreshAccess()
      this.heldBack = 0

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
      this._folderCache.clear()
      this._driveFileIds = null
      this.liveSetlistFiles = null
      this.pullIncomplete = false
      this.readOnly = null
    }
    return { success: true }
  }

  /** Update and clean up this organisation's share links (see share-manager.ts) */
  async syncShares(): Promise<number> {
    try {
      return await syncShares({
        db: this.db,
        organisationId: this.organisationId,
        organisationFolderId: this.folderId,
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
      const fileIds = new Set<string>()
      await this._addFolderContentsToInventory(this.folderId, fileIds)
      this._driveFileIds = fileIds
    } catch (error) {
      // Without a complete inventory we can't tell which files are missing, so
      // skip the check (fileExistsInDrive assumes they exist). An incomplete set
      // would make every unlisted file look deleted and get re-uploaded.
      console.error('[DriveSync] Failed to build Drive inventory, skipping check:', error)
      this._driveFileIds = null
    }
  }

  /**
   * Recursively add all files in a folder to the inventory
   */
  async _addFolderContentsToInventory(folderId: string, fileIds: Set<string>): Promise<void> {
    const query = `'${folderId}' in parents and trashed=false`
    let pageToken: string | null = null

    do {
      let url =
        `/files?q=${encodeURIComponent(query)}&spaces=drive` +
        '&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000'
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`

      const result = await driveRequest(url)
      for (const file of result.files) {
        fileIds.add(file.id)

        // Recursively process subfolders
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          await this._addFolderContentsToInventory(file.id, fileIds)
        }
      }
      pageToken = result.nextPageToken || null
    } while (pageToken)
  }

  /**
   * Fetch and cache the people the organisation's Drive folder is shared with.
   * Not essential to syncing, so failures are only logged.
   */
  async refreshMembers(): Promise<OrganisationMember[] | null> {
    try {
      const members = await DriveAPI.listFolderPermissions(this.folderId)
      await this.#memberCache.set(members)
      return members
    } catch (error) {
      console.warn('[DriveSync] Could not refresh organisation members:', error)
      return null
    }
  }

  /**
   * Ask Drive whether the user can add files to the organisation's folder, and remember it
   * (on the organisation, so the app can stop offering edits that could never sync). If Drive
   * can't be asked, the user is taken to have write access, as before: nothing changes.
   * @returns whether the user can only read the folder
   */
  async refreshAccess(): Promise<boolean> {
    let canAdd: boolean | undefined
    try {
      const folder = await DriveAPI.getFile(this.folderId, 'id,capabilities')
      canAdd = folder?.capabilities?.canAddChildren
    } catch (error) {
      console.warn('[DriveSync] Could not check access to the organisation folder:', error)
    }
    this.readOnly = canAdd === false
    if (canAdd !== undefined) {
      try {
        await this.#memberCache.setReadOnly?.(this.readOnly)
      } catch (error) {
        console.warn('[DriveSync] Could not record the access to the organisation folder:', error)
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
   * Throw OrganisationFolderMismatchError if local records point to Drive files
   * that exist outside this organisation's folder. Sync treats records missing
   * from the folder as deleted and re-uploads them; for files that actually live
   * in another folder that would duplicate them, so stop instead. Needs the
   * inventory; skipped if it couldn't be built.
   */
  async assertRecordsInThisFolder(): Promise<void> {
    if (!this._driveFileIds) return

    const missing = [...(await this.db.getAllSetlists()), ...(await this.db.getAllSongs())].filter(
      record => record.driveFileId && !this.fileExistsInDrive(record.driveFileId)
    )

    let elsewhere = 0
    for (const record of missing) {
      const file = await DriveAPI.getFile(record.driveFileId as string, 'id,trashed')
      if (file && !file.trashed) elsewhere++
    }
    if (elsewhere > 0) {
      throw new OrganisationFolderMismatchError(elsewhere, this.organisationName)
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
      if (!setlist.driveFileId || this.fileExistsInDrive(setlist.driveFileId)) continue
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
  fileExistsInDrive(driveFileId: string): boolean {
    if (!this._driveFileIds) {
      // Inventory not built, assume file exists (conservative)
      return true
    }
    return this._driveFileIds.has(driveFileId)
  }

  /**
   * Whether a local record has no Drive file to be found: it never had one, or the one it
   * had is no longer in the folder. (With no inventory, any file is assumed to be there.)
   */
  isOrphaned(record: { driveFileId?: string | null }): boolean {
    return !record.driveFileId || !this.fileExistsInDrive(record.driveFileId)
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
      this._folderCache.clear()
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
    const refusals = DriveAPI.countWriteRefusals()
    try {
      await this.#pushAll(progressCallback)
    } catch (error) {
      if (!(await this.foundToBeReadOnly())) throw error
      return
    }
    // Writes that failed were tried again and left for the next sync: were they refused?
    if (DriveAPI.countWriteRefusals() > refusals) await this.foundToBeReadOnly()
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
  return DriveAPI.checkDriveAccess()
}

/**
 * Create a sync manager for an organisation
 */
export async function createSyncManager(
  organisationName: string,
  organisationId: string | null
): Promise<DriveSyncManager> {
  const manager = new DriveSyncManager(organisationName, organisationId)
  await manager.init()
  return manager
}
