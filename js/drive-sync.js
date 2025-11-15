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
 */

import * as DriveAPI from './drive-api.js';
import {
  getSongsFolder,
  getSetlistsFolder,
  driveRequest,
  batchDeleteFiles,
  batchUploadFiles,
  generateSetlistFilename,
  generateChordProFilename,
} from './drive-api.js';
import { getGlobalSongsDB } from './songs-db.js';
import { getGlobalChordProDB } from './chordpro-db.js';
import { SetalightDB } from './db.js';
import { hashText } from './song-utils.js';
import { ChordProParser } from './parser.js';

/**
 * Sync Manager for a specific organisation
 */
export class DriveSyncManager {
  constructor(organisationName, organisationId) {
    this.organisationName = organisationName;
    this.organisationId = organisationId;
    this.organisationDb = null;
    this.songsDb = null;
    this.chordproDb = null;
    this.driveFolderId = null;
    this.parser = new ChordProParser();

    // Performance optimizations
    this._folderCache = new Map(); // Cache folder IDs during sync
    this.CONCURRENT_LIMIT = 10; // Process 10 files at a time

    // Drive file inventory (for existence checks)
    this._driveFileIds = null; // Set of file IDs that exist in Drive
  }

  async init() {
    console.log(`[DriveSync] Initializing sync for: ${this.organisationName}`);

    // Initialize databases
    this.organisationDb = new SetalightDB(this.organisationName);
    await this.organisationDb.init();
    this.songsDb = await getGlobalSongsDB();
    this.chordproDb = await getGlobalChordProDB();

    // Find or create organisation folder in Drive
    const result = await DriveAPI.findOrCreateOrganisationFolder(
      this.organisationName,
      this.organisationId
    );
    this.driveFolderId = result.folderId;

    console.log(`[DriveSync] Organisation folder ID: ${this.driveFolderId}`);

    return result.isNew;
  }

  /**
   * Get cached folder ID (avoids repeated API calls)
   */
  async getCachedSongsFolder() {
    if (!this._folderCache.has('songs')) {
      const folderId = await getSongsFolder(this.driveFolderId);
      this._folderCache.set('songs', folderId);
    }
    return this._folderCache.get('songs');
  }

  async getCachedSetlistsFolder() {
    if (!this._folderCache.has('setlists')) {
      const folderId = await getSetlistsFolder(this.driveFolderId);
      this._folderCache.set('setlists', folderId);
    }
    return this._folderCache.get('setlists');
  }

  /**
   * Full sync: pull from Drive, then push local changes
   */
  async sync(progressCallback = null) {
    console.log('[DriveSync] Starting full sync...');

    if (progressCallback) progressCallback({ stage: 'starting', message: 'Starting sync...' });

    try {
      // First, pull changes from Drive
      if (progressCallback)
        progressCallback({ stage: 'pulling', message: 'Downloading from Drive...' });
      await this.pullFromDrive(progressCallback);

      // Then, push local changes
      if (progressCallback)
        progressCallback({ stage: 'pushing', message: 'Uploading to Drive...' });
      await this.pushToDrive(progressCallback);

      if (progressCallback) progressCallback({ stage: 'complete', message: 'Sync complete!' });

      console.log('[DriveSync] Full sync complete');
      return { success: true };
    } catch (error) {
      console.error('[DriveSync] Sync failed:', error);
      if (progressCallback) {
        progressCallback({ stage: 'error', message: `Sync failed: ${error.message}` });
      }
      throw error;
    } finally {
      // Clear caches after sync
      this._folderCache.clear();
      this._driveFileIds = null;
    }
  }

