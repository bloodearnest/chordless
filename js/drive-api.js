/**
 * Google Drive API Helper
 *
 * Handles all interactions with Google Drive API for Setalight.
 *
 * Folder Structure:
 * - Setalight/ (root)
 *   - [Organisation Name]/
 *     - songs/
 *       - [song-id]/
 *         - [version-id].chordpro
 *     - setlists/
 *       - [setlist-id].json
 */

import * as GoogleAuth from './google-auth.js'

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3'

const ROOT_FOLDER_NAME = 'Setalight'
const PADS_FOLDER_NAME = 'pads'
const PADSET_CATEGORY = 'padset'
const PADSET_FILE_CATEGORY = 'padsetFile'
const APP_VERSION = '1.0.0'

/**
 * Helper functions for human-readable filenames
 */

/**
 * Generate human-readable song folder name
 * Format: title-ccli (e.g., "amazing-grace-4779")
 */
export function generateSongFolderName(title, ccliNumber) {
  const normalizedTitle = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Spaces to dashes
    .replace(/--+/g, '-') // Multiple dashes to single
    .trim()

  if (ccliNumber) {
    return `${normalizedTitle}-${ccliNumber}`
  }
  return normalizedTitle
}

/**
 * Generate human-readable chordpro filename
 * Format: title-ccli.txt (e.g., "amazing-grace-4779.txt")
 */
export function generateChordProFilename(title, ccliNumber, _versionLabel) {
  const baseName = generateSongFolderName(title, ccliNumber)
  return `${baseName}.txt`
}

/**
 * Generate metadata filename for a song
 * Format: title-ccli.metadata.json (e.g., "amazing-grace-4779.metadata.json")
 */
export function generateMetadataFilename(title, ccliNumber) {
  const baseName = generateSongFolderName(title, ccliNumber)
  return `${baseName}.metadata.json`
}

/**
 * Generate human-readable setlist filename
 * Format: date-leader-type[-name].json (e.g., "2025-11-10-john-smith-sunday-morning-service.json")
 */
export function generateSetlistFilename(date, type, leader, name) {
  const parts = [date]

  // Add leader name
  if (leader) {
    const normalizedLeader = leader
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim()
    if (normalizedLeader) parts.push(normalizedLeader)
  }

  // Add type (Sunday, Midweek, Special, etc.)
  if (type) {
    const normalizedType = type
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim()
    if (normalizedType) parts.push(normalizedType)
  }

  // Add event name
  if (name) {
    const normalizedName = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim()
    if (normalizedName) parts.push(normalizedName)
  }

  return parts.join('-') + '.json'
}

/**
 * Core Drive API operations
 */

/**
 * Make an authenticated request to Google Drive API
 */
export async function driveRequest(endpoint, options = {}) {
  const token = await GoogleAuth.getAccessToken()

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options.headers,
  }

  const response = await fetch(`${DRIVE_API_BASE}${endpoint}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
    throw new Error(`Drive API error: ${error.error?.message || response.statusText}`)
  }

  // Handle responses with no content (like DELETE operations)
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return null
  }

  return response.json()
}

/**
 * Batch delete multiple files (up to 100 at a time)
 */
export async function batchDeleteFiles(fileIds) {
  if (fileIds.length === 0) return

  const token = await GoogleAuth.getAccessToken()
  const boundary = '===============7330845974216740156=='

  // Build batch request body
  let batchBody = ''
  fileIds.forEach((fileId, index) => {
    batchBody += `--${boundary}\r\n`
    batchBody += `Content-Type: application/http\r\n`
    batchBody += `Content-ID: <item${index}>\r\n\r\n`
    batchBody += `DELETE /drive/v3/files/${fileId}\r\n\r\n`
  })
  batchBody += `--${boundary}--`

  const response = await fetch('https://www.googleapis.com/batch/drive/v3', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/mixed; boundary=${boundary}`,
    },
    body: batchBody,
  })

  if (!response.ok) {
    throw new Error(`Batch delete failed: ${response.statusText}`)
  }

  // Parse batch response
  const responseText = await response.text()
  const successCount = (responseText.match(/HTTP\/\d\.\d 2\d\d/g) || []).length

  console.log(`[DriveAPI] Batch deleted ${successCount}/${fileIds.length} files`)
  return successCount
}

