/**
 * Drive Cleanup Utility
 *
 * Temporary utility for testing batch deletion.
 * Usage from browser console:
 *
 * const { deleteTestFolder } = await import('/js/drive-cleanup-util.js');
 * await deleteTestFolder('TEST');
 */

import { driveRequest, batchDeleteFiles } from './drive-api.js';

/**
 * Find folder by name
 */
async function findFolderByName(folderName, parentId = null) {
  let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
  );

  if (result.files && result.files.length > 0) {
    return result.files[0];
  }

  return null;
}

/**
 * Delete all contents of a folder (batch)
 */
async function deleteFolderContentsBatch(folderId) {
  console.log(`[Cleanup] Scanning folder: ${folderId}`);

  const query = `'${folderId}' in parents and trashed=false`;
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,mimeType)`
  );

  if (!result.files || result.files.length === 0) {
    console.log('[Cleanup] Folder is empty');
    return 0;
  }

  console.log(`[Cleanup] Found ${result.files.length} items`);

  // First, recursively delete contents of subfolders
  const folders = result.files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
  let subfolderCount = 0;

  for (const folder of folders) {
    console.log(`[Cleanup] Processing subfolder: ${folder.name}`);
    const deleted = await deleteFolderContentsBatch(folder.id);
    subfolderCount += deleted;
  }

  // Collect all file IDs (including now-empty folders)
  const fileIds = result.files.map(f => f.id);

  // Batch delete in chunks of 50
  const BATCH_SIZE = 50;
  let totalDeleted = 0;

  for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
    const batch = fileIds.slice(i, i + BATCH_SIZE);
    try {
      const deleted = await batchDeleteFiles(batch);
      totalDeleted += deleted;
      console.log(
        `[Cleanup] Batch deleted ${deleted} files (${totalDeleted}/${fileIds.length} in this folder)`
      );
    } catch (error) {
      console.warn(`[Cleanup] Batch delete failed:`, error.message);
      // Fallback to individual deletion
      for (const fileId of batch) {
        try {
          await driveRequest(`/files/${fileId}`, { method: 'DELETE' });
          totalDeleted++;
        } catch (err) {
          console.warn(`[Cleanup] Failed to delete ${fileId}:`, err.message);
        }
      }
    }
  }

  console.log(`[Cleanup] ✅ Deleted ${totalDeleted} items from this folder`);
  return totalDeleted + subfolderCount;
}

/**
 * Delete contents of a named folder (e.g., "TEST")
 */
export async function deleteTestFolder(folderName = 'TEST') {
  console.log(`[Cleanup] Looking for folder: ${folderName}`);

  const folder = await findFolderByName(folderName);

  if (!folder) {
    console.log(`[Cleanup] ❌ Folder "${folderName}" not found`);
    return;
  }

  console.log(`[Cleanup] Found folder: ${folder.name} (${folder.id})`);
  console.log(`[Cleanup] Starting deletion...`);

  const totalDeleted = await deleteFolderContentsBatch(folder.id);

  console.log(`[Cleanup] ✅ Complete! Deleted ${totalDeleted} total items from "${folderName}"`);
  return totalDeleted;
}

/**
 * Delete the folder itself after clearing contents
 */
export async function deleteTestFolderCompletely(folderName = 'TEST') {
  const folder = await findFolderByName(folderName);

  if (!folder) {
    console.log(`[Cleanup] ❌ Folder "${folderName}" not found`);
    return;
  }

  console.log(`[Cleanup] Deleting contents...`);
  await deleteFolderContentsBatch(folder.id);

  console.log(`[Cleanup] Deleting folder itself...`);
  await driveRequest(`/files/${folder.id}`, { method: 'DELETE' });

  console.log(`[Cleanup] ✅ Complete! Folder "${folderName}" deleted`);
}

// Make available globally for console use
window.driveCleanup = {
  deleteTestFolder,
  deleteTestFolderCompletely,
};

console.log('[Cleanup] Drive cleanup utilities loaded. Use: driveCleanup.deleteTestFolder("TEST")');
