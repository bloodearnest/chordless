/**
 * Google Drive Sync Manager
 *
 * Handles bidirectional sync between local IndexedDB and Google Drive.
 *
 * Sync Strategy:
 * - Track sync state in local database (lastSyncedAt, driveFileId, driveModifiedTime)
 * - Push: Upload local changes that haven't been synced
 * - Pull: Download Drive changes that are newer than local
 * - Conflict: If both changed, prefer Drive (or offer manual resolution)
 *
 * ⚠️ NOTE ⚠️
 * Pull-side logic still needs to be brought in line with the new flattened song variant
 * model, but the push path now targets the per-organisation ChordlessDB schema.
 */

import type {
  ChordProRecord,
  DriveFile,
  OrganisationMember,
  Setlist,
  SongDriveProperties,
  SongInput,
  SongRecord,
} from './data-types.ts'
import { type ChordlessDB, getCurrentDB, normalizeTitle, withNumericTempos } from './db.ts'
import * as DriveAPI from './drive-api.ts'
import {
  batchUploadFiles,
  type DriveUpload,
  driveRequest,
  getSetlistsFolder,
  getSongsFolder,
} from './drive-api.ts'
import {
  forUpdate,
  setlistFileMetadata,
  songFileDetails,
  songFileMetadata,
} from './drive-metadata.ts'
import { setOrganisationReadOnly } from './organisation.ts'
import { OrganisationDB } from './organisation-db.ts'
import { ChordProParser } from './parser.ts'
import { syncShares } from './share-manager.ts'
import { chartFields, hashText } from './song-utils.ts'
import { setlistContent, setlistContentHash } from './sync/setlist-hash.ts'
import { md5Hex } from './utils/md5.ts'

/** A setlist's file content in Drive */
function setlistJson(setlist: Setlist): string {
  return JSON.stringify(setlistContent(setlist), null, 2)
}

export { setlistContent, setlistContentHash }

/** What a sync reports while it runs */
export interface SyncProgress {
  stage: 'starting' | 'scanning' | 'pulling' | 'pushing' | 'clearing' | 'complete' | 'error'
  message: string
  current?: number
  total?: number
}

export type ProgressCallback = (progress: SyncProgress) => void

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

/** A chord chart in Drive that a pull has decided to download */
interface SongDownload {
  songUuid: string
  file: DriveFile
  props: Record<string, string>
  localSong: SongRecord | undefined
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

/** The id of the setlist a Drive file holds: from its properties, or its name (`<id>.json`) */
export function setlistIdOf(file: DriveFile): string {
  return file.appProperties?.setlistId || (file.name ?? '').replace('.json', '')
}

/** What a record keeps of its Drive file: when it was modified, and its checksum */
export function driveMarkers(file: DriveFile | null | undefined) {
  return { driveModifiedTime: file?.modifiedTime ?? null, driveChecksum: file?.md5Checksum ?? null }
}

/** What makes two setlist records the same setlist, whatever their ids */
const setlistKey = (setlist: Setlist) =>
  [setlist.date, setlist.time, setlist.owner, setlist.type, setlist.name].join('|')

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
export class DriveSyncManager {
  organisationName: string
  organisationId: string | null
  organisationDb: ChordlessDB | null
  folderLink: FolderLink | null
  memberCache: MemberCache | null
  driveFolderId: string | null
  parser: ChordProParser
  _folderCache: Map<string, string>
  CONCURRENT_LIMIT: number
  /** The ids of the files in the organisation's Drive folder, once listed */
  _driveFileIds: Set<string> | null
  /** The setlist files in Drive, as listed by the last pull */
  _liveSetlistFiles: DriveFile[] | null
  /** Whether the last pull of setlists failed to read some file, so it may not know them all */
  _pullIncomplete: boolean
  /** Whether the user can only read the folder, as the last check found (null: not asked) */
  readOnly: boolean | null

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
    this.CONCURRENT_LIMIT = 10 // Process 10 files at a time

    // Drive file inventory (for existence checks)
    this._driveFileIds = null // Set of file IDs that exist in Drive
    this._liveSetlistFiles = null
    this._pullIncomplete = false
    this.readOnly = null
  }