/**
 * Concurrent upload of multiple files
 * Note: Google's Batch API doesn't support file content uploads, only metadata operations.
 * So we use high-concurrency individual uploads instead (much faster than sequential).
 *
 * @param {Array} files - Array of { metadata, content, contentType }
 * @returns {Promise<Array>} - Array of uploaded file responses
 */
export async function batchUploadFiles(files) {
  if (files.length === 0) return []

  const CONCURRENT_LIMIT = 30 // Upload 30 files at once
  const results = []

  console.log(
    `[DriveAPI] Uploading ${files.length} files with ${CONCURRENT_LIMIT} concurrent requests...`
  )

  // Process in chunks of CONCURRENT_LIMIT
  for (let i = 0; i < files.length; i += CONCURRENT_LIMIT) {
    const chunk = files.slice(i, i + CONCURRENT_LIMIT)

    // Upload all files in this chunk concurrently
    const uploadPromises = chunk.map(async file => {
      try {
        const token = await GoogleAuth.getAccessToken()
        const boundary = '-------314159265358979323846'
        const delimiter = `\r\n--${boundary}\r\n`
        const closeDelimiter = `\r\n--${boundary}--`

        const metadataBody = JSON.stringify(file.metadata)
        const body =
          delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          metadataBody +
          delimiter +
          `Content-Type: ${file.contentType || 'text/plain'}\r\n\r\n` +
          file.content +
          closeDelimiter

        const response = await fetch(`${UPLOAD_API_BASE}/files?uploadType=multipart`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: body,
        })

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: { message: response.statusText } }))
          throw new Error(`Upload error: ${error.error?.message || response.statusText}`)
        }

        return await response.json()
      } catch (error) {
        console.error(`[DriveAPI] Failed to upload file:`, error)
        return null // Return null for failed uploads
      }
    })

    // Wait for all uploads in this chunk to complete
    const chunkResults = await Promise.all(uploadPromises)

    // Filter out nulls (failed uploads) and add to results
    results.push(...chunkResults.filter(r => r !== null))

    console.log(`[DriveAPI] Progress: ${results.length}/${files.length} files uploaded`)
  }

  console.log(`[DriveAPI] Completed: ${results.length}/${files.length} files uploaded successfully`)
  return results
}

/**
 * Upload file content to Drive
 */
async function uploadFile(metadata, content, contentType = 'text/plain') {
  const token = await GoogleAuth.getAccessToken()
  const boundary = '-------314159265358979323846'
  const encoder = new TextEncoder()

  const headerJson = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
  )
  const metadataBytes = encoder.encode(JSON.stringify(metadata))
  const headerContent = encoder.encode(`\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`)
  const closing = encoder.encode(`\r\n--${boundary}--`)

  let contentBlob
  if (typeof content === 'string') {
    contentBlob = new Blob([encoder.encode(content)])
  } else if (content instanceof Blob) {
    contentBlob = content
  } else if (content instanceof ArrayBuffer) {
    contentBlob = new Blob([content])
  } else if (content instanceof Uint8Array) {
    contentBlob = new Blob([
      content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
    ])
  } else {
    throw new Error('Unsupported content type for Drive upload')
  }

  const body = new Blob([headerJson, metadataBytes, headerContent, contentBlob, closing], {
    type: `multipart/related; boundary=${boundary}`,
  })

  const response = await fetch(`${UPLOAD_API_BASE}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
    throw new Error(`Drive upload error: ${error.error?.message || response.statusText}`)
  }

  return response.json()
}

/**
 * Update existing file content
 */
async function updateFileContent(fileId, content, contentType = 'text/plain') {
  const token = await GoogleAuth.getAccessToken()

  const response = await fetch(`${UPLOAD_API_BASE}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: content,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: response.statusText } }))
    throw new Error(`Drive update error: ${error.error?.message || response.statusText}`)
  }

  return response.json()
}