  /**
   * Clear Drive and re-upload everything with new file structure
   */
  async clearAndReupload(progressCallback = null) {
    console.log('[DriveSync] Starting clear and re-upload...');

    if (progressCallback) progressCallback({ stage: 'clearing', message: 'Clearing Drive...' });

    try {
      // Clear songs and setlists from Drive
      await this.clearDriveData(progressCallback);

      // Clear local sync metadata
      await this.clearLocalSyncMetadata();

      // Push everything as new
      if (progressCallback)
        progressCallback({ stage: 'uploading', message: 'Uploading to Drive...' });
      await this.pushToDrive(progressCallback);

      if (progressCallback) progressCallback({ stage: 'complete', message: 'Re-upload complete!' });

      console.log('[DriveSync] Clear and re-upload complete');
      return { success: true };
    } catch (error) {
      console.error('[DriveSync] Clear and re-upload failed:', error);
      if (progressCallback) {
        progressCallback({ stage: 'error', message: `Failed: ${error.message}` });
      }
      throw error;
    } finally {
      // Clear caches after sync
      this._folderCache.clear();
      this._driveFileIds = null;
    }
  }

  /**
   * Clear all data from Drive organisation folder
   */
  async clearDriveData(progressCallback = null) {
    console.log('[DriveSync] Clearing Drive data...');

    // Get songs and setlists folders
    const songsFolderId = await this.getCachedSongsFolder();
    const setlistsFolderId = await this.getCachedSetlistsFolder();

    // Delete all files in setlists folder
    if (progressCallback) progressCallback({ stage: 'clearing', message: 'Clearing setlists...' });
    await this.deleteFolderContents(setlistsFolderId);

    // Delete all files and folders in songs folder
    if (progressCallback) progressCallback({ stage: 'clearing', message: 'Clearing songs...' });
    await this.deleteFolderContents(songsFolderId);

    console.log('[DriveSync] Drive data cleared');
  }