  /** The database, once init() has set it */
  get #db(): ChordlessDB {
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
  get #folderId(): string {
    if (!this.driveFolderId) throw new Error('The Drive folder is not known yet: call init()')
    return this.driveFolderId
  }

  async init(): Promise<boolean> {
    console.log(`[DriveSync] Initializing sync for: ${this.organisationName}`)

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
    console.log(`[DriveSync] Organisation folder ID: ${this.driveFolderId}`)
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
        console.log(
          `[DriveSync] Joining existing Drive folder "${this.organisationName}" instead of "${folder.name}"`
        )
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

    console.log(`[DriveSync] Renaming Drive folder "${folder.name}" to "${this.organisationName}"`)
    await DriveAPI.renameFile(folder.id, this.organisationName)
  }

  /** Whether any local setlist or song has been synced to Drive */
  async hasSyncedRecords(): Promise<boolean> {
    const records = [...(await this.#db.getAllSetlists()), ...(await this.#db.getAllSongs())]
    return records.some(record => record.driveFileId)
  }

  /**
   * Get cached folder ID (avoids repeated API calls)
   */
  async getCachedSongsFolder(): Promise<string> {
    let folderId = this._folderCache.get('songs')
    if (folderId === undefined) {
      folderId = await getSongsFolder(this.#folderId)
      this._folderCache.set('songs', folderId)
    }
    return folderId
  }

  async getCachedSetlistsFolder(): Promise<string> {
    let folderId = this._folderCache.get('setlists')
    if (folderId === undefined) {
      folderId = await getSetlistsFolder(this.#folderId)
      this._folderCache.set('setlists', folderId)
    }
    return folderId
  }

  /**
   * Full sync: pull from Drive, then push local changes
   */
  async sync(progressCallback: ProgressCallback | null = null): Promise<{ success: true }> {
    console.log('[DriveSync] Starting full sync...')

    if (progressCallback) progressCallback({ stage: 'starting', message: 'Starting sync...' })

    try {
      // Who the organisation's folder is shared with, for choosing leaders
      await this.refreshMembers()
      await this.refreshAccess()

      // Before changing anything, check local records belong to this folder
      if (progressCallback)
        progressCallback({ stage: 'scanning', message: 'Checking Drive files...' })
      await this.buildDriveInventory()
      await this.assertRecordsInThisFolder()

      // First, pull changes from Drive
      if (progressCallback)
        progressCallback({ stage: 'pulling', message: 'Downloading from Drive...' })
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
          if (progressCallback)
            progressCallback({ stage: 'pushing', message: 'Uploading to Drive...' })
          await this.pushToDrive(progressCallback)
        }
      } catch (error) {
        if (!(await this.foundToBeReadOnly())) throw error
      }

      if (progressCallback) {
        progressCallback({
          stage: 'complete',
          message: this.readOnly ? 'Sync complete (view-only: nothing uploaded)' : 'Sync complete!',
        })
      }

      console.log('[DriveSync] Full sync complete')
    } catch (error) {
      console.error('[DriveSync] Sync failed:', error)
      if (progressCallback) {
        progressCallback({
          stage: 'error',
          message: `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
      throw error
    } finally {
      // Clear caches after sync
      this._folderCache.clear()
      this._driveFileIds = null
      this._liveSetlistFiles = null
      this._pullIncomplete = false
      this.readOnly = null
    }
    return { success: true }
  }

  /** Update and clean up this organisation's share links (see share-manager.ts) */
  async syncShares(): Promise<number> {
    try {
      return await syncShares({
        db: this.#db,
        organisationId: this.organisationId,
        organisationFolderId: this.#folderId,
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
    console.log('[DriveSync] Building Drive file inventory...')

    try {
      const fileIds = new Set<string>()
      await this._addFolderContentsToInventory(this.#folderId, fileIds)
      this._driveFileIds = fileIds
      console.log(`[DriveSync] Drive inventory: ${fileIds.size} files found`)
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
      const members = await DriveAPI.listFolderPermissions(this.#folderId)
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
      const folder = await DriveAPI.getFile(this.#folderId, 'id,capabilities')
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
    const readOnly = await this.refreshAccess()
    if (readOnly) console.log('[DriveSync] Writing was refused: the user can only read the folder')
    return readOnly
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

    const missing = [
      ...(await this.#db.getAllSetlists()),
      ...(await this.#db.getAllSongs()),
    ].filter(record => record.driveFileId && !this.fileExistsInDrive(record.driveFileId))

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
    for (const setlist of await this.#db.getAllSetlists()) {
      if (!setlist.driveFileId || this.fileExistsInDrive(setlist.driveFileId)) continue
      if (this.hasLiveFileOfItsOwn(setlist)) continue
      if (this.setlistHasLocalChanges(setlist)) continue
      console.log(
        `[DriveSync] Removing setlist ${setlist.id}: its Drive file ${setlist.driveFileId} is gone`
      )
      await this.#db.deleteSetlist(setlist.id)
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
   * Smart skip detection: Check if setlist needs syncing
   * Uses content hash comparison and Drive existence check
   */
  async setlistNeedsSync(setlist: Setlist): Promise<boolean> {
    // If never synced, needs sync
    if (!setlist.driveFileId) {
      return true
    }

    // Check if file actually exists in Drive
    if (!this.fileExistsInDrive(setlist.driveFileId)) {
      console.log(
        `[DriveSync] Setlist ${setlist.id} missing from Drive (driveFileId: ${setlist.driveFileId}) - forcing re-upload`
      )
      return true
    }

    return this.setlistHasLocalChanges(setlist)
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
    return (this._liveSetlistFiles ?? []).some(file => setlistIdOf(file) === setlist.id)
  }

  /**
   * Another setlist, with a live Drive file, for the same date, time, leader, type and name
   */
  syncedTwinOf(setlist: Setlist, setlists: Setlist[]): Setlist | undefined {
    const key = setlistKey(setlist)
    return setlists.find(
      other =>
        other.id !== setlist.id &&
        setlistKey(other) === key &&
        ((other.driveFileId && this.fileExistsInDrive(other.driveFileId)) ||
          this.hasLiveFileOfItsOwn(other))
    )
  }

  /**
   * Whether a setlist has local changes that aren't in Drive: never uploaded,
   * or edited since its last sync. Ignores whether its Drive file still exists.
   */
  setlistHasLocalChanges(setlist: Setlist): boolean {
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
   * Smart skip detection: Check if song version needs syncing
   * Uses content hash comparison and Drive existence check
   */
  async songNeedsSync(song: SongRecord, chordproFile: ChordProRecord): Promise<boolean> {
    // If never synced, needs sync
    if (!song.driveFileId) {
      return true
    }

    // Check if file actually exists in Drive
    if (!this.fileExistsInDrive(song.driveFileId)) {
      const songUuid = this.getSongUuid(song)
      console.log(
        `[DriveSync] Song ${song.id}/${songUuid} missing from Drive (driveFileId: ${song.driveFileId}) - forcing re-upload`
      )
      return true
    }

    return this.songHasLocalChanges(song, chordproFile)
  }

  /**
   * Whether a song has local changes that aren't in Drive: never uploaded, or
   * its chart edited since its last sync. Ignores whether its Drive file exists.
   */
  songHasLocalChanges(song: SongRecord, chordproFile: ChordProRecord): boolean {
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
      await this.#db.clearSyncedData()

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
    for (const setlist of await this.#db.getAllSetlists()) {
      if (this.setlistHasLocalChanges(setlist)) {
        const label = [setlist.date, setlist.name].filter(Boolean).join(' ')
        unsynced.push({ type: 'setlist', id: setlist.id, label })
      }
    }
    for (const song of await this.#db.getAllSongs()) {
      if (!song.chordproFileId) continue
      const chordproFile = await this.#db.getChordPro(song.chordproFileId)
      if (chordproFile && this.songHasLocalChanges(song, chordproFile)) {
        unsynced.push({ type: 'song', id: this.getSongUuid(song), label: song.title || '' })
      }
    }
    return unsynced
  }

  /**
   * Pull changes from Drive to local
   */
  async pullFromDrive(progressCallback: ProgressCallback | null = null): Promise<void> {
    console.log('[DriveSync] Pulling from Drive...')

    // Pull setlists
    if (progressCallback)
      progressCallback({ stage: 'pulling', message: 'Checking setlists...', current: 0, total: 1 })
    await this.pullSetlists(progressCallback)

    // Pull songs (chordpro files)
    if (progressCallback)
      progressCallback({ stage: 'pulling', message: 'Checking songs...', current: 0, total: 1 })
    await this.pullSongs(progressCallback)

    console.log('[DriveSync] Pull complete')
  }

  /**
   * Pull setlists from Drive (with batch database operations)
   */
  async pullSetlists(progressCallback: ProgressCallback | null = null): Promise<void> {
    console.log('[DriveSync] Pulling setlists...')

    // Get all setlists from Drive
    const driveSetlists = await DriveAPI.listSetlists(this.#folderId)
    console.log(`[DriveSync] Found ${driveSetlists.length} setlists in Drive`)
    this._liveSetlistFiles = driveSetlists
    this._pullIncomplete = false

    const downloadQueue: {
      driveFile: DriveFile
      setlistId: string
      localSetlist?: Setlist
      /** The local record's own Drive file is gone: this live file is taking its place */
      adopt?: boolean
    }[] = []
    const adopted = new Set<string>()

    for (const driveFile of driveSetlists) {
      try {
        const setlistId = setlistIdOf(driveFile)

        // Check if we have this setlist locally
        const localSetlist = await this.#db.getSetlist(setlistId)

        if (!localSetlist) {
          // New setlist, download it
          console.log(`[DriveSync] Downloading new setlist: ${setlistId}`)
          downloadQueue.push({ driveFile, setlistId })
        } else if (localSetlist.driveFileId === driveFile.id) {
          // Drive's content changed since our last sync if its md5Checksum (computed
          // by Drive) differs from the one we recorded. No clocks involved.
          if (driveFile.md5Checksum !== localSetlist.driveChecksum) {
            downloadQueue.push({ driveFile, setlistId, localSetlist })
          }
        } else if (!adopted.has(setlistId) && this.isOrphaned(localSetlist)) {
          // The Drive file this device knew is gone (e.g. duplicates were cleaned up), yet
          // another live file holds this setlist: take that one over rather than uploading
          // a copy of it
          console.log(`[DriveSync] Adopting ${driveFile.id} for setlist ${setlistId}`)
          adopted.add(setlistId)
          downloadQueue.push({ driveFile, setlistId, localSetlist, adopt: true })
        }
      } catch (error) {
        this._pullIncomplete = true
        console.error(`[DriveSync] Failed to pull setlist ${driveFile.name}:`, error)
      }
    }

    if (downloadQueue.length === 0) {
      if (progressCallback) {
        progressCallback({
          stage: 'pulling',
          message: 'Setlists already up to date',
          current: 1,
          total: 1,
        })
      }
      return
    }

    if (progressCallback) {
      progressCallback({
        stage: 'pulling',
        message: `Downloading ${downloadQueue.length} setlists...`,
        current: 0,
        total: downloadQueue.length,
      })
    }

    const setlistsToSave: Setlist[] = []
    let completed = 0
    for (let i = 0; i < downloadQueue.length; i += this.CONCURRENT_LIMIT) {
      const batch = downloadQueue.slice(i, i + this.CONCURRENT_LIMIT)

      const results = await Promise.allSettled(
        batch.map(async ({ driveFile, setlistId, localSetlist, adopt }) => {
          // Older setlists in Drive may hold a chart's text as a tempo. Saving
          // converts it too, but convert first: the hash recorded as synced must
          // be of what's stored, or the setlist would look edited here
          const remote = withNumericTempos(await DriveAPI.downloadSetlist(driveFile.id))
          const remoteHash = setlistContentHash(remote)

          if (adopt && localSetlist) {
            const localHash = setlistContentHash(localSetlist)
            const syncedHash = localSetlist.syncedContentHash
            if (localHash === remoteHash) {
              // The same content: only the file it points at changes
              return {
                ...localSetlist,
                driveFileId: driveFile.id,
                driveModifiedTime: driveFile.modifiedTime,
                driveChecksum: driveFile.md5Checksum,
                lastSyncedAt: new Date().toISOString(),
                syncedContentHash: remoteHash,
              }
            }
            if (!syncedHash || localHash !== syncedHash) {
              // Edited here (or never synced): keep it, and the next push updates the live file
              console.warn(`[DriveSync] Setlist ${setlistId} has local changes: keeping them`)
              return {
                ...localSetlist,
                driveFileId: driveFile.id,
                driveModifiedTime: driveFile.modifiedTime,
                driveChecksum: driveFile.md5Checksum,
              }
            }
            // Unchanged here since it was synced, and Drive's copy differs: Drive's is newer
          }

          if (localSetlist?.syncedContentHash === remoteHash) {
            // Same content as we last synced, e.g. a record from before checksums
            // were recorded. Not a remote change: keep local edits, record checksum.
            return {
              ...localSetlist,
              driveModifiedTime: driveFile.modifiedTime,
              driveChecksum: driveFile.md5Checksum,
            }
          }
          if (localSetlist && this.setlistHasLocalChanges(localSetlist)) {
            // Changed both here and in Drive. For now Drive wins.
            // TODO: Implement proper conflict resolution
            console.warn(`[DriveSync] ⚠️ Conflict for setlist ${setlistId}, keeping Drive version`)
          }

          return {
            ...setlistContent(remote),
            id: remote.id || setlistId,
            driveFileId: driveFile.id,
            driveModifiedTime: driveFile.modifiedTime,
            driveChecksum: driveFile.md5Checksum,
            lastSyncedAt: new Date().toISOString(),
            syncedContentHash: remoteHash,
          }
        })
      )

      results.forEach(result => {
        if (result.status === 'fulfilled') {
          setlistsToSave.push(result.value)
          completed++
          if (progressCallback) {
            progressCallback({
              stage: 'pulling',
              message: `Downloaded ${completed}/${downloadQueue.length} setlists`,
              current: completed,
              total: downloadQueue.length,
            })
          }
        } else {
          this._pullIncomplete = true
          console.error('[DriveSync] Failed to download setlist:', result.reason)
        }
      })
    }

    if (setlistsToSave.length > 0) {
      await this.#db.saveSetlistsBatch(setlistsToSave)
      console.log(`[DriveSync] ✅ Synced ${setlistsToSave.length} setlists from Drive`)
    }
  }

  /**
   * Pull songs from Drive
   *
   * Validation: Handle user-copied files
   * When users copy files in Drive, appProperties are also copied, which can create
   * duplicate versionId values (multiple files with same versionId but different driveFileId)
   *
   * Detection and auto-fix strategy:
   * 1. List all chordpro files in songs/ folder with appProperties
   * 2. Group by songId
   * 3. For each song, detect duplicate versionId values:
   *    - If multiple files have same versionId but different driveFileId
   *    - Generate new unique versionId for the duplicate
   *    - Update Drive file's appProperties with corrected versionId and versionLabel
   * 4. Download/update local database with corrected metadata
   * 5. Parse chordpro content and create/update song records
   */
  async pullSongs(progressCallback: ProgressCallback | null = null): Promise<void> {
    console.log('[DriveSync] Pulling songs...')

    const songsFolderId = await this.getCachedSongsFolder()
    const driveFiles = await this.listDriveSongFiles(songsFolderId)
    console.log(`[DriveSync] Found ${driveFiles.length} chord charts in Drive`)

    const latestByUuid = new Map<
      string,
      { file: DriveFile; props: Record<string, string>; songUuid: string; driveModified: Date }
    >()
    for (const file of driveFiles) {
      const props = file.appProperties || {}
      if (props.type && props.type !== 'chordpro') continue
      const songUuid = this.getDriveSongUuid(props, file.id)
      const driveModified = new Date(file.modifiedTime || file.createdTime || 0)
      const existing = latestByUuid.get(songUuid)
      if (existing && driveModified <= existing.driveModified) {
        if (driveModified.getTime() !== existing.driveModified.getTime()) {
          console.warn(`[DriveSync] Duplicate chord chart for ${songUuid}, keeping newer file`)
        }
        continue
      }
      if (existing) {
        console.warn(`[DriveSync] Duplicate chord chart for ${songUuid}, replacing with newer file`)
      }
      latestByUuid.set(songUuid, { file, props, songUuid, driveModified })
    }

    if (latestByUuid.size === 0) {
      console.log('[DriveSync] No chord charts found in Drive')
      if (progressCallback) {
        progressCallback({
          stage: 'pulling',
          message: 'No songs found in Drive',
          current: 1,
          total: 1,
        })
      }
      return
    }

    const downloads: SongDownload[] = []
    for (const entry of latestByUuid.values()) {
      const { songUuid, file, props } = entry
      const localSong = await this.#db.getSong(songUuid)
      const chordproRecord = localSong?.chordproFileId
        ? await this.#db.getChordPro(localSong.chordproFileId)
        : null

      let needsDownload = false
      if (!localSong) {
        needsDownload = true
      } else if (!localSong.driveFileId || localSong.driveFileId !== file.id) {
        needsDownload = true
      } else if (file.md5Checksum !== localSong.driveChecksum) {
        // Drive's content changed since our last sync: its md5Checksum (computed
        // by Drive) differs from the one we recorded
        needsDownload = true
      } else if (!chordproRecord) {
        needsDownload = true
      }

      if (needsDownload) {
        downloads.push({ songUuid, file, props, localSong })
      }
    }

    if (downloads.length === 0) {
      console.log('[DriveSync] Local song library already up to date')
      if (progressCallback) {
        progressCallback({
          stage: 'pulling',
          message: 'Songs already up to date',
          current: 1,
          total: 1,
        })
      }
      return
    }

    console.log(`[DriveSync] Downloading ${downloads.length} songs from Drive...`)
    let downloaded = 0

    if (progressCallback) {
      progressCallback({
        stage: 'pulling',
        message: `Downloading ${downloads.length} songs...`,
        current: 0,
        total: downloads.length,
      })
    }

    for (let i = 0; i < downloads.length; i += this.CONCURRENT_LIMIT) {
      const batch = downloads.slice(i, i + this.CONCURRENT_LIMIT)
      const results = await Promise.allSettled(batch.map(item => this.downloadSongFromDrive(item)))

      const succeeded = results.filter(r => r.status === 'fulfilled').length
      downloaded += succeeded
      if (progressCallback && succeeded > 0) {
        progressCallback({
          stage: 'pulling',
          message: `Downloaded ${downloaded}/${downloads.length} songs`,
          current: downloaded,
          total: downloads.length,
        })
      }

      results
        .filter(r => r.status === 'rejected')
        .forEach(result => {
          console.error('[DriveSync] Failed to download song:', result.reason)
        })
    }

    console.log(`[DriveSync] ✅ Pulled ${downloaded} songs from Drive`)
  }

  async listDriveSongFiles(folderId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let pageToken: string | null = null

    do {
      const query = `'${folderId}' in parents and trashed=false and mimeType='text/plain'`
      let url =
        `/files?q=${encodeURIComponent(
          query
        )}&spaces=drive&fields=nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,md5Checksum,appProperties,size)` +
        '&pageSize=1000'
      if (pageToken) {
        url += `&pageToken=${pageToken}`
      }

      const result = await driveRequest(url)
      files.push(...result.files)
      pageToken = result.nextPageToken || null
    } while (pageToken)

    return files
  }

  getDriveSongUuid(props: Record<string, string>, fallbackId: string): string {
    return props.songUuid || props.versionId || props.songId || fallbackId
  }

  getTitleFromFilename(filename: string | undefined): string {
    if (!filename) return 'Untitled'
    return filename.replace(/\.[^/.]+$/, '')
  }

  async downloadSongFromDrive({ songUuid, file, props, localSong }: SongDownload): Promise<void> {
    const chordproContent = await DriveAPI.downloadChordProFile(file.id)
    const remoteHash = hashText(chordproContent)
    const localChart = localSong?.chordproFileId
      ? await this.#db.getChordPro(localSong.chordproFileId)
      : undefined

    // (with the chart gone from this device, it is restored from Drive's, whatever the hash)
    if (
      localChart &&
      localSong?.driveFileId === file.id &&
      localSong.syncedContentHash === remoteHash
    ) {
      // Same chart as we last synced, e.g. a record from before checksums were
      // recorded. Not a remote change: keep local edits, record the checksum.
      await this.#db.saveSong({
        ...localSong,
        ...driveMarkers(file),
      })
      return
    }
    if (localSong && localChart && this.songHasLocalChanges(localSong, localChart)) {
      // Changed both here and in Drive. For now Drive wins.
      console.warn(`[DriveSync] ⚠️ Conflict for song ${songUuid}, keeping Drive version`)
    }

    const chordproFileId = localSong?.chordproFileId || `chordpro-${crypto.randomUUID()}`

    const parsed = this.parser.parse(chordproContent)
    const { metadata } = parsed
    const ccliNumber =
      metadata.ccliSongNumber || metadata.ccli || props.ccliNumber || localSong?.ccliNumber || null
    const title =
      metadata.title || props.title || localSong?.title || this.getTitleFromFilename(file.name)
    const titleNormalized = normalizeTitle(title)
    const deterministicId =
      props.songId ||
      localSong?.id ||
      (ccliNumber ? `ccli-${ccliNumber}` : `title-${titleNormalized}`)
    const variantLabel = props.variantLabel || localSong?.variantLabel || 'Original'
    const contentHash = remoteHash

    await this.#db.saveChordPro({
      id: chordproFileId,
      content: chordproContent,
      contentHash,
      lastModified: new Date(file.modifiedTime || Date.now()).getTime(),
    })

    // The chart's fields, as for an imported song, falling back to this device's copy for
    // any the chart lacks
    const chart = chartFields(metadata)
    const songRecord: SongInput = {
      uuid: songUuid,
      id: deterministicId,
      variantOf: props.variantOf || localSong?.variantOf || null,
      isDefault: props.isDefault === 'true' || localSong?.isDefault || !props.variantOf,
      variantLabel,
      chordproFileId,
      ccliNumber,
      title,
      titleNormalized,
      author: chart.author ?? localSong?.author ?? null,
      copyright: chart.copyright ?? localSong?.copyright ?? null,
      key: chart.key ?? localSong?.key ?? null,
      originalKey: chart.originalKey ?? localSong?.originalKey ?? null,
      tempo: chart.tempo ?? localSong?.tempo ?? null,
      originalTempo: chart.originalTempo ?? localSong?.originalTempo ?? null,
      time: chart.time ?? localSong?.time ?? null,
      importDate:
        localSong?.importDate || props.importDate || file.createdTime || new Date().toISOString(),
      importUser: localSong?.importUser || props.importUser || null,
      importSource: 'drive',
      sourceUrl: localSong?.sourceUrl || null,
      modifiedDate: new Date(file.modifiedTime || file.createdTime || Date.now()).toISOString(),
      driveFileId: file.id,
      ...driveMarkers(file),
      lastSyncedAt: new Date().toISOString(),
      syncedContentHash: remoteHash,
      driveProperties: {
        songId: deterministicId,
        songUuid,
        contentHash,
        ccliNumber: ccliNumber || '',
        title,
        titleNormalized,
        variantLabel,
        appVersion: props.appVersion || '1.0.0',
      },
      contentHash,
    }

    await this.#db.saveSong(songRecord)
  }

  /**
   * Push local changes to Drive
   */
  async pushToDrive(progressCallback: ProgressCallback | null = null): Promise<void> {
    if (this.readOnly ?? (await this.refreshAccess())) {
      console.log('[DriveSync] View-only access: nothing to push')
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
    console.log('[DriveSync] Pushing to Drive...')

    // Build inventory of existing Drive files
    if (progressCallback)
      progressCallback({ stage: 'scanning', message: 'Checking Drive files...' })
    await this.buildDriveInventory()

    // Push setlists
    if (progressCallback)
      progressCallback({
        stage: 'pushing',
        message: 'Scanning setlists...',
        current: 0,
        total: 1,
      })
    await this.pushSetlists(progressCallback)

    // Push songs (chordpro files)
    if (progressCallback)
      progressCallback({
        stage: 'pushing',
        message: 'Scanning songs...',
        current: 0,
        total: 1,
      })
    await this.pushSongs(progressCallback)

    console.log('[DriveSync] Push complete')
  }

  /**
   * Push setlists to Drive (with batch upload for new files)
   */
  async pushSetlists(progressCallback: ProgressCallback | null = null): Promise<void> {
    console.log('[DriveSync] Pushing setlists...')

    const localSetlists = await this.#db.getAllSetlists()
    console.log(`[DriveSync] Found ${localSetlists.length} local setlists`)

    // Filter to only setlists that need syncing (using smart detection)
    const setlistsToSync: Setlist[] = []
    for (const setlist of localSetlists) {
      if (await this.setlistNeedsSync(setlist)) {
        setlistsToSync.push(setlist)
      }
    }

    const neverUploaded = setlistsToSync.filter(setlist => !setlist.driveFileId).length
    const missing = setlistsToSync.filter(
      setlist => setlist.driveFileId && !this.fileExistsInDrive(setlist.driveFileId)
    ).length
    console.log(
      `[DriveSync] ${setlistsToSync.length} setlists need syncing: ${neverUploaded} never uploaded, ` +
        `${missing} missing from Drive, ${setlistsToSync.length - neverUploaded - missing} edited here`
    )
    if (progressCallback) {
      progressCallback({
        stage: 'pushing',
        message: `Uploading ${setlistsToSync.length} setlists...`,
        current: 0,
        total: Math.max(1, setlistsToSync.length),
      })
    }

    // Separate new setlists from updates (also check Drive existence)
    const newSetlists: Setlist[] = []
    const updatedSetlists: Setlist[] = []

    for (const setlist of setlistsToSync) {
      if (setlist.driveFileId && this.fileExistsInDrive(setlist.driveFileId)) {
        // Exists in Drive, needs update
        updatedSetlists.push(setlist)
      } else {
        // New or missing from Drive, needs upload
        if (setlist.driveFileId && !this.fileExistsInDrive(setlist.driveFileId)) {
          console.log(`[DriveSync] Clearing stale Drive ID for setlist ${setlist.id}`)
          setlist.driveFileId = null
          setlist.driveModifiedTime = null
          setlist.driveChecksum = null
        }
        newSetlists.push(setlist)
      }
    }

    // After a pull that could not read every file, this device may not know a twin of a setlist
    // it would create a file for. Create nothing until a pull succeeds; updates go ahead.
    if (this._pullIncomplete && newSetlists.length > 0) {
      console.warn(
        `[DriveSync] Not uploading ${newSetlists.length} new setlists: the pull could not read every file. They are retried next sync.`
      )
      newSetlists.length = 0
    }

    // A record with no file of its own that is still there, while Drive has a live file for its
    // id, waits for a pull to adopt that file (see hasLiveFileOfItsOwn)
    newSetlists.splice(
      0,
      newSetlists.length,
      ...newSetlists.filter(setlist => {
        if (!this.hasLiveFileOfItsOwn(setlist)) return true
        console.warn(
          `[DriveSync] Not uploading setlist ${setlist.id}: Drive has a file for it that this sync could not read. It is retried next sync.`
        )
        return false
      })
    )

    // A setlist never uploaded, while another setlist that has been synced is for the same date,
    // time, leader, type and name, is that setlist stored twice, e.g. two devices each made their
    // own record of it. Uploading it would duplicate it, so leave it here. The other is one with
    // a live file (the pull has just made a local record of every file in Drive, so this needs no
    // downloads) or one about to be uploaded again because its file is gone. Two records made
    // here and never uploaded are the user's own doing and are both uploaded.
    const reuploading = new Set(
      newSetlists.filter(setlist => setlist.lastSyncedAt).map(setlist => setlistKey(setlist))
    )
    const toUpload = newSetlists.filter(setlist => {
      const twin = this.syncedTwinOf(setlist, localSetlists)
      if (!twin && (setlist.lastSyncedAt || !reuploading.has(setlistKey(setlist)))) return true
      console.warn(
        `[DriveSync] Not uploading setlist ${setlist.id}: it is the same setlist as ` +
          `${twin ? `${twin.id}, which Drive has` : 'one being uploaded again'} ` +
          `(${setlist.date} ${setlist.type}). Reset this device from Google Drive to fix it.`
      )
      return false
    })
    newSetlists.splice(0, newSetlists.length, ...toUpload)

    console.log(`[DriveSync] ${newSetlists.length} new, ${updatedSetlists.length} updates`)

    let processed = 0

    // Batch upload new setlists (50 at a time)
    if (newSetlists.length > 0) {
      const setlistsFolderId = await this.getCachedSetlistsFolder()
      const BATCH_SIZE = 50

      for (let i = 0; i < newSetlists.length; i += BATCH_SIZE) {
        const batch = newSetlists.slice(i, i + BATCH_SIZE)

        // Prepare files for batch upload
        const files: DriveUpload[] = batch.map(setlist => ({
          metadata: { ...this.setlistMetadata(setlist), parents: [setlistsFolderId] },
          content: setlistJson(setlist),
          contentType: 'application/json',
        }))

        try {
          console.log(`[DriveSync] Uploading ${files.length} new setlists...`)
          const uploadedFiles = await batchUploadFiles(files)

          // Update local records with Drive metadata (batch save)
          const savedSetlists: Setlist[] = []
          for (let j = 0; j < batch.length; j++) {
            const setlist = batch[j]
            const driveFile = uploadedFiles[j]

            if (driveFile?.id) {
              setlist.driveFileId = driveFile.id
              Object.assign(setlist, driveMarkers(driveFile))
              if (this.driveHolds(driveFile, files[j].content, `setlist ${setlist.id}`)) {
                setlist.lastSyncedAt = new Date().toISOString()
                setlist.syncedContentHash = setlistContentHash(setlist)
              }
              savedSetlists.push(setlist)
              processed++
            }
          }

          // Batch save to database
          if (savedSetlists.length > 0) {
            await this.#db.saveSetlistsBatch(savedSetlists)
          }

          console.log(`[DriveSync] ✅ Uploaded ${savedSetlists.length}/${batch.length} setlists`)
        } catch (error) {
          console.error(`[DriveSync] Concurrent upload failed:`, error)
          // Fallback to sequential uploads for this batch
          for (const setlist of batch) {
            try {
              await this.pushSetlist(setlist)
              processed++
            } catch (err) {
              console.error(`[DriveSync] Failed to upload setlist ${setlist.id}:`, err)
            }
          }
        }

        // Update progress
        if (progressCallback) {
          progressCallback({
            stage: 'pushing',
            message: `Uploaded ${processed}/${setlistsToSync.length} setlists`,
            current: processed,
            total: setlistsToSync.length,
          })
        }
      }
    }

    // Process updates in parallel (individual API calls required)
    if (updatedSetlists.length > 0) {
      for (let i = 0; i < updatedSetlists.length; i += this.CONCURRENT_LIMIT) {
        const batch = updatedSetlists.slice(i, i + this.CONCURRENT_LIMIT)

        const results = await Promise.allSettled(batch.map(setlist => this.pushSetlist(setlist)))

        const succeeded = results.filter(r => r.status === 'fulfilled').length
        processed += succeeded

        // Update progress
        if (progressCallback) {
          progressCallback({
            stage: 'pushing',
            message: `Uploaded ${processed}/${setlistsToSync.length} setlists`,
            current: processed,
            total: setlistsToSync.length,
          })
        }
      }
    }

    console.log(`[DriveSync] ✅ Pushed ${processed} setlists`)
  }

  /**
   * Push a single setlist to Drive
   */
  async pushSetlist(setlist: Setlist): Promise<void> {
    try {
      if (!setlist.driveFileId) {
        // New setlist, upload it
        console.log(`[DriveSync] Uploading new setlist: ${setlist.id}`)

        const content = setlistJson(setlist)
        const driveFile = await DriveAPI.createFile(
          { ...this.setlistMetadata(setlist), parents: [await this.getCachedSetlistsFolder()] },
          content,
          'application/json'
        )

        // Update local record with Drive metadata
        setlist.driveFileId = driveFile.id
        Object.assign(setlist, driveMarkers(driveFile))
        if (this.driveHolds(driveFile, content, `setlist ${setlist.id}`)) {
          setlist.lastSyncedAt = new Date().toISOString()
          setlist.syncedContentHash = setlistContentHash(setlist)
        }
        await this.#db.saveSetlist(setlist)

        console.log(`[DriveSync] ✅ Uploaded setlist: ${setlist.id}`)
      } else {
        // Existing setlist, update it
        console.log(`[DriveSync] Updating setlist: ${setlist.id}`)

        // Metadata too, so the file name follows e.g. a changed date or leader
        const content = setlistJson(setlist)
        const driveFile = await DriveAPI.updateFile(
          setlist.driveFileId,
          forUpdate(this.setlistMetadata(setlist), 'setlist'),
          content,
          'application/json'
        )

        // Update sync metadata
        Object.assign(setlist, driveMarkers(driveFile))
        if (this.driveHolds(driveFile, content, `setlist ${setlist.id}`)) {
          setlist.lastSyncedAt = new Date().toISOString()
          setlist.syncedContentHash = setlistContentHash(setlist)
        }
        await this.#db.saveSetlist(setlist)

        console.log(`[DriveSync] ✅ Updated setlist: ${setlist.id}`)
      }
    } catch (error) {
      console.error(`[DriveSync] Failed to push setlist ${setlist.id}:`, error)
      throw error // Re-throw for Promise.allSettled
    }
  }

  /**
   * Push songs (flattened variants) to Drive
   */
  async pushSongs(progressCallback: ProgressCallback | null = null): Promise<void> {
    console.log('[DriveSync] Pushing songs...')

    const songs = await this.#db.getAllSongs()
    console.log(`[DriveSync] Found ${songs.length} local song variants`)

    const newSongs: { song: SongRecord; chordproFile: ChordProRecord }[] = []
    const updatesToProcess: { song: SongRecord; chordproFile: ChordProRecord }[] = []
    let totalVariants = 0

    for (const song of songs) {
      if (!song.chordproFileId) continue

      const chordproFile = await this.#db.getChordPro(song.chordproFileId)
      if (!chordproFile) {
        console.warn(`[DriveSync] ChordPro file not found: ${song.chordproFileId}`)
        continue
      }

      if (await this.songNeedsSync(song, chordproFile)) {
        const existsInDrive = song.driveFileId && this.fileExistsInDrive(song.driveFileId)

        if (existsInDrive) {
          updatesToProcess.push({ song, chordproFile })
        } else {
          if (song.driveFileId && !existsInDrive) {
            console.log(
              `[DriveSync] Clearing stale Drive ID for ${song.id}/${this.getSongUuid(song)}`
            )
            song.driveFileId = null
            song.driveProperties = null
            song.driveChecksum = null
          }
          newSongs.push({ song, chordproFile })
        }
        totalVariants++
      }
    }

    console.log(
      `[DriveSync] ${newSongs.length} songs need upload, ${updatesToProcess.length} need updates`
    )
    if (progressCallback) {
      progressCallback({
        stage: 'pushing',
        message: `Uploading ${totalVariants} songs...`,
        current: 0,
        total: Math.max(1, totalVariants),
      })
    }

    let processed = 0
    const songsFolderId = await this.getCachedSongsFolder()
    const BATCH_SIZE = 25

    for (let i = 0; i < newSongs.length; i += BATCH_SIZE) {
      const batch = newSongs.slice(i, i + BATCH_SIZE)
      const files: DriveUpload[] = []
      const fileTracking: { song: SongRecord; chordproFile: ChordProRecord }[] = []

      for (const { song, chordproFile } of batch) {
        files.push({
          metadata: { ...this.songMetadata(song, chordproFile), parents: [songsFolderId] },
          content: chordproFile.content,
          contentType: 'text/plain; charset=utf-8',
        })
        fileTracking.push({ song, chordproFile })
      }

      try {
        console.log(`[DriveSync] Uploading ${files.length} files...`)
        const uploadedFiles = await batchUploadFiles(files)
        const updatedSongs: SongRecord[] = []

        for (let j = 0; j < fileTracking.length; j++) {
          const tracking = fileTracking[j]
          const driveFile = uploadedFiles[j]
          if (!driveFile?.id) continue

          tracking.song.driveFileId = driveFile.id
          Object.assign(tracking.song, driveMarkers(driveFile))
          if (
            this.driveHolds(driveFile, tracking.chordproFile.content, `song ${tracking.song.id}`)
          ) {
            // (what Drive holds is kept only when it is what was sent: with other content in
            // Drive, this song differs from it, and is uploaded again)
            tracking.song.driveProperties = this.songDriveProperties(
              tracking.song,
              tracking.chordproFile
            )
            tracking.song.lastSyncedAt = new Date().toISOString()
            tracking.song.syncedContentHash = hashText(tracking.chordproFile.content)
            tracking.song.contentHash = tracking.chordproFile.contentHash
          }
          updatedSongs.push(tracking.song)
          processed++
        }

        if (updatedSongs.length > 0) {
          await this.#db.saveSongsBatch(updatedSongs)
        }

        console.log(`[DriveSync] ✅ Uploaded ${updatedSongs.length} songs`)
      } catch (error) {
        console.error(`[DriveSync] Concurrent upload failed:`, error)
        for (const { song, chordproFile } of batch) {
          try {
            await this.pushSongVariant(song, chordproFile)
            processed++
          } catch (err) {
            console.error(
              `[DriveSync] Failed to upload song ${song.id}/${this.getSongUuid(song)}:`,
              err
            )
          }
        }
      }

      if (progressCallback) {
        progressCallback({
          stage: 'pushing',
          message: `Uploaded ${processed}/${totalVariants} song variants`,
          current: processed,
          total: totalVariants,
        })
      }
    }

    if (updatesToProcess.length > 0) {
      console.log(`[DriveSync] Updating ${updatesToProcess.length} existing song variants...`)

      for (let i = 0; i < updatesToProcess.length; i += this.CONCURRENT_LIMIT) {
        const batch = updatesToProcess.slice(i, i + this.CONCURRENT_LIMIT)

        const results = await Promise.allSettled(
          batch.map(({ song, chordproFile }) => this.pushSongVariant(song, chordproFile))
        )

        const succeeded = results.filter(r => r.status === 'fulfilled').length
        processed += succeeded

        if (progressCallback) {
          progressCallback({
            stage: 'pushing',
            message: `Uploaded ${processed}/${totalVariants} song variants`,
            current: processed,
            total: totalVariants,
          })
        }
      }
    }

    console.log(`[DriveSync] ✅ Pushed ${processed} song variants`)
  }

  /**
   * Push a specific song variant to Drive
   */
  async pushSongVariant(song: SongRecord, chordproFile: ChordProRecord): Promise<void> {
    const songUuid = this.getSongUuid(song)
    try {
      const { title } = songFileDetails(song, chordproFile)
      const contentHash = hashText(chordproFile.content)
      const metadata = this.songMetadata(song, chordproFile)
      let driveFile: DriveFile

      if (!song.driveFileId) {
        console.log(`[DriveSync] Uploading song: ${title} (${song.id}/${songUuid})`)
        driveFile = await DriveAPI.createFile(
          { ...metadata, parents: [await this.getCachedSongsFolder()] },
          chordproFile.content,
          'text/plain; charset=utf-8'
        )
        song.driveFileId = driveFile.id
      } else {
        console.log(`[DriveSync] Updating song: ${title} (${song.id}/${songUuid})`)
        driveFile = await DriveAPI.updateFile(
          song.driveFileId,
          forUpdate(metadata, 'song'),
          chordproFile.content,
          'text/plain; charset=utf-8'
        )
      }

      Object.assign(song, driveMarkers(driveFile))
      if (this.driveHolds(driveFile, chordproFile.content, `song ${song.id}`)) {
        song.driveProperties = this.songDriveProperties(song, chordproFile)
        song.lastSyncedAt = new Date().toISOString()
        song.syncedContentHash = contentHash
        song.contentHash = chordproFile.contentHash
      }

      await this.#db.saveSong(song)

      console.log(`[DriveSync] ✅ Synced song: ${title}`)
    } catch (error) {
      console.error(`[DriveSync] Failed to push song ${song.id}/${songUuid}:`, error)
      throw error
    }
  }

  /**
   * Whether Drive stored exactly the bytes we sent: the md5Checksum it reports for the upload
   * is the MD5 of the content. If not, the record is kept as changed here (its synced markers
   * are not set), so the next push uploads it again, over the same file.
   */
  driveHolds(driveFile: DriveFile | null | undefined, content: string, what: string): boolean {
    if (!driveFile?.md5Checksum || md5Hex(content) === driveFile.md5Checksum) return true
    console.error(
      `[DriveSync] Drive stored other content for ${what} than was sent: uploading it again next sync`
    )
    return false
  }

  /** Drive file metadata for a setlist (see drive-metadata.js) */
  setlistMetadata(setlist: Setlist) {
    return setlistFileMetadata(setlist, { organisationId: this.organisationId })
  }

  /** Drive file metadata for a song variant's chart (see drive-metadata.js) */
  songMetadata(song: SongRecord, chordproFile: ChordProRecord) {
    return songFileMetadata(song, chordproFile, { organisationId: this.organisationId })
  }

  /** What this device records about a song's synced file */
  songDriveProperties(song: SongRecord, chordproFile: ChordProRecord): SongDriveProperties {
    const { title, ccliNumber, variantLabel } = songFileDetails(song, chordproFile)
    return {
      songId: song.id,
      songUuid: this.getSongUuid(song),
      contentHash: hashText(chordproFile.content),
      ccliNumber,
      title,
      titleNormalized: song.titleNormalized,
      variantLabel,
    }
  }

  getSongUuid(song: Pick<SongRecord, 'uuid' | 'id'>): string {
    return song.uuid || song.id
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