/**
 * Download file content
 */
async function downloadFile(fileId) {
  const token = await GoogleAuth.getAccessToken()

  const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Drive download error: ${response.statusText}`)
  }

  return response.text()
}

export async function downloadFileBinary(fileId) {
  const token = await GoogleAuth.getAccessToken()

  const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Drive download error: ${response.statusText}`)
  }

  return response.arrayBuffer()
}

/**
 * Folder Management
 */

/**
 * Find or create the root "Setalight" folder
 */
export async function findOrCreateRootFolder() {
  console.log('[DriveAPI] Finding/creating root Setalight folder...')

  // Search for existing Setalight folder
  const query = `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
  )

  if (result.files && result.files.length > 0) {
    console.log('[DriveAPI] Found existing Setalight folder:', result.files[0].id)
    return result.files[0].id
  }

  // Create new root folder
  console.log('[DriveAPI] Creating new Setalight folder...')
  const folder = await driveRequest('/files', {
    method: 'POST',
    body: JSON.stringify({
      name: ROOT_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Setalight - Worship Setlist Management',
    }),
  })

  console.log('[DriveAPI] Created Setalight folder:', folder.id)
  return folder.id
}

/**
 * Find or create an organisation folder under Setalight/
 */
export async function findOrCreateOrganisationFolder(organisationName, organisationId) {
  console.log(`[DriveAPI] Finding/creating organisation folder: ${organisationName}`)

  const rootFolderId = await findOrCreateRootFolder()

  // Search for existing organisation folder by name and parent
  const query = `name='${organisationName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties)`
  )

  if (result.files && result.files.length > 0) {
    console.log('[DriveAPI] Found existing organisation folder:', result.files[0].id)
    return {
      folderId: result.files[0].id,
      isNew: false,
    }
  }

  // Create new organisation folder with appProperties
  console.log('[DriveAPI] Creating new organisation folder...')
  const folder = await driveRequest('/files', {
    method: 'POST',
    body: JSON.stringify({
      name: organisationName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
      appProperties: {
        setalightType: 'organisation',
        organisationId: organisationId,
        createdAt: new Date().toISOString(),
        appVersion: APP_VERSION,
      },
    }),
  })

  console.log('[DriveAPI] Created organisation folder:', folder.id)

  // Create songs and setlists subfolders
  await createSubfolder(folder.id, 'songs')
  await createSubfolder(folder.id, 'setlists')

  return {
    folderId: folder.id,
    isNew: true,
  }
}

export async function getPadsRootFolder() {
  const rootFolderId = await findOrCreateRootFolder()
  let padsFolderId = await findSubfolder(rootFolderId, PADS_FOLDER_NAME)
  if (!padsFolderId) {
    padsFolderId = await createSubfolder(rootFolderId, PADS_FOLDER_NAME)
  }
  return padsFolderId
}

export async function listPadSetFolders() {
  const padsRootId = await getPadsRootFolder()
  const query = `'${padsRootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)`
  )
  return result.files || []
}

export async function ensurePadSetFolder(padSetName) {
  const padsRootId = await getPadsRootFolder()
  const query = `name='${padSetName}' and '${padsRootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)`
  )

  if (result.files && result.files.length > 0) {
    const folder = result.files[0]
    await updatePadSetFolderMetadata(folder.id, padSetName)
    return folder.id
  }

  const folder = await driveRequest('/files', {
    method: 'POST',
    body: JSON.stringify({
      name: padSetName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [padsRootId],
      appProperties: {
        category: PADSET_CATEGORY,
        padSetName,
        appVersion: APP_VERSION,
        createdAt: new Date().toISOString(),
      },
    }),
  })

  return folder.id
}