  /**
   * Delete all contents of a folder (recursively, using batch API)
   */
  async deleteFolderContents(folderId) {
    const query = `'${folderId}' in parents and trashed=false`;
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,mimeType)`
    );

    if (!result.files || result.files.length === 0) {
      return;
    }

    console.log(`[DriveSync] Found ${result.files.length} items to delete in folder`);

    // First, recursively delete contents of subfolders
    const folders = result.files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    for (const folder of folders) {
      console.log(`[DriveSync] Recursively deleting folder: ${folder.name}`);
      await this.deleteFolderContents(folder.id);
    }

    // Collect all file IDs (including now-empty folders)
    const fileIds = result.files.map(f => f.id);

    // Batch delete in chunks of 50 (safer than 100)
    const BATCH_SIZE = 50;
    let totalDeleted = 0;

    for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
      const batch = fileIds.slice(i, i + BATCH_SIZE);
      try {
        const deleted = await batchDeleteFiles(batch);
        totalDeleted += deleted;
        console.log(
          `[DriveSync] Batch deleted ${deleted} files (${totalDeleted}/${fileIds.length})`
        );
      } catch (error) {
        console.warn(`[DriveSync] Batch delete failed:`, error.message);
        // Fallback to individual deletion for this batch
        for (const fileId of batch) {
          try {
            await driveRequest(`/files/${fileId}`, { method: 'DELETE' });
            totalDeleted++;
          } catch (err) {
            console.warn(`[DriveSync] Failed to delete file ${fileId}:`, err.message);
          }
        }
      }
    }

    console.log(`[DriveSync] ✅ Deleted ${totalDeleted} items`);
  }

  /**
   * Clear local sync metadata (driveFileId, lastSyncedAt, etc.)
   * Uses batch database operations for better performance
   */
  async clearLocalSyncMetadata() {
    console.log('[DriveSync] Clearing local sync metadata...');

    // Clear setlist sync metadata (batch save)
    const setlists = await this.organisationDb.getAllSetlists();
    for (const setlist of setlists) {
      setlist.driveFileId = null;
      setlist.driveModifiedTime = null;
      setlist.lastSyncedAt = null;
      setlist._lastSyncHash = null;
    }
    if (setlists.length > 0) {
      await this.organisationDb.saveSetlistsBatch(setlists);
    }

    // Clear song version sync metadata (batch save)
    const songs = await this.songsDb.getAllSongs();
    for (const song of songs) {
      for (const version of song.versions) {
        version.driveChordproFileId = null;
        version.driveProperties = null;
        version.lastSyncedAt = null;
      }
    }
    if (songs.length > 0) {
      await this.songsDb.saveSongsBatch(songs);
    }

    console.log('[DriveSync] Local sync metadata cleared');
  }

  /**
   * Build inventory of all file IDs that exist in Drive
   * This is called at the start of sync to detect missing files
   */
  async buildDriveInventory() {
    console.log('[DriveSync] Building Drive file inventory...');

    const fileIds = new Set();

    try {
      // List all files recursively in the organisation folder
      const query = `'${this.driveFolderId}' in parents and trashed=false`;
      const result = await driveRequest(
        `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,mimeType)&pageSize=1000`
      );

      if (result.files) {
        for (const file of result.files) {
          fileIds.add(file.id);

          // If it's a folder, recursively list its contents
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            await this._addFolderContentsToInventory(file.id, fileIds);
          }
        }
      }

      console.log(`[DriveSync] Drive inventory: ${fileIds.size} files found`);
    } catch (error) {
      console.error('[DriveSync] Failed to build Drive inventory:', error);
      // Don't fail the sync, just skip the inventory check
    }

    this._driveFileIds = fileIds;
  }

  /**
   * Recursively add all files in a folder to the inventory
   */
  async _addFolderContentsToInventory(folderId, fileIds) {
    const query = `'${folderId}' in parents and trashed=false`;
    const result = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,mimeType)&pageSize=1000`
    );

    if (result.files) {
      for (const file of result.files) {
        fileIds.add(file.id);

        // Recursively process subfolders
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          await this._addFolderContentsToInventory(file.id, fileIds);
        }
      }
    }
  }

  /**
   * Check if a Drive file ID actually exists in Drive
   */
  fileExistsInDrive(driveFileId) {
    if (!this._driveFileIds) {
      // Inventory not built, assume file exists (conservative)
      return true;
    }
    return this._driveFileIds.has(driveFileId);
  }

  /**
   * Smart skip detection: Check if setlist needs syncing
   * Uses content hash comparison and Drive existence check
   */
  async setlistNeedsSync(setlist) {
    // If never synced, needs sync
    if (!setlist.driveFileId) {
      return true;
    }

    // Check if file actually exists in Drive
    if (!this.fileExistsInDrive(setlist.driveFileId)) {
      console.log(
        `[DriveSync] Setlist ${setlist.id} missing from Drive (driveFileId: ${setlist.driveFileId}) - forcing re-upload`
      );
      return true;
    }

    // Check timestamp first (fast path)
    const localModified = new Date(setlist.updatedAt);
    const lastSynced = setlist.lastSyncedAt ? new Date(setlist.lastSyncedAt) : new Date(0);

    if (localModified <= lastSynced) {
      return false; // Not modified since last sync
    }

    // Content might have changed - compare hash
    const currentHash = hashText(JSON.stringify(setlist));
    if (setlist._lastSyncHash && setlist._lastSyncHash === currentHash) {
      // Content hasn't actually changed, just timestamp
      return false;
    }

    return true; // Content changed, needs sync
  }

  /**
   * Smart skip detection: Check if song version needs syncing
   * Uses content hash comparison and Drive existence check
   */
  async songVersionNeedsSync(song, version, chordproFile) {
    // If never synced, needs sync
    if (!version.driveChordproFileId) {
      return true;
    }

    // Check if file actually exists in Drive
    if (!this.fileExistsInDrive(version.driveChordproFileId)) {
      console.log(
        `[DriveSync] Song ${song.id}/${version.id} missing from Drive (driveFileId: ${version.driveChordproFileId}) - forcing re-upload`
      );
      return true;
    }

    // Check timestamp first (fast path)
    const lastSynced = version.lastSyncedAt ? new Date(version.lastSyncedAt) : new Date(0);
    const localModified = new Date(chordproFile.lastModified);

    if (localModified <= lastSynced) {
      return false; // Not modified since last sync
    }

    // Check content hash
    if (version.driveProperties?.contentHash === chordproFile.contentHash) {
      // Content hash matches, no changes
      return false;
    }

    return true; // Content changed, needs sync
  }

  /**
   * Pull changes from Drive to local
   */
  async pullFromDrive(progressCallback = null) {
    console.log('[DriveSync] Pulling from Drive...');

    // Pull setlists
    if (progressCallback)
      progressCallback({ stage: 'pulling', message: 'Downloading setlists...' });
    await this.pullSetlists();

    // Pull songs (chordpro files)
    if (progressCallback) progressCallback({ stage: 'pulling', message: 'Downloading songs...' });
    await this.pullSongs();

    console.log('[DriveSync] Pull complete');
  }

  /**
   * Pull setlists from Drive (with batch database operations)
   */
  async pullSetlists() {
    console.log('[DriveSync] Pulling setlists...');

    // Get all setlists from Drive
    const driveSetlists = await DriveAPI.listSetlists(this.driveFolderId);
    console.log(`[DriveSync] Found ${driveSetlists.length} setlists in Drive`);

    const setlistsToSave = [];

    for (const driveFile of driveSetlists) {
      try {
        const setlistId = driveFile.name.replace('.json', '');
        const driveModifiedTime = new Date(driveFile.modifiedTime);

        // Check if we have this setlist locally
        const localSetlist = await this.organisationDb.getSetlist(setlistId);

        if (!localSetlist) {
          // New setlist, download it
          console.log(`[DriveSync] Downloading new setlist: ${setlistId}`);
          const setlistData = await DriveAPI.downloadSetlist(driveFile.id);

          // Add Drive metadata
          setlistData.driveFileId = driveFile.id;
          setlistData.driveModifiedTime = driveFile.modifiedTime;
          setlistData.lastSyncedAt = new Date().toISOString();
          setlistData._lastSyncHash = hashText(JSON.stringify(setlistData));

          setlistsToSave.push(setlistData);
          console.log(`[DriveSync] ✅ Downloaded setlist: ${setlistId}`);
        } else if (localSetlist.driveFileId === driveFile.id) {
          // Existing setlist, check if Drive version is newer
          const localModified = new Date(localSetlist.updatedAt);
          const lastSynced = localSetlist.lastSyncedAt
            ? new Date(localSetlist.lastSyncedAt)
            : new Date(0);

          if (driveModifiedTime > lastSynced) {
            console.log(`[DriveSync] Drive version newer for: ${setlistId}`);

            // Check if we also have local changes
            if (localModified > lastSynced) {
              console.warn(`[DriveSync] ⚠️ Conflict detected for setlist: ${setlistId}`);
              // For now, prefer Drive version
              // TODO: Implement proper conflict resolution
            }

            const setlistData = await DriveAPI.downloadSetlist(driveFile.id);
            setlistData.driveFileId = driveFile.id;
            setlistData.driveModifiedTime = driveFile.modifiedTime;
            setlistData.lastSyncedAt = new Date().toISOString();
            setlistData._lastSyncHash = hashText(JSON.stringify(setlistData));

            setlistsToSave.push(setlistData);
            console.log(`[DriveSync] ✅ Updated setlist from Drive: ${setlistId}`);
          }
        }
      } catch (error) {
        console.error(`[DriveSync] Failed to pull setlist ${driveFile.name}:`, error);
      }
    }

    // Batch save all downloaded/updated setlists
    if (setlistsToSave.length > 0) {
      await this.organisationDb.saveSetlistsBatch(setlistsToSave);
      console.log(`[DriveSync] ✅ Batch saved ${setlistsToSave.length} setlists`);
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
  async pullSongs() {
    console.log('[DriveSync] Pulling songs...');
    // TODO: Implement song pulling with duplicate detection
    //
    // Implementation steps:
    // 1. List all files: driveRequest(`/files?q='${songsFolderId}' in parents and mimeType='text/plain'&fields=files(id,name,appProperties,modifiedTime)`)
    // 2. Group by songId from appProperties
    // 3. Detect duplicates: const versionIdMap = new Map(); // versionId -> [driveFileId1, driveFileId2...]
    // 4. Generate new versionId: `version-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    // 5. Update Drive file metadata via PATCH request
    // 6. Download content and save to local database
    console.log('[DriveSync] Song pulling not yet implemented');
  }

  /**
   * Push local changes to Drive
   */
  async pushToDrive(progressCallback = null) {
    console.log('[DriveSync] Pushing to Drive...');

    // Build inventory of existing Drive files
    if (progressCallback)
      progressCallback({ stage: 'scanning', message: 'Checking Drive files...' });
    await this.buildDriveInventory();

    // Push setlists
    if (progressCallback) progressCallback({ stage: 'pushing', message: 'Uploading setlists...' });
    await this.pushSetlists();

    // Push songs (chordpro files)
    if (progressCallback) progressCallback({ stage: 'pushing', message: 'Uploading songs...' });
    await this.pushSongs();

    console.log('[DriveSync] Push complete');
  }

  /**
   * Push setlists to Drive (with batch upload for new files)
   */
  async pushSetlists(progressCallback = null) {
    console.log('[DriveSync] Pushing setlists...');

    const localSetlists = await this.organisationDb.getAllSetlists();
    console.log(`[DriveSync] Found ${localSetlists.length} local setlists`);

    // Filter to only setlists that need syncing (using smart detection)
    const setlistsToSync = [];
    for (const setlist of localSetlists) {
      if (await this.setlistNeedsSync(setlist)) {
        setlistsToSync.push(setlist);
      }
    }

    console.log(`[DriveSync] ${setlistsToSync.length} setlists need syncing`);

    // Separate new setlists from updates (also check Drive existence)
    const newSetlists = [];
    const updatedSetlists = [];

    for (const setlist of setlistsToSync) {
      if (setlist.driveFileId && this.fileExistsInDrive(setlist.driveFileId)) {
        // Exists in Drive, needs update
        updatedSetlists.push(setlist);
      } else {
        // New or missing from Drive, needs upload
        if (setlist.driveFileId && !this.fileExistsInDrive(setlist.driveFileId)) {
          console.log(`[DriveSync] Clearing stale Drive ID for setlist ${setlist.id}`);
          setlist.driveFileId = null;
          setlist.driveModifiedTime = null;
        }
        newSetlists.push(setlist);
      }
    }

    console.log(`[DriveSync] ${newSetlists.length} new, ${updatedSetlists.length} updates`);

    let processed = 0;

    // Batch upload new setlists (50 at a time)
    if (newSetlists.length > 0) {
      const setlistsFolderId = await this.getCachedSetlistsFolder();
      const BATCH_SIZE = 50;

      for (let i = 0; i < newSetlists.length; i += BATCH_SIZE) {
        const batch = newSetlists.slice(i, i + BATCH_SIZE);

        // Prepare files for batch upload
        const files = batch.map(setlist => {
          const filename = generateSetlistFilename(
            setlist.date,
            setlist.type,
            setlist.leader,
            setlist.name
          );

          return {
            metadata: {
              name: filename,
              parents: [setlistsFolderId],
              mimeType: 'application/json',
              appProperties: {
                organisationId: this.organisationId,
                setlistId: setlist.id,
                appVersion: '1.0.0',
              },
            },
            content: JSON.stringify(setlist, null, 2),
            contentType: 'application/json',
          };
        });

        try {
          console.log(`[DriveSync] Uploading ${files.length} new setlists...`);
          const uploadedFiles = await batchUploadFiles(files);

          // Update local records with Drive metadata (batch save)
          const updatedSetlists = [];
          for (let j = 0; j < batch.length; j++) {
            const setlist = batch[j];
            const driveFile = uploadedFiles[j];

            if (driveFile && driveFile.id) {
              setlist.driveFileId = driveFile.id;
              setlist.driveModifiedTime = driveFile.modifiedTime || new Date().toISOString();
              setlist.lastSyncedAt = new Date().toISOString();
              setlist._lastSyncHash = hashText(JSON.stringify(setlist));
              updatedSetlists.push(setlist);
              processed++;
            }
          }

          // Batch save to database
          if (updatedSetlists.length > 0) {
            await this.organisationDb.saveSetlistsBatch(updatedSetlists);
          }

          console.log(`[DriveSync] ✅ Uploaded ${uploadedFiles.length} setlists`);
        } catch (error) {
          console.error(`[DriveSync] Concurrent upload failed:`, error);
          // Fallback to sequential uploads for this batch
          for (const setlist of batch) {
            try {
              await this.pushSetlist(setlist);
              processed++;
            } catch (err) {
              console.error(`[DriveSync] Failed to upload setlist ${setlist.id}:`, err);
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
          });
        }
      }
    }

    // Process updates in parallel (individual API calls required)
    if (updatedSetlists.length > 0) {
      for (let i = 0; i < updatedSetlists.length; i += this.CONCURRENT_LIMIT) {
        const batch = updatedSetlists.slice(i, i + this.CONCURRENT_LIMIT);

        const results = await Promise.allSettled(batch.map(setlist => this.pushSetlist(setlist)));

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        processed += succeeded;

        // Update progress
        if (progressCallback) {
          progressCallback({
            stage: 'pushing',
            message: `Uploaded ${processed}/${setlistsToSync.length} setlists`,
            current: processed,
            total: setlistsToSync.length,
          });
        }
      }
    }

    console.log(`[DriveSync] ✅ Pushed ${processed} setlists`);
  }

  /**
   * Push a single setlist to Drive
   */
  async pushSetlist(setlist) {
    try {
      if (!setlist.driveFileId) {
        // New setlist, upload it
        console.log(`[DriveSync] Uploading new setlist: ${setlist.id}`);

        const driveFile = await DriveAPI.uploadSetlist(
          this.driveFolderId,
          setlist.id,
          setlist,
          this.organisationId
        );

        // Update local record with Drive metadata
        setlist.driveFileId = driveFile.id;
        setlist.driveModifiedTime = driveFile.modifiedTime || new Date().toISOString();
        setlist.lastSyncedAt = new Date().toISOString();
        await this.organisationDb.saveSetlist(setlist);

        console.log(`[DriveSync] ✅ Uploaded setlist: ${setlist.id}`);
      } else {
        // Existing setlist, update it
        console.log(`[DriveSync] Updating setlist: ${setlist.id}`);

        await DriveAPI.updateSetlist(setlist.driveFileId, setlist);

        // Update sync metadata
        setlist.driveModifiedTime = new Date().toISOString();
        setlist.lastSyncedAt = new Date().toISOString();
        await this.organisationDb.saveSetlist(setlist);

        console.log(`[DriveSync] ✅ Updated setlist: ${setlist.id}`);
      }
    } catch (error) {
      console.error(`[DriveSync] Failed to push setlist ${setlist.id}:`, error);
      throw error; // Re-throw for Promise.allSettled
    }
  }

  /**
   * Push songs to Drive (flat structure with batch upload)
   */
  async pushSongs(progressCallback = null) {
    console.log('[DriveSync] Pushing songs...');

    // Get all songs
    const songs = await this.songsDb.getAllSongs();
    console.log(`[DriveSync] Found ${songs.length} songs to sync`);

    // Group songs that need syncing and separate new vs updates
    const songsToSync = [];
    const updatesToProcess = []; // Versions that need updating (not batch-able)
    let totalVersions = 0;

    for (const song of songs) {
      let needsSync = false;
      const versionsToSync = [];

      // Check each version
      for (const version of song.versions) {
        const chordproFile = await this.chordproDb.get(version.chordproFileId);
        if (!chordproFile) continue;

        if (await this.songVersionNeedsSync(song, version, chordproFile)) {
          // Check if file actually exists in Drive
          const existsInDrive =
            version.driveChordproFileId && this.fileExistsInDrive(version.driveChordproFileId);

          if (existsInDrive) {
            // File exists in Drive, needs update (can't batch)
            updatesToProcess.push({ song, version, chordproFile });
            totalVersions++;
          } else {
            // New file or missing from Drive, can batch upload
            // Clear stale Drive ID if file is missing
            if (version.driveChordproFileId && !existsInDrive) {
              console.log(`[DriveSync] Clearing stale Drive ID for ${song.id}/${version.id}`);
              version.driveChordproFileId = null;
              version.driveProperties = null;
            }
            versionsToSync.push({ version, chordproFile });
            needsSync = true;
            totalVersions++;
          }
        }
      }

      if (needsSync) {
        songsToSync.push({ song, versionsToSync });
      }
    }

    console.log(
      `[DriveSync] ${songsToSync.length} songs need upload, ${updatesToProcess.length} versions need updates`
    );

    let processed = 0;
    const songsFolderId = await this.getCachedSongsFolder();
    const BATCH_SIZE = 25; // Process 25 songs at a time (each song has metadata + chordpro files)

    // Process new files in chunks (concurrent uploads within each chunk)
    for (let i = 0; i < songsToSync.length; i += BATCH_SIZE) {
      const batch = songsToSync.slice(i, i + BATCH_SIZE);

      // Prepare all files for this batch (metadata + chordpro files)
      const files = [];
      const fileTracking = []; // Track what each uploaded file corresponds to

      for (const { song, versionsToSync } of batch) {
        // Get title from first version
        const firstVersion = versionsToSync[0];
        const parsed = this.parser.parse(firstVersion.chordproFile.content);
        const title = parsed.metadata.title || 'Untitled';
        const ccliNumber = song.ccliNumber || '';

        // Add all chordpro files for this song (each with complete metadata in appProperties)
        for (const { version, chordproFile } of versionsToSync) {
          const versionLabel = version.label || 'Original';
          const filename = generateChordProFilename(title, ccliNumber, versionLabel);

          files.push({
            metadata: {
              name: filename,
              parents: [songsFolderId],
              mimeType: 'text/plain',
              appProperties: {
                // File type
                setalightType: 'chordpro',

                // Song-level metadata
                songId: song.id,
                ccliNumber: ccliNumber,
                title: title,
                titleNormalized: song.titleNormalized,

                // Version-level metadata
                versionId: version.id,
                versionLabel: versionLabel,
                contentHash: chordproFile.contentHash,

                // Timestamps
                createdAt: song.createdAt,
                updatedAt: song.updatedAt,

                // App version
                appVersion: '1.0.0',
              },
            },
            content: chordproFile.content,
            contentType: 'text/plain; charset=utf-8',
          });
          fileTracking.push({ type: 'chordpro', song, version, chordproFile });
        }
      }

      if (files.length === 0) continue;

      try {
        console.log(`[DriveSync] Uploading ${files.length} files (${batch.length} songs)...`);
        const uploadedFiles = await batchUploadFiles(files);

        // Update local records with Drive metadata
        const updatedSongs = new Map();

        for (let j = 0; j < fileTracking.length; j++) {
          const tracking = fileTracking[j];
          const driveFile = uploadedFiles[j];

          if (!driveFile || !driveFile.id) continue;

          // All files are chordpro now (no separate metadata files)
          tracking.version.driveChordproFileId = driveFile.id;
          tracking.version.driveProperties = {
            songId: tracking.song.id,
            versionId: tracking.version.id,
            contentHash: tracking.chordproFile.contentHash,
            ccliNumber: tracking.song.ccliNumber || '',
            title: this.parser.parse(tracking.chordproFile.content).metadata.title || 'Untitled',
            titleNormalized: tracking.song.titleNormalized,
            versionLabel: tracking.version.label || 'Original',
            appVersion: '1.0.0',
          };
          tracking.version.lastSyncedAt = new Date().toISOString();
          updatedSongs.set(tracking.song.id, tracking.song);
          processed++;
        }

        // Batch save updated songs to database
        if (updatedSongs.size > 0) {
          await this.songsDb.saveSongsBatch(Array.from(updatedSongs.values()));
        }

        console.log(`[DriveSync] ✅ Uploaded ${uploadedFiles.length} files`);
      } catch (error) {
        console.error(`[DriveSync] Concurrent upload failed:`, error);
        // Fallback to sequential uploads for this batch
        for (const { song, versionsToSync } of batch) {
          for (const { version, chordproFile } of versionsToSync) {
            try {
              await this.pushSongVersion(song, version, chordproFile);
              processed++;
            } catch (err) {
              console.error(
                `[DriveSync] Failed to upload song version ${song.id}/${version.id}:`,
                err
              );
            }
          }
        }
      }

      // Update progress
      if (progressCallback) {
        progressCallback({
          stage: 'pushing',
          message: `Uploaded ${processed}/${totalVersions} song versions`,
          current: processed,
          total: totalVersions,
        });
      }
    }

    // Process updates in parallel (individual API calls required)
    if (updatesToProcess.length > 0) {
      console.log(`[DriveSync] Updating ${updatesToProcess.length} existing song versions...`);

      for (let i = 0; i < updatesToProcess.length; i += this.CONCURRENT_LIMIT) {
        const batch = updatesToProcess.slice(i, i + this.CONCURRENT_LIMIT);

        const results = await Promise.allSettled(
          batch.map(({ song, version, chordproFile }) =>
            this.pushSongVersion(song, version, chordproFile)
          )
        );

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        processed += succeeded;

        // Update progress
        if (progressCallback) {
          progressCallback({
            stage: 'pushing',
            message: `Uploaded ${processed}/${totalVersions} song versions`,
            current: processed,
            total: totalVersions,
          });
        }
      }
    }

    console.log(`[DriveSync] ✅ Pushed ${processed} song versions`);
  }

  /**
   * Push a specific song version to Drive
   */
  async pushSongVersion(song, version, chordproFile) {
    try {
      if (!chordproFile) {
        console.warn(`[DriveSync] ChordPro file not found: ${version.chordproFileId}`);
        return;
      }

      // Parse chordpro to get title
      const parsed = this.parser.parse(chordproFile.content);
      const title = parsed.metadata.title || 'Untitled';
      const ccliNumber = song.ccliNumber || '';
      const versionLabel = version.label || 'Original';

      if (!version.driveChordproFileId) {
        // New version, upload it
        console.log(`[DriveSync] Uploading song version: ${title} (${song.id}/${version.id})`);

        const driveFile = await DriveAPI.uploadChordProFile(
          this.driveFolderId,
          song.id,
          version.id,
          title,
          ccliNumber,
          versionLabel,
          chordproFile.content,
          {
            titleNormalized: song.titleNormalized,
            contentHash: chordproFile.contentHash,
            createdAt: song.createdAt,
            updatedAt: song.updatedAt,
          }
        );

        // Update version with Drive metadata
        version.driveChordproFileId = driveFile.id;
        version.driveProperties = {
          songId: song.id,
          versionId: version.id,
          contentHash: chordproFile.contentHash,
          ccliNumber: ccliNumber,
          title: title,
          titleNormalized: song.titleNormalized,
          versionLabel: versionLabel,
          appVersion: '1.0.0',
        };
        version.lastSyncedAt = new Date().toISOString();

        await this.songsDb.saveSong(song);

        console.log(`[DriveSync] ✅ Uploaded song version: ${title}`);
      } else {
        // Existing version, update it
        console.log(`[DriveSync] Updating song version: ${title} (${song.id}/${version.id})`);

        await DriveAPI.updateChordProFile(version.driveChordproFileId, chordproFile.content, {
          contentHash: chordproFile.contentHash,
          ccliNumber: ccliNumber,
          title: title,
          titleNormalized: song.titleNormalized,
          versionLabel: versionLabel,
          updatedAt: song.updatedAt,
        });

        // Update sync metadata
        version.lastSyncedAt = new Date().toISOString();
        await this.songsDb.saveSong(song);

        console.log(`[DriveSync] ✅ Updated song version: ${title}`);
      }
    } catch (error) {
      console.error(`[DriveSync] Failed to push song version ${song.id}/${version.id}:`, error);
      throw error; // Re-throw for Promise.allSettled
    }
  }
}

/**
 * Helper functions
 */

/**
 * Check if Drive sync is available (user is authenticated)
 */
export async function isSyncAvailable() {
  return DriveAPI.checkDriveAccess();
}

/**
 * Create a sync manager for an organisation
 */
export async function createSyncManager(organisationName, organisationId) {
  const manager = new DriveSyncManager(organisationName, organisationId);
  await manager.init();
  return manager;
}
