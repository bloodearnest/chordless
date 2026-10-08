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

import { ChordlessDB, getCurrentDB, normalizeTitle } from './db.js'
import * as DriveAPI from './drive-api.js'
import { batchUploadFiles, driveRequest, getSetlistsFolder, getSongsFolder } from './drive-api.js'
import {
  forUpdate,
  setlistFileMetadata,
  songFileDetails,
  songFileMetadata,
} from './drive-metadata.js'
import { OrganisationDB } from './organisation-db.js'
import { ChordProParser } from './parser.js'
import { hashText } from './song-utils.js'

// Fields describing a setlist's sync state on this device rather than its
// content. Excluded from content hashes and from the copy uploaded to Drive.
// (_lastSyncHash is the pre-content-hash field, kept only for old records.)
const SETLIST_SYNC_FIELDS = [
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

/** A setlist's file content in Drive */
function setlistJson(setlist) {
  return JSON.stringify(setlistContent(setlist), null, 2)
}

/** JSON with object keys sorted, so equal content always hashes the same */
function stableStringify(value) {
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

/**
 * Thrown by resetLocalFromDrive when local records have changes not in Drive.
 */
export class UnsyncedChangesError extends Error {
  constructor(unsynced) {
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
  constructor(count, folderName) {
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
function organisationFolderLink(organisationId) {
  let db = null
  const getDb = async () => {
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
    async set(driveFolderId) {
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
function organisationMemberCache(organisationId) {
  return {
    async set(members) {
      const db = new OrganisationDB()
      await db.init()
      await db.updateOrganisation(organisationId, { members })
    },
  }
}

/**
 * Sync Manager for a specific organisation
 */
export class DriveSyncManager {
  /**
   * @param {object} [options]
   * @param {ChordlessDB} [options.db] - Database to sync. Defaults to the current
   *   organisation's database. Tests pass one per simulated device.
   * @param {{get: Function, set: Function}} [options.folderLink] - Where the link
   *   to the organisation's Drive folder is stored. Defaults to its record in the
   *   organisations database.
   * @param {{set: Function}} [options.memberCache] - Where the folder's members
   *   are cached. Defaults to the organisation's record.
   */
  constructor(
    organisationName,
    organisationId,
    { db = null, folderLink = null, memberCache = null } = {}
  ) {
    this.organisationName = organisationName
    this.organisationId = organisationId
    this.organisationDb = db
    this.folderLink = folderLink
    this.memberCache = memberCache
    this.driveFolderId = null
    this.parser = new ChordProParser()

    // Performance optimizations
    this._folderCache = new Map() // Cache folder IDs during sync
    this.CONCURRENT_LIMIT = 10 // Process 10 files at a time

    // Drive file inventory (for existence checks)
    this._driveFileIds = null // Set of file IDs that exist in Drive
  }

  async init() {
    console.log(`[DriveSync] Initializing sync for: ${this.organisationName}`)

    // Initialize database
    if (this.organisationDb) {
      this.organisationId ??= this.organisationDb.organisationId
    } else if (typeof window !== 'undefined') {
      // In main thread we can reuse the same DB instance the UI uses
      this.organisationDb = await getCurrentDB()
      // Ensure we keep the actual organisation ID from the DB (in case caller passed null)
      this.organisationId = this.organisationDb.organisationId
    } else {
      this.organisationDb = new ChordlessDB(this.organisationId)
      await this.organisationDb.init()
    }

    this.folderLink ??= organisationFolderLink(this.organisationId)
    this.memberCache ??= organisationMemberCache(this.organisationId)
    const isNew = await this.resolveDriveFolder()
    console.log(`[DriveSync] Organisation folder ID: ${this.driveFolderId}`)
    return isNew
  }

  /**
   * Find this organisation's Drive folder. Once linked (stored after the first
   * sync) it's used by ID, so renaming the organisation can't point sync at a
   * different folder. The first sync finds or creates it by name and links it.
   * @returns {Promise<boolean>} whether the folder was newly created
   */
  async resolveDriveFolder() {
    const linkedId = await this.folderLink.get()

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
      this.organisationId
    )
    this.driveFolderId = result.folderId
    await this.folderLink.set(result.folderId)
    return result.isNew
  }

  /**
   * The organisation was renamed since it was linked to `folder`. If another
   * organisation folder already has the new name (e.g. another device created
   * it) and this device has nothing synced yet, join that folder. Otherwise
   * rename the linked folder to match, unless that name is taken.
   */
  async followRename(folder) {
    const existing = await DriveAPI.findOrganisationFolderByName(this.organisationName)

    if (existing && existing.id !== folder.id) {
      if (!(await this.hasSyncedRecords())) {
        console.log(
          `[DriveSync] Joining existing Drive folder "${this.organisationName}" instead of "${folder.name}"`
        )
        this.driveFolderId = existing.id
        await this.folderLink.set(existing.id)
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
  async hasSyncedRecords() {
    const records = [
      ...(await this.organisationDb.getAllSetlists()),
      ...(await this.organisationDb.getAllSongs()),
    ]
    return records.some(record => record.driveFileId)
  }

  /**
   * Get cached folder ID (avoids repeated API calls)
   */
  async getCachedSongsFolder() {
    if (!this._folderCache.has('songs')) {
      const folderId = await getSongsFolder(this.driveFolderId)
      this._folderCache.set('songs', folderId)
    }
    return this._folderCache.get('songs')
  }

  async getCachedSetlistsFolder() {
    if (!this._folderCache.has('setlists')) {
      const folderId = await getSetlistsFolder(this.driveFolderId)
      this._folderCache.set('setlists', folderId)
    }
    return this._folderCache.get('setlists')
  }

  /**
   * Full sync: pull from Drive, then push local changes
   */
  async sync(progressCallback = null) {
    console.log('[DriveSync] Starting full sync...')

    if (progressCallback) progressCallback({ stage: 'starting', message: 'Starting sync...' })

    try {
      // Who the organisation's folder is shared with, for choosing leaders
      await this.refreshMembers()

      // Before changing anything, check local records belong to this folder
      if (progressCallback)
        progressCallback({ stage: 'scanning', message: 'Checking Drive files...' })
      await this.buildDriveInventory()
      await this.assertRecordsInThisFolder()

      // First, pull changes from Drive
      if (progressCallback)
        progressCallback({ stage: 'pulling', message: 'Downloading from Drive...' })
      await this.pullFromDrive(progressCallback)

      // Then, push local changes
      if (progressCallback) progressCallback({ stage: 'pushing', message: 'Uploading to Drive...' })
      await this.pushToDrive(progressCallback)

      if (progressCallback) progressCallback({ stage: 'complete', message: 'Sync complete!' })

      console.log('[DriveSync] Full sync complete')
      return { success: true }
    } catch (error) {
      console.error('[DriveSync] Sync failed:', error)
      if (progressCallback) {
        progressCallback({ stage: 'error', message: `Sync failed: ${error.message}` })
      }
      throw error
    } finally {
      // Clear caches after sync
      this._folderCache.clear()
      this._driveFileIds = null
    }
  }

  /**
   * Build inventory of all file IDs that exist in Drive
   * This is called at the start of sync to detect missing files
   */
  async buildDriveInventory() {
    console.log('[DriveSync] Building Drive file inventory...')

    try {
      const fileIds = new Set()
      await this._addFolderContentsToInventory(this.driveFolderId, fileIds)
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
  async _addFolderContentsToInventory(folderId, fileIds) {
    const query = `'${folderId}' in parents and trashed=false`
    let pageToken = null

    do {
      let url =
        `/files?q=${encodeURIComponent(query)}&spaces=drive` +
        '&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000'
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`

      const result = await driveRequest(url)
      for (const file of result.files || []) {
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
   * @returns {Promise<Array<{email: string, name: string, role: string}>|null>}
   */
  async refreshMembers() {
    try {
      const members = await DriveAPI.listFolderPermissions(this.driveFolderId)
      await this.memberCache.set(members)
      return members
    } catch (error) {
      console.warn('[DriveSync] Could not refresh organisation members:', error)
      return null
    }
  }

  /**
   * Throw OrganisationFolderMismatchError if local records point to Drive files
   * that exist outside this organisation's folder. Sync treats records missing
   * from the folder as deleted and re-uploads them; for files that actually live
   * in another folder that would duplicate them, so stop instead. Needs the
   * inventory; skipped if it couldn't be built.
   */
  async assertRecordsInThisFolder() {
    if (!this._driveFileIds) return

    const missing = [
      ...(await this.organisationDb.getAllSetlists()),
      ...(await this.organisationDb.getAllSongs()),
    ].filter(record => record.driveFileId && !this.fileExistsInDrive(record.driveFileId))

    let elsewhere = 0
    for (const record of missing) {
      const file = await DriveAPI.getFile(record.driveFileId, 'id,trashed')
      if (file && !file.trashed) elsewhere++
    }
    if (elsewhere > 0) {
      throw new OrganisationFolderMismatchError(elsewhere, this.organisationName)
    }
  }

  /**
   * Check if a Drive file ID actually exists in Drive
   */
  fileExistsInDrive(driveFileId) {
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
  async setlistNeedsSync(setlist) {
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
   * Whether a setlist has local changes that aren't in Drive: never uploaded,
   * or edited since its last sync. Ignores whether its Drive file still exists.
   */
  setlistHasLocalChanges(setlist) {
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
  async songNeedsSync(song, chordproFile) {
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
  songHasLocalChanges(song, chordproFile) {
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
  async resetLocalFromDrive(progressCallback = null) {
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
      await this.organisationDb.clearSyncedData()

      await this.pullFromDrive(progressCallback)
      progressCallback?.({ stage: 'complete', message: 'Reset complete' })
    } finally {
      this._folderCache.clear()
      this._driveFileIds = null
    }
  }

  /**
   * Local setlists and songs with changes that aren't in Drive.
   * @returns {Promise<Array<{type: string, id: string, label: string}>>}
   */
  async findUnsyncedChanges() {
    const unsynced = []
    for (const setlist of await this.organisationDb.getAllSetlists()) {
      if (this.setlistHasLocalChanges(setlist)) {
        const label = [setlist.date, setlist.name].filter(Boolean).join(' ')
        unsynced.push({ type: 'setlist', id: setlist.id, label })
      }
    }
    for (const song of await this.organisationDb.getAllSongs()) {
      if (!song.chordproFileId) continue
      const chordproFile = await this.organisationDb.getChordPro(song.chordproFileId)
      if (chordproFile && this.songHasLocalChanges(song, chordproFile)) {
        unsynced.push({ type: 'song', id: this.getSongUuid(song), label: song.title || '' })
      }
    }
    return unsynced
  }

  /**
   * Pull changes from Drive to local
   */
  async pullFromDrive(progressCallback = null) {
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
  async pullSetlists(progressCallback = null) {
    console.log('[DriveSync] Pulling setlists...')

    // Get all setlists from Drive
    const driveSetlists = await DriveAPI.listSetlists(this.driveFolderId)
    console.log(`[DriveSync] Found ${driveSetlists.length} setlists in Drive`)

    const downloadQueue = []

    for (const driveFile of driveSetlists) {
      try {
        const setlistId = driveFile.appProperties?.setlistId || driveFile.name.replace('.json', '')

        // Check if we have this setlist locally
        const localSetlist = await this.organisationDb.getSetlist(setlistId)

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
        }
      } catch (error) {
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

    const setlistsToSave = []
    let completed = 0
    for (let i = 0; i < downloadQueue.length; i += this.CONCURRENT_LIMIT) {
      const batch = downloadQueue.slice(i, i + this.CONCURRENT_LIMIT)

      const results = await Promise.allSettled(
        batch.map(async ({ driveFile, setlistId, localSetlist }) => {
          const remote = await DriveAPI.downloadSetlist(driveFile.id)
          const remoteHash = setlistContentHash(remote)

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
          console.error('[DriveSync] Failed to download setlist:', result.reason)
        }
      })
    }

    if (setlistsToSave.length > 0) {
      await this.organisationDb.saveSetlistsBatch(setlistsToSave)
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
  async pullSongs(progressCallback = null) {
    console.log('[DriveSync] Pulling songs...')

    const songsFolderId = await this.getCachedSongsFolder()
    const driveFiles = await this.listDriveSongFiles(songsFolderId)
    console.log(`[DriveSync] Found ${driveFiles.length} chord charts in Drive`)

    const latestByUuid = new Map()
    for (const file of driveFiles) {
      const props = file.appProperties || {}
      if (props.type && props.type !== 'chordpro') continue
      const songUuid = this.getDriveSongUuid(props, file.id)
      if (!songUuid) {
        console.warn(`[DriveSync] Skipping chord chart with no song UUID: ${file.name}`)
        continue
      }
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

    const downloads = []
    for (const entry of latestByUuid.values()) {
      const { songUuid, file, props } = entry
      const localSong = await this.organisationDb.getSong(songUuid)
      const chordproRecord =
        localSong && localSong.chordproFileId
          ? await this.organisationDb.getChordPro(localSong.chordproFileId)
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
        .forEach(result => console.error('[DriveSync] Failed to download song:', result.reason))
    }

    console.log(`[DriveSync] ✅ Pulled ${downloaded} songs from Drive`)
  }

  async listDriveSongFiles(folderId) {
    const files = []
    let pageToken = null

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
      if (result.files) {
        files.push(...result.files)
      }
      pageToken = result.nextPageToken || null
    } while (pageToken)

    return files
  }

  getDriveSongUuid(props, fallbackId) {
    return props.songUuid || props.versionId || props.songId || fallbackId || null
  }

  getTitleFromFilename(filename) {
    if (!filename) return 'Untitled'
    return filename.replace(/\.[^/.]+$/, '')
  }

  async downloadSongFromDrive({ songUuid, file, props, localSong }) {
    const chordproContent = await DriveAPI.downloadChordProFile(file.id)
    const remoteHash = hashText(chordproContent)

    if (localSong?.driveFileId === file.id && localSong.syncedContentHash === remoteHash) {
      // Same chart as we last synced, e.g. a record from before checksums were
      // recorded. Not a remote change: keep local edits, record the checksum.
      await this.organisationDb.saveSong({
        ...localSong,
        driveModifiedTime: file.modifiedTime,
        driveChecksum: file.md5Checksum,
      })
      return
    }
    if (localSong?.chordproFileId) {
      const localChart = await this.organisationDb.getChordPro(localSong.chordproFileId)
      if (localChart && this.songHasLocalChanges(localSong, localChart)) {
        // Changed both here and in Drive. For now Drive wins.
        console.warn(`[DriveSync] ⚠️ Conflict for song ${songUuid}, keeping Drive version`)
      }
    }

    const chordproFileId = localSong?.chordproFileId || `chordpro-${crypto.randomUUID()}`

    const parsed = this.parser.parse(chordproContent)
    const metadata = parsed.metadata || {}
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

    await this.organisationDb.saveChordPro({
      id: chordproFileId,
      content: chordproContent,
      contentHash,
      lastModified: new Date(file.modifiedTime || Date.now()).getTime(),
    })

    const songRecord = {
      uuid: songUuid,
      id: deterministicId,
      variantOf: props.variantOf || localSong?.variantOf || null,
      isDefault:
        props.isDefault === 'true' ||
        props.isDefault === true ||
        localSong?.isDefault ||
        !props.variantOf,
      variantLabel,
      chordproFileId,
      ccliNumber,
      title,
      titleNormalized,
      author: metadata.artist || metadata.author || localSong?.author || null,
      copyright: metadata.copyright || localSong?.copyright || null,
      key: metadata.key || localSong?.key || null,
      tempo: metadata.tempo || localSong?.tempo || null,
      time: metadata.time || localSong?.time || null,
      importDate:
        localSong?.importDate || props.importDate || file.createdTime || new Date().toISOString(),
      importUser: localSong?.importUser || props.importUser || null,
      importSource: 'drive',
      sourceUrl: localSong?.sourceUrl || null,
      modifiedDate: new Date(file.modifiedTime || file.createdTime || Date.now()).toISOString(),
      driveFileId: file.id,
      driveModifiedTime: file.modifiedTime,
      driveChecksum: file.md5Checksum,
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

    await this.organisationDb.saveSong(songRecord)
  }

  /**
   * Push local changes to Drive
   */
  async pushToDrive(progressCallback = null) {
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
  async pushSetlists(progressCallback = null) {
    console.log('[DriveSync] Pushing setlists...')

    const localSetlists = await this.organisationDb.getAllSetlists()
    console.log(`[DriveSync] Found ${localSetlists.length} local setlists`)

    // Filter to only setlists that need syncing (using smart detection)
    const setlistsToSync = []
    for (const setlist of localSetlists) {
      if (await this.setlistNeedsSync(setlist)) {
        setlistsToSync.push(setlist)
      }
    }

    console.log(`[DriveSync] ${setlistsToSync.length} setlists need syncing`)
    if (progressCallback) {
      progressCallback({
        stage: 'pushing',
        message: `Uploading ${setlistsToSync.length} setlists...`,
        current: 0,
        total: Math.max(1, setlistsToSync.length),
      })
    }

    // Separate new setlists from updates (also check Drive existence)
    const newSetlists = []
    const updatedSetlists = []

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

    console.log(`[DriveSync] ${newSetlists.length} new, ${updatedSetlists.length} updates`)

    let processed = 0

    // Batch upload new setlists (50 at a time)
    if (newSetlists.length > 0) {
      const setlistsFolderId = await this.getCachedSetlistsFolder()
      const BATCH_SIZE = 50

      for (let i = 0; i < newSetlists.length; i += BATCH_SIZE) {
        const batch = newSetlists.slice(i, i + BATCH_SIZE)

        // Prepare files for batch upload
        const files = batch.map(setlist => ({
          metadata: { ...this.setlistMetadata(setlist), parents: [setlistsFolderId] },
          content: setlistJson(setlist),
          contentType: 'application/json',
        }))

        try {
          console.log(`[DriveSync] Uploading ${files.length} new setlists...`)
          const uploadedFiles = await batchUploadFiles(files)

          // Update local records with Drive metadata (batch save)
          const updatedSetlists = []
          for (let j = 0; j < batch.length; j++) {
            const setlist = batch[j]
            const driveFile = uploadedFiles[j]

            if (driveFile && driveFile.id) {
              setlist.driveFileId = driveFile.id
              setlist.driveModifiedTime = driveFile.modifiedTime ?? null
              setlist.driveChecksum = driveFile.md5Checksum ?? null
              setlist.lastSyncedAt = new Date().toISOString()
              setlist.syncedContentHash = setlistContentHash(setlist)
              updatedSetlists.push(setlist)
              processed++
            }
          }

          // Batch save to database
          if (updatedSetlists.length > 0) {
            await this.organisationDb.saveSetlistsBatch(updatedSetlists)
          }

          console.log(`[DriveSync] ✅ Uploaded ${updatedSetlists.length}/${batch.length} setlists`)
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
  async pushSetlist(setlist) {
    try {
      if (!setlist.driveFileId) {
        // New setlist, upload it
        console.log(`[DriveSync] Uploading new setlist: ${setlist.id}`)

        const driveFile = await DriveAPI.createFile(
          { ...this.setlistMetadata(setlist), parents: [await this.getCachedSetlistsFolder()] },
          setlistJson(setlist),
          'application/json'
        )

        // Update local record with Drive metadata
        setlist.driveFileId = driveFile.id
        setlist.driveModifiedTime = driveFile.modifiedTime ?? null
        setlist.driveChecksum = driveFile.md5Checksum ?? null
        setlist.lastSyncedAt = new Date().toISOString()
        setlist.syncedContentHash = setlistContentHash(setlist)
        await this.organisationDb.saveSetlist(setlist)

        console.log(`[DriveSync] ✅ Uploaded setlist: ${setlist.id}`)
      } else {
        // Existing setlist, update it
        console.log(`[DriveSync] Updating setlist: ${setlist.id}`)

        // Metadata too, so the file name follows e.g. a changed date or leader
        const driveFile = await DriveAPI.updateFile(
          setlist.driveFileId,
          forUpdate(this.setlistMetadata(setlist), 'setlist'),
          setlistJson(setlist),
          'application/json'
        )

        // Update sync metadata
        setlist.driveModifiedTime = driveFile?.modifiedTime ?? null
        setlist.driveChecksum = driveFile?.md5Checksum ?? null
        setlist.lastSyncedAt = new Date().toISOString()
        setlist.syncedContentHash = setlistContentHash(setlist)
        await this.organisationDb.saveSetlist(setlist)

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
  async pushSongs(progressCallback = null) {
    console.log('[DriveSync] Pushing songs...')

    const songs = await this.organisationDb.getAllSongs()
    console.log(`[DriveSync] Found ${songs.length} local song variants`)

    const newSongs = []
    const updatesToProcess = []
    let totalVariants = 0

    for (const song of songs) {
      if (!song.chordproFileId) continue

      const chordproFile = await this.organisationDb.getChordPro(song.chordproFileId)
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
      const files = []
      const fileTracking = []

      for (const { song, chordproFile } of batch) {
        files.push({
          metadata: { ...this.songMetadata(song, chordproFile), parents: [songsFolderId] },
          content: chordproFile.content,
          contentType: 'text/plain; charset=utf-8',
        })
        fileTracking.push({ song, chordproFile })
      }

      if (files.length === 0) continue

      try {
        console.log(`[DriveSync] Uploading ${files.length} files...`)
        const uploadedFiles = await batchUploadFiles(files)
        const updatedSongs = []

        for (let j = 0; j < fileTracking.length; j++) {
          const tracking = fileTracking[j]
          const driveFile = uploadedFiles[j]
          if (!driveFile || !driveFile.id) continue

          tracking.song.driveFileId = driveFile.id
          tracking.song.driveProperties = this.songDriveProperties(
            tracking.song,
            tracking.chordproFile
          )
          tracking.song.lastSyncedAt = new Date().toISOString()
          tracking.song.driveModifiedTime = driveFile.modifiedTime ?? null
          tracking.song.driveChecksum = driveFile.md5Checksum ?? null
          tracking.song.syncedContentHash = hashText(tracking.chordproFile.content)
          tracking.song.contentHash = tracking.chordproFile.contentHash
          updatedSongs.push(tracking.song)
          processed++
        }

        if (updatedSongs.length > 0) {
          await this.organisationDb.saveSongsBatch(updatedSongs)
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
  async pushSongVariant(song, chordproFile) {
    const songUuid = this.getSongUuid(song)
    try {
      if (!chordproFile) {
        console.warn(`[DriveSync] ChordPro file not found: ${song.chordproFileId}`)
        return
      }

      const { title } = songFileDetails(song, chordproFile)
      const contentHash = hashText(chordproFile.content)
      const metadata = this.songMetadata(song, chordproFile)
      let driveFile

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

      song.driveProperties = this.songDriveProperties(song, chordproFile)
      song.lastSyncedAt = new Date().toISOString()
      song.driveModifiedTime = driveFile?.modifiedTime ?? null
      song.driveChecksum = driveFile?.md5Checksum ?? null
      song.syncedContentHash = contentHash
      song.contentHash = chordproFile.contentHash

      await this.organisationDb.saveSong(song)

      console.log(`[DriveSync] ✅ Synced song: ${title}`)
    } catch (error) {
      console.error(`[DriveSync] Failed to push song ${song.id}/${songUuid}:`, error)
      throw error
    }
  }

  /** Drive file metadata for a setlist (see drive-metadata.js) */
  setlistMetadata(setlist) {
    return setlistFileMetadata(setlist, { organisationId: this.organisationId })
  }

  /** Drive file metadata for a song variant's chart (see drive-metadata.js) */
  songMetadata(song, chordproFile) {
    return songFileMetadata(song, chordproFile, { organisationId: this.organisationId })
  }

  /** What this device records about a song's synced file */
  songDriveProperties(song, chordproFile) {
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

  getSongUuid(song) {
    return song?.uuid || song?.id || ''
  }
}

/**
 * Helper functions
 */

/**
 * Check if Drive sync is available (user is authenticated)
 */
export async function isSyncAvailable() {
  return DriveAPI.checkDriveAccess()
}

/**
 * Create a sync manager for an organisation
 */
export async function createSyncManager(organisationName, organisationId) {
  const manager = new DriveSyncManager(organisationName, organisationId)
  await manager.init()
  return manager
}