export async function updatePadSetFolderMetadata(folderId, padSetName) {
  return driveRequest(`/files/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: padSetName,
      appProperties: {
        category: PADSET_CATEGORY,
        padSetName,
        appVersion: APP_VERSION,
        updatedAt: new Date().toISOString(),
      },
    }),
  })
}

export async function listPadSetFiles(folderId) {
  const query = `'${folderId}' in parents and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime,md5Checksum,mimeType)`
  )
  return result.files || []
}

export async function deleteFilesInFolder(folderId) {
  const files = await listPadSetFiles(folderId)
  const fileIds = files.map(file => file.id)
  if (fileIds.length > 0) {
    await batchDeleteFiles(fileIds)
  }
}

export async function uploadPadFile(folderId, key, blob) {
  const metadata = {
    name: `${key}.mp3`,
    parents: [folderId],
    appProperties: {
      category: PADSET_FILE_CATEGORY,
      padKey: key,
      padSetFolderId: folderId,
      appVersion: APP_VERSION,
      uploadedAt: new Date().toISOString(),
    },
  }

  return uploadFile(metadata, blob, 'audio/mpeg')
}

/**
 * Create a subfolder
 */
async function createSubfolder(parentId, name) {
  console.log(`[DriveAPI] Creating subfolder: ${name}`)

  const folder = await driveRequest('/files', {
    method: 'POST',
    body: JSON.stringify({
      name: name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  })

  return folder.id
}

/**
 * Find subfolder by name within a parent
 */
async function findSubfolder(parentId, name) {
  const query = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`
  )

  if (result.files && result.files.length > 0) {
    return result.files[0].id
  }

  return null
}

/**
 * Find or create a song folder with appProperties
 * Returns { folderId, isNew }
 */
export async function findOrCreateSongFolder(parentId, songId, folderName, properties = {}) {
  console.log(`[DriveAPI] Finding/creating song folder: ${folderName} (${songId})`)

  // First, try to find by appProperties.songId (most reliable)
  const queryByProps = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and properties has { key='songId' and value='${songId}' }`
  const resultByProps = await driveRequest(
    `/files?q=${encodeURIComponent(queryByProps)}&spaces=drive&fields=files(id,name,appProperties)`
  )

  if (resultByProps.files && resultByProps.files.length > 0) {
    console.log(`[DriveAPI] Found existing song folder by songId: ${resultByProps.files[0].id}`)
    return {
      folderId: resultByProps.files[0].id,
      isNew: false,
    }
  }

  // Fall back to finding by folder name
  const folderId = await findSubfolder(parentId, folderName)
  if (folderId) {
    console.log(`[DriveAPI] Found existing song folder by name: ${folderId}`)
    return {
      folderId: folderId,
      isNew: false,
    }
  }

  // Not found, create new folder with appProperties
  console.log(`[DriveAPI] Creating new song folder: ${folderName}`)
  const folder = await driveRequest('/files', {
    method: 'POST',
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
      appProperties: {
        setalightType: 'songFolder',
        songId: songId,
        ccliNumber: properties.ccliNumber || '',
        title: properties.title || '',
        appVersion: APP_VERSION,
      },
    }),
  })

  console.log(`[DriveAPI] Created song folder: ${folder.id}`)
  return {
    folderId: folder.id,
    isNew: true,
  }
}

/**
 * Get or create songs folder within organisation
 */
export async function getSongsFolder(orgFolderId) {
  let folderId = await findSubfolder(orgFolderId, 'songs')
  if (!folderId) {
    folderId = await createSubfolder(orgFolderId, 'songs')
  }
  return folderId
}

/**
 * Get or create setlists folder within organisation
 */
export async function getSetlistsFolder(orgFolderId) {
  let folderId = await findSubfolder(orgFolderId, 'setlists')
  if (!folderId) {
    folderId = await createSubfolder(orgFolderId, 'setlists')
  }
  return folderId
}

/**
 * Song Operations
 */

/**
 * Upload a chordpro file to Drive (flat structure)
 * Each file contains complete metadata in appProperties (self-contained)
 *
 * @param {string} organisationFolderId - Parent organisation folder ID
 * @param {string} songId - Internal song ID (for appProperties)
 * @param {string} versionId - Internal version ID (for appProperties)
 * @param {string} title - Song title (for filename)
 * @param {string} ccliNumber - CCLI number (for filename)
 * @param {string} versionLabel - Version label stored in appProperties (e.g., "Original")
 * @param {string} content - ChordPro file content
 * @param {object} metadata - Complete metadata object
 */
export async function uploadChordProFile(
  organisationFolderId,
  songId,
  versionId,
  title,
  ccliNumber,
  versionLabel,
  content,
  metadata = {}
) {
  console.log(`[DriveAPI] Uploading chordpro: ${title} (${songId}/${versionId})`)

  const songsFolderId = await getSongsFolder(organisationFolderId)

  // Generate human-readable filename (flat structure, no folder)
  const fileName = generateChordProFilename(title, ccliNumber, versionLabel)

  const fileMetadata = {
    name: fileName,
    parents: [songsFolderId], // Directly in songs/ folder
    appProperties: {
      // File type
      setalightType: 'chordpro',

      // Song-level metadata
      songId: songId,
      ccliNumber: ccliNumber || '',
      title: title,
      titleNormalized: metadata.titleNormalized || '',

      // Version-level metadata
      versionId: versionId,
      versionLabel: versionLabel,
      contentHash: metadata.contentHash || '',

      // Timestamps
      createdAt: metadata.createdAt || new Date().toISOString(),
      updatedAt: metadata.updatedAt || new Date().toISOString(),

      // App version
      appVersion: APP_VERSION,
    },
  }

  const file = await uploadFile(fileMetadata, content, 'text/plain')

  console.log(`[DriveAPI] Uploaded chordpro file: ${file.id} (${fileName})`)
  return file
}

/**
 * Download a chordpro file from Drive
 */
export async function downloadChordProFile(fileId) {
  console.log(`[DriveAPI] Downloading chordpro: ${fileId}`)
  return downloadFile(fileId)
}

/**
 * Update an existing chordpro file (content and metadata)
 */
export async function updateChordProFile(fileId, content, metadata = {}) {
  console.log(`[DriveAPI] Updating chordpro: ${fileId}`)

  // Update content
  await updateFileContent(fileId, content, 'text/plain')

  // Update appProperties with complete metadata (if provided)
  if (Object.keys(metadata).length > 0) {
    const appPropsUpdate = {
      appVersion: APP_VERSION,
    }

    // Add all provided metadata fields
    if (metadata.contentHash) appPropsUpdate.contentHash = metadata.contentHash
    if (metadata.ccliNumber !== undefined) appPropsUpdate.ccliNumber = metadata.ccliNumber
    if (metadata.title) appPropsUpdate.title = metadata.title
    if (metadata.titleNormalized) appPropsUpdate.titleNormalized = metadata.titleNormalized
    if (metadata.versionLabel) appPropsUpdate.versionLabel = metadata.versionLabel
    if (metadata.updatedAt) appPropsUpdate.updatedAt = metadata.updatedAt

    await driveRequest(`/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        appProperties: appPropsUpdate,
      }),
    })
  }

  console.log(`[DriveAPI] Updated chordpro file: ${fileId}`)
}

/**
 * Find chordpro file by songId and versionId (searches by appProperties)
 */
export async function findChordProFile(
  organisationFolderId,
  songId,
  versionId,
  title = null,
  ccliNumber = null
) {
  const songsFolderId = await getSongsFolder(organisationFolderId)

  // If we have title/ccli, try to find the folder by name first
  if (title) {
    const folderName = generateSongFolderName(title, ccliNumber)
    const songFolderId = await findSubfolder(songsFolderId, folderName)

    if (songFolderId) {
      // Search for file by appProperties within this folder
      const query = `'${songFolderId}' in parents and trashed=false and properties has { key='songId' and value='${songId}' } and properties has { key='versionId' and value='${versionId}' }`
      const result = await driveRequest(
        `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)`
      )

      if (result.files && result.files.length > 0) {
        return result.files[0]
      }
    }
  }

  // Fallback: search by appProperties across all songs folders
  const query = `'${songsFolderId}' in parents and trashed=false and properties has { key='songId' and value='${songId}' } and properties has { key='versionId' and value='${versionId}' }`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)`
  )

  if (result.files && result.files.length > 0) {
    return result.files[0]
  }

  return null
}

/**
 * Setlist Operations
 */

/**
 * Upload a setlist to Drive
 */
export async function uploadSetlist(organisationFolderId, setlistId, setlistData, organisationId) {
  console.log(`[DriveAPI] Uploading setlist: ${setlistId}`)

  const setlistsFolderId = await getSetlistsFolder(organisationFolderId)

  // Generate human-readable filename
  const fileName = generateSetlistFilename(
    setlistData.date || setlistId,
    setlistData.type || '',
    setlistData.owner || '',
    setlistData.name || ''
  )

  const fileMetadata = {
    name: fileName,
    parents: [setlistsFolderId],
    appProperties: {
      setalightType: 'setlist',
      setlistId: setlistId,
      organisationId: organisationId,
      date: setlistData.date || '',
      type: setlistData.type || '',
      leader: setlistData.leader || '',
      name: setlistData.name || '',
      appVersion: APP_VERSION,
    },
  }

  const content = JSON.stringify(setlistData, null, 2)
  const file = await uploadFile(fileMetadata, content, 'application/json')

  console.log(`[DriveAPI] Uploaded setlist: ${file.id} (${fileName})`)
  return file
}

/**
 * Download a setlist from Drive
 */
export async function downloadSetlist(fileId) {
  console.log(`[DriveAPI] Downloading setlist: ${fileId}`)
  const content = await downloadFile(fileId)
  return JSON.parse(content)
}

/**
 * Update an existing setlist
 */
export async function updateSetlist(fileId, setlistData) {
  console.log(`[DriveAPI] Updating setlist: ${fileId}`)
  const content = JSON.stringify(setlistData, null, 2)
  await updateFileContent(fileId, content, 'application/json')
  console.log(`[DriveAPI] Updated setlist: ${fileId}`)
}

/**
 * Find setlist file by setlistId (searches by appProperties)
 */
export async function findSetlist(organisationFolderId, setlistId) {
  const setlistsFolderId = await getSetlistsFolder(organisationFolderId)

  // Search by appProperties
  const query = `'${setlistsFolderId}' in parents and trashed=false and properties has { key='setlistId' and value='${setlistId}' }`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)`
  )

  if (result.files && result.files.length > 0) {
    return result.files[0]
  }

  return null
}

/**
 * List all setlists in organisation folder
 */
export async function listSetlists(organisationFolderId) {
  const setlistsFolderId = await getSetlistsFolder(organisationFolderId)

  const query = `'${setlistsFolderId}' in parents and trashed=false and name contains '.json'`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,modifiedTime)&orderBy=modifiedTime desc`
  )

  return result.files || []
}

/**
 * Discovery Operations
 */

/**
 * List all Setalight organisation folders
 */
export async function listOrganisations() {
  console.log('[DriveAPI] Listing all Setalight organisations...')

  const rootFolderId = await findOrCreateRootFolder()

  // Find all folders in Setalight root with setalightType=organisation
  const query = `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const result = await driveRequest(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name,appProperties,createdTime)`
  )

  // Filter to only Setalight organisation folders
  const organisations = (result.files || []).filter(
    folder => folder.appProperties?.setalightType === 'organisation'
  )

  console.log(`[DriveAPI] Found ${organisations.length} organisations`)
  return organisations
}

/**
 * Helper function to check if user is authenticated and has Drive access
 */
export async function checkDriveAccess() {
  try {
    await GoogleAuth.getAccessToken()
    // Try a simple API call to verify access
    await driveRequest('/about?fields=user')
    return true
  } catch (error) {
    console.warn('[DriveAPI] No Drive access:', error.message)
    return false
  }
}
